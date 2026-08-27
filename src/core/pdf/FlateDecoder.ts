// Stream decompression and compression for PDF filters
import * as pako from 'pako';
import { PdfDict, PdfStream } from '../types/pdf';

export class FlateDecoder {
  /**
   * Decompress a PDF stream according to its /Filter and /DecodeParms
   */
  static decodeStream(stream: PdfStream): Uint8Array {
    let data = stream.data;
    const filter = stream.dict.get('Filter');
    if (!filter) {
      return data;
    }

    const filterList = Array.isArray(filter) ? filter : [filter];
    for (const f of filterList) {
      const fName = typeof f === 'object' && f && 'value' in f ? f.value : String(f).replace(/^\//, '');
      if (fName === 'FlateDecode' || fName === 'Fl') {
        try {
          data = pako.inflate(data);
          
          // Check for Predictor in DecodeParms
          const decodeParms = stream.dict.get('DecodeParms');
          if (decodeParms instanceof PdfDict) {
            const predictor = Number(decodeParms.get('Predictor') || 1);
            if (predictor >= 10) {
              const columns = Number(decodeParms.get('Columns') || 1);
              const colors = Number(decodeParms.get('Colors') || 1);
              const bitsPerComponent = Number(decodeParms.get('BitsPerComponent') || 8);
              data = this.unpredictPNG(data, columns, colors, bitsPerComponent);
            }
          }
        } catch (err) {
          console.warn('FlateDecode error:', err);
        }
      } else if (fName === 'ASCIIHexDecode' || fName === 'AHx') {
        data = this.decodeASCIIHex(data);
      } else if (fName === 'ASCII85Decode' || fName === 'A85') {
        data = this.decodeASCII85(data);
      }
    }

    return data;
  }

  /**
   * Compress data with Flate (zlib deflate)
   */
  static encodeFlate(data: Uint8Array): Uint8Array {
    return pako.deflate(data);
  }

  /**
   * Decode ASCII Hex
   */
  private static decodeASCIIHex(data: Uint8Array): Uint8Array {
    let hex = '';
    for (let i = 0; i < data.length; i++) {
      const c = String.fromCharCode(data[i]);
      if (c === '>') break;
      if (/[0-9a-fA-F]/.test(c)) {
        hex += c;
      }
    }
    if (hex.length % 2 !== 0) hex += '0';
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      out[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return out;
  }

  /**
   * Decode ASCII85
   */
  private static decodeASCII85(data: Uint8Array): Uint8Array {
    const out: number[] = [];
    let count = 0;
    let tuple = 0;

    for (let i = 0; i < data.length; i++) {
      const byte = data[i];
      const char = String.fromCharCode(byte);
      if (char === '~') break; // '~>' end
      if (/\s/.test(char)) continue;

      if (char === 'z' && count === 0) {
        out.push(0, 0, 0, 0);
        continue;
      }

      if (byte < 33 || byte > 117) continue;

      tuple = tuple * 85 + (byte - 33);
      count++;

      if (count === 5) {
        out.push(
          (tuple >>> 24) & 0xff,
          (tuple >>> 16) & 0xff,
          (tuple >>> 8) & 0xff,
          tuple & 0xff
        );
        tuple = 0;
        count = 0;
      }
    }

    if (count > 1) {
      for (let i = count; i < 5; i++) {
        tuple = tuple * 85 + 84;
      }
      for (let i = 0; i < count - 1; i++) {
        out.push((tuple >>> (24 - i * 8)) & 0xff);
      }
    }

    return new Uint8Array(out);
  }

  /**
   * Reverse PNG predictor (RFC 2083)
   */
  private static unpredictPNG(
    data: Uint8Array,
    columns: number,
    colors: number,
    bitsPerComponent: number
  ): Uint8Array {
    const bytesPerPixel = Math.max(1, Math.ceil((colors * bitsPerComponent) / 8));
    const rowBytes = Math.ceil((columns * colors * bitsPerComponent) / 8);
    const stride = rowBytes + 1;
    const numRows = Math.floor(data.length / stride);

    const output = new Uint8Array(numRows * rowBytes);
    let prevRow = new Uint8Array(rowBytes);

    for (let r = 0; r < numRows; r++) {
      const rowStart = r * stride;
      const filterType = data[rowStart];
      const currentRow = new Uint8Array(rowBytes);

      for (let i = 0; i < rowBytes; i++) {
        const raw = data[rowStart + 1 + i];
        const left = i >= bytesPerPixel ? currentRow[i - bytesPerPixel] : 0;
        const up = prevRow[i];
        const upLeft = i >= bytesPerPixel ? prevRow[i - bytesPerPixel] : 0;

        let val = raw;
        if (filterType === 0) {
          // None
          val = raw;
        } else if (filterType === 1) {
          // Sub
          val = (raw + left) & 0xff;
        } else if (filterType === 2) {
          // Up
          val = (raw + up) & 0xff;
        } else if (filterType === 3) {
          // Average
          val = (raw + Math.floor((left + up) / 2)) & 0xff;
        } else if (filterType === 4) {
          // Paeth
          val = (raw + this.paethPredictor(left, up, upLeft)) & 0xff;
        }

        currentRow[i] = val;
        output[r * rowBytes + i] = val;
      }

      prevRow = currentRow;
    }

    return output;
  }

  private static paethPredictor(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }
}
