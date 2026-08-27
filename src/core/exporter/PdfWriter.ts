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
  // Maps original object numbers (from the source PDF) to their new object
  // numbers in the exported file, so an original resource subgraph (fonts,
  // embedded font programs, ExtGStates, other XObjects, etc.) can be copied
  // over verbatim instead of being discarded.
  private copiedObjNumMap = new Map<number, number>();
  private copyWorklist: { newNum: number; original: PdfObject }[] = [];

  constructor(private rawPdfDoc?: { objects: Map<number, PdfObject>; trailer: PdfDict }) {}

  /**
   * Recursively copies a PdfObject graph from the source document, allocating
   * new object numbers for any indirect references encountered and queuing
   * them for later writing. Leaves that are already-resolved primitives are
   * cloned in place. This is what lets us preserve original fonts/encodings/
   * embedded font files/other resources for pages (or parts of pages) that
   * weren't touched by the user, instead of collapsing everything to a single
   * fallback Helvetica font.
   */
  private copyObjectGraph(obj: PdfObject | undefined, allocNum: () => number): PdfObject | undefined {
    if (obj === undefined || obj === null) return obj ?? null;

    if (obj instanceof PdfRef) {
      const existing = this.copiedObjNumMap.get(obj.num);
      if (existing !== undefined) {
        return new PdfRef(existing, 0);
      }
      const original = this.rawPdfDoc?.objects.get(obj.num);
      if (original === undefined) {
        // Reference to something we don't have (e.g. broken/missing xref
        // entry in the source file) - drop the reference rather than emit an
        // invalid one.
        return null;
      }
      const newNum = allocNum();
      this.copiedObjNumMap.set(obj.num, newNum);
      this.copyWorklist.push({ newNum, original });
      return new PdfRef(newNum, 0);
    }

    if (obj instanceof PdfDict) {
      const clone = new PdfDict();
      for (const [k, v] of obj.entries()) {
        const copied = this.copyObjectGraph(v, allocNum);
        if (copied !== undefined) clone.set(k, copied);
      }
      return clone;
    }

    if (obj instanceof PdfStream) {
      const clonedDict = this.copyObjectGraph(obj.dict, allocNum) as PdfDict;
      // Stream data (font programs, image data, ICC profiles, etc.) is opaque
      // binary we don't need to touch - reuse the original bytes as-is.
      return new PdfStream(clonedDict, obj.data, obj.decodedData);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.copyObjectGraph(item, allocNum) ?? null);
    }

    // PdfName, PdfString, number, boolean - immutable-ish primitives, safe to
    // pass through directly.
    return obj;
  }

  /**
   * Export the entire DocumentModel to a 100% compliant PDF 1.7 binary Uint8Array
   */
  exportDocument(doc: DocumentModel): Uint8Array {
    this.chunks = [];
    this.currentOffset = 0;
    this.xrefOffsets = [0]; // obj 0 is free entry
    this.copiedObjNumMap = new Map();
    this.copyWorklist = [];

    // Use the document's own retained source PDF (from loading) if the caller
    // didn't explicitly supply one.
    if (!this.rawPdfDoc && doc.sourcePdf) {
      this.rawPdfDoc = doc.sourcePdf;
    }

    // 1. Write PDF Header
    this.writeString('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');

    let nextObjNum = 1;
    const objectMap = new Map<number, { dict?: PdfDict; stream?: PdfStream; array?: PdfArray; primitive?: PdfObject; rawStr?: string }>();
    const allocNum = () => nextObjNum++;

    // 2. Catalog & Pages objects
    const catalogObjNum = allocNum();
    const pagesObjNum = allocNum();
    const pageObjNums: number[] = [];

    // Fallback Standard Font Object (Helvetica) - only used for resource keys
    // that aren't present in a page's original (preserved) Resources dict,
    // e.g. brand new user-created text on a page with no source PDF.
    const stdFontObjNum = allocNum();
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
      const pageObjNum = allocNum();
      const contentStreamObjNum = allocNum();
      pageObjNums.push(pageObjNum);

      // Reconstruct content stream, passing the original bytes/dict through so
      // unmodified content is preserved byte-for-byte (see ContentStreamReconstructor).
      const { streamBytes, newResources } = reconstructor.reconstructPageStream(
        page,
        doc,
        page.sourceStreams,
        page.sourcePageDict
      );
      const compressedStream = FlateDecoder.encodeFlate(streamBytes);

      // Create Content Stream Object
      const streamDict = new PdfDict();
      streamDict.set('Length', compressedStream.length);
      streamDict.set('Filter', new PdfName('FlateDecode'));
      const contentStream = new PdfStream(streamDict, compressedStream);
      objectMap.set(contentStreamObjNum, { stream: contentStream });

      // Page Resources: prefer copying the ORIGINAL page's Resources dict
      // (fonts, embedded font programs, ExtGStates, existing XObjects, color
      // spaces, everything) so untouched text keeps rendering with its real
      // font instead of being collapsed to Helvetica. We still merge in a
      // fallback Helvetica entry and any newly-created image XObjects.
      let resDict: PdfDict | null = null;
      if (page.sourcePageDict && this.rawPdfDoc) {
        const originalResources = this.resolveInherited(page.sourcePageDict, 'Resources');
        if (originalResources instanceof PdfDict) {
          const copied = this.copyObjectGraph(originalResources, allocNum);
          if (copied instanceof PdfDict) {
            resDict = copied;
          }
        }
      }
      if (!resDict) {
        resDict = new PdfDict();
      }

      // Ensure a fallback font is always available under well-known keys,
      // without clobbering original font resources that use the same keys.
      let resFontDict = resDict.get('Font');
      if (!(resFontDict instanceof PdfDict)) {
        resFontDict = new PdfDict();
        resDict.set('Font', resFontDict);
      }
      const fontDictTyped = resFontDict as PdfDict;
      if (!fontDictTyped.has('F_Helv')) fontDictTyped.set('F_Helv', new PdfRef(stdFontObjNum, 0));
      if (!fontDictTyped.has('F1')) fontDictTyped.set('F1', new PdfRef(stdFontObjNum, 0));
      if (!fontDictTyped.has('F2')) fontDictTyped.set('F2', new PdfRef(stdFontObjNum, 0));

      let resXObjDict = resDict.get('XObject');
      if (!(resXObjDict instanceof PdfDict)) {
        resXObjDict = new PdfDict();
        resDict.set('XObject', resXObjDict);
      }
      const xObjDictTyped = resXObjDict as PdfDict;
      // Register newly created Image XObjects (from user-added/edited images)
      for (const [xKey, xStream] of newResources.xobjects.entries()) {
        const xObjNum = allocNum();
        objectMap.set(xObjNum, { stream: xStream });
        xObjDictTyped.set(xKey, new PdfRef(xObjNum, 0));
      }

      if (!resDict.has('ProcSet')) {
        resDict.set('ProcSet', [new PdfName('PDF'), new PdfName('Text'), new PdfName('ImageB'), new PdfName('ImageC'), new PdfName('ImageI')]);
      }

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

    // 3b. Flush the copy worklist: any indirect objects pulled in while
    // copying original Resources graphs (font descriptors, embedded font
    // file streams, encoding dicts, nested XObjects, ICC profiles, etc.)
    // need to be written out too. Copying can itself enqueue more work
    // (e.g. a font descriptor referencing a font file stream), so drain the
    // worklist until empty rather than iterating it once.
    while (this.copyWorklist.length > 0) {
      const { newNum, original } = this.copyWorklist.shift()!;
      const copied = this.copyObjectGraph(original, allocNum);
      if (copied instanceof PdfStream) {
        objectMap.set(newNum, { stream: copied });
      } else if (copied instanceof PdfDict) {
        objectMap.set(newNum, { dict: copied });
      } else if (Array.isArray(copied)) {
        objectMap.set(newNum, { array: copied });
      } else if (copied !== undefined && copied !== null) {
        objectMap.set(newNum, { primitive: copied });
      }
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
      } else if (entry?.array) {
        this.writeArrayObject(objNum, entry.array);
      } else if (entry?.primitive !== undefined) {
        this.writeString(`${objNum} 0 obj\n`);
        this.writeObject(entry.primitive);
        this.writeString('\nendobj\n\n');
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

  /** Resolve a single indirect reference against the retained source object table. */
  private resolveRaw(obj: PdfObject | undefined): PdfObject | undefined {
    if (obj instanceof PdfRef && this.rawPdfDoc) {
      const target = this.rawPdfDoc.objects.get(obj.num);
      return target instanceof PdfRef ? this.resolveRaw(target) : target;
    }
    return obj;
  }

  /** Walk up /Parent to resolve an inherited page attribute (e.g. Resources). */
  private resolveInherited(pageDict: PdfDict, key: string): PdfObject | undefined {
    let current: PdfDict | null = pageDict;
    let guard = 0;
    while (current && guard++ < 64) {
      const val = this.resolveRaw(current.get(key));
      if (val !== undefined && val !== null) return val;
      const parent = this.resolveRaw(current.get('Parent'));
      current = parent instanceof PdfDict ? parent : null;
    }
    return undefined;
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

  private writeArrayObject(objNum: number, arr: PdfArray) {
    this.writeString(`${objNum} 0 obj\n`);
    this.writeObject(arr);
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
