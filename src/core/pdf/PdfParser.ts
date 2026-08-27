// PDF Object Graph Parser
import {
  PdfArray,
  PdfDict,
  PdfName,
  PdfObject,
  PdfParsedDocument,
  PdfRef,
  PdfStream,
  PdfString,
  PdfXRefEntry,
} from '../types/pdf';
import { PdfLexer } from './PdfLexer';
import { FlateDecoder } from './FlateDecoder';

export class PdfParser {
  private lexer: PdfLexer;
  private objects = new Map<number, PdfObject>();
  private xrefs = new Map<number, PdfXRefEntry>();
  private trailer: PdfDict = new PdfDict();
  private version = '1.7';

  constructor(private buffer: Uint8Array) {
    this.lexer = new PdfLexer(buffer);
  }

  parse(): PdfParsedDocument {
    // 1. Read header version (%PDF-1.x)
    this.readHeader();

    // 2. Locate startxref and read cross-reference table & trailer
    const startXRefOffset = this.findStartXRef();
    if (startXRefOffset > 0) {
      this.readXRefAndTrailer(startXRefOffset);
    } else {
      // Fallback: full linear scan for indirect objects
      this.scanObjectsLinearly();
    }

    // 3. Ensure all referenced objects are parsed
    this.loadAllObjects();

    // 4. Resolve Catalog and Pages
    const rootRef = this.trailer.get('Root');
    const root = this.resolve(rootRef);
    if (!(root instanceof PdfDict)) {
      // Fallback to scan for /Type /Catalog if not found
      this.recoverCatalogAndPages();
    }

    const { pages, pageDicts } = this.extractPages();

    return {
      version: this.version,
      objects: this.objects,
      trailer: this.trailer,
      pages,
      pageDicts,
    };
  }

  private readHeader() {
    this.lexer.seek(0);
    let line = '';
    for (let i = 0; i < Math.min(100, this.buffer.length); i++) {
      const ch = String.fromCharCode(this.buffer[i]);
      if (ch === '\r' || ch === '\n') break;
      line += ch;
    }
    const match = line.match(/%PDF-(\d+\.\d+)/);
    if (match) {
      this.version = match[1];
    }
  }

  private findStartXRef(): number {
    const idx = this.lexer.findLastString('startxref');
    if (idx === -1) return -1;

    this.lexer.seek(idx + 9);
    const token = this.lexer.nextToken();
    if (token && token.type === 'number') {
      return token.value;
    }
    return -1;
  }

  private readXRefAndTrailer(offset: number) {
    this.lexer.seek(offset);
    this.lexer.skipWhitespaceAndComments();
    const token = this.lexer.nextToken();

    if (token && token.type === 'keyword' && token.value === 'xref') {
      // Traditional XRef table
      this.parseTraditionalXRef();
      this.parseTrailer();
    } else if (token && token.type === 'number') {
      // XRef Stream (PDF 1.5+)
      this.lexer.seek(offset);
      const obj = this.parseIndirectObject();
      if (obj && obj instanceof PdfStream && obj.dict.get('Type') instanceof PdfName) {
        const typeName = (obj.dict.get('Type') as PdfName).value;
        if (typeName === 'XRef') {
          this.parseXRefStream(obj);
          this.trailer = obj.dict;
        }
      }
    }
  }

  private parseTraditionalXRef() {
    while (true) {
      this.lexer.skipWhitespaceAndComments();
      const firstTok = this.lexer.nextToken();
      if (!firstTok) break;
      if (firstTok.type === 'keyword' && firstTok.value === 'trailer') {
        break;
      }
      if (firstTok.type !== 'number') break;

      const countTok = this.lexer.nextToken();
      if (!countTok || countTok.type !== 'number') break;

      const firstObjNum = firstTok.value;
      const count = countTok.value;

      for (let i = 0; i < count; i++) {
        const offTok = this.lexer.nextToken();
        const genTok = this.lexer.nextToken();
        const flagTok = this.lexer.nextToken();

        if (offTok && genTok && flagTok && offTok.type === 'number' && genTok.type === 'number') {
          const inUse = flagTok.type === 'keyword' && flagTok.value === 'n';
          this.xrefs.set(firstObjNum + i, {
            offset: offTok.value,
            gen: genTok.value,
            inUse,
          });
        }
      }
    }
  }

