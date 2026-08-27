// Compliant PDF 1.7 Binary Serializer and Exporter
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
    this.chunks = [];
    this.currentOffset = 0;
    this.xrefOffsets = [0]; // obj 0 is free entry

    // 1. Write PDF Header
    this.writeString('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');

    let nextObjNum = 1;
    const objectMap = new Map<number, { dict?: PdfDict; stream?: PdfStream; rawStr?: string }>();

    // 2. Catalog & Pages objects
    const catalogObjNum = nextObjNum++;
    const pagesObjNum = nextObjNum++;
    const pageObjNums: number[] = [];

    // Standard Font Object (Helvetica)
    const stdFontObjNum = nextObjNum++;
    const fontDict = new PdfDict();
    fontDict.set('Type', new PdfName('Font'));
    fontDict.set('Subtype', new PdfName('Type1'));
    fontDict.set('BaseFont', new PdfName('Helvetica'));
    fontDict.set('Encoding', new PdfName('WinAnsiEncoding'));
    objectMap.set(stdFontObjNum, { dict: fontDict });

    const reconstructor = new ContentStreamReconstructor();

    // 3. Process each page
    for (let p = 0; p < doc.pages.length; p++) {
      const page = doc.pages[p];
      const pageObjNum = nextObjNum++;
      const contentStreamObjNum = nextObjNum++;
      pageObjNums.push(pageObjNum);

      // Reconstruct content stream
      const { streamBytes, newResources } = reconstructor.reconstructPageStream(page, doc);
      const compressedStream = FlateDecoder.encodeFlate(streamBytes);

      // Create Content Stream Object
      const streamDict = new PdfDict();
      streamDict.set('Length', compressedStream.length);
      streamDict.set('Filter', new PdfName('FlateDecode'));
      const contentStream = new PdfStream(streamDict, compressedStream);
      objectMap.set(contentStreamObjNum, { stream: contentStream });

      // Page Resources
      const resDict = new PdfDict();
      const resFontDict = new PdfDict();
      resFontDict.set('F_Helv', new PdfRef(stdFontObjNum, 0));
      resFontDict.set('F1', new PdfRef(stdFontObjNum, 0));
      resFontDict.set('F2', new PdfRef(stdFontObjNum, 0));

      const resXObjDict = new PdfDict();
      // Register newly created Image XObjects
      for (const [xKey, xStream] of newResources.xobjects.entries()) {
        const xObjNum = nextObjNum++;
        objectMap.set(xObjNum, { stream: xStream });
        resXObjDict.set(xKey, new PdfRef(xObjNum, 0));
      }

      resDict.set('Font', resFontDict);
      resDict.set('XObject', resXObjDict);
      resDict.set('ProcSet', [new PdfName('PDF'), new PdfName('Text'), new PdfName('ImageB'), new PdfName('ImageC'), new PdfName('ImageI')]);

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

      objectMap.set(pageObjNum, { dict: pDict });
    }

    // 4. Pages Root Object
    const pagesDict = new PdfDict();
    pagesDict.set('Type', new PdfName('Pages'));
    pagesDict.set('Count', pageObjNums.length);
    pagesDict.set('Kids', pageObjNums.map((num) => new PdfRef(num, 0)));
    objectMap.set(pagesObjNum, { dict: pagesDict });

    // 5. Catalog Object
    const catDict = new PdfDict();
    catDict.set('Type', new PdfName('Catalog'));
    catDict.set('Pages', new PdfRef(pagesObjNum, 0));
    objectMap.set(catalogObjNum, { dict: catDict });

    // 6. Write all objects sequentially
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

    // 7. Write Cross-Reference Table (XRef)
    const xrefStart = this.currentOffset;
    this.writeString('xref\n');
    this.writeString(`0 ${totalObjects}\n`);
    this.writeString('0000000000 65535 f \r\n');

    for (let i = 1; i < totalObjects; i++) {
      const off = this.xrefOffsets[i] || 0;
      const offStr = off.toString().padStart(10, '0');
      this.writeString(`${offStr} 00000 n \r\n`);
    }

    // 8. Write Trailer
    this.writeString('trailer\n');
    const trailer = new PdfDict();
    trailer.set('Size', totalObjects);
    trailer.set('Root', new PdfRef(catalogObjNum, 0));
    this.writeDict(trailer);
    this.writeString('\n');

    // 9. Write startxref & EOF
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
    this.writeString('\nendobj\n\n');
  }

  private writeStreamObject(objNum: number, stream: PdfStream) {
    this.writeString(`${objNum} 0 obj\n`);
    this.writeDict(stream.dict);
    this.writeString('\nstream\r\n');
    this.writeBytes(stream.data);
    this.writeString('\r\nendstream\nendobj\n\n');
  }

  private writeDict(dict: PdfDict) {
    this.writeString('<<\n');
    for (const [k, v] of dict.entries()) {
      this.writeString(`  /${k} `);
      this.writeObject(v);
      this.writeString('\n');
    }
    this.writeString('>>');
  }

  private writeObject(obj: PdfObject) {
    if (obj === null) {
      this.writeString('null');
    } else if (typeof obj === 'boolean') {
      this.writeString(obj ? 'true' : 'false');
    } else if (typeof obj === 'number') {
      this.writeString(Number.isInteger(obj) ? obj.toString() : obj.toFixed(4));
    } else if (obj instanceof PdfName) {
      this.writeString(obj.toString());
    } else if (obj instanceof PdfString) {
      this.writeString(`(${obj.toText()})`);
    } else if (obj instanceof PdfRef) {
      this.writeString(obj.toString());
    } else if (Array.isArray(obj)) {
      this.writeString('[ ');
      for (const item of obj) {
        this.writeObject(item);
        this.writeString(' ');
      }
      this.writeString(']');
    } else if (obj instanceof PdfDict) {
      this.writeDict(obj);
    }
  }
}
