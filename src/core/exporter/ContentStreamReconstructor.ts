// True In-Place PDF Content Stream Reconstructor
import {
  ContentOperator,
  PdfArray,
  PdfDict,
  PdfName,
  PdfObject,
  PdfRef,
  PdfStream,
  PdfString,
} from '../types/pdf';
import {
  DocumentModel,
  EditableObject,
  ImageObject,
  Matrix2D,
  PageModel,
  ShapeObject,
  TableObject,
  TextObject,
} from '../types/model';
import { ContentStreamParser } from '../pdf/ContentStreamParser';
import { CoordinateSystem } from '../coords/CoordinateSystem';
import { FlateDecoder } from '../pdf/FlateDecoder';
import { FontEngine } from '../pdf/FontEngine';
import { PdfParser } from '../pdf/PdfParser';
import { ImageDecoder } from './ImageDecoder';

export class ContentStreamReconstructor {
  private fontEngine: FontEngine;

  constructor(private parser?: PdfParser, fontEngine?: FontEngine) {
    this.fontEngine = fontEngine || new FontEngine();
  }

  /**
   * Reconstruct and serialize the content stream for a given page.
   *
   * Key correctness rule: any pdf_source object that the user has NOT modified
   * (obj.isModified is not true) is passed through as the *exact original bytes*
   * from the source stream. It is never round-tripped through decode -> JS string
   * -> re-encode, which is what previously caused encoding corruption (non-ASCII
   * string bytes get mangled by UTF-8 re-encoding), font/positioning drift, and
   * loss of operators (kerning arrays, word spacing, unsupported color ops, stray
   * graphics in between grouped text runs) that the simplified object model
   * doesn't fully capture. Only objects that are actually edited, or newly
   * user-created, go through the lossy serializer below.
   *
   * `sourceStreams` should be the ORIGINAL decoded content stream(s) for this
   * page, keyed by the same streamIndex values recorded in sourcePdfRef at parse
   * time (a page can have more than one /Contents stream).
   */
  reconstructPageStream(
    page: PageModel,
    doc: DocumentModel,
    sourceStreams?: { data: Uint8Array; streamIndex: number }[],
    pageDict?: PdfDict
  ): { streamBytes: Uint8Array; newResources: { fonts: Map<string, PdfRef>; xobjects: Map<string, PdfStream> } } {
    const newFonts = new Map<string, PdfRef>();
    const newXObjects = new Map<string, PdfStream>();

    if (doc.fonts) {
      for (const [key, fontDesc] of doc.fonts.entries()) {
        if (!this.fontEngine.getFont(key)) {
          this.fontEngine.registerFont(key, fontDesc);
        }
      }
    }

    const userCreatedObjects: EditableObject[] = page.objects.filter((o) => o.origin === 'user_created' && o.visible && !o.id.startsWith('mask_'));

    // Group tracked pdf_source objects by the stream they came from, keyed by
    // their startOpIndex WITHIN that stream (matches how interpretPage assigns
    // opIdx, which restarts at 0 for every content stream).
    const byStream = new Map<number, Map<number, EditableObject>>();
    for (const obj of page.objects) {
      if (obj.origin === 'pdf_source' && obj.sourcePdfRef) {
        const streamIdx = obj.sourcePdfRef.streamIndex;
        if (!byStream.has(streamIdx)) byStream.set(streamIdx, new Map());
        byStream.get(streamIdx)!.set(obj.sourcePdfRef.startOpIndex, obj);
      }
    }

    const outputChunks: Uint8Array[] = [];
    const pushText = (s: string) => {
      if (s) outputChunks.push(new TextEncoder().encode(s));
    };
    const pushRaw = (b: Uint8Array) => {
      if (b.length) outputChunks.push(b);
    };
    const NEWLINE = new Uint8Array([0x0a]);

    if (!sourceStreams || sourceStreams.length === 0) {
      // No original stream available at all (brand new page, or original bytes
      // weren't retained) - fall back to serializing every object directly.
      for (const obj of page.objects) {
        if (!obj.visible) continue;
        const opString = this.serializeEditableObject(obj, newFonts, newXObjects);
        if (opString) {
          pushText(opString);
          pushRaw(NEWLINE);
        }
      }
    } else {
      let lastActiveCtm: Matrix2D = CoordinateSystem.identity();

      for (const { data, streamIndex } of sourceStreams) {
        const streamParser = new ContentStreamParser(this.parser || new PdfParser(new Uint8Array()), this.fontEngine);
        const streamOps = streamParser.parseOperators(data);
        const trackedForStream = byStream.get(streamIndex) || new Map();

        let skipUntilOpIndex = -1;
        let inText = false;

        let currentCtm: Matrix2D = CoordinateSystem.identity();
        const ctmStack: Matrix2D[] = [];

        for (let i = 0; i < streamOps.length; i++) {
          const op = streamOps[i];

          // Track CTM state through stream
          if (op.op === 'q') {
            ctmStack.push([...currentCtm]);
          } else if (op.op === 'Q') {
            if (ctmStack.length > 0) currentCtm = ctmStack.pop()!;
          } else if (op.op === 'cm' && op.args.length >= 6) {
            const cmM: Matrix2D = [
              Number(op.args[0]),
              Number(op.args[1]),
              Number(op.args[2]),
              Number(op.args[3]),
              Number(op.args[4]),
              Number(op.args[5]),
            ];
            currentCtm = CoordinateSystem.multiply(cmM, currentCtm);
          }

          if (i <= skipUntilOpIndex) continue;

          const trackedObj = trackedForStream.get(i);

          if (trackedObj && trackedObj.sourcePdfRef) {
            const endIdx = trackedObj.sourcePdfRef.endOpIndex;
            skipUntilOpIndex = endIdx;

            if (!trackedObj.visible) {
              continue; // deleted by user - emit nothing for this span
            }

            const wasEdited = trackedObj.isModified === true;
            if (!wasEdited) {
              // Byte-exact passthrough of the untouched original span
              const startOp = streamOps[i];
              const endOp = streamOps[Math.min(endIdx, streamOps.length - 1)];
              if (
                typeof startOp.startByte === 'number' &&
                typeof endOp.endByte === 'number'
              ) {
                pushRaw(data.subarray(startOp.startByte, endOp.endByte));
                pushRaw(NEWLINE);
              } else {
                const opString = this.serializeEditableObject(trackedObj, newFonts, newXObjects, currentCtm);
                if (opString) {
                  pushText(opString);
                  pushRaw(NEWLINE);
                }
              }
            } else {
              // Edited: close any in-flight text block first to prevent nested BT
              if (inText) {
                pushText('ET');
                pushRaw(NEWLINE);
                inText = false;
              }
              const opString = this.serializeEditableObject(trackedObj, newFonts, newXObjects, currentCtm);
              if (opString) {
                pushText(opString);
                pushRaw(NEWLINE);
              }
            }
          } else {
            // Track inText state on untracked operators to avoid redundant ET
            if (op.op === 'BT') {
              inText = true;
            } else if (op.op === 'ET') {
              if (!inText) continue; // skip unmatched ET
              inText = false;
            }

            if (typeof op.startByte === 'number' && typeof op.endByte === 'number') {
              pushRaw(data.subarray(op.startByte, op.endByte));
              pushRaw(NEWLINE);
            } else {
              const opStr = this.serializeSingleOperator(op);
              if (opStr) {
                pushText(opStr);
                pushRaw(NEWLINE);
              }
            }
          }
        }
        if (inText) {
          pushText('ET');
          pushRaw(NEWLINE);
        }

        lastActiveCtm = currentCtm;
      }

      // Append newly inserted user elements (with active CTM compensation)
      for (const userObj of userCreatedObjects) {
        const opString = this.serializeEditableObject(userObj, newFonts, newXObjects, lastActiveCtm);
        if (opString) {
          pushText(opString);
          pushRaw(NEWLINE);
        }
      }
    }

    const totalLen = outputChunks.reduce((sum, c) => sum + c.length, 0);
    const streamBytes = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of outputChunks) {
      streamBytes.set(chunk, offset);
      offset += chunk.length;
    }

