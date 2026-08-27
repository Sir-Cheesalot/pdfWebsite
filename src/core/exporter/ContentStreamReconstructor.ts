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
  PageModel,
  ShapeObject,
  TableObject,
  TextObject,
} from '../types/model';
import { ContentStreamParser } from '../pdf/ContentStreamParser';
import { FlateDecoder } from '../pdf/FlateDecoder';
import { FontEngine } from '../pdf/FontEngine';
import { PdfParser } from '../pdf/PdfParser';

export class ContentStreamReconstructor {
  private fontEngine: FontEngine;

  constructor(private parser?: PdfParser, fontEngine?: FontEngine) {
    this.fontEngine = fontEngine || new FontEngine();
  }

  /**
   * Reconstruct and serialize the content stream for a given page,
   * modifying existing PDF operations in-place and appending new genuine PDF primitives.
   */
  reconstructPageStream(
    page: PageModel,
    doc: DocumentModel,
    originalStreamData?: Uint8Array,
    pageDict?: PdfDict
  ): { streamBytes: Uint8Array; newResources: { fonts: Map<string, PdfRef>; xobjects: Map<string, PdfStream> } } {
    const newFonts = new Map<string, PdfRef>();
    const newXObjects = new Map<string, PdfStream>();

    // 1. Separate objects into:
    // - PDF-origin objects that were modified or untouched
    // - User-created objects (new text, images, shapes, tables)
    // - Deleted objects (present in original stream but removed from page.objects)
    const activeObjMap = new Map<string, EditableObject>(page.objects.map((o) => [o.id, o]));
    const userCreatedObjects: EditableObject[] = page.objects.filter((o) => o.origin === 'user_created');

    let streamOps: ContentOperator[] = [];
    if (originalStreamData && originalStreamData.length > 0) {
      const streamParser = new ContentStreamParser(this.parser || new PdfParser(new Uint8Array()), this.fontEngine);
      streamOps = streamParser.parseOperators(originalStreamData);
    }

    // 2. Reconstruct original stream with in-place modifications
    const reconstructedStreamChunks: string[] = [];

    // Find all modified / moved PDF-source objects
    const sourceObjMapByStartOp = new Map<number, EditableObject>();
    for (const obj of page.objects) {
      if (obj.origin === 'pdf_source' && obj.sourcePdfRef) {
        sourceObjMapByStartOp.set(obj.sourcePdfRef.startOpIndex, obj);
      }
    }

    if (streamOps.length === 0) {
      // No original stream: serialize all objects directly as genuine PDF operators
      for (const obj of page.objects) {
        if (!obj.visible) continue;
        const opString = this.serializeEditableObject(obj, newFonts, newXObjects);
        if (opString) {
          reconstructedStreamChunks.push(opString);
        }
      }
    } else {
      // Reconstruct original stream with in-place modifications
      let skipUntilOpIndex = -1;

      for (let i = 0; i < streamOps.length; i++) {
        if (i <= skipUntilOpIndex) {
          continue;
        }

        const trackedObj = sourceObjMapByStartOp.get(i);

        if (trackedObj && trackedObj.sourcePdfRef) {
          const endIdx = trackedObj.sourcePdfRef.endOpIndex;
          skipUntilOpIndex = endIdx;

          if (trackedObj.visible) {
            const opString = this.serializeEditableObject(trackedObj, newFonts, newXObjects);
            if (opString) {
              reconstructedStreamChunks.push(opString);
            }
          }
        } else {
          const opStr = this.serializeSingleOperator(streamOps[i]);
          if (opStr) {
            reconstructedStreamChunks.push(opStr);
          }
        }
      }

      // Append newly inserted user elements
      for (const userObj of userCreatedObjects) {
        if (!userObj.visible) continue;
        const opString = this.serializeEditableObject(userObj, newFonts, newXObjects);
        if (opString) {
          reconstructedStreamChunks.push(opString);
        }
      }
    }

    const fullStreamText = reconstructedStreamChunks.join('\n');
    const streamBytes = new TextEncoder().encode(fullStreamText);

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
    newXObjects: Map<string, PdfStream>
  ): string {
    if (obj.type === 'text') {
      return this.serializeTextObject(obj, newFonts);
    } else if (obj.type === 'image') {
      return this.serializeImageObject(obj, newXObjects);
    } else if (obj.type === 'shape') {
      return this.serializeShapeObject(obj);
    } else if (obj.type === 'table') {
      return this.serializeTableObject(obj, newFonts);
    }
    return '';
  }

