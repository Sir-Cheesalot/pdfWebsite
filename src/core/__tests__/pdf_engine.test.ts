// Comprehensive Automated Tests for True WYSIWYG PDF Engine
import { describe, expect, it } from 'vitest';
import * as pako from 'pako';
import { CoordinateSystem } from '../coords/CoordinateSystem';
import { PdfLexer } from '../pdf/PdfLexer';
import { PdfParser } from '../pdf/PdfParser';
import { FlateDecoder } from '../pdf/FlateDecoder';
import { FontEngine } from '../pdf/FontEngine';
import { ContentStreamParser } from '../pdf/ContentStreamParser';
import { SmartLayoutEngine } from '../model/SmartLayoutEngine';
import { PdfWriter } from '../exporter/PdfWriter';
import { SamplePdfs } from '../samples/SamplePdfs';
import { DocumentModelManager } from '../model/DocumentModel';
import { PdfDict, PdfName, PdfStream, PdfString } from '../types/pdf';
import { PageModel, TextObject } from '../types/model';
import fs from 'fs';
import path from 'path';

describe('1. Centralized Coordinate System', () => {
  const samplePage: PageModel = {
    pageIndex: 0,
    width: 612,
    height: 792,
    mediaBox: [0, 0, 612, 792],
    rotation: 0,
    objects: [],
    rawContentStreamIndices: [],
    unhandledOperatorsCount: 0,
  };

  it('converts PDF points (bottom-left) to Screen pixels (top-left) at 100% zoom', () => {
    // Top-left of PDF is (0, 792) in PDF -> (0, 0) in screen
    const screenTopLeft = CoordinateSystem.pdfToScreenPoint({ x: 0, y: 792 }, samplePage, 1.0);
    expect(screenTopLeft.x).toBe(0);
    expect(screenTopLeft.y).toBe(0);

    // Bottom-left of PDF is (0, 0) in PDF -> (0, 792) in screen
    const screenBottomLeft = CoordinateSystem.pdfToScreenPoint({ x: 0, y: 0 }, samplePage, 1.0);
    expect(screenBottomLeft.x).toBe(0);
    expect(screenBottomLeft.y).toBe(792);

    // Reverse mapping
    const backToPdf = CoordinateSystem.screenToPdfPoint(screenTopLeft, samplePage, 1.0);
    expect(backToPdf.x).toBe(0);
    expect(backToPdf.y).toBe(792);
  });

  it('handles zoom scaling correctly', () => {
    const zoom = 1.5;
    const pt = { x: 100, y: 500 };
    const screenPt = CoordinateSystem.pdfToScreenPoint(pt, samplePage, zoom);
    expect(screenPt.x).toBeCloseTo(100 * zoom);
    expect(screenPt.y).toBeCloseTo((792 - 500) * zoom);

    const backPt = CoordinateSystem.screenToPdfPoint(screenPt, samplePage, zoom);
    expect(backPt.x).toBeCloseTo(pt.x);
    expect(backPt.y).toBeCloseTo(pt.y);
  });

  it('transforms bounding boxes accurately', () => {
    const pdfRect = { x: 50, y: 600, width: 200, height: 40 };
    const screenRect = CoordinateSystem.pdfRectToScreenRect(pdfRect, samplePage, 1.0);
    expect(screenRect.x).toBe(50);
    expect(screenRect.y).toBe(792 - 600 - 40); // 152
    expect(screenRect.width).toBe(200);
    expect(screenRect.height).toBe(40);

    const backPdfRect = CoordinateSystem.screenRectToPdfRect(screenRect, samplePage, 1.0);
    expect(backPdfRect.x).toBeCloseTo(pdfRect.x);
    expect(backPdfRect.y).toBeCloseTo(pdfRect.y);
    expect(backPdfRect.width).toBeCloseTo(pdfRect.width);
    expect(backPdfRect.height).toBeCloseTo(pdfRect.height);
  });
});

describe('2. FlateDecoder & Stream Compression', () => {
  it('compresses and decompresses stream data without loss', () => {
    const originalText = 'BT /F1 12 Tf 1 0 0 1 100 700 Tm (True WYSIWYG PDF Editing) Tj ET';
    const originalBytes = new TextEncoder().encode(originalText);

    const compressed = FlateDecoder.encodeFlate(originalBytes);
    expect(compressed.length).toBeGreaterThan(0);

    const dict = new PdfDict();
    dict.set('Filter', new PdfName('FlateDecode'));
    const stream = new PdfStream(dict, compressed);

    const decoded = FlateDecoder.decodeStream(stream);
    const decodedText = new TextDecoder().decode(decoded);
    expect(decodedText).toBe(originalText);
  });
});

