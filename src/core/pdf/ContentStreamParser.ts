// PDF Content Stream Parser and Graphics State Machine
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
  EditableObject,
  ImageObject,
  Matrix2D,
  PageModel,
  Point,
  Rect,
  ShapeObject,
  TextObject,
  TextRun,
} from '../types/model';
import { CoordinateSystem } from '../coords/CoordinateSystem';
import { FontEngine } from './FontEngine';
import { PdfLexer } from './PdfLexer';
import { PdfParser } from './PdfParser';

interface GraphicsState {
  ctm: Matrix2D;
  strokeColor: string;
  fillColor: string;
  lineWidth: number;
  dashArray: number[];
}

export class ContentStreamParser {
  private fontEngine: FontEngine;

  constructor(private parser: PdfParser, fontEngine?: FontEngine) {
    this.fontEngine = fontEngine || new FontEngine();
  }

  /**
   * Parse operators from raw content stream data
   */
  parseOperators(data: Uint8Array): ContentOperator[] {
    const lexer = new PdfLexer(data);
    const ops: ContentOperator[] = [];
    const argsStack: PdfObject[] = [];

    while (true) {
      lexer.skipWhitespaceAndComments();
      const pos = lexer.position;
      const tok = lexer.nextToken();
      if (!tok) break;

      if (tok.type === 'keyword') {
        const opName = tok.value;
        ops.push({
          op: opName,
          args: [...argsStack],
          rawIndex: pos,
        });
        argsStack.length = 0; // clear args
      } else if (tok.type === 'name') {
        argsStack.push(new PdfName(tok.value));
      } else if (tok.type === 'string') {
        argsStack.push(new PdfString(tok.value, tok.isHex));
      } else if (tok.type === 'number') {
        argsStack.push(tok.value);
      } else if (tok.type === 'boolean') {
        argsStack.push(tok.value);
      } else if (tok.type === 'null') {
        argsStack.push(null);
      } else if (tok.type === 'array_start') {
        // Parse array inline
        const arr: PdfArray = [];
        while (true) {
          lexer.skipWhitespaceAndComments();
          const p = lexer.peekChar();
          if (p === 0x5d) {
            // ']'
            lexer.nextChar();
            break;
          }
          const item = lexer.nextToken();
          if (!item) break;
          if (item.type === 'number') arr.push(item.value);
          else if (item.type === 'string') arr.push(new PdfString(item.value, item.isHex));
          else if (item.type === 'name') arr.push(new PdfName(item.value));
          else if (item.type === 'keyword') {
            if (item.value === ']') break;
          } else {
            break;
          }
        }
        argsStack.push(arr);
      }
    }

    return ops;
  }