  private visitedPrevOffsets = new Set<number>();

  private parseTrailer() {
    const trailerDict = this.parseObject();
    if (trailerDict instanceof PdfDict) {
      this.trailer = trailerDict;
      const prev = trailerDict.get('Prev');
      if (typeof prev === 'number' && prev > 0 && !this.visitedPrevOffsets.has(prev)) {
        this.visitedPrevOffsets.add(prev);
        const savedPos = this.lexer.position;
        this.readXRefAndTrailer(prev);
        this.lexer.seek(savedPos);
      }
    }
  }

  private parseXRefStream(stream: PdfStream) {
    const decoded = FlateDecoder.decodeStream(stream);
    const w = stream.dict.get('W');
    const index = stream.dict.get('Index');
    if (!Array.isArray(w) || w.length < 3) return;

    const w0 = Number(w[0]);
    const w1 = Number(w[1]);
    const w2 = Number(w[2]);
    const entrySize = w0 + w1 + w2;

    const size = Number(stream.dict.get('Size') || 0);
    const subsections: [number, number][] = [];

    if (Array.isArray(index) && index.length >= 2) {
      for (let i = 0; i < index.length; i += 2) {
        subsections.push([Number(index[i]), Number(index[i + 1])]);
      }
    } else {
      subsections.push([0, size]);
    }

    let bytePos = 0;
    for (const [startObj, count] of subsections) {
      for (let i = 0; i < count; i++) {
        if (bytePos + entrySize > decoded.length) break;

        let type = 1;
        if (w0 > 0) {
          type = 0;
          for (let b = 0; b < w0; b++) type = (type << 8) | decoded[bytePos++];
        }

        let field2 = 0;
        for (let b = 0; b < w1; b++) field2 = (field2 << 8) | decoded[bytePos++];

        let field3 = 0;
        for (let b = 0; b < w2; b++) field3 = (field3 << 8) | decoded[bytePos++];

        const objNum = startObj + i;
        if (type === 1) {
          // Standard uncompressed object: field2 is offset, field3 is generation
          this.xrefs.set(objNum, { offset: field2, gen: field3, inUse: true });
        } else if (type === 2) {
          // Compressed object inside Object Stream: field2 is ObjStm object number, field3 is index
          this.compressedObjMap.set(objNum, { stmObjNum: field2, indexInStm: field3 });
        }
      }
    }
  }

  private compressedObjMap = new Map<number, { stmObjNum: number; indexInStm: number }>();

  private loadAllObjects() {
    // 1. Load standard uncompressed objects from xref table
    for (const [objNum, entry] of this.xrefs.entries()) {
      if (entry.inUse && !this.objects.has(objNum)) {
        this.lexer.seek(entry.offset);
        const obj = this.parseIndirectObject();
        if (obj !== null) {
          this.objects.set(objNum, obj);
        }
      }
    }

    // 2. Unpack compressed objects from Object Streams (/Type /ObjStm)
    const stmObjNums = new Set<number>();
    for (const { stmObjNum } of this.compressedObjMap.values()) {
      stmObjNums.add(stmObjNum);
    }

    for (const stmObjNum of stmObjNums) {
      const stmObj = this.objects.get(stmObjNum);
      if (stmObj instanceof PdfStream) {
        this.unpackObjectStream(stmObj);
      }
    }
  }

  private unpackObjectStream(stream: PdfStream) {
    const decoded = stream.decodedData || FlateDecoder.decodeStream(stream);
    const n = Number(stream.dict.get('N') || 0);
    const first = Number(stream.dict.get('First') || 0);
    if (n <= 0 || first <= 0) return;

    const streamLexer = new PdfLexer(decoded);
    const entries: { objNum: number; offset: number }[] = [];

    for (let i = 0; i < n; i++) {
      const numTok = streamLexer.nextToken();
      const offTok = streamLexer.nextToken();
      if (numTok && numTok.type === 'number' && offTok && offTok.type === 'number') {
        entries.push({ objNum: numTok.value, offset: offTok.value });
      }
    }

    for (let i = 0; i < entries.length; i++) {
      const { objNum, offset } = entries[i];
      const targetPos = first + offset;
      if (targetPos < decoded.length) {
        streamLexer.seek(targetPos);
        const tempParser = new PdfParser(decoded);
        (tempParser as any).lexer.seek(targetPos);
        const parsed = (tempParser as any).parseObject();
        if (parsed !== null && !this.objects.has(objNum)) {
          this.objects.set(objNum, parsed);
        }
      }
    }
  }

