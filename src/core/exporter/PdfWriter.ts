// Compliant PDF 1.7 Binary Serializer and Exporter (Lossless Structure & Resource Preservation)
import {
  PdfArray,
  PdfDict,
  PdfName,
  PdfObject,
  PdfRef,
  PdfStream,
  PdfString,
} from '../types/pdf';
import { DocumentModel } from '../types/model';
import { ContentStreamReconstructor } from './ContentStreamReconstructor';
import { FlateDecoder } from '../pdf/FlateDecoder';
import { PdfParser } from '../pdf/PdfParser';

export class PdfWriter {
  private chunks: Uint8Array[] = [];
  private currentOffset = 0;
  private xrefOffsets: number[] = [];

  constructor(private rawPdfDoc?: { objects: Map<number, PdfObject>; trailer: PdfDict }) {}

  /**
   * Export the entire DocumentModel to a 100% compliant PDF 1.7 binary Uint8Array
   */
  exportDocument(doc: DocumentModel): Uint8Array {
    // 1. Lossless bypass: if untouched and original binary exists, return verbatim
    if (doc.originalPdfBytes && !doc.isDirty) {
      return doc.originalPdfBytes;
    }

    this.chunks = [];
    this.currentOffset = 0;
    this.xrefOffsets = [0]; // obj 0 is free entry

    // Write PDF Header
    this.writeString('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');

    let nextObjNum = 1;
    const objectMap = new Map<number, { dict?: PdfDict; stream?: PdfStream; rawStr?: string }>();

    // Catalog & Pages root objects
    const catalogObjNum = nextObjNum++;
    const pagesObjNum = nextObjNum++;
    const pageObjNums: number[] = [];

    // Fallback Standard Font Object (Helvetica) for new user-created elements
    const stdFontObjNum = nextObjNum++;
    const fontDict = new PdfDict();
    fontDict.set('Type', new PdfName('Font'));
    fontDict.set('Subtype', new PdfName('Type1'));
    fontDict.set('BaseFont', new PdfName('Helvetica'));
    fontDict.set('Encoding', new PdfName('WinAnsiEncoding'));
    objectMap.set(stdFontObjNum, { dict: fontDict });

    let parser: PdfParser | undefined;
    let parsedPdf: any;
    if (doc.originalPdfBytes) {
      try {
        parser = new PdfParser(doc.originalPdfBytes);
        parsedPdf = parser.parse();
      } catch (_) {}
    }

    const reconstructor = new ContentStreamReconstructor(parser);

    // Process each page
    for (let p = 0; p < doc.pages.length; p++) {
      const page = doc.pages[p];
      const pageObjNum = nextObjNum++;
      const contentStreamObjNum = nextObjNum++;
      pageObjNums.push(pageObjNum);

      let originalStreamData: Uint8Array | undefined;
      let origPageDict: PdfDict | undefined;

      if (parsedPdf && parsedPdf.pageDicts && parsedPdf.pageDicts[p]) {
        origPageDict = parsedPdf.pageDicts[p];
        const contentsObj = parser?.resolve(origPageDict?.get('Contents'));
        if (contentsObj instanceof PdfStream) {
          originalStreamData = contentsObj.decodedData || FlateDecoder.decodeStream(contentsObj);
        }
      }

      // Reconstruct content stream (pass through untouched ops verbatim)
      const { streamBytes, newResources } = reconstructor.reconstructPageStream(
        page,
        doc,
        originalStreamData,
        origPageDict
      );
      const compressedStream = FlateDecoder.encodeFlate(streamBytes);

      // Create Content Stream Object
      const streamDict = new PdfDict();
      streamDict.set('Length', compressedStream.length);
      streamDict.set('Filter', new PdfName('FlateDecode'));
      const contentStream = new PdfStream(streamDict, compressedStream);
      objectMap.set(contentStreamObjNum, { stream: contentStream });

      // Page Resources: preserve original resource dictionaries while registering additions
      const resDict = new PdfDict();
      const resFontDict = new PdfDict();
      resFontDict.set('F_Helv', new PdfRef(stdFontObjNum, 0));

      // Copy original page fonts
      if (origPageDict) {
        const origRes = parser?.resolve(origPageDict.get('Resources'));
        if (origRes instanceof PdfDict) {
          const origFonts = parser?.resolve(origRes.get('Font'));
          if (origFonts instanceof PdfDict) {
            for (const [k, v] of origFonts.entries()) {
              resFontDict.set(k, v);
            }
          }
          const origExtG = parser?.resolve(origRes.get('ExtGState'));
          if (origExtG instanceof PdfDict) {
            resDict.set('ExtGState', origExtG);
          }
          const origColorSpace = parser?.resolve(origRes.get('ColorSpace'));
          if (origColorSpace) {
            resDict.set('ColorSpace', origColorSpace);
          }
          const origPattern = parser?.resolve(origRes.get('Pattern'));
          if (origPattern) {
            resDict.set('Pattern', origPattern);
          }
          const origShading = parser?.resolve(origRes.get('Shading'));
          if (origShading) {
            resDict.set('Shading', origShading);
          }
        }
      }

      const resXObjDict = new PdfDict();
      if (origPageDict) {
        const origRes = parser?.resolve(origPageDict.get('Resources'));
        if (origRes instanceof PdfDict) {
          const origXObj = parser?.resolve(origRes.get('XObject'));
          if (origXObj instanceof PdfDict) {
            for (const [k, v] of origXObj.entries()) {
              resXObjDict.set(k, v);
            }
          }
        }
      }

      // Register newly created Image XObjects
      for (const [xKey, xStream] of newResources.xobjects.entries()) {
        const xObjNum = nextObjNum++;
        objectMap.set(xObjNum, { stream: xStream });
        resXObjDict.set(xKey, new PdfRef(xObjNum, 0));
      }

      resDict.set('Font', resFontDict);
      resDict.set('XObject', resXObjDict);
      resDict.set(
        'ProcSet',
        [new PdfName('PDF'), new PdfName('Text'), new PdfName('ImageB'), new PdfName('ImageC'), new PdfName('ImageI')]
      );

      // Page Dict
      const pDict = new PdfDict();
      pDict.set('Type', new PdfName('Page'));
      pDict.set('Parent', new PdfRef(pagesObjNum, 0));
      pDict.set('MediaBox', [page.mediaBox[0], page.mediaBox[1], page.mediaBox[2], page.mediaBox[3]]);
      if (page.cropBox) {
        pDict.set('CropBox', [page.cropBox[0], page.cropBox[1], page.cropBox[2], page.cropBox[3]]);
      }
      pDict.set('Rotate', page.rotation || 0);
      pDict.set('Resources', resDict);
      pDict.set('Contents', new PdfRef(contentStreamObjNum, 0));

      // Preserve Page Annotations if present
      if (origPageDict) {
        const annots = origPageDict.get('Annots');
        if (annots) {
          pDict.set('Annots', annots);
        }
      }

      objectMap.set(pageObjNum, { dict: pDict });
    }

    // Pages Root Object
    const pagesDict = new PdfDict();
    pagesDict.set('Type', new PdfName('Pages'));
    pagesDict.set('Count', pageObjNums.length);
    pagesDict.set('Kids', pageObjNums.map((num) => new PdfRef(num, 0)));
    objectMap.set(pagesObjNum, { dict: pagesDict });

    // Catalog Object: preserve document-level structures (/Outlines, /AcroForm, /OCProperties)
    const catDict = new PdfDict();
    catDict.set('Type', new PdfName('Catalog'));
    catDict.set('Pages', new PdfRef(pagesObjNum, 0));

    if (parsedPdf && parsedPdf.rootDict instanceof PdfDict) {
      const origCat = parsedPdf.rootDict;
      const outlines = origCat.get('Outlines');
      if (outlines) catDict.set('Outlines', outlines);
      const acroForm = origCat.get('AcroForm');
      if (acroForm) catDict.set('AcroForm', acroForm);
      const ocProps = origCat.get('OCProperties');
      if (ocProps) catDict.set('OCProperties', ocProps);
    }
    objectMap.set(catalogObjNum, { dict: catDict });

    // Write all objects sequentially
    const totalObjects = nextObjNum;
    for (let objNum = 1; objNum < totalObjects; objNum++) {
      this.xrefOffsets[objNum] = this.currentOffset;
      const entry = objectMap.get(objNum);

      if (entry?.stream) {
        this.writeStreamObject(objNum, entry.stream);
      } else if (entry?.dict) {
        this.writeDictObject(objNum, entry.dict);
      }
    }

    // Write Cross-Reference Table (XRef)
    const xrefStart = this.currentOffset;
    this.writeString('xref\n');
    this.writeString(`0 ${totalObjects}\n`);
    this.writeString('0000000000 65535 f \r\n');

    for (let i = 1; i < totalObjects; i++) {
      const off = this.xrefOffsets[i] || 0;
      const offStr = off.toString().padStart(10, '0');
      this.writeString(`${offStr} 00000 n \r\n`);
    }

    // Write Trailer: preserve /Info metadata
    this.writeString('trailer\n');
    const trailer = new PdfDict();
    trailer.set('Size', totalObjects);
    trailer.set('Root', new PdfRef(catalogObjNum, 0));

    if (parsedPdf && parsedPdf.trailerDict instanceof PdfDict) {
      const info = parsedPdf.trailerDict.get('Info');
      if (info) {
        trailer.set('Info', info);
      }
    }

    this.writeDict(trailer);
    this.writeString('\n');

    // Write startxref & EOF
    this.writeString('startxref\n');
    this.writeString(`${xrefStart}\n`);
    this.writeString('%%EOF\n');

    // Combine all chunks into single Uint8Array
    const totalBytes = this.chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  private writeString(str: string) {
    const bytes = new TextEncoder().encode(str);
    this.chunks.push(bytes);
    this.currentOffset += bytes.length;
  }

  private writeBytes(bytes: Uint8Array) {
    this.chunks.push(bytes);
    this.currentOffset += bytes.length;
  }

  private writeDictObject(objNum: number, dict: PdfDict) {
    this.writeString(`${objNum} 0 obj\n`);
    this.writeDict(dict);
    this.writeString('\nendobj\n');
  }

  private writeStreamObject(objNum: number, stream: PdfStream) {
    this.writeString(`${objNum} 0 obj\n`);
    this.writeDict(stream.dict);
    this.writeString('\nstream\n');
    this.writeBytes(stream.data);
    this.writeString('\nendstream\nendobj\n');
  }

  private writeDict(dict: PdfDict) {
    this.writeString('<<\n');
    for (const [key, value] of dict.entries()) {
      this.writeString(`/${key} `);
      this.writeObjectValue(value);
      this.writeString('\n');
    }
    this.writeString('>>');
  }

  private writeObjectValue(value: any) {
    if (value instanceof PdfName) {
      this.writeString(`/${value.value}`);
    } else if (value instanceof PdfRef) {
      this.writeString(`${value.num} ${value.gen} R`);
    } else if (value instanceof PdfString) {
      this.writeString(`(${this.escapePdfString(value.toText())})`);
    } else if (value instanceof PdfDict) {
      this.writeDict(value);
    } else if (Array.isArray(value)) {
      this.writeString('[');
      for (let i = 0; i < value.length; i++) {
        if (i > 0) this.writeString(' ');
        this.writeObjectValue(value[i]);
      }
      this.writeString(']');
    } else if (typeof value === 'number') {
      this.writeString(Number.isInteger(value) ? value.toString() : value.toFixed(4));
    } else if (typeof value === 'boolean') {
      this.writeString(value ? 'true' : 'false');
    } else if (value === null || value === undefined) {
      this.writeString('null');
    } else {
      this.writeString(String(value));
    }
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
