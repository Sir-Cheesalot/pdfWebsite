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
import { FontFamilyHelper } from '../fonts/FontFamilyHelper';
import { FlateDecoder } from './FlateDecoder';
import { FontEngine } from './FontEngine';
import { PdfLexer } from './PdfLexer';
import { PdfParser } from './PdfParser';
import { OcrVerificationEngine } from '../ocr/OcrVerificationEngine';

interface GraphicsState {
  ctm: Matrix2D;
  strokeColor: string;
  fillColor: string;
  fillCmyk?: [number, number, number, number];
  strokeCmyk?: [number, number, number, number];
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
    let opStartByte: number | null = null;

    while (true) {
      lexer.skipWhitespaceAndComments();
      const pos = lexer.position;
      if (opStartByte === null) opStartByte = pos;
      const tok = lexer.nextToken();
      if (!tok) break;

      if (tok.type === 'keyword') {
        const opName = tok.value;
        ops.push({
          op: opName,
          args: [...argsStack],
          rawIndex: pos,
          startByte: opStartByte,
          endByte: lexer.position,
        });
        argsStack.length = 0; // clear args
        opStartByte = null;
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
    // 1. Resolve MediaBox, CropBox, Rotation (with parent dictionary inheritance)
    const mediaBoxObj = this.getInheritedAttribute(pageDict, 'MediaBox');
    let mediaBox: [number, number, number, number] = [0, 0, 612, 792]; // default Letter
    if (Array.isArray(mediaBoxObj) && mediaBoxObj.length >= 4) {
      mediaBox = [
        Number(mediaBoxObj[0] || 0),
        Number(mediaBoxObj[1] || 0),
        Number(mediaBoxObj[2] || 612),
        Number(mediaBoxObj[3] || 792),
      ];
    }

    const cropBoxObj = this.getInheritedAttribute(pageDict, 'CropBox');
    let cropBox: [number, number, number, number] | undefined;
    if (Array.isArray(cropBoxObj) && cropBoxObj.length >= 4) {
      cropBox = [
        Number(cropBoxObj[0] || 0),
        Number(cropBoxObj[1] || 0),
        Number(cropBoxObj[2] || 612),
        Number(cropBoxObj[3] || 792),
      ];
    }

    const rotateObj = this.getInheritedAttribute(pageDict, 'Rotate');
    const rotation = typeof rotateObj === 'number' ? rotateObj : 0;

    const effectiveBox = cropBox || mediaBox;
    const width = Math.abs(effectiveBox[2] - effectiveBox[0]);
    const height = Math.abs(effectiveBox[3] - effectiveBox[1]);

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
    const resources = this.getInheritedAttribute(pageDict, 'Resources');
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
          const descent = 0.22 * activeTextObj.fontSize;
          const bboxH = Math.max(activeTextObj.fontSize * 1.15, maxY - minY + activeTextObj.fontSize * 1.15);
          activeTextObj.pdfBounds = {
            x: minX,
            y: minY - descent,
            width: Math.max(8, maxX - minX),
            height: bboxH,
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
        } else if (op === 'k' && args.length >= 4) {
          // Fill CMYK
          const c = Number(args[0]), m = Number(args[1]), y = Number(args[2]), k = Number(args[3]);
          const r = Math.round(255 * (1 - c) * (1 - k));
          const g = Math.round(255 * (1 - m) * (1 - k));
          const b = Math.round(255 * (1 - y) * (1 - k));
          state.fillColor = `rgb(${r}, ${g}, ${b})`;
          state.fillCmyk = [c, m, y, k];
        } else if (op === 'K' && args.length >= 4) {
          // Stroke CMYK
          const c = Number(args[0]), m = Number(args[1]), y = Number(args[2]), k = Number(args[3]);
          const r = Math.round(255 * (1 - c) * (1 - k));
          const g = Math.round(255 * (1 - m) * (1 - k));
          const b = Math.round(255 * (1 - y) * (1 - k));
          state.strokeColor = `rgb(${r}, ${g}, ${b})`;
          state.strokeCmyk = [c, m, y, k];
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
          textLineMatrix[4] += tx * textLineMatrix[0] + ty * textLineMatrix[2];
          textLineMatrix[5] += tx * textLineMatrix[1] + ty * textLineMatrix[3];
          textMatrix = [...textLineMatrix];
        } else if (op === 'TD' && args.length === 2) {
          flushActiveText();
          const tx = Number(args[0]);
          const ty = Number(args[1]);
          currentLeading = -ty;
          textLineMatrix[4] += tx * textLineMatrix[0] + ty * textLineMatrix[2];
          textLineMatrix[5] += tx * textLineMatrix[1] + ty * textLineMatrix[3];
          textMatrix = [...textLineMatrix];
        } else if (op === 'T*') {
          flushActiveText();
          textLineMatrix[4] += -currentLeading * textLineMatrix[2];
          textLineMatrix[5] += -currentLeading * textLineMatrix[3];
          textMatrix = [...textLineMatrix];
        }

        // --- Text Showing Operators ---
        else if ((op === 'Tj' || op === "'" || op === '"') && args.length >= 1) {
          if (op === "'" || op === '"') {
            textLineMatrix[4] += -currentLeading * textLineMatrix[2];
            textLineMatrix[5] += -currentLeading * textLineMatrix[3];
            textMatrix = [...textLineMatrix];
          }

          const strArg = args[op === '"' ? 2 : 0];
          if (strArg instanceof PdfString) {
            const fontObj = fontDict instanceof PdfDict ? fontDict.get(currentFontKey) : null;
            const fontDesc = fontObj
              ? this.fontEngine.resolveFont(currentFontKey, fontObj, this.parser)
              : undefined;

            const { text, widths, glyphs } = this.fontEngine.decodeString(strArg.bytes, fontDesc);
            
            // Calculate effective position in PDF coordinates
            const effectiveMatrix = CoordinateSystem.multiply(textMatrix, state.ctm);
            const posX = effectiveMatrix[4];
            const posY = effectiveMatrix[5];

            let textWidth = 0;
            for (let i = 0; i < widths.length; i++) {
              textWidth += (widths[i] / 1000) * currentFontSize + charSpacing;
            }

            const descent = 0.22 * currentFontSize;
            const bboxH = currentFontSize * 1.15;
            const run: TextRun = {
              text,
              pdfBytes: strArg.bytes,
              glyphs,
              x: posX,
              y: posY,
              width: textWidth,
              height: bboxH,
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
                pdfBounds: { x: posX, y: posY - descent, width: textWidth, height: bboxH },
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
                horizontalScale,
                fillColor: state.fillColor,
                cmykColor: state.fillCmyk ? [...state.fillCmyk] : undefined,
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

            if (activeTextObj) {
              activeTextObj.text += text;
              activeTextObj.runs.push(run);
              activeTextObj.sourcePdfRef!.endOpIndex = opIdx;
            }

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
                const { text, widths, glyphs } = this.fontEngine.decodeString(item.bytes, fontDesc);
                let segmentWidth = 0;
                for (let i = 0; i < widths.length; i++) {
                  segmentWidth += (widths[i] / 1000) * currentFontSize + charSpacing;
                }
                combinedText += text;
                runs.push({
                  text,
                  pdfBytes: item.bytes,
                  glyphs,
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
                const adj = (-item / 1000) * currentFontSize;
                currentX += adj;
                if (item < -150) {
                  combinedText += ' ';
                }
              }
            }

            const totalWidth = Math.max(8, currentX - startX);
            const descent = 0.22 * currentFontSize;
            const bboxH = currentFontSize * 1.15;
            const textObj: TextObject = {
              id: `txt_${pageIndex}_${objectCounter++}`,
              type: 'text',
              origin: 'pdf_source',
              pageIndex,
              pdfBounds: { x: startX, y: startY - descent, width: totalWidth, height: bboxH },
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
              horizontalScale,
              fillColor: state.fillColor,
              cmykColor: state.fillCmyk ? [...state.fillCmyk] : undefined,
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
                let startOpIdx = opIdx;
                let endOpIdx = opIdx;

                if (opIdx > 0 && ops[opIdx - 1]?.op === 'cm') {
                  startOpIdx = opIdx - 1;
                  if (opIdx > 1 && ops[opIdx - 2]?.op === 'q') {
                    startOpIdx = opIdx - 2;
                  }
                }
                if (opIdx + 1 < ops.length && ops[opIdx + 1]?.op === 'Q' && startOpIdx <= opIdx - 2) {
                  endOpIdx = opIdx + 1;
                }

                const imgObj = this.extractImageObject(
                  pageIndex,
                  objectCounter++,
                  xobjName,
                  xobj,
                  state.ctm,
                  streamIndex,
                  startOpIdx,
                  endOpIdx
                );
                if (imgObj) {
                  objects.push(imgObj);
                }
              }
            }
          }
        }

        // --- Vector Path Operators (m, l, c, v, y, re, h, S, s, f, F, f*, B, b, B*, b*, n) ---
        else if (op === 'm' && args.length >= 2) {
          const pt = CoordinateSystem.transformPoint({ x: Number(args[0]), y: Number(args[1]) }, state.ctm);
          currentPathPoints.push(pt);
        } else if (op === 'l' && args.length >= 2) {
          const pt = CoordinateSystem.transformPoint({ x: Number(args[0]), y: Number(args[1]) }, state.ctm);
          currentPathPoints.push(pt);
        } else if (op === 'c' && args.length >= 6) {
          const pt = CoordinateSystem.transformPoint({ x: Number(args[4]), y: Number(args[5]) }, state.ctm);
          currentPathPoints.push(pt);
        } else if (op === 'h') {
          if (currentPathPoints.length > 0) {
            currentPathPoints.push(currentPathPoints[0]);
          }
        } else if (op === 'n') {
          currentPathPoints = [];
        } else if (op === 're' && args.length === 4) {
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
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const pt of currentPathPoints) {
            minX = Math.min(minX, pt.x);
            minY = Math.min(minY, pt.y);
            maxX = Math.max(maxX, pt.x);
            maxY = Math.max(maxY, pt.y);
          }

          const w = Math.max(1, maxX - minX);
          const h = Math.max(1, maxY - minY);

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
            strokeWidth: Math.max(0.5, state.lineWidth || 1),
            sourcePdfRef: {
              streamIndex,
              startOpIndex: opIdx - 1,
              endOpIndex: opIdx,
              originalOpName: op,
            },
          };
          objects.push(shape);
          currentPathPoints = [];
        }
      }
    }

    flushActiveText();
    const consolidatedObjects = this.consolidateTextObjects(objects, pageIndex);
    const verifiedObjects = OcrVerificationEngine.verifyPageObjects(consolidatedObjects);
    pageModel.objects = verifiedObjects;

    return { page: pageModel, objects: verifiedObjects };
  }

  /**
   * Consolidates atomic text runs and fragments into clean, natural line and paragraph blocks
   */
  private consolidateTextObjects(rawObjects: EditableObject[], pageIndex: number): EditableObject[] {
    const nonTextObjects: EditableObject[] = [];
    const textObjects: TextObject[] = [];

    for (const obj of rawObjects) {
      if (obj.type === 'text') {
        textObjects.push(obj as TextObject);
      } else {
        nonTextObjects.push(obj);
      }
    }

    if (textObjects.length <= 1) {
      return rawObjects;
    }

    // Step 1: Baseline sorting (top-of-page to bottom, left-to-right)
    textObjects.sort((a, b) => {
      const dy = b.pdfBounds.y - a.pdfBounds.y;
      const minFs = Math.min(a.fontSize || 12, b.fontSize || 12);
      if (Math.abs(dy) > Math.max(2.5, 0.28 * minFs)) {
        return dy; // Higher PDF Y first (top of page to bottom)
      }
      return a.pdfBounds.x - b.pdfBounds.x; // Left to right
    });

    // Helper: Check if a drawn vector shape (vertical divider, table cell border, or box edge) separates two horizontal text positions
    const isSeparatedByShape = (
      lineA: TextObject,
      lineB: TextObject
    ): boolean => {
      const xA = lineA.pdfBounds.x;
      const xB = lineB.pdfBounds.x;
      const leftStartX = Math.min(xA, xB);
      const rightStartX = Math.max(xA, xB);

      const yMin = Math.min(lineA.pdfBounds.y, lineB.pdfBounds.y);
      const yMax = Math.max(
        lineA.pdfBounds.y + lineA.pdfBounds.height,
        lineB.pdfBounds.y + lineB.pdfBounds.height
      );

      for (const obj of nonTextObjects) {
        if (obj.type !== 'shape') continue;
        const s = obj.pdfBounds;
        // Check vertical overlap with the text
        const sYMin = s.y;
        const sYMax = s.y + s.height;
        const vOverlap = Math.min(yMax, sYMax) - Math.max(yMin, sYMin);
        if (vOverlap <= 0.5) continue;

        // 1. Vertical dividing line or stroke between the two text starting positions
        if (s.x > leftStartX && s.x < rightStartX) {
          return true;
        }
        const sRight = s.x + s.width;
        if (sRight > leftStartX && sRight < rightStartX) {
          return true;
        }

        // 2. Container boundary: one text item is inside shape, other is outside
        const aMidX = lineA.pdfBounds.x + lineA.pdfBounds.width / 2;
        const aMidY = lineA.pdfBounds.y + lineA.pdfBounds.height / 2;
        const bMidX = lineB.pdfBounds.x + lineB.pdfBounds.width / 2;
        const bMidY = lineB.pdfBounds.y + lineB.pdfBounds.height / 2;

        const aInside = aMidX >= s.x && aMidX <= sRight && aMidY >= sYMin && aMidY <= sYMax;
        const bInside = bMidX >= s.x && bMidX <= sRight && bMidY >= sYMin && bMidY <= sYMax;
        if (aInside !== bInside) {
          return true;
        }
      }
      return false;
    };

    // Helper: Check if a horizontal divider line lies between two vertical baselines
    const hasHorizontalDivider = (
      topY: number,
      bottomY: number,
      leftX: number,
      rightX: number
    ): boolean => {
      const yLow = Math.min(topY, bottomY);
      const yHigh = Math.max(topY, bottomY);

      for (const obj of nonTextObjects) {
        if (obj.type !== 'shape') continue;
        const s = obj.pdfBounds;
        // Horizontal line or separator rectangle
        const sMidY = s.y + s.height / 2;
        if (sMidY > yLow && sMidY < yHigh) {
          // Check horizontal overlap with paragraph span
          const hOverlap = Math.min(rightX, s.x + s.width) - Math.max(leftX, s.x);
          if (hOverlap > 10 || s.width >= (rightX - leftX) * 0.4) {
            return true;
          }
        }
      }
      return false;
    };

    // Step 2: Horizontal Line Consolidation (merge fragments & words on same baseline)
    const lines: TextObject[] = [];
    let currentLine: TextObject | null = null;

    for (const textObj of textObjects) {
      if (!currentLine) {
        currentLine = { ...textObj, runs: [...textObj.runs] };
        continue;
      }

      const minFs = Math.min(currentLine.fontSize || 12, textObj.fontSize || 12);
      const sameBaseline = Math.abs(currentLine.pdfBounds.y - textObj.pdfBounds.y) <= Math.max(2.5, 0.28 * minFs);
      
      const fontA = FontFamilyHelper.getCleanFontName(currentLine.fontName);
      const fontB = FontFamilyHelper.getCleanFontName(textObj.fontName);
      const sameFont = fontA === fontB || currentLine.fontName === textObj.fontName;
      const sameFontSize = Math.abs(currentLine.fontSize - textObj.fontSize) <= 1.5;
      const sameColor = !currentLine.fillColor || !textObj.fillColor || currentLine.fillColor === textObj.fillColor;

      const currentRight = currentLine.pdfBounds.x + currentLine.pdfBounds.width;
      const distance = textObj.pdfBounds.x - currentRight;
      const avgCharW = (minFs * 0.5) || 6;

      // 3-space gap rule: in standard typography, a space is ~0.28*fontSize.
      // 3 spaces is ~0.84*fontSize (capped at 10-12pt). Gaps larger than this are separate columns/fields!
      const maxSpaceGap = Math.min(10.5, 0.85 * minFs);
      const isAdjacent = distance >= -avgCharW * 0.45 && distance <= maxSpaceGap;

      // Visual context: ensure no drawn shape or container boundary separates the two fragments
      const isBlockedByShape = isSeparatedByShape(currentLine, textObj);

      if (sameBaseline && sameFont && sameFontSize && sameColor && isAdjacent && !isBlockedByShape) {
        // Determine whether a space separator is needed between adjacent words/fragments
        const needsSpace = distance >= (minFs * 0.16) &&
          !currentLine.text.endsWith(' ') &&
          !textObj.text.startsWith(' ') &&
          !currentLine.text.endsWith('-') &&
          !textObj.text.startsWith(',') &&
          !textObj.text.startsWith('.') &&
          !textObj.text.startsWith(';') &&
          !textObj.text.startsWith(':') &&
          !textObj.text.startsWith('!') &&
          !textObj.text.startsWith('?') &&
          !textObj.text.startsWith(')') &&
          !textObj.text.startsWith(']');

        if (needsSpace) {
          currentLine.text += ' ';
        }
        currentLine.text += textObj.text;
        currentLine.runs.push(...textObj.runs);

        const newRight = Math.max(currentRight, textObj.pdfBounds.x + textObj.pdfBounds.width);
        currentLine.pdfBounds.width = newRight - currentLine.pdfBounds.x;
        currentLine.pdfBounds.height = Math.max(currentLine.pdfBounds.height, textObj.pdfBounds.height);

        if (currentLine.sourcePdfRef && textObj.sourcePdfRef) {
          currentLine.sourcePdfRef.startOpIndex = Math.min(
            currentLine.sourcePdfRef.startOpIndex,
            textObj.sourcePdfRef.startOpIndex
          );
          currentLine.sourcePdfRef.endOpIndex = Math.max(
            currentLine.sourcePdfRef.endOpIndex,
            textObj.sourcePdfRef.endOpIndex
          );
        }
      } else {
        lines.push(currentLine);
        currentLine = { ...textObj, runs: [...textObj.runs] };
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }

    // Step 3: Paragraph Detection & Block Consolidation
    // Group consecutive lines that form coherent body paragraphs
    const paragraphs: TextObject[] = [];
    let currentPara: TextObject | null = null;
    let lastLineBottomY = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!currentPara) {
        currentPara = { ...line, runs: [...line.runs] };
        lastLineBottomY = line.pdfBounds.y;
        continue;
      }

      const fontA = FontFamilyHelper.getCleanFontName(currentPara.fontName);
      const fontB = FontFamilyHelper.getCleanFontName(line.fontName);
      const sameFont = fontA === fontB || currentPara.fontName === line.fontName;
      const sameFontSize = Math.abs(currentPara.fontSize - line.fontSize) <= 0.8;
      const sameColor = currentPara.fillColor === line.fillColor;
      
      // Vertical pitch (distance from previous line baseline to this line baseline)
      const linePitch = lastLineBottomY - line.pdfBounds.y;
      const fs = currentPara.fontSize || 12;
      const isNaturalPitch = linePitch >= (0.85 * fs) && linePitch <= (1.85 * fs);

      // Alignment / Margins check:
      // Paragraph lines have matching left margins (within 14pt) or first line indent (up to 28pt)
      const leftDiff = Math.abs(currentPara.pdfBounds.x - line.pdfBounds.x);
      const isAlignedLeft = leftDiff <= 14 || (currentPara.text.indexOf('\n') === -1 && leftDiff <= 28);

      // Not a list bullet or header delimiter
      const isBullet = /^[\u2022\u2023\u25E6\u2043\u2219\*\-\–\—\d+\.\)]/.test(line.text.trim());
      const isHeading = line.fontSize >= (currentPara.fontSize + 2) || (line.bold && !currentPara.bold);

      // Visual context: check if a horizontal dividing line or shape lies between the two lines
      const paraMinX = Math.min(currentPara.pdfBounds.x, line.pdfBounds.x);
      const paraMaxX = Math.max(
        currentPara.pdfBounds.x + currentPara.pdfBounds.width,
        line.pdfBounds.x + line.pdfBounds.width
      );
      const isDividedByShape = hasHorizontalDivider(lastLineBottomY, line.pdfBounds.y, paraMinX, paraMaxX);

      // Previous line end-of-paragraph indicators
      const isWideGap = linePitch > (1.85 * fs);

      if (sameFont && sameFontSize && sameColor && isNaturalPitch && isAlignedLeft && !isBullet && !isHeading && !isWideGap && !isDividedByShape) {
        // Append line to current paragraph
        currentPara.text += '\n' + line.text;
        currentPara.runs.push(...line.runs);

        const newMinX = Math.min(currentPara.pdfBounds.x, line.pdfBounds.x);
        const newMaxX = Math.max(currentPara.pdfBounds.x + currentPara.pdfBounds.width, line.pdfBounds.x + line.pdfBounds.width);
        const newMinY = Math.min(currentPara.pdfBounds.y, line.pdfBounds.y);
        const newMaxY = Math.max(currentPara.pdfBounds.y + currentPara.pdfBounds.height, line.pdfBounds.y + line.pdfBounds.height);

        currentPara.pdfBounds.x = newMinX;
        currentPara.pdfBounds.y = newMinY;
        currentPara.pdfBounds.width = newMaxX - newMinX;
        currentPara.pdfBounds.height = newMaxY - newMinY;
        currentPara.lineHeight = linePitch > 0 ? linePitch : (fs * 1.2);

        if (currentPara.sourcePdfRef && line.sourcePdfRef) {
          currentPara.sourcePdfRef.startOpIndex = Math.min(
            currentPara.sourcePdfRef.startOpIndex,
            line.sourcePdfRef.startOpIndex
          );
          currentPara.sourcePdfRef.endOpIndex = Math.max(
            currentPara.sourcePdfRef.endOpIndex,
            line.sourcePdfRef.endOpIndex
          );
        }

        lastLineBottomY = line.pdfBounds.y;
      } else {
        paragraphs.push(currentPara);
        currentPara = { ...line, runs: [...line.runs] };
        lastLineBottomY = line.pdfBounds.y;
      }
    }

    if (currentPara) {
      paragraphs.push(currentPara);
    }

    const result: EditableObject[] = [...nonTextObjects, ...paragraphs];
    result.forEach((obj, idx) => {
      obj.zIndex = idx + 1;
    });

    return result;
  }

  private extractImageObject(
    pageIndex: number,
    idNum: number,
    resourceName: string,
    xobj: PdfStream,
    ctm: Matrix2D,
    streamIndex: number,
    startOpIndex: number,
    endOpIndex: number
  ): ImageObject | null {
    const resolveObj = (val: any) => (this.parser && val instanceof PdfRef ? this.parser.resolve(val) : val);

    const widthVal = resolveObj(xobj.dict.get('Width'));
    const heightVal = resolveObj(xobj.dict.get('Height'));
    const filterVal = resolveObj(xobj.dict.get('Filter'));
    const colorSpaceVal = resolveObj(xobj.dict.get('ColorSpace'));
    const bpcVal = resolveObj(xobj.dict.get('BitsPerComponent'));
    const isImageMaskVal = resolveObj(xobj.dict.get('ImageMask'));
    const decodeArrVal = resolveObj(xobj.dict.get('Decode'));

    const width = Number(widthVal || 100) || 100;
    const height = Number(heightVal || 100) || 100;
    
    let isJpeg = false;
    if (filterVal instanceof PdfName) {
      const v = filterVal.value;
      isJpeg = v === 'DCTDecode' || v === 'DCT' || v === 'JPXDecode';
    } else if (Array.isArray(filterVal)) {
      isJpeg = filterVal.some((f) => {
        const resolvedF = resolveObj(f);
        const v = resolvedF instanceof PdfName ? resolvedF.value : String(resolvedF).replace(/^\//, '');
        return v === 'DCTDecode' || v === 'DCT' || v === 'JPXDecode';
      });
    }

    let mimeType = isJpeg ? 'image/jpeg' : 'image/png';
    let dataUrl = '';

    if (isJpeg && xobj.data && xobj.data.length > 4) {
      dataUrl = `data:image/jpeg;base64,${this.uint8ToBase64(xobj.data)}`;
    } else {
      const raw = xobj.decodedData || FlateDecoder.decodeStream(xobj);
      const bpc = Number(bpcVal || 8) || 8;
      const isImageMask = isImageMaskVal === true;

      dataUrl = this.rawRgbToDataUrl(raw, width, height, colorSpaceVal, bpc, isImageMask, decodeArrVal);
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
        startOpIndex,
        endOpIndex,
        originalOpName: 'Do',
      },
    };
  }

  private uint8ToBase64(bytes: Uint8Array): string {
    if (!bytes || bytes.length === 0) return '';
    try {
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode.apply(null, chunk as any);
      }
      return btoa(binary);
    } catch {
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }
  }

  private rawRgbToDataUrl(
    data: Uint8Array,
    width: number,
    height: number,
    colorSpaceObj?: any,
    bitsPerComponent: number = 8,
    isImageMask: boolean = false,
    decodeArrObj?: any
  ): string {
    if (!data || data.length === 0 || width <= 0 || height <= 0) return '';

    try {
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const imgData = ctx.createImageData(width, height);

          // 1. Check for Indexed ColorSpace: [/Indexed, baseCS, hival, lookup]
          let isIndexed = false;
          let lookupTable: Uint8Array | null = null;
          let csName = 'DeviceRGB';

          if (colorSpaceObj instanceof PdfName) {
            csName = colorSpaceObj.value;
          } else if (Array.isArray(colorSpaceObj)) {
            const first = colorSpaceObj[0] instanceof PdfName ? colorSpaceObj[0].value : String(colorSpaceObj[0]).replace(/^\//, '');
            if (first === 'Indexed' || first === 'I') {
              isIndexed = true;
              const lookupRaw = this.parser ? this.parser.resolve(colorSpaceObj[3]) : colorSpaceObj[3];
              if (lookupRaw instanceof PdfString) {
                lookupTable = new Uint8Array(lookupRaw.bytes);
              } else if (lookupRaw instanceof PdfStream) {
                lookupTable = lookupRaw.decodedData || FlateDecoder.decodeStream(lookupRaw);
              } else if (lookupRaw instanceof Uint8Array) {
                lookupTable = lookupRaw;
              }
            } else if (first) {
              csName = first;
            }
          }

          // Invert check from /Decode array
          let decodeInverted = false;
          if (Array.isArray(decodeArrObj) && decodeArrObj.length >= 2) {
            if (Number(decodeArrObj[0]) > Number(decodeArrObj[1])) {
              decodeInverted = true;
            }
          }

          if (isImageMask || bitsPerComponent === 1) {
            // 1-bit monochrome mask: each row padded to byte boundary
            const rowStride = Math.ceil(width / 8);
            for (let y = 0; y < height; y++) {
              const rowOffset = y * rowStride;
              for (let x = 0; x < width; x++) {
                const byteIdx = rowOffset + Math.floor(x / 8);
                const bitOffset = 7 - (x % 8);
                const bit = byteIdx < data.length ? ((data[byteIdx] >> bitOffset) & 1) : 0;
                let val = bit ? 255 : 0;
                if (decodeInverted) val = 255 - val;

                const outIdx = (y * width + x) * 4;
                imgData.data[outIdx] = val;
                imgData.data[outIdx + 1] = val;
                imgData.data[outIdx + 2] = val;
                imgData.data[outIdx + 3] = isImageMask && !bit ? 0 : 255;
              }
            }
          } else if (isIndexed && lookupTable && lookupTable.length > 0) {
            // Indexed Palette lookup: each pixel is an index byte into the RGB lookup table
            for (let i = 0; i < width * height; i++) {
              const idx = data[i] ?? 0;
              const lutOffset = idx * 3;
              const r = lutOffset < lookupTable.length ? lookupTable[lutOffset] : 0;
              const g = lutOffset + 1 < lookupTable.length ? lookupTable[lutOffset + 1] : 0;
              const b = lutOffset + 2 < lookupTable.length ? lookupTable[lutOffset + 2] : 0;

              const outIdx = i * 4;
              imgData.data[outIdx] = r;
              imgData.data[outIdx + 1] = g;
              imgData.data[outIdx + 2] = b;
              imgData.data[outIdx + 3] = 255;
            }
          } else if (csName.includes('CMYK') || (!csName.includes('RGB') && !csName.includes('Gray') && data.length >= width * height * 4)) {
            // CMYK (4 bytes per pixel) -> standard RGB conversion
            for (let i = 0; i < width * height; i++) {
              const c = (data[i * 4] || 0) / 255;
              const m = (data[i * 4 + 1] || 0) / 255;
              const y = (data[i * 4 + 2] || 0) / 255;
              const k = (data[i * 4 + 3] || 0) / 255;

              const r = Math.round(255 * (1 - c) * (1 - k));
              const g = Math.round(255 * (1 - m) * (1 - k));
              const b = Math.round(255 * (1 - y) * (1 - k));

              const outIdx = i * 4;
              imgData.data[outIdx] = r;
              imgData.data[outIdx + 1] = g;
              imgData.data[outIdx + 2] = b;
              imgData.data[outIdx + 3] = 255;
            }
          } else if (csName.includes('Gray') || csName.includes('DeviceGray') || (data.length < width * height * 3)) {
            // Grayscale (1 byte per pixel)
            for (let i = 0; i < width * height; i++) {
              let val = data[i] ?? 0;
              if (decodeInverted) val = 255 - val;
              const outIdx = i * 4;
              imgData.data[outIdx] = val;
              imgData.data[outIdx + 1] = val;
              imgData.data[outIdx + 2] = val;
              imgData.data[outIdx + 3] = 255;
            }
          } else {
            // Default DeviceRGB (3 bytes per pixel)
            for (let i = 0; i < width * height; i++) {
              const outIdx = i * 4;
              imgData.data[outIdx] = data[i * 3] ?? 0;
              imgData.data[outIdx + 1] = data[i * 3 + 1] ?? 0;
              imgData.data[outIdx + 2] = data[i * 3 + 2] ?? 0;
              imgData.data[outIdx + 3] = 255;
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

  /**
   * Resolves an inherited attribute by walking up the /Parent tree (for MediaBox, CropBox, Resources, Rotate)
   */
  private getInheritedAttribute(pageDict: PdfDict, key: string): PdfObject | undefined {
    let current: PdfDict | null = pageDict;
    while (current) {
      const rawVal: PdfObject | undefined = current.get(key);
      const val: PdfObject | undefined = this.parser ? this.parser.resolve(rawVal) : rawVal;
      if (val !== undefined && val !== null) {
        return val;
      }
      const rawParent: PdfObject | undefined = current.get('Parent');
      const resolvedParent: PdfObject | undefined = this.parser ? this.parser.resolve(rawParent) : rawParent;
      current = resolvedParent instanceof PdfDict ? resolvedParent : null;
    }
    return undefined;
  }
}
