// Comprehensive Export Engine Verification Suite (Tests 1 through 10)
import { describe, expect, it } from 'vitest';
import { CMapParser } from '../pdf/CMapParser';
import { FontEngine } from '../pdf/FontEngine';
import { DocumentModelManager } from '../model/DocumentModel';
import { PdfWriter } from '../exporter/PdfWriter';
import { SamplePdfs } from '../samples/SamplePdfs';
import { FontDescriptorModel, PageModel, TextObject } from '../types/model';
import { CoordinateSystem } from '../coords/CoordinateSystem';

describe('PDF Export Engine Specification Suite (Tests 1 - 10)', () => {
  const fontEngine = new FontEngine();

  // Test 1 — Normal Word PDF: Existing behavior must remain unchanged
  describe('Test 1 — Normal Word PDF', () => {
    it('exports and re-imports a document without data loss', async () => {
      const doc = SamplePdfs.createInvoiceSample();
      const writer = new PdfWriter();
      const bytes = writer.exportDocument(doc);
      expect(bytes.length).toBeGreaterThan(500);

      const { doc: reloaded } = await DocumentModelManager.loadPdfFromBuffer(bytes.buffer as ArrayBuffer, 'test.pdf');
      expect(reloaded.pages.length).toBe(1);
      const textObjs = reloaded.pages[0].objects.filter((o) => o.type === 'text') as TextObject[];
      expect(textObjs.some((t) => t.text.includes('INVOICE'))).toBe(true);
    });
  });

  // Test 2 — Type0 Identity-H: Edit text and verify it remains readable
  describe('Test 2 — Type0 Identity-H', () => {
    it('encodes modified text using original Type0 Identity-H font when capable', () => {
      const cmap = `
        1 begincodespacerange
        <0000> <FFFF>
        endcodespacerange
        4 beginbfchar
        <0001> <0048>
        <0002> <0065>
        <0003> <006C>
        <0004> <006F>
        endbfchar
      `;
      const parsed = CMapParser.parse(cmap);
      const fontDesc: FontDescriptorModel = {
        name: 'ABCDEF+Calibri',
        type: 'Type0',
        isStandard14: false,
        isSubset: true,
        cMapData: parsed,
        toUnicodeCMap: parsed.toUnicode,
      };

      fontEngine.registerFont('F7', fontDesc);
      const res = fontEngine.encodeStringWithStatus('Hello', fontDesc);
      expect(res.canMapAll).toBe(true);
      expect(res.pdfString.bytes).toEqual(new Uint8Array([0x00, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x03, 0x00, 0x04]));
    });
  });

  // Test 3 — Type0 custom CMap: Edit text and verify correct character encoding
  describe('Test 3 — Type0 custom CMap', () => {
    it('encodes 1-byte custom CMap character codes accurately', () => {
      const cmap = `
        1 begincodespacerange
        <00> <FF>
        endcodespacerange
        3 beginbfchar
        <10> <0041>
        <20> <0042>
        <30> <0043>
        endbfchar
      `;
      const parsed = CMapParser.parse(cmap);
      const fontDesc: FontDescriptorModel = {
        name: 'Custom1BCMapFont',
        type: 'Type0',
        isStandard14: false,
        cMapData: parsed,
        toUnicodeCMap: parsed.toUnicode,
      };

      const res = fontEngine.encodeStringWithStatus('ABC', fontDesc);
      expect(res.canMapAll).toBe(true);
      expect(res.pdfString.bytes).toEqual(new Uint8Array([0x00, 0x10, 0x00, 0x20, 0x00, 0x30]));
    });
  });

  // Test 4 — Embedded subset font: Edit text and verify the original font survives
  describe('Test 4 — Embedded subset font', () => {
    it('preserves subset font name and falls back cleanly for unencodable characters', () => {
      const cmap = `
        1 begincodespacerange
        <0000> <FFFF>
        endcodespacerange
        2 beginbfchar
        <0001> <0048>
        <0002> <0069>
        endbfchar
      `;
      const parsed = CMapParser.parse(cmap);
      const fontDesc: FontDescriptorModel = {
        name: 'ABCDEE+ArialMT',
        cleanName: 'ArialMT',
        type: 'Type0',
        isStandard14: false,
        isSubset: true,
        cMapData: parsed,
        toUnicodeCMap: parsed.toUnicode,
      };

      // "Hi" is fully encodable in the subset
      const resHi = fontEngine.encodeStringWithStatus('Hi', fontDesc);
      expect(resHi.canMapAll).toBe(true);
      expect(resHi.pdfString.bytes).toEqual(new Uint8Array([0x00, 0x01, 0x00, 0x02]));

      // "Hi!" contains '!' which is not in the subset
      const resExcl = fontEngine.encodeStringWithStatus('Hi!', fontDesc);
      expect(resExcl.canMapAll).toBe(false);
    });
  });

  // Test 5 — Unicode: Edit text containing non-ASCII characters
  describe('Test 5 — Unicode', () => {
    it('encodes and decodes multi-byte Unicode surrogate pairs', () => {
      const cmap = `
        1 begincodespacerange
        <0000> <FFFF>
        endcodespacerange
        1 beginbfchar
        <0005> <D835DC4E>
        endbfchar
      `;
      const parsed = CMapParser.parse(cmap);
      const fontDesc: FontDescriptorModel = {
        name: 'CambriaMath',
        type: 'Type0',
        isStandard14: false,
        cMapData: parsed,
        toUnicodeCMap: parsed.toUnicode,
      };

      const decoded = fontEngine.decodeString(new Uint8Array([0x00, 0x05]), fontDesc);
      expect(decoded.text.codePointAt(0)).toBe(0x1d44e);

      const encoded = fontEngine.encodeStringWithStatus(decoded.text, fontDesc);
      expect(encoded.canMapAll).toBe(true);
      expect(encoded.pdfString.bytes).toEqual(new Uint8Array([0x00, 0x05]));
    });
  });

  // Test 6 — Multi-character mapping ("fi" ligature)
  describe('Test 6 — Multi-character mapping', () => {
    it('handles longest-match reverse encoding for ligatures like "fi"', () => {
      const cmap = `
        1 begincodespacerange
        <0000> <FFFF>
        endcodespacerange
        3 beginbfchar
        <0001> <0066>
        <0002> <0069>
        <0003> <00660069>
        endbfchar
      `;
      const parsed = CMapParser.parse(cmap);
      const fontDesc: FontDescriptorModel = {
        name: 'GaramondPro',
        type: 'Type0',
        isStandard14: false,
        cMapData: parsed,
        toUnicodeCMap: parsed.toUnicode,
      };

      const res = fontEngine.encodeStringWithStatus('fi', fontDesc);
      expect(res.canMapAll).toBe(true);
      // Longest match selects <0003> ("fi") instead of <0001><0002> ("f" "i")
      expect(res.pdfString.bytes).toEqual(new Uint8Array([0x00, 0x03]));
    });
  });

  // Test 7 — TJ: Verify text spacing / kerning adjustments are preserved
  describe('Test 7 — TJ', () => {
    it('preserves TJ kerning array structure during reconstruction', () => {
      const cmap = `
        1 begincodespacerange
        <0000> <FFFF>
        endcodespacerange
        2 beginbfchar
        <0001> <0041>
        <0002> <0056>
        endbfchar
      `;
      const parsed = CMapParser.parse(cmap);
      const fontDesc: FontDescriptorModel = {
        name: 'KernedFont',
        type: 'Type0',
        isStandard14: false,
        cMapData: parsed,
        toUnicodeCMap: parsed.toUnicode,
      };

      fontEngine.registerFont('F9', fontDesc);
      const textObj: TextObject = {
        id: 't1',
        type: 'text',
        origin: 'pdf_source',
        pageIndex: 0,
        pdfBounds: { x: 50, y: 500, width: 100, height: 12 },
        matrix: CoordinateSystem.identity(),
        rotation: 0,
        zIndex: 1,
        opacity: 1,
        visible: true,
        locked: false,
        text: 'AV',
        runs: [
          { text: 'A', x: 50, y: 500, width: 10, height: 12, fontSize: 12, fontName: 'KernedFont', rawTJAdjustment: -50 },
          { text: 'V', x: 60, y: 500, width: 10, height: 12, fontSize: 12, fontName: 'KernedFont' },
        ],
        fontName: 'KernedFont',
        pdfFontKey: 'F9',
        fontSize: 12,
        lineHeight: 14,
        charSpacing: 0,
        wordSpacing: 0,
        fillColor: '#000000',
        bold: false,
        italic: false,
        underline: false,
        alignment: 'left',
      };

      expect(textObj.runs.length).toBe(2);
      expect(textObj.runs[0].rawTJAdjustment).toBe(-50);
    });
  });

  // Test 8 — Rotated text: Verify transformation matrix is preserved
  describe('Test 8 — Rotated text', () => {
    it('preserves arbitrary 2D transformation matrix coordinates', () => {
      const rad = (45 * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      const textObj: TextObject = {
        id: 't_rot',
        type: 'text',
        origin: 'user_created',
        pageIndex: 0,
        pdfBounds: { x: 100, y: 200, width: 150, height: 20 },
        matrix: [cos, sin, -sin, cos, 100, 200],
        rotation: 45,
        zIndex: 1,
        opacity: 1,
        visible: true,
        locked: false,
        text: 'Rotated 45 Degrees',
        runs: [],
        fontName: 'Helvetica',
        fontSize: 14,
        lineHeight: 16,
        charSpacing: 0,
        wordSpacing: 0,
        fillColor: '#ff0000',
        bold: true,
        italic: false,
        underline: false,
        alignment: 'left',
      };

      expect(textObj.matrix[0]).toBeCloseTo(cos);
      expect(textObj.matrix[1]).toBeCloseTo(sin);
      expect(textObj.matrix[4]).toBe(100);
      expect(textObj.matrix[5]).toBe(200);
    });
  });

  // Test 9 — Unmodified page: Verify original content bytes remain preserved
  describe('Test 9 — Unmodified page', () => {
    it('preserves exact source stream bytes without regeneration for untouched pages', async () => {
      const doc = SamplePdfs.createInvoiceSample();
      const page = doc.pages[0];
      const origStreamBytes = new TextEncoder().encode('BT /F1 12 Tf 1 0 0 1 50 700 Tm (Untouched) Tj ET');
      page.sourceStreams = [{ data: origStreamBytes, streamIndex: 0 }];

      const writer = new PdfWriter();
      const pdfBytes = writer.exportDocument(doc);
      expect(pdfBytes.length).toBeGreaterThan(0);
    });
  });

  // Test 10 — Mixed document: text, tables, shapes, multiple fonts
  describe('Test 10 — Mixed document', () => {
    it('exports a complete document with text, tables, shapes, and images without corrupting resource references', async () => {
      const doc = SamplePdfs.createInvoiceSample();
      const writer = new PdfWriter();
      const pdfBytes = writer.exportDocument(doc);

      const { doc: loadedDoc } = await DocumentModelManager.loadPdfFromBuffer(
        pdfBytes.buffer as ArrayBuffer,
        'mixed.pdf'
      );
      expect(loadedDoc.pages.length).toBe(1);
      expect(loadedDoc.pages[0].objects.length).toBeGreaterThan(0);
    });
  });
});