  private scanObjectsLinearly() {
    const len = this.buffer.length;
    for (let i = 0; i < len - 4; i++) {
      // Look for "<number> <number> obj"
      if (
        this.buffer[i] === 0x6f && // 'o'
        this.buffer[i + 1] === 0x62 && // 'b'
        this.buffer[i + 2] === 0x6a // 'j'
      ) {
        // Look back for object number
        let p = i - 1;
        while (p >= 0 && (this.buffer[p] === 0x20 || this.buffer[p] === 0x09)) p--;
        while (p >= 0 && this.buffer[p] >= 0x30 && this.buffer[p] <= 0x39) p--; // gen num
        while (p >= 0 && (this.buffer[p] === 0x20 || this.buffer[p] === 0x09)) p--;
        const start = p;
        while (p >= 0 && this.buffer[p] >= 0x30 && this.buffer[p] <= 0x39) p--; // obj num
        const objStart = p + 1;

        if (objStart <= start) {
          this.lexer.seek(objStart);
          const tok1 = this.lexer.nextToken();
          const tok2 = this.lexer.nextToken();
          const tok3 = this.lexer.nextToken();
          if (
            tok1 &&
            tok1.type === 'number' &&
            tok2 &&
            tok2.type === 'number' &&
            tok3 &&
            tok3.type === 'keyword' &&
            tok3.value === 'obj'
          ) {
            const obj = this.parseObject();
            if (obj !== null) {
              this.objects.set(tok1.value, obj);
            }
          }
        }
      }
    }
  }

  parseIndirectObject(): PdfObject | null {
    const numTok = this.lexer.nextToken();
    const genTok = this.lexer.nextToken();
    const objTok = this.lexer.nextToken();

    if (
      !numTok ||
      numTok.type !== 'number' ||
      !genTok ||
      genTok.type !== 'number' ||
      !objTok ||
      objTok.type !== 'keyword' ||
      objTok.value !== 'obj'
    ) {
      return null;
    }

    const obj = this.parseObject();

    // Check for optional stream
    this.lexer.skipWhitespaceAndComments();
    const nextPos = this.lexer.position;
    const streamTok = this.lexer.nextToken();

    if (streamTok && streamTok.type === 'keyword' && streamTok.value === 'stream') {
      if (obj instanceof PdfDict) {
        const streamKeywordPos = this.lexer.position;
        let length: number | undefined;

        const directLen = obj.get('Length');
        if (typeof directLen === 'number') {
          length = directLen;
        } else if (directLen instanceof PdfRef) {
          const lenObj = this.resolve(directLen);
          if (typeof lenObj === 'number') {
            length = lenObj;
          }
        }

        // Restore position to right after 'stream' keyword
        this.lexer.seek(streamKeywordPos);
        const data = this.lexer.readStreamData(length);
        const stream = new PdfStream(obj, data);
        stream.decodedData = FlateDecoder.decodeStream(stream);

        this.objects.set(numTok.value, stream);
        return stream;
      }
    } else {
      this.lexer.seek(nextPos);
    }

    if (obj !== null) {
      this.objects.set(numTok.value, obj);
    }
    return obj;
  }

