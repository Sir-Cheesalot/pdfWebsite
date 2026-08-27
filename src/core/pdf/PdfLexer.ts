// Low-level PDF Tokenizer / Lexer
import { PdfName, PdfRef, PdfString, PdfToken } from '../types/pdf';

export class PdfLexer {
  private pos = 0;
  private len: number;

  constructor(private buffer: Uint8Array) {
    this.len = buffer.length;
  }

  get position(): number {
    return this.pos;
  }

  seek(pos: number) {
    this.pos = Math.max(0, Math.min(this.len, pos));
  }

  private isWhitespace(b: number): boolean {
    return b === 0x00 || b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20;
  }

  private isDelimiter(b: number): boolean {
    return (
      b === 0x28 || // (
      b === 0x29 || // )
      b === 0x3c || // <
      b === 0x3e || // >
      b === 0x5b || // [
      b === 0x5d || // ]
      b === 0x7b || // {
      b === 0x7d || // }
      b === 0x2f || // /
      b === 0x25    // %
    );
  }

  skipWhitespaceAndComments(): void {
    while (this.pos < this.len) {
      const b = this.buffer[this.pos];
      if (this.isWhitespace(b)) {
        this.pos++;
      } else if (b === 0x25) {
        // Comment %
        while (this.pos < this.len && this.buffer[this.pos] !== 0x0a && this.buffer[this.pos] !== 0x0d) {
          this.pos++;
        }
      } else {
        break;
      }
    }
  }

  peekChar(): number {
    return this.pos < this.len ? this.buffer[this.pos] : -1;
  }

  nextChar(): number {
    return this.pos < this.len ? this.buffer[this.pos++] : -1;
  }

  readName(): string {
    // Starts with /
    this.pos++; // skip /
    let name = '';
    while (this.pos < this.len) {
      const b = this.buffer[this.pos];
      if (this.isWhitespace(b) || this.isDelimiter(b)) {
        break;
      }
      if (b === 0x23 && this.pos + 2 < this.len) {
        // #xx hex escape
        const hex = String.fromCharCode(this.buffer[this.pos + 1], this.buffer[this.pos + 2]);
        name += String.fromCharCode(parseInt(hex, 16));
        this.pos += 3;
      } else {
        name += String.fromCharCode(b);
        this.pos++;
      }
    }
    return name;
  }

  readLiteralString(): PdfString {
    this.pos++; // skip (
    const bytes: number[] = [];
    let depth = 1;

    while (this.pos < this.len && depth > 0) {
      const b = this.buffer[this.pos++];
      if (b === 0x5c) {
        // \ escape
        if (this.pos >= this.len) break;
        const next = this.buffer[this.pos++];
        if (next === 0x6e) bytes.push(0x0a); // \n
        else if (next === 0x72) bytes.push(0x0d); // \r
        else if (next === 0x74) bytes.push(0x09); // \t
        else if (next === 0x62) bytes.push(0x08); // \b
        else if (next === 0x66) bytes.push(0x0c); // \f
        else if (next === 0x5c) bytes.push(0x5c); // \\
        else if (next === 0x28) bytes.push(0x28); // \(
        else if (next === 0x29) bytes.push(0x29); // \)
        else if (next >= 0x30 && next <= 0x37) {
          // Octal \ddd
          let octal = String.fromCharCode(next);
          for (let k = 0; k < 2; k++) {
            if (this.pos < this.len && this.buffer[this.pos] >= 0x30 && this.buffer[this.pos] <= 0x37) {
              octal += String.fromCharCode(this.buffer[this.pos++]);
            } else {
              break;
            }
          }
          bytes.push(parseInt(octal, 8));
        } else if (next === 0x0d || next === 0x0a) {
          // Line break continuation
          if (next === 0x0d && this.pos < this.len && this.buffer[this.pos] === 0x0a) {
            this.pos++;
          }
        } else {
          bytes.push(next);
        }
      } else if (b === 0x28) {
        // (
        depth++;
        bytes.push(b);
      } else if (b === 0x29) {
        // )
        depth--;
        if (depth > 0) bytes.push(b);
      } else {
        bytes.push(b);
      }
    }

    const arr = new Uint8Array(bytes);
    return new PdfString(arr, false);
  }

  readHexString(): PdfString {
    this.pos++; // skip <
    let hex = '';
    while (this.pos < this.len) {
      const b = this.buffer[this.pos++];
      if (b === 0x3e) {
        // >
        break;
      }
      const ch = String.fromCharCode(b);
      if (/[0-9a-fA-F]/.test(ch)) {
        hex += ch;
      }
    }

    if (hex.length % 2 !== 0) {
      hex += '0';
    }

    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return new PdfString(bytes, true);
  }