  /**
   * Interpret page content streams and convert into internal EditableObjects
   */
  interpretPage(
    pageIndex: number,
    pageDict: PdfDict,
    streamDataList: { data: Uint8Array; streamIndex: number }[]
  ): { page: PageModel; objects: EditableObject[] } {
    // 1. Resolve MediaBox, CropBox, Rotation
    const mediaBoxObj = this.parser.resolve(pageDict.get('MediaBox'));
    let mediaBox: [number, number, number, number] = [0, 0, 612, 792]; // default Letter
    if (Array.isArray(mediaBoxObj) && mediaBoxObj.length >= 4) {
      mediaBox = [
        Number(mediaBoxObj[0] || 0),
        Number(mediaBoxObj[1] || 0),
        Number(mediaBoxObj[2] || 612),
        Number(mediaBoxObj[3] || 792),
      ];
    }

    const cropBoxObj = this.parser.resolve(pageDict.get('CropBox'));
    let cropBox: [number, number, number, number] | undefined;
    if (Array.isArray(cropBoxObj) && cropBoxObj.length >= 4) {
      cropBox = [
        Number(cropBoxObj[0] || 0),
        Number(cropBoxObj[1] || 0),
        Number(cropBoxObj[2] || 612),
        Number(cropBoxObj[3] || 792),
      ];
    }

    const rotateObj = pageDict.get('Rotate');
    const rotation = typeof rotateObj === 'number' ? rotateObj : 0;

    const width = Math.abs(mediaBox[2] - mediaBox[0]);
    const height = Math.abs(mediaBox[3] - mediaBox[1]);

    const pageModel: PageModel = {
      pageIndex,
      width,
      height,
      mediaBox,
      cropBox,
      rotation,
      objects: [],
      rawContentStreamIndices: streamDataList.map((s) => s.streamIndex),
      unhandledOperatorsCount: 0,
    };

    // 2. Resolve Page Resources (Fonts, XObjects)
    const resources = this.parser.resolve(pageDict.get('Resources'));
    const fontDict = resources instanceof PdfDict ? this.parser.resolve(resources.get('Font')) : null;
    const xobjDict = resources instanceof PdfDict ? this.parser.resolve(resources.get('XObject')) : null;

    const objects: EditableObject[] = [];
    let objectCounter = 1;

    // Graphics State Machine
    const stateStack: GraphicsState[] = [];
    let state: GraphicsState = {
      ctm: CoordinateSystem.identity(),
      strokeColor: '#000000',
      fillColor: '#000000',
      lineWidth: 1,
      dashArray: [],
    };

    // Text State
    let inText = false;
    let textMatrix: Matrix2D = CoordinateSystem.identity();
    let textLineMatrix: Matrix2D = CoordinateSystem.identity();
    let currentFontKey = '';
    let currentFontSize = 12;
    let currentLeading = 14.4;
    let charSpacing = 0;
    let wordSpacing = 0;
    let horizontalScale = 100;

    // Path State
    let currentPathPoints: Point[] = [];

    // Current active Text Object accumulator
    let activeTextObj: TextObject | null = null;

    const flushActiveText = () => {
      if (activeTextObj && activeTextObj.text.trim().length > 0) {
        // Calculate bounding box from runs
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const run of activeTextObj.runs) {
          minX = Math.min(minX, run.x);
          minY = Math.min(minY, run.y);
          maxX = Math.max(maxX, run.x + run.width);
          maxY = Math.max(maxY, run.y + run.height);
        }
        if (minX !== Infinity) {
          activeTextObj.pdfBounds = {
            x: minX,
            y: minY,
            width: Math.max(10, maxX - minX),
            height: Math.max(activeTextObj.fontSize, maxY - minY),
          };
        }
        objects.push(activeTextObj);
      }
      activeTextObj = null;
    };

