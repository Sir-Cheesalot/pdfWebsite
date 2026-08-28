// High-Level Document Loader & Model Management
import {
  DocumentModel,
  EditableObject,
  FontDescriptorModel,
  PageModel,
} from '../types/model';
import { PdfArray, PdfDict, PdfRef, PdfStream } from '../types/pdf';
import { ContentStreamParser } from '../pdf/ContentStreamParser';
import { FlateDecoder } from '../pdf/FlateDecoder';
import { FontEngine } from '../pdf/FontEngine';
import { PdfParser } from '../pdf/PdfParser';

export class DocumentModelManager {
  /**
   * Parse a raw PDF ArrayBuffer into an editable DocumentModel
   */
  static async loadPdfFromBuffer(
    buffer: ArrayBuffer,
    fileName: string = 'document.pdf'
  ): Promise<{ doc: DocumentModel; parser: PdfParser }> {
    const uint8 = new Uint8Array(buffer);
    const parser = new PdfParser(uint8);
    const parsedPdf = parser.parse();

    const fontEngine = new FontEngine();
    const streamParser = new ContentStreamParser(parser, fontEngine);

    const pages: PageModel[] = [];
    const fonts = new Map<string, FontDescriptorModel>();

    for (let pageIdx = 0; pageIdx < parsedPdf.pageDicts.length; pageIdx++) {
      const pageDict = parsedPdf.pageDicts[pageIdx];

      // Extract /Contents
      const contentsObj = parser.resolve(pageDict.get('Contents'));
      const streamDataList: { data: Uint8Array; streamIndex: number }[] = [];

      if (contentsObj instanceof PdfStream) {
        const decoded = contentsObj.decodedData || FlateDecoder.decodeStream(contentsObj);
        streamDataList.push({ data: decoded, streamIndex: 0 });
      } else if (Array.isArray(contentsObj)) {
        for (let sIdx = 0; sIdx < contentsObj.length; sIdx++) {
          const item = parser.resolve(contentsObj[sIdx]);
          if (item instanceof PdfStream) {
            const decoded = item.decodedData || FlateDecoder.decodeStream(item);
            streamDataList.push({ data: decoded, streamIndex: sIdx });
          }
        }
      }

      // Interpret content stream into editable objects
      const { page } = streamParser.interpretPage(pageIdx, pageDict, streamDataList);
      // Retain the original bytes and page dict so export can pass through
      // anything unmodified instead of regenerating it from the object model.
      page.sourceStreams = streamDataList;
      page.sourcePageDict = pageDict;
      pages.push(page);
    }

    if (pages.length === 0) {
      // Fallback create blank page if none found
      pages.push(this.createBlankPage(0));
    }

    const doc: DocumentModel = {
      id: `doc_${Date.now()}`,
      title: fileName.replace(/\.pdf$/i, ''),
      version: parsedPdf.version || '1.7',
      pages,
      fonts: fontEngine.getAllFonts(),
      isDirty: false,
      activePageIndex: 0,
      sourcePdf: { objects: parsedPdf.objects, trailer: parsedPdf.trailer },
    };

    return { doc, parser };
  }

  /**
   * Create a new blank DocumentModel with 1 or more pages
   */
  static createBlankDocument(
    title: string = 'Untitled Document',
    numPages: number = 1,
    width: number = 612,
    height: number = 792
  ): DocumentModel {
    const pages: PageModel[] = [];
    for (let i = 0; i < numPages; i++) {
      pages.push(this.createBlankPage(i, width, height));
    }

    return {
      id: `doc_${Date.now()}`,
      title,
      version: '1.7',
      pages,
      fonts: new Map(),
      isDirty: false,
      activePageIndex: 0,
    };
  }

  static createBlankPage(pageIndex: number, width: number = 612, height: number = 792): PageModel {
    return {
      pageIndex,
      width,
      height,
      mediaBox: [0, 0, width, height],
      rotation: 0,
      objects: [],
      rawContentStreamIndices: [],
      unhandledOperatorsCount: 0,
    };
  }
}