describe('3. PDF Lexer & Tokenizer', () => {
  it('correctly tokenizes keywords, names, numbers, literal strings, and hex strings', () => {
    const pdfSnippet = `
      /Type /Catalog
      /Pages 2 0 R
      (Hello \\(World\\))
      <48656c6c6f>
      [ 1 2.5 (Item) ]
      << /Key 42 >>
    `;
    const lexer = new PdfLexer(new TextEncoder().encode(pdfSnippet));

    const tok1 = lexer.nextToken(); // /Type
    expect(tok1).toEqual({ type: 'name', value: 'Type' });

    const tok2 = lexer.nextToken(); // /Catalog
    expect(tok2).toEqual({ type: 'name', value: 'Catalog' });

    const tok3 = lexer.nextToken(); // /Pages
    expect(tok3).toEqual({ type: 'name', value: 'Pages' });

    const tok4 = lexer.nextToken(); // 2
    expect(tok4).toEqual({ type: 'number', value: 2 });

    const tok5 = lexer.nextToken(); // 0
    expect(tok5).toEqual({ type: 'number', value: 0 });

    const tok6 = lexer.nextToken(); // R
    expect(tok6).toEqual({ type: 'keyword', value: 'R' });

    const tok7 = lexer.nextToken(); // (Hello (World))
    expect(tok7?.type).toBe('string');
    expect(tok7 && 'raw' in tok7 && tok7.raw).toBe('Hello (World)');

    const tok8 = lexer.nextToken(); // <48656c6c6f> -> "Hello"
    expect(tok8?.type).toBe('string');
    expect(tok8 && 'raw' in tok8 && tok8.raw).toBe('Hello');
  });
});

describe('4. Font Engine & CMap Resolution', () => {
  const fontEngine = new FontEngine();

  it('decodes standard Latin1/WinAnsi text runs', () => {
    const raw = new TextEncoder().encode('Invoice #1024');
    const { text, widths } = fontEngine.decodeString(raw);
    expect(text).toBe('Invoice #1024');
    expect(widths.length).toBe(13);
  });

  it('encodes unicode text back into valid PDF string representation', () => {
    const pdfStr = fontEngine.encodeString('Annual Financial Summary');
    expect(pdfStr.toText()).toBe('Annual Financial Summary');
  });
});

describe('5. Content Stream Parser & Operator Extraction', () => {
  it('parses text operators (BT, Tf, Tm, Tj, TJ, ET) without whiteout masks', () => {
    const contentStream = `
      q
      0.1 0.2 0.3 rg
      BT
      /F1 14 Tf
      1 0 0 1 50 650 Tm
      (First Line of Text) Tj
      ET
      BT
      /F1 12 Tf
      1 0 0 1 50 620 Tm
      [ (Second ) -50 (Line) ] TJ
      ET
      Q
    `;
    const parser = new PdfParser(new Uint8Array());
    const streamParser = new ContentStreamParser(parser);

    const ops = streamParser.parseOperators(new TextEncoder().encode(contentStream));
    expect(ops.length).toBeGreaterThan(10);

    const pageDict = new PdfDict();
    const { objects } = streamParser.interpretPage(0, pageDict, [
      { data: new TextEncoder().encode(contentStream), streamIndex: 0 },
    ]);

    expect(objects.length).toBe(2);
    expect(objects[0].type).toBe('text');
    expect((objects[0] as TextObject).text).toBe('First Line of Text');
    expect(objects[0].pdfBounds.x).toBe(50);
    expect(objects[0].pdfBounds.y).toBeCloseTo(650, -1);

    expect(objects[1].type).toBe('text');
    expect((objects[1] as TextObject).text).toContain('Second Line');
  });
});

