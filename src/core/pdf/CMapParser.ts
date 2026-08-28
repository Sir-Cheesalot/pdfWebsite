// Structured PDF CMap & ToUnicode Parser
// Implements Adobe CMap Specification & ISO 32000-1 §9.7.5

export interface CodeSpaceRange {
  min: number;
  max: number;
  byteLength: number;
  rawMin: Uint8Array;
  rawMax: Uint8Array;
}

export interface CMapData {
  codeSpaces: CodeSpaceRange[];
  toUnicode: Map<number, string>;
  cidMap?: Map<number, number>;
  reverseMap?: Map<string, number>;
  maxUnicodeKeyLen?: number;
}

export class CMapParser {
  /**
   * Parse a /ToUnicode or CMap stream (raw bytes or text)
   */
  static parse(data: Uint8Array | string): CMapData {
    const text = typeof data === 'string' ? data : new TextDecoder('latin1').decode(data);
    const codeSpaces: CodeSpaceRange[] = [];
    const toUnicode = new Map<number, string>();
    const cidMap = new Map<number, number>();

    const tokens = this.tokenize(text);
    let i = 0;

    while (i < tokens.length) {
      const tok = tokens[i++];

      if (tok.type === 'keyword') {
        if (tok.value === 'begincodespacerange') {
          i = this.parseCodeSpaceRange(tokens, i, codeSpaces);
        } else if (tok.value === 'beginbfchar') {
          i = this.parseBfChar(tokens, i, toUnicode);
        } else if (tok.value === 'beginbfrange') {
          i = this.parseBfRange(tokens, i, toUnicode);
        } else if (tok.value === 'begincidchar') {
          i = this.parseCidChar(tokens, i, cidMap);
        } else if (tok.value === 'begincidrange') {
          i = this.parseCidRange(tokens, i, cidMap);
        }
      }
    }

    // Build reverse map for longest-match round-trip encoding
    const reverseMap = new Map<string, number>();
    let maxUnicodeKeyLen = 1;
    for (const [code, uni] of toUnicode.entries()) {
      if (uni && !reverseMap.has(uni)) {
        reverseMap.set(uni, code);
        if (uni.length > maxUnicodeKeyLen) {
          maxUnicodeKeyLen = uni.length;
        }
      }
    }

    return {
      codeSpaces,
      toUnicode,
      cidMap: cidMap.size > 0 ? cidMap : undefined,
      reverseMap,
      maxUnicodeKeyLen,
    };
  }

  private static parseCodeSpaceRange(tokens: Token[], startIndex: number, codeSpaces: CodeSpaceRange[]): number {
    let i = startIndex;
    while (i < tokens.length) {
      const tok = tokens[i];
      if (tok.type === 'keyword' && tok.value === 'endcodespacerange') {
        return i + 1;
      }
      if (tok.type === 'hex' && i + 1 < tokens.length && tokens[i + 1].type === 'hex') {
        const minHex = tok.value as string;
        const maxHex = tokens[i + 1].value as string;
        i += 2;

        const byteLen = Math.max(1, Math.ceil(minHex.length / 2));
        const minVal = parseInt(minHex, 16);
        const maxVal = parseInt(maxHex, 16);

        codeSpaces.push({
          min: minVal,
          max: maxVal,
          byteLength: byteLen,
          rawMin: this.hexToBytes(minHex),
          rawMax: this.hexToBytes(maxHex),
        });
      } else {
        i++;
      }
    }
    return i;
  }

  private static parseBfChar(tokens: Token[], startIndex: number, toUnicode: Map<number, string>): number {
    let i = startIndex;
    while (i < tokens.length) {
      const tok = tokens[i];
      if (tok.type === 'keyword' && tok.value === 'endbfchar') {
        return i + 1;
      }
      if (tok.type === 'hex' && i + 1 < tokens.length) {
        const srcHex = tok.value as string;
        const destTok = tokens[i + 1];
        i += 2;

        const srcCode = parseInt(srcHex, 16);
        if (destTok.type === 'hex') {
          const unicode = this.decodeHexToUnicode(destTok.value as string);
          toUnicode.set(srcCode, unicode);
        } else if (destTok.type === 'name') {
          toUnicode.set(srcCode, destTok.value as string);
        }
      } else {
        i++;
      }
    }
    return i;
  }

