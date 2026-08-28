// Automated Tests for Modified Image Export & Reconstruction
import { describe, expect, it } from 'vitest';
import * as pako from 'pako';
import { ImageDecoder } from '../exporter/ImageDecoder';
import { PdfWriter } from '../exporter/PdfWriter';
import { ContentStreamReconstructor } from '../exporter/ContentStreamReconstructor';
import { DocumentModel, ImageObject, PageModel } from '../types/model';
import { PdfDict, PdfName, PdfStream } from '../types/pdf';
import { DocumentModelManager } from '../model/DocumentModel';

// Helper to create a valid 2x2 RGB PNG in pure bytes
function create2x2RgbPng(r: number, g: number, b: number): Uint8Array {
  // Signature
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  // IHDR: 2x2, 8-bit, RGB (colorType=2)
  const ihdrData = [
    0x00, 0x00, 0x00, 0x02, // width = 2
    0x00, 0x00, 0x00, 0x02, // height = 2
    0x08, // bitDepth = 8
    0x02, // colorType = 2 (RGB)
    0x00, 0x00, 0x00 // compression, filter, interlace
  ];
  const ihdrChunk = makeChunk('IHDR', new Uint8Array(ihdrData));

  // IDAT: 2 rows of (filterType 0 + 2 pixels of RGB = 1 + 6 = 7 bytes per row -> 14 bytes)
  const rawScanlines = new Uint8Array([
    0, r, g, b, r, g, b, // row 0
    0, r, g, b, r, g, b  // row 1
  ]);
  const compressed = pako.deflate(rawScanlines);
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND
  const iendChunk = makeChunk('IEND', new Uint8Array(0));

  const totalLen = sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const png = new Uint8Array(totalLen);
  let offset = 0;
  png.set(sig, offset); offset += sig.length;
  png.set(ihdrChunk, offset); offset += ihdrChunk.length;
  png.set(idatChunk, offset); offset += idatChunk.length;
  png.set(iendChunk, offset);

  return png;
}

// Helper to create a valid 2x2 RGBA PNG with transparency
function create2x2RgbaPng(r: number, g: number, b: number, a: number): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  const ihdrData = [
    0x00, 0x00, 0x00, 0x02,
    0x00, 0x00, 0x00, 0x02,
    0x08,
    0x06, // colorType = 6 (RGBA)
    0x00, 0x00, 0x00
  ];
  const ihdrChunk = makeChunk('IHDR', new Uint8Array(ihdrData));

  const rawScanlines = new Uint8Array([
    0, r, g, b, a, r, g, b, a,
    0, r, g, b, a, r, g, b, a
  ]);
  const compressed = pako.deflate(rawScanlines);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', new Uint8Array(0));

  const totalLen = sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const png = new Uint8Array(totalLen);
  let offset = 0;
  png.set(sig, offset); offset += sig.length;
  png.set(ihdrChunk, offset); offset += ihdrChunk.length;
  png.set(idatChunk, offset); offset += idatChunk.length;
  png.set(iendChunk, offset);

  return png;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const len = data.length;
  const chunk = new Uint8Array(4 + 4 + len + 4);
  chunk[0] = (len >>> 24) & 0xff;
  chunk[1] = (len >>> 16) & 0xff;
  chunk[2] = (len >>> 8) & 0xff;
  chunk[3] = len & 0xff;

  chunk[4] = type.charCodeAt(0);
  chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2);
  chunk[7] = type.charCodeAt(3);

  chunk.set(data, 8);

  // CRC dummy
  return chunk;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