describe('6. Smart Layout Repositioning Engine', () => {
  it('shifts downstream elements downward by deltaHeight when content is inserted above them', () => {
    const samplePage: PageModel = {
      pageIndex: 0,
      width: 612,
      height: 792,
      mediaBox: [0, 0, 612, 792],
      rotation: 0,
      objects: [
        {
          id: 'title',
          type: 'text',
          origin: 'pdf_source',
          pageIndex: 0,
          pdfBounds: { x: 50, y: 700, width: 200, height: 30 },
          matrix: [1, 0, 0, 1, 50, 700],
          rotation: 0,
          zIndex: 1,
          opacity: 1,
          visible: true,
          locked: false,
          text: 'Title at Y=700',
          runs: [],
          fontName: 'Helvetica',
          fontSize: 18,
          lineHeight: 22,
          charSpacing: 0,
          wordSpacing: 0,
          fillColor: '#000',
          bold: true,
          italic: false,
          underline: false,
          alignment: 'left',
        },
        {
          id: 'name',
          type: 'text',
          origin: 'pdf_source',
          pageIndex: 0,
          pdfBounds: { x: 50, y: 650, width: 150, height: 16 },
          matrix: [1, 0, 0, 1, 50, 650],
          rotation: 0,
          zIndex: 2,
          opacity: 1,
          visible: true,
          locked: false,
          text: 'Name at Y=650',
          runs: [],
          fontName: 'Helvetica',
          fontSize: 12,
          lineHeight: 15,
          charSpacing: 0,
          wordSpacing: 0,
          fillColor: '#000',
          bold: false,
          italic: false,
          underline: false,
          alignment: 'left',
        },
        {
          id: 'age',
          type: 'text',
          origin: 'pdf_source',
          pageIndex: 0,
          pdfBounds: { x: 50, y: 620, width: 100, height: 16 },
          matrix: [1, 0, 0, 1, 50, 620],
          rotation: 0,
          zIndex: 3,
          opacity: 1,
          visible: true,
          locked: false,
          text: 'Age at Y=620',
          runs: [],
          fontName: 'Helvetica',
          fontSize: 12,
          lineHeight: 15,
          charSpacing: 0,
          wordSpacing: 0,
          fillColor: '#000',
          bold: false,
          italic: false,
          underline: false,
          alignment: 'left',
        },
      ],
      rawContentStreamIndices: [],
      unhandledOperatorsCount: 0,
    };

    // User inserts 100pt table between Title (y=700) and Name (y=650)
    // Insertion point threshold: Y = 680
    const result = SmartLayoutEngine.pushDownstreamContent(samplePage, 680, 100);

    // Title should stay at Y=700
    const titleObj = samplePage.objects.find((o) => o.id === 'title')!;
    expect(titleObj.pdfBounds.y).toBe(700);

    // Name (old y=650) should move to 650 - 100 = 550
    const nameObj = samplePage.objects.find((o) => o.id === 'name')!;
    expect(nameObj.pdfBounds.y).toBe(550);
    expect(nameObj.matrix[5]).toBe(550);

    // Age (old y=620) should move to 620 - 100 = 520
    const ageObj = samplePage.objects.find((o) => o.id === 'age')!;
    expect(ageObj.pdfBounds.y).toBe(520);
    expect(ageObj.matrix[5]).toBe(520);

    // Verify undo reverts positions cleanly
    SmartLayoutEngine.revertReposition(samplePage, result);
    expect(nameObj.pdfBounds.y).toBe(650);
    expect(ageObj.pdfBounds.y).toBe(620);
  });
});

describe('7. PDF Exporter & Binary Serialization Round-Trip', () => {
  it('exports a complete document with text, tables, and shapes to a valid PDF 1.7 file', async () => {
    const doc = SamplePdfs.createInvoiceSample();

    const writer = new PdfWriter();
    const pdfBytes = writer.exportDocument(doc);

    expect(pdfBytes.length).toBeGreaterThan(500);

    // Verify PDF binary header
    const header = new TextDecoder('latin1').decode(pdfBytes.subarray(0, 8));
    expect(header).toContain('%PDF-1.7');

    // Verify EOF marker
    const trailerEnd = new TextDecoder('latin1').decode(pdfBytes.subarray(pdfBytes.length - 20));
    expect(trailerEnd).toContain('%%EOF');

    // Round-trip parse the generated PDF binary back into DocumentModel!
    const { doc: reloadedDoc } = await DocumentModelManager.loadPdfFromBuffer(pdfBytes.buffer as ArrayBuffer, 'test.pdf');
    expect(reloadedDoc.pages.length).toBe(1);
    expect(reloadedDoc.pages[0].objects.length).toBeGreaterThan(0);
  });
});

describe('8. Workspace Sample PDF Verification', () => {
  it('parses real workspace PDF if present', async () => {
    const samplePath = path.resolve('../Semester_I_exam_Paper_1_practice__MS.pdf');
    if (fs.existsSync(samplePath)) {
      const fileBuffer = fs.readFileSync(samplePath);
      const uint8 = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength);
      const arrayBuffer = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength) as ArrayBuffer;
      const { doc } = await DocumentModelManager.loadPdfFromBuffer(arrayBuffer, 'Exam_Paper.pdf');
      expect(doc.pages.length).toBeGreaterThan(0);
      expect(doc.pages[0].width).toBeGreaterThan(0);
      expect(doc.pages[0].height).toBeGreaterThan(0);
    }
  });
});

describe('9. OCR Verification & Exotic Character Resolution Engine', () => {
  it('detects exotic and corrupted characters accurately', async () => {
    const { OcrVerificationEngine } = await import('../ocr/OcrVerificationEngine');
    expect(OcrVerificationEngine.containsExoticChars('Standard ASCII text')).toBe(false);
    expect(OcrVerificationEngine.containsExoticChars('Text with Devanagari \u0913\u091F')).toBe(true);
    expect(OcrVerificationEngine.containsExoticChars('Missing glyph □')).toBe(true);
  });

  it('cleans and resolves scientific notation when corrupted glyph codes are present', async () => {
    const { OcrVerificationEngine } = await import('../ocr/OcrVerificationEngine');
    const corruptedRate = 'Uncertainty (ओट-१)';
    const result = OcrVerificationEngine.verifyAndCleanText(corruptedRate);
    expect(result.hasExoticChars).toBe(true);
    expect(result.verifiedText).toContain('(g/s)');

    const corruptedScientific = '6.1 x \u096C\u091F';
    const sciResult = OcrVerificationEngine.verifyAndCleanText(corruptedScientific);
    expect(sciResult.verifiedText).toContain('6.1 × 10⁻⁴');
  });
});
