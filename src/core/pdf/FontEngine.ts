// Comprehensive PDF Font & Encoding Engine
import { PdfDict, PdfName, PdfObject, PdfStream, PdfString } from '../types/pdf';
import { FontDescriptorModel } from '../types/model';
import { PdfParser } from './PdfParser';

// Standard 14 AFM Glyph widths (1000-unit scale)
const STANDARD_14_FONTS = new Set([
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
  'Times-Roman',
  'Times-Bold',
  'Times-Italic',
  'Times-BoldItalic',
  'Courier',
  'Courier-Bold',
  'Courier-Oblique',
  'Courier-BoldOblique',
  'Symbol',
  'ZapfDingbats',
]);

// WinAnsi standard glyph widths approximations for Helvetica / Arial
const HELVETICA_WIDTHS: { [key: number]: number } = {
  32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191,
  40: 333, 41: 333, 42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278,
  48: 556, 49: 556, 50: 556, 51: 556, 52: 556, 53: 556, 54: 556, 55: 556,
  56: 556, 57: 556, 58: 278, 59: 278, 60: 584, 61: 584, 62: 584, 63: 556,
  64: 1015, 65: 667, 66: 667, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778,
  72: 722, 73: 278, 74: 500, 75: 667, 76: 556, 77: 833, 78: 722, 79: 778,
  80: 667, 81: 778, 82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944,
  88: 667, 89: 667, 90: 611, 91: 278, 92: 278, 93: 278, 94: 469, 95: 556,
  96: 333, 97: 556, 98: 556, 99: 500, 100: 556, 101: 556, 102: 278, 103: 556,
  104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833, 110: 556, 111: 556,
  112: 556, 113: 556, 114: 333, 115: 500, 116: 278, 117: 556, 118: 500, 119: 722,
  120: 500, 121: 500, 122: 500, 123: 334, 124: 260, 125: 334, 126: 584,
};

export class FontEngine {
  private parsedFonts = new Map<string, FontDescriptorModel>();

  /**
   * Parse and resolve a font dictionary from page resources
   */
  resolveFont(fontNameKey: string, fontObj: PdfObject | undefined, parser: PdfParser): FontDescriptorModel {
    if (this.parsedFonts.has(fontNameKey)) {
      return this.parsedFonts.get(fontNameKey)!;
    }

    const resolved = parser.resolve(fontObj);
    if (!(resolved instanceof PdfDict)) {
      return this.createFallbackFont(fontNameKey);
    }

    const baseFontObj = resolved.get('BaseFont');
    let baseFontName = 'Helvetica';
    if (baseFontObj instanceof PdfName) {
      baseFontName = baseFontObj.value.replace(/^[A-Z]{6}\+/, ''); // strip subset prefix ABCDEF+
    }

    const subtypeObj = resolved.get('Subtype');
    const subtype = subtypeObj instanceof PdfName ? subtypeObj.value : 'Type1';

    const isStd14 = STANDARD_14_FONTS.has(baseFontName);
    const descriptor: FontDescriptorModel = {
      name: baseFontName,
      type: subtype,
      isStandard14: isStd14,
      widths: new Map(),
      defaultWidth: 500,
      ascent: 750,
      descent: -200,
      capHeight: 700,
    };

    // Parse /FirstChar, /LastChar, /Widths
    const firstChar = Number(resolved.get('FirstChar') || 0);
    const widthsObj = parser.resolve(resolved.get('Widths'));
    if (Array.isArray(widthsObj)) {
      for (let i = 0; i < widthsObj.length; i++) {
        const w = Number(widthsObj[i] || 0);
        descriptor.widths!.set(firstChar + i, w);
      }
    } else if (isStd14) {
      for (const [code, w] of Object.entries(HELVETICA_WIDTHS)) {
        descriptor.widths!.set(Number(code), w);
      }
    }

    // Parse /ToUnicode CMap
    const toUnicodeObj = parser.resolve(resolved.get('ToUnicode'));
    if (toUnicodeObj instanceof PdfStream) {
      const cmapData = toUnicodeObj.decodedData || toUnicodeObj.data;
      descriptor.toUnicodeCMap = this.parseToUnicodeCMap(cmapData);
    }

    // Parse /Encoding
    const encObj = parser.resolve(resolved.get('Encoding'));
    if (encObj instanceof PdfName) {
      descriptor.encoding = encObj.value;
    } else if (encObj instanceof PdfDict) {
      // Custom differences
      const baseEnc = encObj.get('BaseEncoding');
      if (baseEnc instanceof PdfName) {
        descriptor.encoding = baseEnc.value;
      }
      // Note: custom differences can be mapped to unicode if needed
    }

    // Parse /FontDescriptor
    const fdObj = parser.resolve(resolved.get('FontDescriptor'));
    if (fdObj instanceof PdfDict) {
      const ascent = Number(fdObj.get('Ascent') || 750);
      const descent = Number(fdObj.get('Descent') || -200);
      const capHeight = Number(fdObj.get('CapHeight') || 700);
      descriptor.ascent = ascent;
      descriptor.descent = descent;
      descriptor.capHeight = capHeight;
    }

    this.parsedFonts.set(fontNameKey, descriptor);
    return descriptor;
  }