  private static parseBfRange(tokens: Token[], startIndex: number, toUnicode: Map<number, string>): number {
    let i = startIndex;
    while (i < tokens.length) {
      const tok = tokens[i];
      if (tok.type === 'keyword' && tok.value === 'endbfrange') {
        return i + 1;
      }
      if (tok.type === 'hex' && i + 2 < tokens.length && tokens[i + 1].type === 'hex') {
        const startHex = tok.value as string;
        const endHex = tokens[i + 1].value as string;
        const destTok = tokens[i + 2];
        i += 3;

        const startCode = parseInt(startHex, 16);
        const endCode = parseInt(endHex, 16);

        if (destTok.type === 'array') {
          // Array form: <start> <end> [ <dest1> <dest2> ... ]
          const arr = destTok.values || [];
          for (let j = 0; j < arr.length && startCode + j <= endCode; j++) {
            toUnicode.set(startCode + j, this.decodeHexToUnicode(arr[j]));
          }
        } else if (destTok.type === 'hex') {
          // Sequential single destination form: <start> <end> <destStart>
          const destHex = destTok.value as string;
          if (destHex.length === 8) {
            // Surrogate pair starting code point
            const high = parseInt(destHex.slice(0, 4), 16);
            const low = parseInt(destHex.slice(4, 8), 16);
            if (high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) {
              const baseCp = 0x10000 + ((high - 0xd800) << 10) + (low - 0xdc00);
              for (let code = startCode; code <= endCode; code++) {
                toUnicode.set(code, String.fromCodePoint(baseCp + (code - startCode)));
              }
            } else {
              for (let code = startCode; code <= endCode; code++) {
                toUnicode.set(code, this.decodeHexToUnicode(destHex));
              }
            }
          } else if (destHex.length <= 4) {
            let startUni = parseInt(destHex, 16);
            for (let code = startCode; code <= endCode; code++) {
              toUnicode.set(code, String.fromCharCode(startUni + (code - startCode)));
            }
          } else {
            // Multi-char literal
            for (let code = startCode; code <= endCode; code++) {
              toUnicode.set(code, this.decodeHexToUnicode(destHex));
            }
          }
        }
      } else {
        i++;
      }
    }
    return i;
  }

  private static parseCidChar(tokens: Token[], startIndex: number, cidMap: Map<number, number>): number {
    let i = startIndex;
    while (i < tokens.length) {
      const tok = tokens[i];
      if (tok.type === 'keyword' && tok.value === 'endcidchar') {
        return i + 1;
      }
      if (tok.type === 'hex' && i + 1 < tokens.length && tokens[i + 1].type === 'number') {
        const srcCode = parseInt(tok.value as string, 16);
        const cid = tokens[i + 1].value as number;
        cidMap.set(srcCode, cid);
        i += 2;
      } else {
        i++;
      }
    }
    return i;
  }

  private static parseCidRange(tokens: Token[], startIndex: number, cidMap: Map<number, number>): number {
    let i = startIndex;
    while (i < tokens.length) {
      const tok = tokens[i];
      if (tok.type === 'keyword' && tok.value === 'endcidrange') {
        return i + 1;
      }
      if (
        tok.type === 'hex' &&
        i + 2 < tokens.length &&
        tokens[i + 1].type === 'hex' &&
        tokens[i + 2].type === 'number'
      ) {
        const startCode = parseInt(tok.value as string, 16);
        const endCode = parseInt(tokens[i + 1].value as string, 16);
        const startCid = tokens[i + 2].value as number;
        for (let code = startCode; code <= endCode; code++) {
          cidMap.set(code, startCid + (code - startCode));
        }
        i += 3;
      } else {
        i++;
      }
    }
    return i;
  }

  /**
   * Decode hex string to UTF-16 Unicode string supporting surrogate pairs and multi-char sequences
   */
  static decodeHexToUnicode(hex: string): string {
    const cleaned = hex.replace(/[^0-9a-fA-F]/g, '');
    if (cleaned.length === 0) return '';

    if (cleaned.length <= 2) {
      return String.fromCharCode(parseInt(cleaned, 16));
    }
    if (cleaned.length === 4) {
      return String.fromCharCode(parseInt(cleaned, 16));
    }
    if (cleaned.length === 8) {
      const high = parseInt(cleaned.slice(0, 4), 16);
      const low = parseInt(cleaned.slice(4, 8), 16);
      if (high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) {
        const cp = 0x10000 + ((high - 0xd800) << 10) + (low - 0xdc00);
        return String.fromCodePoint(cp);
      }
    }

    let res = '';
    for (let i = 0; i < cleaned.length; i += 4) {
      const chunk = cleaned.substring(i, Math.min(i + 4, cleaned.length));
      if (chunk.length === 4) {
        res += String.fromCharCode(parseInt(chunk, 16));
      } else if (chunk.length === 2) {
        res += String.fromCharCode(parseInt(chunk, 16));
      }
    }
    return res;
  }

