// Comprehensive PDF Font & Encoding Engine (with Math, Symbol, and UTF-16 CMap Resolution)
import { PdfDict, PdfName, PdfObject, PdfStream, PdfString } from '../types/pdf';
import { DecodedGlyph, FontDescriptorModel } from '../types/model';
import { PdfParser } from './PdfParser';
import { CMapData, CMapParser } from './CMapParser';

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

  getFont(fontKey: string): FontDescriptorModel | undefined {
    return this.parsedFonts.get(fontKey);
  }

  getAllFonts(): Map<string, FontDescriptorModel> {
    return new Map(this.parsedFonts);
  }

  registerFont(fontKey: string, font: FontDescriptorModel): void {
    this.parsedFonts.set(fontKey, font);
  }

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
    let rawFontName = 'Helvetica';
    if (baseFontObj instanceof PdfName) {
      rawFontName = baseFontObj.value;
    }

    const isSubset = /^[A-Z]{6}\+/.test(rawFontName);
    const cleanFontName = rawFontName.replace(/^[A-Z]{6}\+/, '');

    const subtypeObj = resolved.get('Subtype');
    const subtype = subtypeObj instanceof PdfName ? subtypeObj.value : 'Type1';

    const isStd14 = STANDARD_14_FONTS.has(cleanFontName);
    const descriptor: FontDescriptorModel = {
      name: rawFontName,
      cleanName: cleanFontName,
      type: subtype,
      isStandard14: isStd14,
      isSubset,
      widths: new Map(),
      defaultWidth: subtype === 'Type0' ? 1000 : 500,
      ascent: 750,
      descent: -200,
      capHeight: 700,
    };

    // 1. Parse /FirstChar, /LastChar, /Widths for simple fonts
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

    // 2. Parse /ToUnicode CMap
    const toUnicodeObj = parser.resolve(resolved.get('ToUnicode'));
    if (toUnicodeObj instanceof PdfStream) {
      const cmapData = toUnicodeObj.decodedData || toUnicodeObj.data;
      const parsedCMap = CMapParser.parse(cmapData);
      descriptor.cMapData = parsedCMap;
      descriptor.toUnicodeCMap = parsedCMap.toUnicode;
      if (parsedCMap.cidMap) {
        descriptor.cidMap = parsedCMap.cidMap;
      }
    }

    // 3. Parse /Encoding
    const encObj = parser.resolve(resolved.get('Encoding'));
    if (encObj instanceof PdfName) {
      descriptor.encoding = encObj.value;
    } else if (encObj instanceof PdfDict) {
      const baseEnc = encObj.get('BaseEncoding');
      if (baseEnc instanceof PdfName) {
        descriptor.encoding = baseEnc.value;
      }
    } else if (encObj instanceof PdfStream) {
      // Stream CMap
      const encCmapData = encObj.decodedData || encObj.data;
      const parsedEncCMap = CMapParser.parse(encCmapData);
      if (!descriptor.cMapData) {
        descriptor.cMapData = parsedEncCMap;
        descriptor.toUnicodeCMap = parsedEncCMap.toUnicode;
      } else if (parsedEncCMap.codeSpaces.length > 0 && descriptor.cMapData.codeSpaces.length === 0) {
        descriptor.cMapData.codeSpaces = parsedEncCMap.codeSpaces;
      }
    }

    // 4. Parse /FontDescriptor for simple fonts
    const fdObj = parser.resolve(resolved.get('FontDescriptor'));
    if (fdObj instanceof PdfDict) {
      descriptor.ascent = Number(fdObj.get('Ascent') || descriptor.ascent);
      descriptor.descent = Number(fdObj.get('Descent') || descriptor.descent);
      descriptor.capHeight = Number(fdObj.get('CapHeight') || descriptor.capHeight);
    }

    // 5. Handle Type0 Composite Fonts and Descendant CIDFonts
    if (subtype === 'Type0') {
      const descFontsObj = parser.resolve(resolved.get('DescendantFonts'));
      if (Array.isArray(descFontsObj) && descFontsObj.length > 0) {
        const cidFontDict = parser.resolve(descFontsObj[0]);
        if (cidFontDict instanceof PdfDict) {
          // Default Width (DW)
          const dw = Number(cidFontDict.get('DW') ?? 1000);
          descriptor.defaultWidth = dw;

          // Parse /W (CIDFont glyph widths array)
          const wObj = parser.resolve(cidFontDict.get('W'));
          if (Array.isArray(wObj)) {
            let i = 0;
            while (i < wObj.length) {
              const first = Number(wObj[i++]);
              if (i >= wObj.length) break;
              const nextItem = parser.resolve(wObj[i++]);
              if (Array.isArray(nextItem)) {
                for (let j = 0; j < nextItem.length; j++) {
                  descriptor.widths!.set(first + j, Number(nextItem[j] || 0));
                }
              } else if (typeof nextItem === 'number') {
                const last = Number(nextItem);
                if (i < wObj.length) {
                  const widthVal = Number(wObj[i++]);
                  for (let c = first; c <= last; c++) {
                    descriptor.widths!.set(c, widthVal);
                  }
                }
              }
            }
          }

          // Descendant FontDescriptor
          const cidFdObj = parser.resolve(cidFontDict.get('FontDescriptor'));
          if (cidFdObj instanceof PdfDict) {
            descriptor.ascent = Number(cidFdObj.get('Ascent') || descriptor.ascent);
            descriptor.descent = Number(cidFdObj.get('Descent') || descriptor.descent);
            descriptor.capHeight = Number(cidFdObj.get('CapHeight') || descriptor.capHeight);
          }

          // Fallback /ToUnicode on descendant CIDFont if top-level font lacked it
          if (!descriptor.cMapData) {
            const descToUnicode = parser.resolve(cidFontDict.get('ToUnicode'));
            if (descToUnicode instanceof PdfStream) {
              const cmapData = descToUnicode.decodedData || descToUnicode.data;
              const parsedCMap = CMapParser.parse(cmapData);
              descriptor.cMapData = parsedCMap;
              descriptor.toUnicodeCMap = parsedCMap.toUnicode;
              if (parsedCMap.cidMap) descriptor.cidMap = parsedCMap.cidMap;
            }
          }
        }
      }
    }

    this.parsedFonts.set(fontNameKey, descriptor);
    return descriptor;
  }

  /**
   * Decode raw bytes/hex string to UTF-8 text using font encoding or ToUnicode CMap
   * Tracks exact DecodedGlyph objects for full WYSIWYG fidelity
   */
  decodeString(
    rawBytes: Uint8Array,
    font?: FontDescriptorModel
  ): { text: string; widths: number[]; glyphs: DecodedGlyph[] } {
    let text = '';
    const widths: number[] = [];
    const glyphs: DecodedGlyph[] = [];

    const cmap = font?.toUnicodeCMap;
    const codeSpaces = font?.cMapData?.codeSpaces || [];
    const isSymbolFont =
      font?.name.toLowerCase().includes('symbol') || font?.name.toLowerCase().includes('math');
    const isType0 = font?.type === 'Type0';
    const defaultByteLength = isType0 ? 2 : 1;

    let offset = 0;
    while (offset < rawBytes.length) {
      const { code, byteLength, rawBytes: glyphBytes } = CMapParser.readCode(
        rawBytes,
        offset,
        codeSpaces,
        defaultByteLength
      );
      offset += byteLength;

      let unicode = '';
      let resolved = false;
      const cid = font?.cidMap?.get(code);

      // 1. Direct CMap lookup
      if (cmap && cmap.has(code)) {
        unicode = cmap.get(code)!;
        resolved = true;
      }
      // 2. Symbol Font special character mapping
      else if (isSymbolFont && SYMBOL_FONT_MAP[code]) {
        unicode = SYMBOL_FONT_MAP[code];
        resolved = true;
      }
      // 3. 1-byte WinAnsi
      else if (byteLength === 1 && WIN_ANSI_MAP[code]) {
        unicode = WIN_ANSI_MAP[code];
        resolved = true;
      }
      // 4. 1-byte Standard Printable ASCII
      else if (byteLength === 1 && code >= 32 && code <= 126) {
        unicode = String.fromCharCode(code);
        resolved = true;
      }
      // 5. 2-byte Identity-H high-byte zero ASCII/WinAnsi
      else if (byteLength === 2 && (code >> 8) === 0 && (code & 0xff) >= 32 && (code & 0xff) <= 126) {
        unicode = String.fromCharCode(code & 0xff);
        resolved = true;
      } else if (byteLength === 2 && (code >> 8) === 0 && WIN_ANSI_MAP[code & 0xff]) {
        unicode = WIN_ANSI_MAP[code & 0xff];
        resolved = true;
      }
      // 6. Common whitespace / control characters
      else if (code === 9 || code === 10 || code === 13 || code === 32) {
        unicode = String.fromCharCode(code);
        resolved = true;
      }
      // 7. Unmapped / Unknown character: NEVER silently convert to space ' '!
      else {
        resolved = false;
        if (code > 0 && code <= 255 && !this.isControlChar(code)) {
          unicode = String.fromCharCode(code);
        } else if (code > 255 && (code & 0xff) >= 32 && (code & 0xff) <= 126) {
          unicode = String.fromCharCode(code & 0xff);
        } else {
          unicode = '\uFFFD'; // Unicode replacement character for unmapped glyph
        }
      }

      const w =
        (font?.widths && font.widths.get(code)) ||
        font?.defaultWidth ||
        (isType0 ? 1000 : 500);

      glyphs.push({
        charCode: code,
        rawBytes: glyphBytes,
        cid,
        unicode,
        byteLength,
        resolved,
      });

      text += unicode;
      widths.push(w);
    }

    return { text, widths, glyphs };
  }

  /**
   * Encode UTF-8 text string back to PDF bytes conforming to font
   */
  encodeString(text: string, font?: FontDescriptorModel): PdfString {
    return this.encodeStringWithStatus(text, font).pdfString;
  }

  /**
   * Encode UTF-8 text string back to PDF bytes with capability status
   * Uses longest-match sequence matching over reverse CMap
   */
  encodeStringWithStatus(
    text: string,
    font?: FontDescriptorModel
  ): { pdfString: PdfString; canMapAll: boolean; encodedByteLength: number } {
    const reverseMap = font?.cMapData?.reverseMap;
    const is2Byte = font?.type === 'Type0';

    if (reverseMap && reverseMap.size > 0) {
      const maxKeyLen = font?.cMapData?.maxUnicodeKeyLen || 1;
      const bytes: number[] = [];
      let canMapAll = true;
      let i = 0;

      while (i < text.length) {
        let matched = false;
        const maxLen = Math.min(maxKeyLen, text.length - i);

        // Longest-match search
        for (let l = maxLen; l >= 1; l--) {
          const sub = text.substring(i, i + l);
          if (reverseMap.has(sub)) {
            const code = reverseMap.get(sub)!;
            if (is2Byte || code > 255) {
              bytes.push((code >> 8) & 0xff, code & 0xff);
            } else {
              bytes.push(code & 0xff);
            }
            i += l;
            matched = true;
            break;
          }
        }

        if (!matched) {
          canMapAll = false;
          break;
        }
      }

      if (canMapAll) {
        return {
          pdfString: new PdfString(new Uint8Array(bytes), is2Byte),
          canMapAll: true,
          encodedByteLength: bytes.length,
        };
      } else {
        // Font had a CMap, but some characters are unencodable in this subset font
        const fallbackBytes = new Uint8Array(text.length);
        for (let j = 0; j < text.length; j++) {
          fallbackBytes[j] = text.charCodeAt(j) & 0xff;
        }
        return {
          pdfString: new PdfString(fallbackBytes, false),
          canMapAll: false,
          encodedByteLength: fallbackBytes.length,
        };
      }
    }

    // Standard WinAnsi / Latin1 string fallback (for standard 14 or non-CMap fonts)
    const bytes = new Uint8Array(text.length);
    let canMapAll = true;
    for (let i = 0; i < text.length; i++) {
      const cc = text.charCodeAt(i);
      if (cc > 255) canMapAll = false;
      bytes[i] = cc & 0xff;
    }
    return {
      pdfString: new PdfString(bytes, false),
      canMapAll,
      encodedByteLength: bytes.length,
    };
  }

  /**
   * Diagnostic formatting helper
   */
  getFontDiagnostics(fontKey: string): string {
    const font = this.parsedFonts.get(fontKey);
    if (!font) return `Font "${fontKey}": Not found`;

    const codeSpacesStr = font.cMapData?.codeSpaces
      .map((cs) => `<${cs.min.toString(16).padStart(cs.byteLength * 2, '0')}>-<${cs.max.toString(16).padStart(cs.byteLength * 2, '0')}> (${cs.byteLength}B)`)
      .join(', ') || 'Default';

    return [
      `Font: ${font.name} (${font.cleanName || font.name})`,
      `Type: ${font.type}`,
      `Encoding: ${font.encoding || 'Identity'}`,
      `Subset: ${font.isSubset ? 'YES' : 'NO'}`,
      `CodeSpaces: ${codeSpacesStr}`,
      `Mapped Characters: ${font.toUnicodeCMap?.size || 0}`,
      `Glyph Widths: ${font.widths?.size || 0} entries (Default: ${font.defaultWidth})`,
    ].join('\n');
  }

  private isControlChar(code: number): boolean {
    return (code >= 0 && code <= 8) || (code >= 11 && code <= 12) || (code >= 14 && code <= 31) || code === 127;
  }

  private createFallbackFont(name: string): FontDescriptorModel {
    const clean = name ? name.replace(/^[A-Z]{6}\+/, '') : 'Helvetica';
    const descriptor: FontDescriptorModel = {
      name: name || 'Helvetica',
      cleanName: clean,
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
