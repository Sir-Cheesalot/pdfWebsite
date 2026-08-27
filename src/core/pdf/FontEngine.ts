// Comprehensive PDF Font & Encoding Engine (with Math, Symbol, and UTF-16 CMap Resolution)
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

// WinAnsi character mappings for high byte codes (0x80 - 0xFF)
const WIN_ANSI_MAP: { [code: number]: string } = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ', 0xa0: ' ',
  0xa1: '¡', 0xa2: '¢', 0xa3: '£', 0xa4: '¤', 0xa5: '¥', 0xa6: '¦', 0xa7: '§',
  0xa8: '¨', 0xa9: '©', 0xaa: 'ª', 0xab: '«', 0xac: '¬', 0xad: '­', 0xae: '®',
  0xaf: '¯', 0xb0: '°', 0xb1: '±', 0xb2: '²', 0xb3: '³', 0xb4: '´', 0xb5: 'µ',
  0xb6: '¶', 0xb7: '·', 0xb8: '¸', 0xb9: '¹', 0xba: 'º', 0xbb: '»', 0xbc: '¼',
  0xbd: '½', 0xbe: '¾', 0xbf: '¿', 0xc0: 'À', 0xc1: 'Á', 0xc2: 'Â', 0xc3: 'Ã',
  0xc4: 'Ä', 0xc5: 'Å', 0xc6: 'Æ', 0xc7: 'Ç', 0xc8: 'È', 0xc9: 'É', 0xca: 'Ê',
  0xcb: 'Ë', 0xcc: 'Ì', 0xcd: 'Í', 0xce: 'Î', 0xcf: 'Ï', 0xd0: 'Ð', 0xd1: 'Ñ',
  0xd2: 'Ò', 0xd3: 'Ó', 0xd4: 'Ô', 0xd5: 'Õ', 0xd6: 'Ö', 0xd7: '×', 0xd8: 'Ø',
  0xd9: 'Ù', 0xda: 'Ú', 0xdb: 'Û', 0xdc: 'Ü', 0xdd: 'Ý', 0xde: 'Þ', 0xdf: 'ß',
  0xe0: 'à', 0xe1: 'á', 0xe2: 'â', 0xe3: 'ã', 0xe4: 'ä', 0xe5: 'å', 0xe6: 'æ',
  0xe7: 'ç', 0xe8: 'è', 0xe9: 'é', 0xea: 'ê', 0xeb: 'ë', 0xec: 'ì', 0xed: 'í',
  0xee: 'î', 0xef: 'ï', 0xf0: 'ð', 0xf1: 'ñ', 0xf2: 'ò', 0xf3: 'ó', 0xf4: 'ô',
  0xf5: 'õ', 0xf6: 'ö', 0xf7: '÷', 0xf8: 'ø', 0xf9: 'ù', 0xfa: 'ú', 0xfb: 'û',
  0xfc: 'ü', 0xfd: 'ý', 0xfe: 'þ', 0xff: 'ÿ',
};

// Symbol font character encoding map
const SYMBOL_FONT_MAP: { [code: number]: string } = {
  0x2b: '+', 0x2d: '−', 0x3d: '=', 0x41: 'Α', 0x42: 'Β', 0x43: 'Χ', 0x44: 'Δ',
  0x45: 'Ε', 0x46: 'Φ', 0x47: 'Γ', 0x48: 'Η', 0x49: 'Ι', 0x4b: 'Κ', 0x4c: 'Λ',
  0x4d: 'Μ', 0x4e: 'Ν', 0x4f: 'Ο', 0x50: 'Π', 0x51: 'Θ', 0x52: 'Ρ', 0x53: 'Σ',
  0x54: 'Τ', 0x55: 'Υ', 0x56: 'ς', 0x57: 'Ω', 0x58: 'Ξ', 0x59: 'Ψ', 0x5a: 'Ζ',
  0x61: 'α', 0x62: 'β', 0x63: 'χ', 0x64: 'δ', 0x65: 'ε', 0x66: 'φ', 0x67: 'γ',
  0x68: 'η', 0x69: 'ι', 0x6b: 'κ', 0x6c: 'λ', 0x6d: 'μ', 0x6e: 'ν', 0x6f: 'ο',
  0x70: 'π', 0x71: 'θ', 0x72: 'ρ', 0x73: 'σ', 0x74: 'τ', 0x75: 'υ', 0x76: 'ϖ',
  0x77: 'ω', 0x78: 'ξ', 0x79: 'ψ', 0x7a: 'ζ', 0xa3: '≤', 0xb1: '±', 0xb3: '≥',
  0xb4: '×', 0xb5: '∝', 0xb8: '÷', 0xb9: '≠', 0xba: '≡', 0xbb: '≈', 0xbc: '…',
  0xd5: '∏', 0xd6: '√', 0xd8: '¬', 0xd9: '∧', 0xda: '∨', 0xdb: '⇔', 0xdc: '⇒',
  0xe5: '∑', 0xf2: '∫',
};

