// Internal Document Model Types
import type { PdfDict, PdfObject } from './pdf';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 2D Affine transformation matrix:
 * [a, b, c, d, e, f] representing:
 * [ a  b  0 ]
 * [ c  d  0 ]
 * [ e  f  1 ]
 */
export type Matrix2D = [number, number, number, number, number, number];

export interface ColorRGBA {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
  a: number; // 0-1
}

export type ObjectType = 'text' | 'image' | 'shape' | 'table';
export type ObjectOrigin = 'pdf_source' | 'user_created';

export interface BaseEditableObject {
  id: string;
  type: ObjectType;
  origin: ObjectOrigin;
  pageIndex: number;
  
  // Bounds in PDF points (bottom-left coordinate origin)
  pdfBounds: Rect;
  
  // Transformation matrix in PDF space
  matrix: Matrix2D;
  
  rotation: number; // in degrees
  zIndex: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  isModified?: boolean;
  
  // Reference back to source PDF if imported
  sourcePdfRef?: {
    streamIndex: number;
    startOpIndex: number;
    endOpIndex: number;
    originalOpName?: string;
  };
}

export interface TextRun {
  text: string;
  pdfBytes?: Uint8Array;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  charSpacing?: number;
  wordSpacing?: number;
  rawTJAdjustment?: number;
}

export interface TextObject extends BaseEditableObject {
  type: 'text';
  text: string;
  runs: TextRun[];
  fontName: string;
  pdfFontKey?: string; // e.g. /F1
  fontSize: number;
  lineHeight: number;
  charSpacing: number;
  wordSpacing: number;
  horizontalScale?: number;
  fillColor: string; // CSS color or hex
  cmykColor?: [number, number, number, number];
  strokeColor?: string;
  strokeWidth?: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  alignment: 'left' | 'center' | 'right' | 'justify';
}

export interface ImageObject extends BaseEditableObject {
  type: 'image';
  src: string; // Base64 Data URL
  resourceName?: string; // e.g. /Im0
  width: number; // in PDF points
  height: number; // in PDF points
  naturalWidth: number; // in pixels
  naturalHeight: number;
  mimeType: string;
}

export type ShapeType = 'rect' | 'circle' | 'line' | 'arrow';

export interface ShapeObject extends BaseEditableObject {
  type: 'shape';
  shapeType: ShapeType;
  strokeColor: string;
  fillColor?: string;
  strokeWidth: number;
  dashArray?: number[];
  arrowStart?: boolean;
  arrowEnd?: boolean;
}

export interface TableCell {
  id: string;
  row: number;
  col: number;
  rowSpan?: number;
  colSpan?: number;
  text: string;
  fontName: string;
  fontSize: number;
  textColor: string;
  bgColor: string;
  borderWidth: number;
  borderColor: string;
  bold: boolean;
  italic: boolean;
  alignment: 'left' | 'center' | 'right';
  padding: number;
}

export interface TableObject extends BaseEditableObject {
  type: 'table';
  rows: number;
  cols: number;
  colWidths: number[]; // widths in PDF points
  rowHeights: number[]; // heights in PDF points
  cells: TableCell[][]; // [row][col]
  globalBorderColor: string;
  globalBorderWidth: number;
}

export type EditableObject = TextObject | ImageObject | ShapeObject | TableObject;

export interface PageModel {
  pageIndex: number;
  width: number; // MediaBox width (points)
  height: number; // MediaBox height (points)
  mediaBox: [number, number, number, number]; // [llx, lly, urx, ury]
  cropBox?: [number, number, number, number];
  rotation: number; // 0, 90, 180, 270
  objects: EditableObject[];
  rawContentStreamIndices: number[];
  unhandledOperatorsCount: number;

  // Original decoded content stream bytes for this page, keyed by streamIndex
  // (a page can have more than one /Contents stream). Retained so export can
  // pass through anything the user didn't edit byte-for-byte instead of
  // regenerating it from the simplified object model. Undefined for
  // brand-new/blank pages that never came from a source PDF.
  sourceStreams?: { data: Uint8Array; streamIndex: number }[];
  // The original /Page dictionary this page was parsed from, so export can
  // reuse its original Resources (fonts, XObjects, ExtGState, etc.) rather
  // than fabricating a single fallback font for the whole document.
  sourcePageDict?: PdfDict;
}

export interface FontDescriptorModel {
  name: string;
  type: string; // 'Type1' | 'TrueType' | 'Type0'
  isStandard14: boolean;
  encoding?: string;
  toUnicodeCMap?: Map<number, string>;
  widths?: Map<number, number>;
  defaultWidth?: number;
  ascent?: number;
  descent?: number;
  capHeight?: number;
  fontFileRef?: any;
}

export interface DocumentModel {
  id: string;
  title: string;
  version: string;
  pages: PageModel[];
  fonts: Map<string, FontDescriptorModel>;
  isDirty: boolean;
  activePageIndex: number;

  // The full original parsed PDF object table + trailer, if this document was
  // loaded from a file (vs. created blank). Export uses this to copy over
  // original fonts/resources instead of discarding them.
  sourcePdf?: { objects: Map<number, PdfObject>; trailer: PdfDict };
}
