// Comprehensive Regression & Robustness Tests for PDF Font, CMap, and Text Encoding
// Tests A through K conforming to ISO 32000-1 and Adobe CMap Specifications
import { describe, expect, it } from 'vitest';
import { CMapParser } from '../pdf/CMapParser';
import { FontEngine } from '../pdf/FontEngine';
import { DocumentModelManager } from '../model/DocumentModel';
import { PdfWriter } from '../exporter/PdfWriter';
import { SamplePdfs } from '../samples/SamplePdfs';
import { FontDescriptorModel, TextObject } from '../types/model';

describe('PDF Font & CMap Robustness Test Suite (Tests A - K)', () => {
  const fontEngine = new FontEngine();

  // Test A — Simple Word-style PDF: Existing behavior must remain unchanged
  describe('Test A — Simple Word-style PDF', () => {
    it('parses and round-trips standard WinAnsi / Latin1 document correctly', async () => {
      const doc = SamplePdfs.createInvoiceSample();
      const writer = new PdfWriter();
      const pdfBytes = writer.exportDocument(doc);
      expect(pdfBytes.length).toBeGreaterThan(500);

      const { doc: loadedDoc } = await DocumentModelManager.loadPdfFromBuffer(
        pdfBytes.buffer as ArrayBuffer,
        'invoice.pdf'
      );
      expect(loadedDoc.pages.length).toBe(1);
      const textObjects = loadedDoc.pages[0].objects.filter((o) => o.type === 'text') as TextObject[];
      expect(textObjects.length).toBeGreaterThan(0);
      expect(textObjects.some((t) => t.text.includes('INVOICE'))).toBe(true);
    });
  });

  // Test B — Type0 Identity-H: Verify PDF bytes -> correct Unicode
  describe('Test B — Type0 Identity-H', () => {
    it('decodes 2-byte Identity-H font character codes to correct Unicode strings', () => {
      const cmapData = `
        /CIDInit /ProcSet findresource begin
        12 dict begin
        begincmap
        /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
        /CMapName /Adobe-Identity-UCS def
        /CMapType 2 def
        1 begincodespacerange
        <0000> <FFFF>
        endcodespacerange
        2 beginbfchar
        <002C> <0049>
        <0051> <006E>
        endbfchar
        endcmap
        CMapName currentdict /CMap defineresource pop
        end
        end
      `;
      const parsedCMap = CMapParser.parse(cmapData);
      const fontDesc: FontDescriptorModel = {
        name: 'ABCDEE+Calibri',
        cleanName: 'Calibri',
        type: 'Type0',
        isStandard14: false,
        isSubset: true,
        cMapData: parsedCMap,
        toUnicodeCMap: parsedCMap.toUnicode,
      };

      // Raw bytes for <002C> ("I") and <0051> ("n")
      const rawBytes = new Uint8Array([0x00, 0x2c, 0x00, 0x51]);
      const { text, glyphs } = fontEngine.decodeString(rawBytes, fontDesc);
      expect(text).toBe('In');
      expect(glyphs.length).toBe(2);
      expect(glyphs[0].charCode).toBe(0x002c);
      expect(glyphs[0].unicode).toBe('I');
      expect(glyphs[0].byteLength).toBe(2);
      expect(glyphs[0].resolved).toBe(true);
      expect(glyphs[1].charCode).toBe(0x0051);
      expect(glyphs[1].unicode).toBe('n');
    });
  });

  // Test C — Type0 non-Identity CMap: Character codes decoded according to CMap rather than fixed 2-byte chunks
  describe('Test C — Type0 non-Identity CMap', () => {
    it('decodes 1-byte CMap in Type0 composite font correctly', () => {
      const cmap1Byte = `
        begincmap
        1 begincodespacerange
        <00> <FF>
        endcodespacerange
        3 beginbfchar
        <41> <0041>
        <42> <0042>
        <43> <0043>
        endbfchar
        endcmap
      `;
      const parsedCMap = CMapParser.parse(cmap1Byte);
      const fontDesc: FontDescriptorModel = {
        name: 'CustomType0Font',
        type: 'Type0',
        isStandard14: false,
        cMapData: parsedCMap,
        toUnicodeCMap: parsedCMap.toUnicode,
      };

      // 1 byte per character code
      const rawBytes = new Uint8Array([0x41, 0x42, 0x43]);
      const { text, glyphs } = fontEngine.decodeString(rawBytes, fontDesc);
      expect(text).toBe('ABC');
      expect(glyphs.length).toBe(3);
      expect(glyphs[0].byteLength).toBe(1);
      expect(glyphs[0].charCode).toBe(0x41);
      expect(glyphs[1].byteLength).toBe(1);
      expect(glyphs[2].byteLength).toBe(1);
    });
  });

  // Test D — Variable-width codes: Test a CMap with multiple codespace ranges
  describe('Test D — Variable-width codes', () => {
    it('decodes mixed 1-byte and 2-byte codes in the same stream based on codespace ranges', () => {
      const variableCMap = `
        begincmap
        2 begincodespacerange
        <00> <7F>
        <8140> <9FFF>
        endcodespacerange
        2 beginbfchar
        <41> <0041>
        <8140> <3042>
        endbfchar
        endcmap
      `;
      const parsedCMap = CMapParser.parse(variableCMap);
      const fontDesc: FontDescriptorModel = {
        name: 'ShiftJISComposite',
        type: 'Type0',
        isStandard14: false,
        cMapData: parsedCMap,
        toUnicodeCMap: parsedCMap.toUnicode,
      };

      // Stream: 0x41 ('A', 1-byte) followed by 0x81, 0x40 (Hiragana 'あ', 2-byte)
      const rawBytes = new Uint8Array([0x41, 0x81, 0x40]);
      const { text, glyphs } = fontEngine.decodeString(rawBytes, fontDesc);
      expect(text).toBe('Aあ');
      expect(glyphs.length).toBe(2);
      expect(glyphs[0].byteLength).toBe(1);
      expect(glyphs[0].unicode).toBe('A');
      expect(glyphs[1].byteLength).toBe(2);
      expect(glyphs[1].unicode).toBe('あ');
    });
  });

  // Test E — bfchar: Verify direct mappings
  describe('Test E — bfchar', () => {
    it('parses direct bfchar mappings with standard and multi-digit hex', () => {
      const cmapText = `
        begincmap
        1 begincodespacerange
        <0000> <FFFF>
        endcodespacerange
        3 beginbfchar
        <0001> <0041>
        <0002> <0042>
        <1000> <005A>
        endbfchar
        endcmap
      `;
      const parsed = CMapParser.parse(cmapText);
      expect(parsed.toUnicode.get(0x0001)).toBe('A');
      expect(parsed.toUnicode.get(0x0002)).toBe('B');
      expect(parsed.toUnicode.get(0x1000)).toBe('Z');
    });
  });

  // Test F — Sequential bfrange: <0001> <0003> <0041> becomes A B C
  describe('Test F — Sequential bfrange', () => {
    it('correctly maps sequential ranges <0001> <0003> <0041> to A B C', () => {
      const cmapText = `
        begincmap
        1 begincodespacerange
        <0000> <FFFF>
        endcodespacerange
        1 beginbfrange
        <0001> <0003> <0041>
        endbfrange
        endcmap
      `;
      const parsed = CMapParser.parse(cmapText);
      expect(parsed.toUnicode.get(0x0001)).toBe('A');
      expect(parsed.toUnicode.get(0x0002)).toBe('B');
      expect(parsed.toUnicode.get(0x0003)).toBe('C');
    });
  });

  // Test G — Array bfrange: <0001> [<0041> <00660069> <0043>] correctly becomes A fi C
  describe('Test G — Array bfrange', () => {
    it('correctly maps array bfrange with ligature to A, fi, C', () => {
      const cmapText = `
        begincmap
        1 begincodespacerange
        <0000> <FFFF>
        endcodespacerange
        1 beginbfrange
        <0001> <0003> [ <0041> <00660069> <0043> ]
        endbfrange
        endcmap
      `;
      const parsed = CMapParser.parse(cmapText);
      expect(parsed.toUnicode.get(0x0001)).toBe('A');
      expect(parsed.toUnicode.get(0x0002)).toBe('fi');
      expect(parsed.toUnicode.get(0x0003)).toBe('C');
    });
  });

  // Test H — Embedded subset font: Verify text remains readable and subset prefix is handled
  describe('Test H — Embedded subset font', () => {
    it('handles subset prefix ABCDEF+FontName while preserving CMap and widths', () => {
      const cmapText = `
        begincmap
        1 begincodespacerange
        <0000> <FFFF>
        endcodespacerange
        4 beginbfchar
        <0001> <0048>
        <0002> <0065>
        <0003> <006C>
        <0004> <006F>
        endbfchar
        endcmap
      `;
      const parsedCMap = CMapParser.parse(cmapText);
      const fontDesc: FontDescriptorModel = {
        name: 'XYZABC+ArialMT',
        cleanName: 'ArialMT',
        type: 'Type0',
        isStandard14: false,
        isSubset: true,
        cMapData: parsedCMap,
        toUnicodeCMap: parsedCMap.toUnicode,
      };

      // Encoded "Hello" -> <0001> <0002> <0003> <0003> <0004>
      const rawBytes = new Uint8Array([0x00, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x03, 0x00, 0x04]);
      const { text } = fontEngine.decodeString(rawBytes, fontDesc);
      expect(text).toBe('Hello');
    });
  });

  // Test I — Editing existing text: Change "Hello" to "Hello!" and round-trip encode
  describe('Test I — Editing existing text', () => {
    it('encodes matching characters with original CMap and falls back cleanly for new characters', () => {
      const cmapText = `
        begincmap
        1 begincodespacerange
        <0000> <FFFF>
        endcodespacerange
        4 beginbfchar
        <0001> <0048>
        <0002> <0065>
        <0003> <006C>
        <0004> <006F>
        endbfchar
        endcmap
      `;
      const parsedCMap = CMapParser.parse(cmapText);
      const fontDesc: FontDescriptorModel = {
        name: 'XYZABC+ArialMT',
        cleanName: 'ArialMT',
        type: 'Type0',
        isStandard14: false,
        isSubset: true,
        cMapData: parsedCMap,
        toUnicodeCMap: parsedCMap.toUnicode,
      };

      // 1. Text composed only of subset characters: "Hello"
      const resHello = fontEngine.encodeStringWithStatus('Hello', fontDesc);
      expect(resHello.canMapAll).toBe(true);
      expect(resHello.pdfString.bytes).toEqual(new Uint8Array([0x00, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x03, 0x00, 0x04]));

      // 2. Text with newly added character not in subset: "Hello!"
      const resExclamation = fontEngine.encodeStringWithStatus('Hello!', fontDesc);
      expect(resExclamation.canMapAll).toBe(false); // flags that fallback font should be used
    });
  });

  // Test J — Unicode & Math: Test characters outside ASCII (surrogates, math alphanumeric)
  describe('Test J — Unicode', () => {
    it('decodes 8-digit UTF-16 surrogate pairs in ToUnicode CMaps (Math Alphanumeric symbols)', () => {
      const cmapMath = `
        begincmap
        1 begincodespacerange
        <0000> <FFFF>
        endcodespacerange
        1 beginbfchar
        <0005> <D835DC4E>
        endbfchar
        endcmap
      `;
      const parsed = CMapParser.parse(cmapMath);
      expect(parsed.toUnicode.get(0x0005)?.codePointAt(0)).toBe(0x1d44e); // Mathematical Italic Small M (U+1D44E)

      const fontDesc: FontDescriptorModel = {
        name: 'CambriaMath',
        type: 'Type0',
        isStandard14: false,
        cMapData: parsed,
        toUnicodeCMap: parsed.toUnicode,
      };
      const { text } = fontEngine.decodeString(new Uint8Array([0x00, 0x05]), fontDesc);
      expect(text.codePointAt(0)).toBe(0x1d44e);
    });
  });

  // Test K — Unknown mapping: Unknown glyphs must NOT silently become spaces
  describe('Test K — Unknown mapping', () => {
    it('marks unmapped glyphs as unresolved and does NOT silently turn them into spaces', () => {
      const cmapEmpty = `
        begincmap
        1 begincodespacerange
        <0000> <FFFF>
        endcodespacerange
        endcmap
      `;
      const parsed = CMapParser.parse(cmapEmpty);
      const fontDesc: FontDescriptorModel = {
        name: 'EmptyFont',
        type: 'Type0',
        isStandard14: false,
        cMapData: parsed,
        toUnicodeCMap: parsed.toUnicode,
      };

      // Unmapped code 0x9999
      const { text, glyphs } = fontEngine.decodeString(new Uint8Array([0x99, 0x99]), fontDesc);
      expect(text).not.toBe(' ');
      expect(glyphs[0].resolved).toBe(false);
      expect(glyphs[0].unicode).toBe('\uFFFD');
    });
  });
});
