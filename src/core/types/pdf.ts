// Low-level PDF Types & AST Nodes

export type PdfToken =
  | { type: 'keyword'; value: string }
  | { type: 'name'; value: string }
  | { type: 'number'; value: number }
  | { type: 'string'; value: Uint8Array; raw: string; isHex: boolean }
  | { type: 'boolean'; value: boolean }
  | { type: 'null' }
  | { type: 'ref'; num: number; gen: number }
  | { type: 'dict_start' }
  | { type: 'dict_end' }
  | { type: 'array_start' }
  | { type: 'array_end' }
  | { type: 'stream_start'; offset: number; length?: number }
  | { type: 'stream_end' };

export type PdfObject =
  | null
  | boolean
  | number
  | string
  | PdfName
  | PdfString
  | PdfRef
  | PdfArray
  | PdfDict
  | PdfStream;

export class PdfName {
  constructor(public value: string) {}
  toString() {
    return '/' + this.value;
  }
}

export class PdfString {
  constructor(public bytes: Uint8Array, public isHex: boolean = false) {}

  toText(encoding: 'latin1' | 'utf8' = 'latin1'): string {
    if (encoding === 'utf8') {
      try {
        return new TextDecoder('utf-8').decode(this.bytes);
      } catch {
        // fallback
      }
    }
    let res = '';
    for (let i = 0; i < this.bytes.length; i++) {
      res += String.fromCharCode(this.bytes[i]);
    }
    return res;
  }

  static fromString(str: string): PdfString {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      bytes[i] = str.charCodeAt(i) & 0xff;
    }
    return new PdfString(bytes, false);
  }
}

export class PdfRef {
  constructor(public num: number, public gen: number = 0) {}
  toString() {
    return `${this.num} ${this.gen} R`;
  }
}

export type PdfArray = PdfObject[];

export class PdfDict {
  private map = new Map<string, PdfObject>();

  set(key: string, value: PdfObject) {
    const cleanKey = key.startsWith('/') ? key.slice(1) : key;
    this.map.set(cleanKey, value);
  }

  get(key: string): PdfObject | undefined {
    const cleanKey = key.startsWith('/') ? key.slice(1) : key;
    return this.map.get(cleanKey);
  }

  has(key: string): boolean {
    const cleanKey = key.startsWith('/') ? key.slice(1) : key;
    return this.map.has(cleanKey);
  }

  delete(key: string): boolean {
    const cleanKey = key.startsWith('/') ? key.slice(1) : key;
    return this.map.delete(cleanKey);
  }

  entries(): [string, PdfObject][] {
    return Array.from(this.map.entries());
  }

  keys(): string[] {
    return Array.from(this.map.keys());
  }

  clone(): PdfDict {
    const dict = new PdfDict();
    for (const [k, v] of this.map.entries()) {
      dict.set(k, v);
    }
    return dict;
  }
}

export class PdfStream {
  constructor(public dict: PdfDict, public data: Uint8Array, public decodedData?: Uint8Array) {}
}

export interface PdfXRefEntry {
  offset: number;
  gen: number;
  inUse: boolean;
}

export interface PdfParsedDocument {
  version: string;
  objects: Map<number, PdfObject>; // objNum -> object
  trailer: PdfDict;
  pages: PdfRef[];
  pageDicts: PdfDict[];
}

export interface ContentOperator {
  op: string;
  args: PdfObject[];
  rawIndex?: number;
  // Exact byte offsets in the source content stream this operator (including
  // its operands) spans. Used to losslessly pass through unmodified content
  // instead of re-serializing it through a lossy string round-trip.
  startByte?: number;
  endByte?: number;
}