describe('Modified Image Export & Canonical Image Reconstruction', () => {
  it('ImageDecoder correctly decodes 2x2 RGB PNG into raw 12-byte RGB pixel buffer', () => {
    const pngBytes = create2x2RgbPng(255, 128, 64);
    const dataUrl = `data:image/png;base64,${uint8ToBase64(pngBytes)}`;

    const decoded = ImageDecoder.decode(dataUrl);
    expect(decoded).not.toBeNull();
    expect(decoded!.width).toBe(2);
    expect(decoded!.height).toBe(2);
    expect(decoded!.colorSpace).toBe('DeviceRGB');
    expect(decoded!.bitsPerComponent).toBe(8);
    expect(decoded!.hasTransparency).toBe(false);

    // Expected 2x2 pixels = 4 pixels * 3 channels = 12 bytes
    expect(decoded!.rgbData.length).toBe(12);
    expect(decoded!.rgbData[0]).toBe(255);
    expect(decoded!.rgbData[1]).toBe(128);
    expect(decoded!.rgbData[2]).toBe(64);
  });

  it('ImageDecoder correctly decodes 2x2 RGBA PNG and extracts /SMask alpha channel', () => {
    const pngBytes = create2x2RgbaPng(10, 20, 30, 128);
    const dataUrl = `data:image/png;base64,${uint8ToBase64(pngBytes)}`;

    const decoded = ImageDecoder.decode(dataUrl);
    expect(decoded).not.toBeNull();
    expect(decoded!.width).toBe(2);
    expect(decoded!.height).toBe(2);
    expect(decoded!.hasTransparency).toBe(true);
    expect(decoded!.rgbData.length).toBe(12);
    expect(decoded!.alphaData).toBeDefined();
    expect(decoded!.alphaData!.length).toBe(4);
    expect(decoded!.alphaData![0]).toBe(128);
  });

  it('ContentStreamReconstructor creates valid PDF Image XObject without corrupting PNG into DeviceRGB', () => {
    const pngBytes = create2x2RgbPng(200, 100, 50);
    const dataUrl = `data:image/png;base64,${uint8ToBase64(pngBytes)}`;

    const imgObj: ImageObject = {
      id: 'img_test_1',
      type: 'image',
      origin: 'user_created',
      pageIndex: 0,
      pdfBounds: { x: 100, y: 200, width: 150, height: 100 },
      matrix: [1, 0, 0, 1, 100, 200],
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      visible: true,
      locked: false,
      src: dataUrl,
      width: 150,
      height: 100,
      naturalWidth: 2,
      naturalHeight: 2,
      mimeType: 'image/png',
      isModified: true,
    };

    const reconstructor = new ContentStreamReconstructor();
    const doc: DocumentModel = {
      id: 'doc1',
      title: 'test.pdf',
      version: '1.7',
      pages: [
        {
          pageIndex: 0,
          width: 612,
          height: 792,
          mediaBox: [0, 0, 612, 792],
          rotation: 0,
          objects: [imgObj],
          rawContentStreamIndices: [],
          unhandledOperatorsCount: 0,
        },
      ],
      fonts: new Map(),
      isDirty: true,
      activePageIndex: 0,
    };

    const result = reconstructor.reconstructPageStream(doc.pages[0], doc);
    expect(result.newResources.xobjects.size).toBe(1);

    const xobj = Array.from(result.newResources.xobjects.values())[0];
    expect(xobj.dict.get('Type')?.toString()).toBe('/XObject');
    expect(xobj.dict.get('Subtype')?.toString()).toBe('/Image');
    expect(xobj.dict.get('Width')).toBe(2);
    expect(xobj.dict.get('Height')).toBe(2);
    expect(xobj.dict.get('ColorSpace')?.toString()).toBe('/DeviceRGB');
    expect(xobj.dict.get('BitsPerComponent')).toBe(8);

    // Decompressing the stream MUST yield exactly 12 raw RGB bytes, NOT the PNG header!
    const uncompressedData = pako.inflate(xobj.data);
    expect(uncompressedData.length).toBe(12);
    expect(uncompressedData[0]).toBe(200);
    expect(uncompressedData[1]).toBe(100);
    expect(uncompressedData[2]).toBe(50);
  });

  it('PdfWriter exports a complete, valid PDF containing moved and rotated image', () => {
    const pngBytes = create2x2RgbaPng(50, 150, 250, 200);
    const dataUrl = `data:image/png;base64,${uint8ToBase64(pngBytes)}`;

    const movedImg: ImageObject = {
      id: 'img_moved',
      type: 'image',
      origin: 'user_created',
      pageIndex: 0,
      pdfBounds: { x: 250, y: 400, width: 80, height: 60 },
      matrix: [1, 0, 0, 1, 250, 400],
      rotation: 45,
      zIndex: 1,
      opacity: 1,
      visible: true,
      locked: false,
      src: dataUrl,
      width: 80,
      height: 60,
      naturalWidth: 2,
      naturalHeight: 2,
      mimeType: 'image/png',
      isModified: true,
    };

    const doc: DocumentModel = {
      id: 'doc_img_export',
      title: 'img_test.pdf',
      version: '1.7',
      pages: [
        {
          pageIndex: 0,
          width: 612,
          height: 792,
          mediaBox: [0, 0, 612, 792],
          rotation: 0,
          objects: [movedImg],
          rawContentStreamIndices: [],
          unhandledOperatorsCount: 0,
        },
      ],
      fonts: new Map(),
      isDirty: true,
      activePageIndex: 0,
    };

    const writer = new PdfWriter();
    const pdfBytes = writer.exportDocument(doc);

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(500);

    const pdfStr = new TextDecoder().decode(pdfBytes);
    expect(pdfStr).toContain('%PDF-1.7');
    expect(pdfStr).toContain('/Subtype /Image');
    expect(pdfStr).toContain('/ColorSpace /DeviceRGB');
    expect(pdfStr).toContain('/SMask');
  });

  it('Roundtrip: Loads an exported PDF with an image, moves the image, and re-exports accurately', async () => {
    const pngBytes = create2x2RgbPng(12, 34, 56);
    const dataUrl = `data:image/png;base64,${uint8ToBase64(pngBytes)}`;

    const initialImg: ImageObject = {
      id: 'img_initial',
      type: 'image',
      origin: 'user_created',
      pageIndex: 0,
      pdfBounds: { x: 50, y: 100, width: 200, height: 150 },
      matrix: [1, 0, 0, 1, 50, 100],
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      visible: true,
      locked: false,
      src: dataUrl,
      width: 200,
      height: 150,
      naturalWidth: 2,
      naturalHeight: 2,
      mimeType: 'image/png',
      isModified: true,
    };

    const doc: DocumentModel = {
      id: 'doc_roundtrip_1',
      title: 'roundtrip.pdf',
      version: '1.7',
      pages: [
        {
          pageIndex: 0,
          width: 612,
          height: 792,
          mediaBox: [0, 0, 612, 792],
          rotation: 0,
          objects: [initialImg],
          rawContentStreamIndices: [],
          unhandledOperatorsCount: 0,
        },
      ],
      fonts: new Map(),
      isDirty: true,
      activePageIndex: 0,
    };

    const writer1 = new PdfWriter();
    const pdf1Bytes = writer1.exportDocument(doc);
    expect(pdf1Bytes.length).toBeGreaterThan(500);

    // Load PDF back with DocumentModelManager
    const { doc: loadedDoc } = await DocumentModelManager.loadPdfFromBuffer(pdf1Bytes.buffer as ArrayBuffer, 'roundtrip.pdf');
    expect(loadedDoc.pages.length).toBe(1);
    
    // Find the image in loaded page
    const foundImg = loadedDoc.pages[0].objects.find((o) => o.type === 'image') as ImageObject;
    expect(foundImg).toBeDefined();
    expect(foundImg.origin).toBe('pdf_source');
    expect(foundImg.pdfBounds.x).toBeCloseTo(50, 1);
    expect(foundImg.pdfBounds.y).toBeCloseTo(100, 1);

    // Move the image by (+100, +200)
    foundImg.pdfBounds.x += 100;
    foundImg.pdfBounds.y += 200;
    foundImg.matrix[4] += 100;
    foundImg.matrix[5] += 200;
    foundImg.isModified = true;

    // Re-export modified PDF
    const writer2 = new PdfWriter(loadedDoc.sourcePdf);
    const pdf2Bytes = writer2.exportDocument(loadedDoc);
    expect(pdf2Bytes.length).toBeGreaterThan(500);

    // Verify content of re-exported PDF
    const pdf2Str = new TextDecoder().decode(pdf2Bytes);
    expect(pdf2Str).toContain('%PDF-1.7');
    expect(pdf2Str).toContain('/Subtype /Image');

    // Parse the re-exported PDF again to verify new coordinates
    const { doc: reloadedDoc } = await DocumentModelManager.loadPdfFromBuffer(pdf2Bytes.buffer as ArrayBuffer, 'roundtrip2.pdf');
    const movedReloadedImg = reloadedDoc.pages[0].objects.find((o) => o.type === 'image') as ImageObject;
    expect(movedReloadedImg).toBeDefined();
    expect(movedReloadedImg.pdfBounds.x).toBeCloseTo(150, 1);
    expect(movedReloadedImg.pdfBounds.y).toBeCloseTo(300, 1);
  });
});