  /**
   * Serialize a TextObject into compliant BT ... ET stream
   */
  private serializeTextObject(textObj: TextObject, newFonts: Map<string, PdfRef>): string {
    const lines: string[] = [];
    lines.push('q'); // save state

    // Color
    const rgb = this.parseColorToRgb(textObj.fillColor);
    lines.push(`${(rgb.r / 255).toFixed(3)} ${(rgb.g / 255).toFixed(3)} ${(rgb.b / 255).toFixed(3)} rg`);

    lines.push('BT'); // Begin Text

    // Font selection: use existing key or default standard font /F_Helvetica
    let fontKey = textObj.pdfFontKey || '/F_Helv';
    if (!fontKey.startsWith('/')) fontKey = '/' + fontKey;
    lines.push(`${fontKey} ${textObj.fontSize.toFixed(2)} Tf`);

    // Character spacing & leading
    if (textObj.charSpacing !== 0) {
      lines.push(`${textObj.charSpacing.toFixed(2)} Tc`);
    }
    if (textObj.lineHeight) {
      lines.push(`${textObj.lineHeight.toFixed(2)} TL`);
    }

    // Set Text Matrix (Tm) to exact PDF position
    const m = textObj.matrix;
    const posX = textObj.pdfBounds.x;
    const posY = textObj.pdfBounds.y;
    lines.push(`${m[0].toFixed(4)} ${m[1].toFixed(4)} ${m[2].toFixed(4)} ${m[3].toFixed(4)} ${posX.toFixed(2)} ${posY.toFixed(2)} Tm`);

    // Escape text string
    const escaped = this.escapePdfString(textObj.text);
    lines.push(`(${escaped}) Tj`);

    lines.push('ET'); // End Text
    lines.push('Q'); // restore state

    return lines.join('\n');
  }

  /**
   * Serialize an ImageObject into a genuine /Do XObject operator
   */
  private serializeImageObject(
    imgObj: ImageObject,
    newXObjects: Map<string, PdfStream>
  ): string {
    // Generate or use resource name
    const xobjKey = imgObj.resourceName ? imgObj.resourceName.replace(/^\//, '') : `Im_Edit_${imgObj.id.replace(/\W/g, '_')}`;
    
    // Create new PDF Image XObject stream if newly created
    if (imgObj.src && !newXObjects.has(xobjKey)) {
      const imgStream = this.createImageXObjectStream(imgObj);
      if (imgStream) {
        newXObjects.set(xobjKey, imgStream);
      }
    }

    const lines: string[] = [];
    lines.push('q'); // save state

    // Transform matrix for image: [width, 0, 0, height, x, y] cm
    const x = imgObj.pdfBounds.x;
    const y = imgObj.pdfBounds.y;
    const w = imgObj.pdfBounds.width;
    const h = imgObj.pdfBounds.height;

    lines.push(`${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm`);
    lines.push(`/${xobjKey} Do`);
    lines.push('Q'); // restore state

    return lines.join('\n');
  }

  /**
   * Serialize a ShapeObject into PDF vector operators
   */
  private serializeShapeObject(shapeObj: ShapeObject): string {
    const lines: string[] = [];
    lines.push('q'); // save state
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
            lines.push(`/F_Helv ${(cell.fontSize || 10).toFixed(2)} Tf`);

            const textPad = cell.padding || 4;
            const textX = currentX + textPad;
            const textY = cellPdfY + (rowH / 2) - (cell.fontSize / 3);

            lines.push(`1 0 0 1 ${textX.toFixed(2)} ${textY.toFixed(2)} Tm`);
            lines.push(`(${this.escapePdfString(cell.text)}) Tj`);
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
      // Decode data URL
      const base64Data = imgObj.src.split(',')[1];
      const binaryStr = atob(base64Data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const dict = new PdfDict();
      dict.set('Type', new PdfName('XObject'));
      dict.set('Subtype', new PdfName('Image'));
      dict.set('Width', imgObj.naturalWidth || 400);
      dict.set('Height', imgObj.naturalHeight || 300);
      dict.set('ColorSpace', new PdfName('DeviceRGB'));
      dict.set('BitsPerComponent', 8);

      if (imgObj.mimeType === 'image/jpeg' || imgObj.src.startsWith('data:image/jpeg')) {
        dict.set('Filter', new PdfName('DCTDecode'));
        return new PdfStream(dict, bytes);
      } else {
        // Flate compressed
        const compressed = FlateDecoder.encodeFlate(bytes);
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
}