  readNumberOrKeyword(): PdfToken {
    let str = '';
    while (this.pos < this.len) {
      const b = this.buffer[this.pos];
      if (this.isWhitespace(b) || this.isDelimiter(b)) {
        break;
      }
      str += String.fromCharCode(b);
      this.pos++;
    }

    if (str === 'true') return { type: 'boolean', value: true };
    if (str === 'false') return { type: 'boolean', value: false };
    if (str === 'null') return { type: 'null' };

    const num = Number(str);
    if (!isNaN(num) && str.trim() !== '') {
      return { type: 'number', value: num };
    }

    return { type: 'keyword', value: str };
  }

  nextToken(): PdfToken | null {
    this.skipWhitespaceAndComments();
    if (this.pos >= this.len) return null;

    const b = this.buffer[this.pos];

    if (b === 0x2f) {
      // '/' Name
      return { type: 'name', value: this.readName() };
    }

    if (b === 0x28) {
      // '(' Literal string
      const str = this.readLiteralString();
      return { type: 'string', value: str.bytes, raw: str.toText(), isHex: false };
    }

    if (b === 0x3c) {
      // '<' could be << or <hex>
      if (this.pos + 1 < this.len && this.buffer[this.pos + 1] === 0x3c) {
        this.pos += 2;
        return { type: 'dict_start' };
      }
      const str = this.readHexString();
      return { type: 'string', value: str.bytes, raw: str.toText(), isHex: true };
    }

    if (b === 0x3e) {
      // '>' could be >>
      if (this.pos + 1 < this.len && this.buffer[this.pos + 1] === 0x3e) {
        this.pos += 2;
        return { type: 'dict_end' };
      }
      this.pos++;
      return { type: 'keyword', value: '>' };
    }

    if (b === 0x5b) {
      // '[' Array start
      this.pos++;
      return { type: 'array_start' };
    }

    if (b === 0x5d) {
      // ']' Array end
      this.pos++;
      return { type: 'array_end' };
    }

    return this.readNumberOrKeyword();
  }

  /**
   * Search backwards from end of buffer for pattern (e.g. 'startxref')
   */
  findLastString(needle: string, startFrom?: number): number {
    const needleBytes = new TextEncoder().encode(needle);
    const nLen = needleBytes.length;
    let idx = startFrom !== undefined ? startFrom : this.len - nLen;

    while (idx >= 0) {
      let match = true;
      for (let j = 0; j < nLen; j++) {
        if (this.buffer[idx + j] !== needleBytes[j]) {
          match = false;
          break;
        }
      }
      if (match) return idx;
      idx--;
    }
    return -1;
  }

  /**
   * Read raw stream slice between stream and endstream
   */
  readStreamData(length?: number): Uint8Array {
    // Current position should be right after 'stream' keyword
    // Skip single \r\n or \n
    if (this.pos < this.len && this.buffer[this.pos] === 0x0d) this.pos++;
    if (this.pos < this.len && this.buffer[this.pos] === 0x0a) this.pos++;

    const startPos = this.pos;

    if (length !== undefined && length >= 0 && startPos + length <= this.len) {
      this.pos = startPos + length;
      // Skip whitespace to endstream
      this.skipWhitespaceAndComments();
      const endMarker = 'endstream';
      let matches = true;
      for (let i = 0; i < endMarker.length; i++) {
        if (this.buffer[this.pos + i] !== endMarker.charCodeAt(i)) {
          matches = false;
          break;
        }
      }
      if (matches) {
        this.pos += endMarker.length;
        return this.buffer.subarray(startPos, startPos + length);
      }
    }

    // Fallback: search for 'endstream'
    const endPos = this.findEndstream(startPos);
    this.pos = endPos + 9; // 'endstream'.length
    return this.buffer.subarray(startPos, endPos);
  }

  private findEndstream(start: number): number {
    const target = [0x65, 0x6e, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d]; // 'endstream'
    for (let i = start; i <= this.len - target.length; i++) {
      let matched = true;
      for (let j = 0; j < target.length; j++) {
        if (this.buffer[i + j] !== target[j]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        // Strip trailing \r / \n before endstream
        let end = i;
        while (end > start && (this.buffer[end - 1] === 0x0a || this.buffer[end - 1] === 0x0d)) {
          end--;
        }
        return end;
      }
    }
    return this.len;
  }
}