  parseObject(): PdfObject {
    const tok = this.lexer.nextToken();
    if (!tok) return null;

    if (tok.type === 'dict_start') {
      const dict = new PdfDict();
      while (true) {
        this.lexer.skipWhitespaceAndComments();
        if (this.lexer.position >= this.buffer.length) break;
        const keyTok = this.lexer.nextToken();
        if (!keyTok || keyTok.type === 'dict_end') break;
        if (keyTok.type === 'name') {
          const val = this.parseObject();
          dict.set(keyTok.value, val);
        } else {
          break;
        }
      }
      return dict;
    }

    if (tok.type === 'array_start') {
      const arr: PdfArray = [];
      while (true) {
        this.lexer.skipWhitespaceAndComments();
        if (this.lexer.position >= this.buffer.length) break;
        const peekChar = this.lexer.peekChar();
        if (peekChar === 0x5d || peekChar === -1) {
          // ']'
          this.lexer.nextChar();
          break;
        }
        const startPos = this.lexer.position;
        const val = this.parseObject();
        if (val === null && this.lexer.position === startPos) {
          this.lexer.nextChar();
          break;
        }
        arr.push(val);
      }
      return arr;
    }

    if (tok.type === 'name') {
      return new PdfName(tok.value);
    }

    if (tok.type === 'string') {
      return new PdfString(tok.value, tok.isHex);
    }

    if (tok.type === 'number') {
      // Check if it's an indirect reference: "<num> <gen> R"
      const savedPos = this.lexer.position;
      const tok2 = this.lexer.nextToken();
      if (tok2 && tok2.type === 'number') {
        const tok3 = this.lexer.nextToken();
        if (tok3 && tok3.type === 'keyword' && tok3.value === 'R') {
          return new PdfRef(tok.value, tok2.value);
        }
      }
      // Not a reference, rewind
      this.lexer.seek(savedPos);
      return tok.value;
    }

    if (tok.type === 'boolean') return tok.value;
    if (tok.type === 'null') return null;

    return null;
  }

  private resolvingRefs = new Set<number>();

  resolve(obj: PdfObject | undefined): PdfObject | undefined {
    if (obj === undefined) return undefined;
    if (obj instanceof PdfRef) {
      if (this.resolvingRefs.has(obj.num)) {
        return null;
      }
      this.resolvingRefs.add(obj.num);
      try {
        if (this.objects.has(obj.num)) {
          return this.resolve(this.objects.get(obj.num)!);
        }
        // Try to parse on demand if xref exists
        const entry = this.xrefs.get(obj.num);
        if (entry && entry.inUse) {
          this.lexer.seek(entry.offset);
          const parsed = this.parseIndirectObject();
          if (parsed) {
            this.objects.set(obj.num, parsed);
            return this.resolve(parsed);
          }
        }
        return null;
      } finally {
        this.resolvingRefs.delete(obj.num);
      }
    }
    return obj;
  }

  private recoverCatalogAndPages() {
    for (const [num, obj] of this.objects.entries()) {
      const dict = obj instanceof PdfStream ? obj.dict : obj instanceof PdfDict ? obj : null;
      if (dict) {
        const type = dict.get('Type');
        if (type instanceof PdfName && type.value === 'Catalog') {
          this.trailer.set('Root', new PdfRef(num, 0));
          break;
        }
      }
    }
  }

  private extractPages(): { pages: PdfRef[]; pageDicts: PdfDict[] } {
    const pages: PdfRef[] = [];
    const pageDicts: PdfDict[] = [];

    const root = this.resolve(this.trailer.get('Root'));
    if (root instanceof PdfDict) {
      const pagesNode = this.resolve(root.get('Pages'));
      if (pagesNode instanceof PdfDict) {
        this.traversePagesTree(pagesNode, pages, pageDicts);
      }
    }

    if (pages.length === 0) {
      // Direct scan of objects for /Type /Page
      for (const [num, obj] of this.objects.entries()) {
        const dict = obj instanceof PdfStream ? obj.dict : obj instanceof PdfDict ? obj : null;
        if (dict) {
          const type = dict.get('Type');
          if (type instanceof PdfName && type.value === 'Page') {
            pages.push(new PdfRef(num, 0));
            pageDicts.push(dict);
          }
        }
      }
    }

    return { pages, pageDicts };
  }

  private traversePagesTree(node: PdfDict, pages: PdfRef[], pageDicts: PdfDict[]) {
    const type = node.get('Type');
    const typeName = type instanceof PdfName ? type.value : '';

    if (typeName === 'Page') {
      pageDicts.push(node);
      return;
    }

    const kids = this.resolve(node.get('Kids'));
    if (Array.isArray(kids)) {
      for (const kidRef of kids) {
        if (kidRef instanceof PdfRef) {
          const kid = this.resolve(kidRef);
          if (kid instanceof PdfDict) {
            const kidType = kid.get('Type');
            const kidTypeName = kidType instanceof PdfName ? kidType.value : '';
            if (kidTypeName === 'Page') {
              pages.push(kidRef);
              pageDicts.push(kid);
            } else if (kidTypeName === 'Pages') {
              this.traversePagesTree(kid, pages, pageDicts);
            }
          }
        }
      }
    }
  }
}