  /**
   * Read the next character code from bytes at offset respecting CMap codespace ranges
   */
  static readCode(
    bytes: Uint8Array,
    offset: number,
    codeSpaces: CodeSpaceRange[],
    defaultByteLength = 1
  ): { code: number; byteLength: number; rawBytes: Uint8Array } {
    if (offset >= bytes.length) {
      return { code: 0, byteLength: 0, rawBytes: new Uint8Array(0) };
    }

    if (codeSpaces && codeSpaces.length > 0) {
      for (const cs of codeSpaces) {
        const len = cs.byteLength;
        if (offset + len <= bytes.length) {
          let val = 0;
          for (let b = 0; b < len; b++) {
            val = (val << 8) | bytes[offset + b];
          }
          if (val >= cs.min && val <= cs.max) {
            return {
              code: val,
              byteLength: len,
              rawBytes: bytes.subarray(offset, offset + len),
            };
          }
        }
      }
    }

    const len = Math.min(defaultByteLength, bytes.length - offset);
    let val = 0;
    for (let b = 0; b < len; b++) {
      val = (val << 8) | bytes[offset + b];
    }
    return {
      code: val,
      byteLength: len,
      rawBytes: bytes.subarray(offset, offset + len),
    };
  }

  private static hexToBytes(hex: string): Uint8Array {
    const cleaned = hex.replace(/[^0-9a-fA-F]/g, '');
    const len = Math.ceil(cleaned.length / 2);
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = parseInt(cleaned.substr(i * 2, 2).padEnd(2, '0'), 16);
    }
    return bytes;
  }

  private static tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const len = text.length;

    while (i < len) {
      const ch = text[i];

      // Skip whitespace
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        i++;
        continue;
      }

      // Skip comments
      if (ch === '%') {
        while (i < len && text[i] !== '\r' && text[i] !== '\n') {
          i++;
        }
        continue;
      }

      // Hex string <...>
      if (ch === '<') {
        i++;
        let hex = '';
        while (i < len && text[i] !== '>') {
          if (!/\s/.test(text[i])) {
            hex += text[i];
          }
          i++;
        }
        if (i < len && text[i] === '>') i++;
        tokens.push({ type: 'hex', value: hex });
        continue;
      }

      // Array [ <hex> <hex> ... ]
      if (ch === '[') {
        i++;
        const values: string[] = [];
        while (i < len && text[i] !== ']') {
          if (text[i] === '<') {
            i++;
            let innerHex = '';
            while (i < len && text[i] !== '>') {
              if (!/\s/.test(text[i])) innerHex += text[i];
              i++;
            }
            if (i < len && text[i] === '>') i++;
            values.push(innerHex);
          } else {
            i++;
          }
        }
        if (i < len && text[i] === ']') i++;
        tokens.push({ type: 'array', values });
        continue;
      }

      // Literal string (...)
      if (ch === '(') {
        i++;
        let depth = 1;
        let str = '';
        while (i < len && depth > 0) {
          if (text[i] === '\\') {
            i++;
            if (i < len) str += text[i++];
          } else if (text[i] === '(') {
            depth++;
            str += text[i++];
          } else if (text[i] === ')') {
            depth--;
            if (depth > 0) str += text[i];
            i++;
          } else {
            str += text[i++];
          }
        }
        tokens.push({ type: 'name', value: str });
        continue;
      }

      // Name /Identifier
      if (ch === '/') {
        i++;
        let name = '';
        while (i < len && !/[\s<>[\]/()%]/.test(text[i])) {
          name += text[i++];
        }
        tokens.push({ type: 'name', value: name });
        continue;
      }

      // Numbers and keywords
      let word = '';
      while (i < len && !/[\s<>[\]/()%]/.test(text[i])) {
        word += text[i++];
      }

      if (/^-?\d+$/.test(word)) {
        tokens.push({ type: 'number', value: parseInt(word, 10) });
      } else if (word) {
        tokens.push({ type: 'keyword', value: word });
      } else {
        i++; // advance past any unrecognized single char
      }
    }

    return tokens;
  }
}

interface Token {
  type: 'keyword' | 'hex' | 'array' | 'name' | 'number';
  value?: string | number;
  values?: string[];
}