    // Iterate through content streams
    for (const { data, streamIndex } of streamDataList) {
      const ops = this.parseOperators(data);

      for (let opIdx = 0; opIdx < ops.length; opIdx++) {
        const { op, args } = ops[opIdx];

        // --- Graphics State Operators ---
        if (op === 'q') {
          stateStack.push({
            ctm: [...state.ctm],
            strokeColor: state.strokeColor,
            fillColor: state.fillColor,
            lineWidth: state.lineWidth,
            dashArray: [...state.dashArray],
          });
        } else if (op === 'Q') {
          if (stateStack.length > 0) {
            state = stateStack.pop()!;
          }
        } else if (op === 'cm' && args.length === 6) {
          const matrix: Matrix2D = [
            Number(args[0]),
            Number(args[1]),
            Number(args[2]),
            Number(args[3]),
            Number(args[4]),
            Number(args[5]),
          ];
          state.ctm = CoordinateSystem.multiply(matrix, state.ctm);
        } else if (op === 'w' && args.length >= 1) {
          state.lineWidth = Number(args[0]);
        } else if (op === 'rg' && args.length >= 3) {
          // Fill RGB
          const r = Math.round(Number(args[0]) * 255);
          const g = Math.round(Number(args[1]) * 255);
          const b = Math.round(Number(args[2]) * 255);
          state.fillColor = `rgb(${r}, ${g}, ${b})`;
        } else if (op === 'RG' && args.length >= 3) {
          // Stroke RGB
          const r = Math.round(Number(args[0]) * 255);
          const g = Math.round(Number(args[1]) * 255);
          const b = Math.round(Number(args[2]) * 255);
          state.strokeColor = `rgb(${r}, ${g}, ${b})`;
        } else if (op === 'g' && args.length >= 1) {
          // Fill Grayscale
          const val = Math.round(Number(args[0]) * 255);
          state.fillColor = `rgb(${val}, ${val}, ${val})`;
        } else if (op === 'G' && args.length >= 1) {
          // Stroke Grayscale
          const val = Math.round(Number(args[0]) * 255);
          state.strokeColor = `rgb(${val}, ${val}, ${val})`;
        }

        // --- Text State Operators ---
        else if (op === 'BT') {
          flushActiveText();
          inText = true;
          textMatrix = CoordinateSystem.identity();
          textLineMatrix = CoordinateSystem.identity();
        } else if (op === 'ET') {
          flushActiveText();
          inText = false;
        } else if (op === 'Tf' && args.length >= 2) {
          const fontName = args[0] instanceof PdfName ? args[0].value : String(args[0]);
          currentFontKey = fontName.replace(/^\//, '');
          currentFontSize = Number(args[1]);
        } else if (op === 'TL' && args.length >= 1) {
          currentLeading = Number(args[0]);
        } else if (op === 'Tc' && args.length >= 1) {
          charSpacing = Number(args[0]);
        } else if (op === 'Tw' && args.length >= 1) {
          wordSpacing = Number(args[0]);
        } else if (op === 'Tz' && args.length >= 1) {
          horizontalScale = Number(args[0]);
        } else if (op === 'Tm' && args.length === 6) {
          flushActiveText();
          textMatrix = [
            Number(args[0]),
            Number(args[1]),
            Number(args[2]),
            Number(args[3]),
            Number(args[4]),
            Number(args[5]),
          ];
          textLineMatrix = [...textMatrix];
        } else if (op === 'Td' && args.length === 2) {
          flushActiveText();
          const tx = Number(args[0]);
          const ty = Number(args[1]);
          const transMatrix: Matrix2D = [1, 0, 0, 1, tx, ty];
          textLineMatrix = CoordinateSystem.multiply(transMatrix, textLineMatrix);
          textMatrix = [...textLineMatrix];
        } else if (op === 'TD' && args.length === 2) {
          flushActiveText();
          const tx = Number(args[0]);
          const ty = Number(args[1]);
          currentLeading = -ty;
          const transMatrix: Matrix2D = [1, 0, 0, 1, tx, ty];
          textLineMatrix = CoordinateSystem.multiply(transMatrix, textLineMatrix);
          textMatrix = [...textLineMatrix];
        } else if (op === 'T*') {
          flushActiveText();
          const transMatrix: Matrix2D = [1, 0, 0, 1, 0, -currentLeading];
          textLineMatrix = CoordinateSystem.multiply(transMatrix, textLineMatrix);
          textMatrix = [...textLineMatrix];
        }

        // --- Text Showing Operators ---
        else if ((op === 'Tj' || op === "'" || op === '"') && args.length >= 1) {
          if (op === "'" || op === '"') {
            const transMatrix: Matrix2D = [1, 0, 0, 1, 0, -currentLeading];
            textLineMatrix = CoordinateSystem.multiply(transMatrix, textLineMatrix);
            textMatrix = [...textLineMatrix];
          }

          const strArg = args[op === '"' ? 2 : 0];
          if (strArg instanceof PdfString) {
            const fontObj = fontDict instanceof PdfDict ? fontDict.get(currentFontKey) : null;
            const fontDesc = fontObj
              ? this.fontEngine.resolveFont(currentFontKey, fontObj, this.parser)
              : undefined;

            const { text, widths } = this.fontEngine.decodeString(strArg.bytes, fontDesc);
            
            // Calculate effective position in PDF coordinates
            // effective matrix = textMatrix x ctm
            const effectiveMatrix = CoordinateSystem.multiply(textMatrix, state.ctm);
            const posX = effectiveMatrix[4];
            const posY = effectiveMatrix[5];

            let textWidth = 0;
            for (let i = 0; i < widths.length; i++) {
              textWidth += (widths[i] / 1000) * currentFontSize + charSpacing;
            }

            const run: TextRun = {
              text,
              pdfBytes: strArg.bytes,
              x: posX,
              y: posY,
              width: textWidth,
              height: currentFontSize,
              fontSize: currentFontSize,
              fontName: fontDesc?.name || 'Helvetica',
              charSpacing,
              wordSpacing,
            };

            if (!activeTextObj) {
              activeTextObj = {
                id: `txt_${pageIndex}_${objectCounter++}`,
                type: 'text',
                origin: 'pdf_source',
                pageIndex,
                pdfBounds: { x: posX, y: posY, width: textWidth, height: currentFontSize },
                matrix: [...effectiveMatrix],
                rotation: 0,
                zIndex: objects.length + 1,
                opacity: 1,
                visible: true,
                locked: false,
                text: '',
                runs: [],
                fontName: fontDesc?.name || 'Helvetica',
                pdfFontKey: currentFontKey,
                fontSize: currentFontSize,
                lineHeight: currentLeading,
                charSpacing,
                wordSpacing,
                fillColor: state.fillColor,
                bold: fontDesc?.name.toLowerCase().includes('bold') || false,
                italic: fontDesc?.name.toLowerCase().includes('italic') || fontDesc?.name.toLowerCase().includes('oblique') || false,
                underline: false,
                alignment: 'left',
                sourcePdfRef: {
                  streamIndex,
                  startOpIndex: opIdx,
                  endOpIndex: opIdx,
                  originalOpName: op,
                },
              };
            }

            activeTextObj.text += text;
            activeTextObj.runs.push(run);
            activeTextObj.sourcePdfRef!.endOpIndex = opIdx;

            // Advance text matrix
            const advanceMatrix: Matrix2D = [1, 0, 0, 1, textWidth, 0];
            textMatrix = CoordinateSystem.multiply(advanceMatrix, textMatrix);
          }
        } else if (op === 'TJ' && args.length >= 1) {
          const arr = args[0];
          if (Array.isArray(arr)) {
            const fontObj = fontDict instanceof PdfDict ? fontDict.get(currentFontKey) : null;
            const fontDesc = fontObj
              ? this.fontEngine.resolveFont(currentFontKey, fontObj, this.parser)
              : undefined;

            const effectiveMatrix = CoordinateSystem.multiply(textMatrix, state.ctm);
            const startX = effectiveMatrix[4];
            const startY = effectiveMatrix[5];
            let currentX = startX;
            let combinedText = '';
            const runs: TextRun[] = [];

            for (const item of arr) {
              if (item instanceof PdfString) {
                const { text, widths } = this.fontEngine.decodeString(item.bytes, fontDesc);
                let segmentWidth = 0;
                for (let i = 0; i < widths.length; i++) {
                  segmentWidth += (widths[i] / 1000) * currentFontSize + charSpacing;
                }
                combinedText += text;
                runs.push({
                  text,
                  pdfBytes: item.bytes,
                  x: currentX,
                  y: startY,
                  width: segmentWidth,
                  height: currentFontSize,
                  fontSize: currentFontSize,
                  fontName: fontDesc?.name || 'Helvetica',
                  charSpacing,
                });
                currentX += segmentWidth;
              } else if (typeof item === 'number') {
                // Kerning / spacing adjustment in 1/1000 em
                const adj = (-item / 1000) * currentFontSize;
                currentX += adj;
                if (item < -150) {
                  combinedText += ' ';
                }
              }
            }

            const totalWidth = Math.max(10, currentX - startX);
            const textObj: TextObject = {
              id: `txt_${pageIndex}_${objectCounter++}`,
              type: 'text',
              origin: 'pdf_source',
              pageIndex,
              pdfBounds: { x: startX, y: startY, width: totalWidth, height: currentFontSize },
              matrix: [...effectiveMatrix],
              rotation: 0,
              zIndex: objects.length + 1,
              opacity: 1,
              visible: true,
              locked: false,
              text: combinedText,
              runs,
              fontName: fontDesc?.name || 'Helvetica',
              pdfFontKey: currentFontKey,
              fontSize: currentFontSize,
              lineHeight: currentLeading,
              charSpacing,
              wordSpacing,
              fillColor: state.fillColor,
              bold: fontDesc?.name.toLowerCase().includes('bold') || false,
              italic: fontDesc?.name.toLowerCase().includes('italic') || fontDesc?.name.toLowerCase().includes('oblique') || false,
              underline: false,
              alignment: 'left',
              sourcePdfRef: {
                streamIndex,
                startOpIndex: opIdx,
                endOpIndex: opIdx,
                originalOpName: 'TJ',
              },
            };
            objects.push(textObj);

            // Advance text matrix
            const advanceMatrix: Matrix2D = [1, 0, 0, 1, totalWidth, 0];
            textMatrix = CoordinateSystem.multiply(advanceMatrix, textMatrix);
          }
        }

        // --- XObject / Image Invocation (Do) ---
        else if (op === 'Do' && args.length >= 1) {
          flushActiveText();
          const nameObj = args[0];
          const xobjName = nameObj instanceof PdfName ? nameObj.value : String(nameObj).replace(/^\//, '');

          if (xobjDict instanceof PdfDict) {
            const xobj = this.parser.resolve(xobjDict.get(xobjName));
            if (xobj instanceof PdfStream) {
              const subtype = xobj.dict.get('Subtype');
              if (subtype instanceof PdfName && subtype.value === 'Image') {
                const imgObj = this.extractImageObject(
                  pageIndex,
                  objectCounter++,
                  xobjName,
                  xobj,
                  state.ctm,
                  streamIndex,
                  opIdx
                );
                if (imgObj) {
                  objects.push(imgObj);
                }
              }
            }
          }
        }

        // --- Vector Path & Shape Operators ---
        else if (op === 're' && args.length === 4) {
          const rx = Number(args[0]);
          const ry = Number(args[1]);
          const rw = Number(args[2]);
          const rh = Number(args[3]);
          currentPathPoints = [
            CoordinateSystem.transformPoint({ x: rx, y: ry }, state.ctm),
            CoordinateSystem.transformPoint({ x: rx + rw, y: ry + rh }, state.ctm),
          ];
        } else if ((op === 'f' || op === 'F' || op === 'f*' || op === 'S' || op === 's' || op === 'B' || op === 'B*' || op === 'b' || op === 'b*') && currentPathPoints.length >= 2) {
          flushActiveText();
          const p1 = currentPathPoints[0];
          const p2 = currentPathPoints[1];
          const minX = Math.min(p1.x, p2.x);
          const minY = Math.min(p1.y, p2.y);
          const w = Math.abs(p2.x - p1.x);
          const h = Math.abs(p2.y - p1.y);

          // Only keep substantial shapes to prevent cluttering tiny path accents
          if (w > 2 && h > 2) {
            const isFill = op.toLowerCase().includes('f') || op.toLowerCase().includes('b');
            const isStroke = op.toLowerCase().includes('s') || op.toLowerCase().includes('b');

            const shape: ShapeObject = {
              id: `shape_${pageIndex}_${objectCounter++}`,
              type: 'shape',
              origin: 'pdf_source',
              pageIndex,
              pdfBounds: { x: minX, y: minY, width: w, height: h },
              matrix: [...state.ctm],
              rotation: 0,
              zIndex: objects.length + 1,
              opacity: 1,
              visible: true,
              locked: false,
              shapeType: 'rect',
              strokeColor: isStroke ? state.strokeColor : 'transparent',
              fillColor: isFill ? state.fillColor : undefined,
              strokeWidth: state.lineWidth || 1,
              sourcePdfRef: {
                streamIndex,
                startOpIndex: opIdx - 1,
                endOpIndex: opIdx,
                originalOpName: op,
              },
            };
            objects.push(shape);
          }
          currentPathPoints = [];
        }
      }
    }

    flushActiveText();
    pageModel.objects = objects;

    return { page: pageModel, objects };
  }

  private extractImageObject(
    pageIndex: number,
    idNum: number,
    resourceName: string,
    xobj: PdfStream,
    ctm: Matrix2D,
    streamIndex: number,
    opIdx: number
  ): ImageObject | null {
    const width = Number(xobj.dict.get('Width') || 100);
    const height = Number(xobj.dict.get('Height') || 100);
    const filter = xobj.dict.get('Filter');
    const filterName = filter instanceof PdfName ? filter.value : '';

    let mimeType = 'image/png';
    let dataUrl = '';

    if (filterName === 'DCTDecode' || filterName === 'JPXDecode') {
      mimeType = 'image/jpeg';
      // Convert JPEG buffer to base64
      dataUrl = `data:image/jpeg;base64,${this.uint8ToBase64(xobj.data)}`;
    } else {
      // Decode raw bitmap or Flate decoded RGB
      const raw = xobj.decodedData || xobj.data;
      dataUrl = this.rawRgbToDataUrl(raw, width, height);
    }

    // PDF image dimension in user units is determined by CTM:
    // CTM [a, b, c, d, e, f] where width is ~ hypot(a, b), height is ~ hypot(c, d), pos is (e, f)
    const pdfW = Math.max(1, Math.hypot(ctm[0], ctm[1]));
    const pdfH = Math.max(1, Math.hypot(ctm[2], ctm[3]));
    const pdfX = ctm[4];
    const pdfY = ctm[5];

    return {
      id: `img_${pageIndex}_${idNum}`,
      type: 'image',
      origin: 'pdf_source',
      pageIndex,
      pdfBounds: { x: pdfX, y: pdfY, width: pdfW, height: pdfH },
      matrix: [...ctm],
      rotation: 0,
      zIndex: idNum,
      opacity: 1,
      visible: true,
      locked: false,
      src: dataUrl,
      resourceName: '/' + resourceName,
      width: pdfW,
      height: pdfH,
      naturalWidth: width,
      naturalHeight: height,
      mimeType,
      sourcePdfRef: {
        streamIndex,
        startOpIndex: opIdx,
        endOpIndex: opIdx,
        originalOpName: 'Do',
      },
    };
  }

  private uint8ToBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private rawRgbToDataUrl(data: Uint8Array, width: number, height: number): string {
    // Render to an offscreen canvas to generate PNG data URL
    try {
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const imgData = ctx.createImageData(width, height);
          const isRGB = data.length >= width * height * 3;
          const isGray = data.length >= width * height;

          for (let i = 0; i < width * height; i++) {
            if (isRGB) {
              imgData.data[i * 4] = data[i * 3];
              imgData.data[i * 4 + 1] = data[i * 3 + 1];
              imgData.data[i * 4 + 2] = data[i * 3 + 2];
              imgData.data[i * 4 + 3] = 255;
            } else if (isGray) {
              const val = data[i];
              imgData.data[i * 4] = val;
              imgData.data[i * 4 + 1] = val;
              imgData.data[i * 4 + 2] = val;
              imgData.data[i * 4 + 3] = 255;
            }
          }
          ctx.putImageData(imgData, 0, 0);
          return canvas.toDataURL('image/png');
        }
      }
    } catch {
      // fallback
    }
    return '';
  }
}
