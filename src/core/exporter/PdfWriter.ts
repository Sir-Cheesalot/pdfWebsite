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

    // 14 Standard PDF Fonts to support lossless text edits across different styles
    const standardFonts = [
      { key: 'F_Helv', name: 'Helvetica' },
      { key: 'F_HelvB', name: 'Helvetica-Bold' },
      { key: 'F_HelvI', name: 'Helvetica-Oblique' },
      { key: 'F_HelvBI', name: 'Helvetica-BoldOblique' },
      { key: 'F_Times', name: 'Times-Roman' },
      { key: 'F_TimesB', name: 'Times-Bold' },
      { key: 'F_TimesI', name: 'Times-Italic' },
      { key: 'F_TimesBI', name: 'Times-BoldItalic' },
      { key: 'F_Cour', name: 'Courier' },
      { key: 'F_CourB', name: 'Courier-Bold' },
      { key: 'F_CourI', name: 'Courier-Oblique' },
      { key: 'F_CourBI', name: 'Courier-BoldOblique' },
      { key: 'F_Symb', name: 'Symbol' },
      { key: 'F_Zapf', name: 'ZapfDingbats' }
    ];

    const stdFontsMap = new Map<string, number>();

    for (const f of standardFonts) {
      const fNum = allocNum();
      const fDict = new PdfDict();
      fDict.set('Type', new PdfName('Font'));
      fDict.set('Subtype', new PdfName('Type1'));
      fDict.set('BaseFont', new PdfName(f.name));
      if (f.key !== 'F_Symb' && f.key !== 'F_Zapf') {
        fDict.set('Encoding', new PdfName('WinAnsiEncoding'));
      }
      objectMap.set(fNum, { dict: fDict });
      stdFontsMap.set(f.key, fNum);
    }

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

      // Page Resources: preserve original Resources dict while properly resolving indirect /Font and /XObject references
      let resDict = new PdfDict();
      const clonedFontDict = new PdfDict();
      const clonedXObjDict = new PdfDict();

      if (page.sourcePageDict && this.rawPdfDoc) {
        const rawRes = this.resolveInherited(page.sourcePageDict, 'Resources');
        if (rawRes instanceof PdfDict) {
          // Copy other resource categories (ExtGState, ColorSpace, Pattern, Shading, etc.)
          for (const [k, v] of rawRes.entries()) {
            if (k !== 'Font' && k !== 'XObject') {
              const copied = this.copyObjectGraph(v, allocNum);
              if (copied !== undefined) {
                resDict.set(k, copied);
              }
            }
          }

          // Resolve and clone original Font dictionary
          const rawFontObj = this.resolveRaw(rawRes.get('Font'));
          if (rawFontObj instanceof PdfDict) {
            for (const [fKey, fVal] of rawFontObj.entries()) {
              const copiedFont = this.copyObjectGraph(fVal, allocNum);
              if (copiedFont !== undefined) {
                clonedFontDict.set(fKey, copiedFont);
              }
            }
          }

          // Resolve and clone original XObject dictionary
          const rawXObj = this.resolveRaw(rawRes.get('XObject'));
          if (rawXObj instanceof PdfDict) {
            for (const [xKey, xVal] of rawXObj.entries()) {
              const copiedXObj = this.copyObjectGraph(xVal, allocNum);
              if (copiedXObj !== undefined) {
                clonedXObjDict.set(xKey, copiedXObj);
              }
            }
          }
        }
      }

      // Add standard fallback fonts (only for keys that don't collide with original fonts)
      for (const [fKey, fNum] of stdFontsMap.entries()) {
        if (!clonedFontDict.has(fKey)) {
          clonedFontDict.set(fKey, new PdfRef(fNum, 0));
        }
      }
      if (!clonedFontDict.has('F1')) clonedFontDict.set('F1', new PdfRef(stdFontsMap.get('F_Helv')!, 0));
      if (!clonedFontDict.has('F2')) clonedFontDict.set('F2', new PdfRef(stdFontsMap.get('F_Helv')!, 0));

      resDict.set('Font', clonedFontDict);

      // Register newly created Image XObjects (from user-added/edited images)
      for (const [xKey, xStream] of newResources.xobjects.entries()) {
        const smaskObj = xStream.dict.get('SMask');
        if (smaskObj instanceof PdfStream) {
          const smaskNum = allocNum();
          objectMap.set(smaskNum, { stream: smaskObj });
          xStream.dict.set('SMask', new PdfRef(smaskNum, 0));
        }

        const xObjNum = allocNum();
        objectMap.set(xObjNum, { stream: xStream });
        clonedXObjDict.set(xKey, new PdfRef(xObjNum, 0));
      }

      resDict.set('XObject', clonedXObjDict);

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
      if (obj.isHex) {
        let hex = '<';
        for (let i = 0; i < obj.bytes.length; i++) {
          hex += obj.bytes[i].toString(16).padStart(2, '0');
        }
        hex += '>';
        this.writeString(hex);
      } else {
        this.writeBytes(this.escapePdfStringBytes(obj.bytes));
      }
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

  private escapePdfStringBytes(bytes: Uint8Array): Uint8Array {
    const out: number[] = [0x28]; // '('
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b === 0x5c) { // '\'
        out.push(0x5c, 0x5c);
      } else if (b === 0x28) { // '('
        out.push(0x5c, 0x28);
      } else if (b === 0x29) { // ')'
        out.push(0x5c, 0x29);
      } else if (b === 0x0d) { // '\r'
        out.push(0x5c, 0x72);
      } else if (b === 0x0a) { // '\n'
        out.push(0x5c, 0x6e);
      } else {
        out.push(b);
      }
    }
    out.push(0x29); // ')'
    return new Uint8Array(out);
  }
}