    return {
      streamBytes,
      newResources: {
        fonts: newFonts,
        xobjects: newXObjects,
      },
    };
  }

  /**
   * Serialize an EditableObject into genuine PDF operators
   */
  private serializeEditableObject(
    obj: EditableObject,
    newFonts: Map<string, PdfRef>,
    newXObjects: Map<string, PdfStream>,
    activeCtm: Matrix2D = CoordinateSystem.identity()
  ): string {
    if (obj.type === 'text') {
      return this.serializeTextObject(obj, newFonts, activeCtm);
    } else if (obj.type === 'image') {
      return this.serializeImageObject(obj, newXObjects, activeCtm);
    } else if (obj.type === 'shape') {
      return this.serializeShapeObject(obj, activeCtm);
    } else if (obj.type === 'table') {
      return this.serializeTableObject(obj, newFonts);
    }
    return '';
  }

  private getBestStandardFont(fontName: string, bold: boolean, italic: boolean): string {
    const fn = (fontName || '').toLowerCase();
    
    if (fn.includes('symbol') || fn.includes('math')) return '/F_Symb';
    if (fn.includes('zapf')) return '/F_Zapf';

    let base = 'Helv';
    if (fn.includes('times') || fn.includes('serif') || fn.includes('minion') || fn.includes('garamond') || fn.includes('georgia') || fn.includes('cambria')) {
      base = 'Times';
    } else if (fn.includes('courier') || fn.includes('mono') || fn.includes('consolas')) {
      base = 'Cour';
    }

    if (bold && italic) return `/F_${base}BI`;
    if (bold) return `/F_${base}B`;
    if (italic) return `/F_${base}I`;
    return `/F_${base}`;
  }

  /**
   * Serialize a TextObject into compliant BT ... ET stream
   */
  private serializeTextObject(
    textObj: TextObject,
    newFonts: Map<string, PdfRef>,
    activeCtm: Matrix2D = CoordinateSystem.identity()
  ): string {
    const lines: string[] = [];
    lines.push('q'); // save state

    // Color
    const rgb = this.parseColorToRgb(textObj.fillColor);
    lines.push(`${(rgb.r / 255).toFixed(3)} ${(rgb.g / 255).toFixed(3)} ${(rgb.b / 255).toFixed(3)} rg`);

    lines.push('BT'); // Begin Text

    // 1. Try encoding with original font if available and capable of encoding all characters
    let fontKey = '';
    let textOp = '';

    const origFont = textObj.pdfFontKey ? this.fontEngine.getFont(textObj.pdfFontKey) : undefined;
    const isSameFont = origFont && (
      textObj.fontName === origFont.name ||
      textObj.fontName === origFont.cleanName ||
      textObj.fontName === origFont.name.replace(/^[A-Z]{6}\+/, '')
    );

    if (origFont && textObj.pdfFontKey && isSameFont) {
      // Check if we can serialize as TJ array preserving original run adjustments
      const runsText = (textObj.runs || []).map((r) => r.text).join('');
      if (textObj.runs && textObj.runs.length > 1 && runsText === textObj.text) {
        const tjItems: string[] = [];
        let canEncodeAllRuns = true;

        for (const run of textObj.runs) {
          if (!run.text) continue;
          const enc = this.fontEngine.encodeStringWithStatus(run.text, origFont);
          if (enc.canMapAll) {
            let hex = '';
            for (let b = 0; b < enc.pdfString.bytes.length; b++) {
              hex += enc.pdfString.bytes[b].toString(16).padStart(2, '0');
            }
            tjItems.push(`<${hex}>`);
            if (typeof run.rawTJAdjustment === 'number' && run.rawTJAdjustment !== 0) {
              tjItems.push(run.rawTJAdjustment.toString());
            }
          } else {
            canEncodeAllRuns = false;
            break;
          }
        }

        if (canEncodeAllRuns && tjItems.length > 0) {
          fontKey = `/${textObj.pdfFontKey}`;
          textOp = `[ ${tjItems.join(' ')} ] TJ`;
        }
      }

      if (!textOp) {
        const encodeRes = this.fontEngine.encodeStringWithStatus(textObj.text, origFont);
        if (encodeRes.canMapAll && encodeRes.encodedByteLength > 0) {
          fontKey = `/${textObj.pdfFontKey}`;
          if (encodeRes.pdfString.isHex || origFont.type === 'Type0') {
            let hex = '';
            const bytes = encodeRes.pdfString.bytes;
            for (let i = 0; i < bytes.length; i++) {
              hex += bytes[i].toString(16).padStart(2, '0');
            }
            textOp = `<${hex}> Tj`;
          } else {
            textOp = `(${this.escapePdfString(encodeRes.pdfString.toText())}) Tj`;
          }
        }
      }
    }

    const hasNewlines = textObj.text.includes('\n');
    const leading = textObj.lineHeight || (textObj.fontSize * 1.2);

    if (!fontKey || hasNewlines) {
      // Fallback or Multiline: dynamically match Standard 14 PDF fonts and handle multi-line paragraph stepping
      if (!fontKey) {
        fontKey = this.getBestStandardFont(textObj.fontName, textObj.bold || false, textObj.italic || false);
      }
      if (hasNewlines) {
        const textLines = textObj.text.split('\n');
        const textOps: string[] = [];
        for (let i = 0; i < textLines.length; i++) {
          const lineStr = textLines[i];
          if (i === 0) {
            textOps.push(`${this.encodeWinAnsi(lineStr)} Tj`);
          } else {
            textOps.push(`T* ${this.encodeWinAnsi(lineStr)} Tj`);
          }
        }
        textOp = textOps.join('\n');
      } else {
        textOp = `${this.encodeWinAnsi(textObj.text)} Tj`;
      }
    }

    lines.push(`${fontKey} ${textObj.fontSize.toFixed(2)} Tf`);

    // Character spacing, word spacing & leading
    if (textObj.charSpacing !== 0) {
      lines.push(`${textObj.charSpacing.toFixed(2)} Tc`);
    }
    if (textObj.wordSpacing) {
      lines.push(`${textObj.wordSpacing.toFixed(2)} Tw`);
    }
    lines.push(`${leading.toFixed(2)} TL`);

    // The stored textObj.matrix = textMatrix × CTM (absolute combined matrix from parsing).
    // To emit the correct Tm inside the current CTM context:
    //   emitted_Tm × activeCtm = textObj.matrix
    //   emitted_Tm = textObj.matrix × activeCtm^(-1)
    // If activeCtm is identity (no cm operators), emitted_Tm = textObj.matrix directly.
    const m = textObj.matrix;
    const invCtm = CoordinateSystem.invert(activeCtm);
    const localMatrix = invCtm ? CoordinateSystem.multiply(m, invCtm) : m;

    lines.push(`${localMatrix[0].toFixed(4)} ${localMatrix[1].toFixed(4)} ${localMatrix[2].toFixed(4)} ${localMatrix[3].toFixed(4)} ${localMatrix[4].toFixed(2)} ${localMatrix[5].toFixed(2)} Tm`);

    lines.push(textOp);

    lines.push('ET'); // End Text
    lines.push('Q'); // restore state

    return lines.join('\n');
  }

  /**
   * Serialize an ImageObject into a genuine /Do XObject operator
   */
  private serializeImageObject(
    imgObj: ImageObject,
    newXObjects: Map<string, PdfStream>,
    activeCtm: Matrix2D = CoordinateSystem.identity()
  ): string {
    // Generate or use resource name
    const xobjKey = imgObj.resourceName ? imgObj.resourceName.replace(/^\//, '') : `Im_Edit_${imgObj.id.replace(/\W/g, '_')}`;
    
    // Create new PDF Image XObject stream if user-created or if not from source PDF
    if (imgObj.src && !imgObj.sourcePdfRef && !newXObjects.has(xobjKey)) {
      const imgStream = this.createImageXObjectStream(imgObj);
      if (imgStream) {
        newXObjects.set(xobjKey, imgStream);
      }
    }

    const lines: string[] = [];
    lines.push('q'); // save state

    const x = imgObj.pdfBounds.x;
    const y = imgObj.pdfBounds.y;
    const w = imgObj.pdfBounds.width;
    const h = imgObj.pdfBounds.height;
    const rot = imgObj.rotation || 0;
    const rad = (rot * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const cx = x + w / 2;
    const cy = y + h / 2;

    const a = w * cos;
    const b = w * sin;
    const c = -h * sin;
    const d = h * cos;
    const e = cx - 0.5 * (w * cos - h * sin);
    const f = cy - 0.5 * (w * sin + h * cos);

    const targetImgMatrix: Matrix2D = [a, b, c, d, e, f];
    const invCtm = CoordinateSystem.invert(activeCtm);
    const localMatrix = invCtm ? CoordinateSystem.multiply(targetImgMatrix, invCtm) : targetImgMatrix;

    lines.push(`${localMatrix[0].toFixed(2)} ${localMatrix[1].toFixed(2)} ${localMatrix[2].toFixed(2)} ${localMatrix[3].toFixed(2)} ${localMatrix[4].toFixed(2)} ${localMatrix[5].toFixed(2)} cm`);
    lines.push(`/${xobjKey} Do`);
    lines.push('Q'); // restore state

    return lines.join('\n');
  }

  /**
   * Serialize a ShapeObject into PDF vector operators
   */
  private serializeShapeObject(
    shapeObj: ShapeObject,
    activeCtm: Matrix2D = CoordinateSystem.identity()
  ): string {
    const lines: string[] = [];
    lines.push('q'); // save state

    // If activeCtm or rotation is non-trivial, establish local transform
    const rot = shapeObj.rotation || 0;
    const hasCustomCtm = activeCtm[0] !== 1 || activeCtm[1] !== 0 || activeCtm[2] !== 0 || activeCtm[3] !== 1 || activeCtm[4] !== 0 || activeCtm[5] !== 0;

    if (rot !== 0 || hasCustomCtm) {
      const invCtm = CoordinateSystem.invert(activeCtm);
      if (rot !== 0) {
        const rad = (rot * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const cx = shapeObj.pdfBounds.x + shapeObj.pdfBounds.width / 2;
        const cy = shapeObj.pdfBounds.y + shapeObj.pdfBounds.height / 2;
        const rotM: Matrix2D = [
          cos,
          sin,
          -sin,
          cos,
          cx - cx * cos + cy * sin,
          cy - cx * sin - cy * cos,
        ];
        const localM = invCtm ? CoordinateSystem.multiply(rotM, invCtm) : rotM;
        lines.push(`${localM[0].toFixed(4)} ${localM[1].toFixed(4)} ${localM[2].toFixed(4)} ${localM[3].toFixed(4)} ${localM[4].toFixed(2)} ${localM[5].toFixed(2)} cm`);
      } else if (invCtm) {
        lines.push(`${invCtm[0].toFixed(4)} ${invCtm[1].toFixed(4)} ${invCtm[2].toFixed(4)} ${invCtm[3].toFixed(4)} ${invCtm[4].toFixed(2)} ${invCtm[5].toFixed(2)} cm`);
      }
    }

    lines.push(`${shapeObj.strokeWidth.toFixed(2)} w`);

    const hasStroke = shapeObj.strokeColor && shapeObj.strokeColor !== 'transparent';
    const hasFill = shapeObj.fillColor && shapeObj.fillColor !== 'transparent';

    if (hasStroke) {
      const sRgb = this.parseColorToRgb(shapeObj.strokeColor);
      lines.push(`${(sRgb.r / 255).toFixed(3)} ${(sRgb.g / 255).toFixed(3)} ${(sRgb.b / 255).toFixed(3)} RG`);
    }

    if (hasFill) {
      const fRgb = this.parseColorToRgb(shapeObj.fillColor!);
      lines.push(`${(fRgb.r / 255).toFixed(3)} ${(fRgb.g / 255).toFixed(3)} ${(fRgb.b / 255).toFixed(3)} rg`);
    }

    const { x, y, width: w, height: h } = shapeObj.pdfBounds;

    if (shapeObj.shapeType === 'rect') {
      lines.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
    } else if (shapeObj.shapeType === 'circle') {
      // 4-bezier curve circle approximation
      const kappa = 0.5522847498;
      const rx = w / 2;
      const ry = h / 2;
      const cx = x + rx;
      const cy = y + ry;
      const ox = rx * kappa;
      const oy = ry * kappa;

      lines.push(`${(cx - rx).toFixed(2)} ${cy.toFixed(2)} m`);
      lines.push(`${(cx - rx).toFixed(2)} ${(cy + oy).toFixed(2)} ${(cx - ox).toFixed(2)} ${(cy + ry).toFixed(2)} ${cx.toFixed(2)} ${(cy + ry).toFixed(2)} c`);
      lines.push(`${(cx + ox).toFixed(2)} ${(cy + ry).toFixed(2)} ${(cx + rx).toFixed(2)} ${(cy + oy).toFixed(2)} ${(cx + rx).toFixed(2)} ${cy.toFixed(2)} c`);
      lines.push(`${(cx + rx).toFixed(2)} ${(cy - oy).toFixed(2)} ${(cx + ox).toFixed(2)} ${(cy - ry).toFixed(2)} ${cx.toFixed(2)} ${(cy - ry).toFixed(2)} c`);
      lines.push(`${(cx - ox).toFixed(2)} ${(cy - ry).toFixed(2)} ${(cx - rx).toFixed(2)} ${(cy - oy).toFixed(2)} ${(cx - rx).toFixed(2)} ${cy.toFixed(2)} c`);
      lines.push('h');
    } else if (shapeObj.shapeType === 'line' || shapeObj.shapeType === 'arrow') {
      lines.push(`${x.toFixed(2)} ${y.toFixed(2)} m`);
      lines.push(`${(x + w).toFixed(2)} ${(y + h).toFixed(2)} l`);
    }

    if (hasFill && hasStroke) {
      lines.push('B');
    } else if (hasFill) {
      lines.push('f');
    } else if (hasStroke) {
      lines.push('S');
    }

    lines.push('Q'); // restore state
    return lines.join('\n');
  }

  /**
   * Serialize a TableObject into genuine PDF vector borders and text streams
   */
  private serializeTableObject(tableObj: TableObject, newFonts: Map<string, PdfRef>): string {
    const lines: string[] = [];
    const tableX = tableObj.pdfBounds.x;
    const tableTopY = tableObj.pdfBounds.y + tableObj.pdfBounds.height;

    // 1. Draw cell background fills & borders
    let currentY = tableTopY;
    for (let r = 0; r < tableObj.rows; r++) {
      const rowH = tableObj.rowHeights[r] || 20;
      let currentX = tableX;

      for (let c = 0; c < tableObj.cols; c++) {
        const colW = tableObj.colWidths[c] || 50;
        const cell = tableObj.cells[r]?.[c];

        if (cell) {
          const cellPdfY = currentY - rowH;

          // Fill
          if (cell.bgColor && cell.bgColor !== 'transparent') {
            lines.push('q');
            const bgRgb = this.parseColorToRgb(cell.bgColor);
            lines.push(`${(bgRgb.r / 255).toFixed(3)} ${(bgRgb.g / 255).toFixed(3)} ${(bgRgb.b / 255).toFixed(3)} rg`);
            lines.push(`${currentX.toFixed(2)} ${cellPdfY.toFixed(2)} ${colW.toFixed(2)} ${rowH.toFixed(2)} re f`);
            lines.push('Q');
          }

          // Border
          if (cell.borderWidth > 0 && cell.borderColor !== 'transparent') {
            lines.push('q');
            const bRgb = this.parseColorToRgb(cell.borderColor || tableObj.globalBorderColor || '#000000');
            lines.push(`${cell.borderWidth.toFixed(2)} w`);
            lines.push(`${(bRgb.r / 255).toFixed(3)} ${(bRgb.g / 255).toFixed(3)} ${(bRgb.b / 255).toFixed(3)} RG`);
            lines.push(`${currentX.toFixed(2)} ${cellPdfY.toFixed(2)} ${colW.toFixed(2)} ${rowH.toFixed(2)} re S`);
            lines.push('Q');
          }

          // Cell text
          if (cell.text && cell.text.trim().length > 0) {
            lines.push('q');
            const tRgb = this.parseColorToRgb(cell.textColor || '#000000');
            lines.push(`${(tRgb.r / 255).toFixed(3)} ${(tRgb.g / 255).toFixed(3)} ${(tRgb.b / 255).toFixed(3)} rg`);
            lines.push('BT');
            const fontKey = this.getBestStandardFont(cell.fontName || 'Helvetica', cell.bold || false, cell.italic || false);
            lines.push(`${fontKey} ${(cell.fontSize || 10).toFixed(2)} Tf`);

            const textPad = cell.padding || 4;
            const textX = currentX + textPad;
            const textY = cellPdfY + (rowH / 2) - (cell.fontSize / 3);

            lines.push(`1 0 0 1 ${textX.toFixed(2)} ${textY.toFixed(2)} Tm`);
            lines.push(`${this.encodeWinAnsi(cell.text)} Tj`);
            lines.push('ET');
            lines.push('Q');
          }
        }

        currentX += colW;
      }
      currentY -= rowH;
    }

    return lines.join('\n');
  }

  private serializeSingleOperator(op: ContentOperator): string {
    const serializedArgs = op.args
      .map((arg) => {
        if (arg instanceof PdfName) return arg.toString();
        if (arg instanceof PdfString) return `(${this.escapePdfString(arg.toText())})`;
        if (arg instanceof PdfRef) return arg.toString();
        if (typeof arg === 'number') return arg.toString();
        if (typeof arg === 'boolean') return arg ? 'true' : 'false';
        if (Array.isArray(arg)) {
          const items = arg.map((item) => {
            if (item instanceof PdfString) return `(${this.escapePdfString(item.toText())})`;
            return String(item);
          });
          return `[${items.join(' ')}]`;
        }
        return String(arg);
      })
      .join(' ');

    return serializedArgs ? `${serializedArgs} ${op.op}` : op.op;
  }

  private createImageXObjectStream(imgObj: ImageObject): PdfStream | null {
    if (!imgObj.src) return null;

    try {
      const decoded = ImageDecoder.decode(
        imgObj.src,
        imgObj.naturalWidth || Math.round(imgObj.pdfBounds.width),
        imgObj.naturalHeight || Math.round(imgObj.pdfBounds.height)
      );
      if (!decoded) {
        console.error('Failed to decode image data for XObject creation');
        return null;
      }

      const dict = new PdfDict();
      dict.set('Type', new PdfName('XObject'));
      dict.set('Subtype', new PdfName('Image'));
      dict.set('Width', decoded.width);
      dict.set('Height', decoded.height);
      dict.set('ColorSpace', new PdfName(decoded.colorSpace));
      dict.set('BitsPerComponent', 8);

      // Handle transparency with /SMask if present
      if (decoded.hasTransparency && decoded.alphaData && decoded.alphaData.length === decoded.width * decoded.height) {
        const smaskDict = new PdfDict();
        smaskDict.set('Type', new PdfName('XObject'));
        smaskDict.set('Subtype', new PdfName('Image'));
        smaskDict.set('Width', decoded.width);
        smaskDict.set('Height', decoded.height);
        smaskDict.set('ColorSpace', new PdfName('DeviceGray'));
        smaskDict.set('BitsPerComponent', 8);

        const compressedAlpha = FlateDecoder.encodeFlate(decoded.alphaData);
        smaskDict.set('Filter', new PdfName('FlateDecode'));
        smaskDict.set('Length', compressedAlpha.length);

        const smaskStream = new PdfStream(smaskDict, compressedAlpha);
        dict.set('SMask', smaskStream);
      }

      if (decoded.isDirectJpeg && decoded.jpegBytes) {
        dict.set('Filter', new PdfName('DCTDecode'));
        dict.set('Length', decoded.jpegBytes.length);
        return new PdfStream(dict, decoded.jpegBytes);
      } else {
        // Flate-encode the raw uncompressed RGB samples (width * height * 3 bytes)
        const compressed = FlateDecoder.encodeFlate(decoded.rgbData);
        dict.set('Filter', new PdfName('FlateDecode'));
        dict.set('Length', compressed.length);
        return new PdfStream(dict, compressed);
      }
    } catch (err) {
      console.error('Error creating image XObject:', err);
      return null;
    }
  }

  private parseColorToRgb(color: string): { r: number; g: number; b: number } {
    if (!color || color === 'transparent') return { r: 0, g: 0, b: 0 };

    if (color.startsWith('#')) {
      const hex = color.slice(1);
      if (hex.length === 3) {
        return {
          r: parseInt(hex[0] + hex[0], 16),
          g: parseInt(hex[1] + hex[1], 16),
          b: parseInt(hex[2] + hex[2], 16),
        };
      }
      return {
        r: parseInt(hex.substring(0, 2), 16) || 0,
        g: parseInt(hex.substring(2, 4), 16) || 0,
        b: parseInt(hex.substring(4, 6), 16) || 0,
      };
    }

    const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) {
      return {
        r: parseInt(rgbMatch[1], 10),
        g: parseInt(rgbMatch[2], 10),
        b: parseInt(rgbMatch[3], 10),
      };
    }

    return { r: 0, g: 0, b: 0 };
  }

  private escapePdfString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n');
  }

  /**
   * Unicode code point → WinAnsiEncoding byte value.
   * Standard 14 PDF fonts (Helvetica, Times, Courier, etc.) use WinAnsiEncoding.
   * Characters 0x20–0x7E map directly (ASCII). Characters above need explicit mapping.
   */
  private static readonly UNICODE_TO_WINANSI: Record<number, number> = {
    // C1 control area re-used by Windows-1252 / WinAnsiEncoding
    0x20AC: 0x80, // € Euro sign
    0x201A: 0x82, // ‚ single low-9 quotation
    0x0192: 0x83, // ƒ Latin small f with hook
    0x201E: 0x84, // „ double low-9 quotation
    0x2026: 0x85, // … horizontal ellipsis
    0x2020: 0x86, // † dagger
    0x2021: 0x87, // ‡ double dagger
    0x02C6: 0x88, // ˆ modifier letter circumflex
    0x2030: 0x89, // ‰ per mille sign
    0x0160: 0x8A, // Š S with caron
    0x2039: 0x8B, // ‹ single left-pointing angle quotation
    0x0152: 0x8C, // Œ OE ligature
    0x017D: 0x8E, // Ž Z with caron
    0x2018: 0x91, // ' left single quotation
    0x2019: 0x92, // ' right single quotation (apostrophe)
    0x201C: 0x93, // " left double quotation
    0x201D: 0x94, // " right double quotation
    0x2022: 0x95, // • bullet
    0x2013: 0x96, // – en dash
    0x2014: 0x97, // — em dash
    0x02DC: 0x98, // ˜ small tilde
    0x2122: 0x99, // ™ trade mark sign
    0x0161: 0x9A, // š s with caron
    0x203A: 0x9B, // › single right-pointing angle quotation
    0x0153: 0x9C, // œ oe ligature
    0x017E: 0x9E, // ž z with caron
    0x0178: 0x9F, // Ÿ Y with diaeresis
    // Latin-1 Supplement (0xA0–0xFF) maps 1:1 in WinAnsiEncoding
    // Common ligatures → approximate with multi-char or closest equivalent
    0xFB01: 0x66, // fi ligature → 'f' (best single-byte approximation)
    0xFB02: 0x66, // fl ligature → 'f'
  };

  /**
   * Encode a Unicode string into WinAnsiEncoding bytes for Standard 14 PDF fonts.
   * Returns a hex-encoded PDF string like <hex>.
   * Characters that can't be mapped are replaced with '?' (0x3F).
   */
  private encodeWinAnsi(text: string): string {
    const bytes: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const cp = text.codePointAt(i)!;
      // Skip high surrogate pair continuation
      if (cp > 0xFFFF) { i++; }

      let byte: number;
      if (cp >= 0x20 && cp <= 0x7E) {
        // ASCII printable range: direct mapping
        byte = cp;
      } else if (cp >= 0xA0 && cp <= 0xFF) {
        // Latin-1 Supplement: 1:1 mapping in WinAnsiEncoding
        byte = cp;
      } else if (cp === 0x0A || cp === 0x0D || cp === 0x09) {
        // Whitespace: newline, carriage return, tab
        byte = cp;
      } else {
        // Look up in the explicit mapping table
        byte = ContentStreamReconstructor.UNICODE_TO_WINANSI[cp] ?? 0x3F; // '?' fallback
      }
      bytes.push(byte);
    }

    // Handle ligatures: expand fi/fl to two characters for proper text
    const expanded: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const cp = text.codePointAt(i)!;
      if (cp > 0xFFFF) { i++; }

      if (cp === 0xFB01) {
        expanded.push(0x66, 0x69); // 'f', 'i'
      } else if (cp === 0xFB02) {
        expanded.push(0x66, 0x6C); // 'f', 'l'
      } else if (cp >= 0x20 && cp <= 0x7E) {
        expanded.push(cp);
      } else if (cp >= 0xA0 && cp <= 0xFF) {
        expanded.push(cp);
      } else if (cp === 0x0A || cp === 0x0D || cp === 0x09) {
        expanded.push(cp);
      } else {
        expanded.push(ContentStreamReconstructor.UNICODE_TO_WINANSI[cp] ?? 0x3F);
      }
    }

    // Build hex string
    let hex = '';
    for (const b of expanded) {
      hex += b.toString(16).padStart(2, '0');
    }
    return `<${hex}>`;
  }
}