// Standard Helvetica glyph widths approximations
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
      const baseEnc = encObj.get('BaseEncoding');
      if (baseEnc instanceof PdfName) {
        descriptor.encoding = baseEnc.value;
      }
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
   * Parse a /ToUnicode CMap stream supporting 2-digit, 4-digit, and multi-char UTF-16
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
          const unicodeStr = this.decodeHexToUnicode(m[2]);
          map.set(charCode, unicodeStr);
        }
      }
    }

    // 2. Match beginbfrange ... endbfrange
    const bfrangeBlocks = text.match(/beginbfrange([\s\S]*?)endbfrange/g);
    if (bfrangeBlocks) {
      for (const block of bfrangeBlocks) {
        // Continuous range: <start> <end> <startUni>
        const regex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(block)) !== null) {
          const startCode = parseInt(m[1], 16);
          const endCode = parseInt(m[2], 16);
          const startUniHex = m[3];

          if (startUniHex.length <= 4) {
            let startUni = parseInt(startUniHex, 16);
            for (let code = startCode; code <= endCode; code++) {
              map.set(code, String.fromCharCode(startUni));
              startUni++;
            }
          }
        }

        // Range with array of target hex values: <start> <end> [ <uni1> <uni2> ... ]
        const arrRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([\s\S]*?)\]/g;
        let arrM: RegExpExecArray | null;
        while ((arrM = arrRegex.exec(block)) !== null) {
          const startCode = parseInt(arrM[1], 16);
          const hexList = arrM[3].match(/<([0-9a-fA-F]+)>/g);
          if (hexList) {
            for (let i = 0; i < hexList.length; i++) {
              const hexVal = hexList[i].replace(/[<>]/g, '');
              map.set(startCode + i, this.decodeHexToUnicode(hexVal));
            }
          }
        }
      }
    }

    return map;
  }

  private decodeHexToUnicode(hex: string): string {
    if (hex.length <= 2) {
      return String.fromCharCode(parseInt(hex, 16));
    }
    let res = '';
    for (let i = 0; i < hex.length; i += 4) {
      const chunk = hex.substring(i, i + 4);
      res += String.fromCharCode(parseInt(chunk, 16));
    }
    return res;
  }

  /**
   * Decode raw bytes/hex string to UTF-8 text using font encoding or ToUnicode CMap
   */
  decodeString(rawBytes: Uint8Array, font?: FontDescriptorModel): { text: string; widths: number[] } {
    let text = '';
    const widths: number[] = [];
    const cmap = font?.toUnicodeCMap;
    const isSymbolFont = font?.name.toLowerCase().includes('symbol') || font?.name.toLowerCase().includes('math');

    // Type0 composite fonts (2 bytes per CID)
    if (font?.type === 'Type0') {
      for (let i = 0; i < rawBytes.length; i += 2) {
        const charCode = (rawBytes[i] << 8) | (rawBytes[i + 1] || 0);
        let char = '';

        if (cmap && cmap.has(charCode)) {
          char = cmap.get(charCode)!;
        } else if (rawBytes[i] === 0 && rawBytes[i + 1] >= 32 && rawBytes[i + 1] <= 126) {
          // Standard ASCII
          char = String.fromCharCode(rawBytes[i + 1]);
        } else if (rawBytes[i] === 0 && WIN_ANSI_MAP[rawBytes[i + 1]]) {
          // Standard WinAnsi
          char = WIN_ANSI_MAP[rawBytes[i + 1]];
        } else if (charCode >= 32 && charCode <= 126) {
          char = String.fromCharCode(charCode);
        } else if (WIN_ANSI_MAP[charCode & 0xff]) {
          char = WIN_ANSI_MAP[charCode & 0xff];
        } else {
          // Skip or output empty rather than converting arbitrary CID integer into Devanagari/Odia
          char = ' ';
        }

        text += char;
        const w = (font?.widths && font.widths.get(charCode)) || font?.defaultWidth || 500;
        widths.push(w);
      }
    } else {
      // 1-byte decoding (Type1, TrueType, Type3, Standard 14)
      for (let i = 0; i < rawBytes.length; i++) {
        const byte = rawBytes[i];
        let char = '';

        if (cmap && cmap.has(byte)) {
          char = cmap.get(byte)!;
        } else if (isSymbolFont && SYMBOL_FONT_MAP[byte]) {
          char = SYMBOL_FONT_MAP[byte];
        } else if (byte >= 32 && byte <= 126) {
          // Printable ASCII
          char = String.fromCharCode(byte);
        } else if (WIN_ANSI_MAP[byte]) {
          // WinAnsi (±, °, ×, µ, etc.)
          char = WIN_ANSI_MAP[byte];
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

    if (cmap && cmap.size > 0) {
      const reverseCMap = new Map<string, number>();
      for (const [code, uni] of cmap.entries()) {
        reverseCMap.set(uni, code);
      }

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