  /**
   * Parse a /ToUnicode CMap stream
   */
  private parseToUnicodeCMap(data: Uint8Array): Map<number, string> {
    const map = new Map<number, string>();
    const text = new TextDecoder('latin1').decode(data);

    // 1. Match beginbfchar ... endbfchar
    const bfcharBlocks = text.match(/beginbfchar([\s\S]*?)endbfchar/g);
    if (bfcharBlocks) {
      for (const block of bfcharBlocks) {
        const regex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(block)) !== null) {
          const charCode = parseInt(m[1], 16);
          const uniHex = m[2];
          let unicodeStr = '';
          for (let i = 0; i < uniHex.length; i += 4) {
            const codePoint = parseInt(uniHex.substring(i, i + 4), 16);
            unicodeStr += String.fromCharCode(codePoint);
          }
          map.set(charCode, unicodeStr);
        }
      }
    }

    // 2. Match beginbfrange ... endbfrange
    const bfrangeBlocks = text.match(/beginbfrange([\s\S]*?)endbfrange/g);
    if (bfrangeBlocks) {
      for (const block of bfrangeBlocks) {
        // Range with starting unicode: <start> <end> <startUni>
        const regex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(block)) !== null) {
          const startCode = parseInt(m[1], 16);
          const endCode = parseInt(m[2], 16);
          let startUni = parseInt(m[3], 16);

          for (let code = startCode; code <= endCode; code++) {
            map.set(code, String.fromCharCode(startUni));
            startUni++;
          }
        }

        // Range with array: <start> <end> [ <uni1> <uni2> ... ]
        const arrRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([\s\S]*?)\]/g;
        let arrM: RegExpExecArray | null;
        while ((arrM = arrRegex.exec(block)) !== null) {
          const startCode = parseInt(arrM[1], 16);
          const hexList = arrM[3].match(/<([0-9a-fA-F]+)>/g);
          if (hexList) {
            for (let i = 0; i < hexList.length; i++) {
              const hexVal = hexList[i].replace(/[<>]/g, '');
              let unicodeStr = '';
              for (let k = 0; k < hexVal.length; k += 4) {
                unicodeStr += String.fromCharCode(parseInt(hexVal.substring(k, k + 4), 16));
              }
              map.set(startCode + i, unicodeStr);
            }
          }
        }
      }
    }

    return map;
  }

  /**
   * Decode raw bytes/hex string to UTF-8 text using font encoding or ToUnicode CMap
   */
  decodeString(rawBytes: Uint8Array, font?: FontDescriptorModel): { text: string; widths: number[] } {
    let text = '';
    const widths: number[] = [];
    const cmap = font?.toUnicodeCMap;

    if (font?.type === 'Type0' || (cmap && cmap.size > 0 && this.isTwoByteFont(rawBytes, cmap))) {
      // 2-byte CID decoding
      for (let i = 0; i < rawBytes.length; i += 2) {
        const charCode = (rawBytes[i] << 8) | (rawBytes[i + 1] || 0);
        let char = '';
        if (cmap && cmap.has(charCode)) {
          char = cmap.get(charCode)!;
        } else {
          char = String.fromCharCode(charCode);
        }
        text += char;

        const w = (font?.widths && font.widths.get(charCode)) || font?.defaultWidth || 500;
        widths.push(w);
      }
    } else {
      // 1-byte decoding
      for (let i = 0; i < rawBytes.length; i++) {
        const byte = rawBytes[i];
        let char = '';
        if (cmap && cmap.has(byte)) {
          char = cmap.get(byte)!;
        } else {
          char = String.fromCharCode(byte);
        }
        text += char;

        const w = (font?.widths && font.widths.get(byte)) || font?.defaultWidth || 500;
        widths.push(w);
      }
    }

    return { text, widths };
  }

  /**
   * Encode UTF-8 text string back to PDF bytes conforming to font
   */
  encodeString(text: string, font?: FontDescriptorModel): PdfString {
    const cmap = font?.toUnicodeCMap;
    
    // Check if font has reverse CMap mapping
    if (cmap && cmap.size > 0) {
      const reverseCMap = new Map<string, number>();
      for (const [code, uni] of cmap.entries()) {
        reverseCMap.set(uni, code);
      }

      // If all characters match reverse CMap
      const is2Byte = font?.type === 'Type0';
      const bytes: number[] = [];
      let canMapAll = true;

      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (reverseCMap.has(ch)) {
          const code = reverseCMap.get(ch)!;
          if (is2Byte || code > 255) {
            bytes.push((code >> 8) & 0xff, code & 0xff);
          } else {
            bytes.push(code & 0xff);
          }
        } else {
          canMapAll = false;
          break;
        }
      }

      if (canMapAll) {
        return new PdfString(new Uint8Array(bytes), is2Byte);
      }
    }

    // Standard WinAnsi / Latin1 string fallback
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      bytes[i] = text.charCodeAt(i) & 0xff;
    }
    return new PdfString(bytes, false);
  }

  private isTwoByteFont(bytes: Uint8Array, cmap: Map<number, string>): boolean {
    if (bytes.length < 2) return false;
    let matchCount = 0;
    for (let i = 0; i < bytes.length; i += 2) {
      const code = (bytes[i] << 8) | (bytes[i + 1] || 0);
      if (cmap.has(code)) matchCount++;
    }
    return matchCount > 0;
  }

  private createFallbackFont(name: string): FontDescriptorModel {
    const descriptor: FontDescriptorModel = {
      name: name || 'Helvetica',
      type: 'Type1',
      isStandard14: true,
      widths: new Map(),
      defaultWidth: 500,
      ascent: 750,
      descent: -200,
      capHeight: 700,
    };
    for (const [code, w] of Object.entries(HELVETICA_WIDTHS)) {
      descriptor.widths!.set(Number(code), w);
    }
    return descriptor;
  }
}
