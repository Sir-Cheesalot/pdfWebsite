// Full Page OCR Reconciler using Tesseract.js & Canvas Rendering
import { PageModel, TextObject, Rect } from '../types/model';
import { CoordinateSystem } from '../coords/CoordinateSystem';
import { OcrVerificationEngine } from './OcrVerificationEngine';

export interface OcrReconcileStats {
  totalObjectsChecked: number;
  replacedCount: number;
  improvedConfidenceAvg: number;
  modifications: { objectId: string; oldText: string; newText: string; reason: string }[];
}

export class FullPageOcrReconciler {
  /**
   * Calculate string similarity between 0.0 (completely different) and 1.0 (identical)
   */
  static computeSimilarity(s1: string, s2: string): number {
    const str1 = s1.trim().toLowerCase();
    const str2 = s2.trim().toLowerCase();
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0.0;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    const longerLen = longer.length;
    if (longerLen === 0) return 1.0;

    // Levenshtein distance
    const costs: number[] = [];
    for (let i = 0; i <= str1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= str2.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          let newValue = costs[j - 1];
          if (str1.charAt(i - 1) !== str2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[str2.length] = lastValue;
    }

    const editDistance = costs[str2.length];
    return (longerLen - editDistance) / longerLen;
  }

  /**
   * Reconcile an entire page's text objects by running high-resolution Tesseract OCR
   */
  static async reconcilePage(
    page: PageModel,
    onProgress?: (msg: string, pct: number) => void
  ): Promise<{ updatedPage: PageModel; stats: OcrReconcileStats }> {
    const stats: OcrReconcileStats = {
      totalObjectsChecked: 0,
      replacedCount: 0,
      improvedConfidenceAvg: 0,
      modifications: [],
    };

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { updatedPage: page, stats };
    }

    const textObjects = page.objects.filter((o) => o.type === 'text') as TextObject[];
    if (textObjects.length === 0) {
      return { updatedPage: page, stats };
    }

    onProgress?.('Initializing Tesseract OCR Worker...', 10);

    let createWorker: any;
    try {
      const tesseractModule = await import('tesseract.js');
      createWorker = tesseractModule.createWorker;
    } catch (err) {
      console.error('Failed to load tesseract.js:', err);
      return { updatedPage: page, stats };
    }

    const worker = await createWorker('eng');
    onProgress?.('Rendering page canvas for OCR analysis...', 30);

    // Render text objects onto a high-DPI canvas for OCR
    const scale = 3;
    const canvasW = Math.round(page.width * scale);
    const canvasH = Math.round(page.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      await worker.terminate();
      return { updatedPage: page, stats };
    }

    // Fill background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Draw all text objects in standard fonts
    for (const obj of textObjects) {
      const screenRect = CoordinateSystem.pdfRectToScreenRect(obj.pdfBounds, page, scale);
      ctx.fillStyle = '#000000';
      const fontName = obj.fontName.includes('Times') ? 'Times New Roman' : 'Arial';
      ctx.font = `${Math.round(obj.fontSize * scale)}px ${fontName}, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(obj.text, screenRect.x, screenRect.y);
    }

    onProgress?.('Running OCR recognition on full page...', 50);

    const ret = await worker.recognize(canvas);
    const ocrLines = ret.data.lines || [];
    const ocrBlocks = ret.data.blocks || [];

    onProgress?.('Comparing extracted text with OCR output...', 80);

    // Flatten OCR lines with their bounding boxes in PDF space
    const ocrEntries: { text: string; pdfBounds: Rect; confidence: number }[] = [];
    for (const line of ocrLines) {
      const bbox = line.bbox;
      const p1 = CoordinateSystem.screenToPdfPoint({ x: bbox.x0, y: bbox.y0 }, page, scale);
      const p2 = CoordinateSystem.screenToPdfPoint({ x: bbox.x1, y: bbox.y1 }, page, scale);

      const pdfX = Math.min(p1.x, p2.x);
      const pdfY = Math.min(p1.y, p2.y);
      const pdfW = Math.abs(p2.x - p1.x);
      const pdfH = Math.abs(p2.y - p1.y);

      ocrEntries.push({
        text: line.text.trim(),
        pdfBounds: { x: pdfX, y: pdfY, width: pdfW, height: pdfH },
        confidence: line.confidence,
      });
    }

    // Check each text object against OCR entries and clean up significant mismatches
    const updatedObjects = page.objects.map((obj) => {
      if (obj.type !== 'text') return obj;
      const textObj = obj as TextObject;
      stats.totalObjectsChecked++;

      // Check if text already has exotic characters
      const hasExotic = OcrVerificationEngine.containsExoticChars(textObj.text);

      // Find best matching OCR entry by vertical overlap
      let bestOcr: { text: string; confidence: number; similarity: number } | null = null;
      let maxOverlap = 0;

      for (const entry of ocrEntries) {
        // Check vertical overlap
        const yTop1 = textObj.pdfBounds.y + textObj.pdfBounds.height;
        const yBottom1 = textObj.pdfBounds.y;
        const yTop2 = entry.pdfBounds.y + entry.pdfBounds.height;
        const yBottom2 = entry.pdfBounds.y;

        const overlapY = Math.max(0, Math.min(yTop1, yTop2) - Math.max(yBottom1, yBottom2));
        if (overlapY > 0) {
          const sim = this.computeSimilarity(textObj.text, entry.text);
          if (overlapY > maxOverlap) {
            maxOverlap = overlapY;
            bestOcr = { text: entry.text, confidence: entry.confidence, similarity: sim };
          }
        }
      }

      // If text contains corrupted exotic characters OR if there is a significant mismatch (< 65% similarity)
      // and OCR has reasonable confidence:
      if (hasExotic) {
        const cleaned = OcrVerificationEngine.verifyAndCleanText(textObj.text).verifiedText;
        if (bestOcr && bestOcr.text.length > 0 && bestOcr.confidence > 60 && !OcrVerificationEngine.containsExoticChars(bestOcr.text)) {
          stats.replacedCount++;
          stats.modifications.push({
            objectId: textObj.id,
            oldText: textObj.text,
            newText: bestOcr.text,
            reason: 'Replaced exotic/corrupted glyphs with OCR recognized text',
          });
          return {
            ...textObj,
            text: bestOcr.text,
          };
        } else if (cleaned !== textObj.text) {
          stats.replacedCount++;
          stats.modifications.push({
            objectId: textObj.id,
            oldText: textObj.text,
            newText: cleaned,
            reason: 'Sanitized corrupted characters to clean standard keyboard text',
          });
          return {
            ...textObj,
            text: cleaned,
          };
        }
      } else if (bestOcr && bestOcr.confidence > 80 && bestOcr.similarity < 0.5 && bestOcr.text.length > 0) {
        // Significant mismatch with high-confidence OCR
        stats.replacedCount++;
        stats.modifications.push({
          objectId: textObj.id,
          oldText: textObj.text,
          newText: bestOcr.text,
          reason: `Resolved significant mismatch (similarity: ${Math.round(bestOcr.similarity * 100)}%, OCR confidence: ${Math.round(bestOcr.confidence)}%)`,
        });
        return {
          ...textObj,
          text: bestOcr.text,
        };
      }

      return textObj;
    });

    await worker.terminate();
    onProgress?.('OCR reconciliation complete!', 100);

    return {
      updatedPage: {
        ...page,
        objects: updatedObjects,
      },
      stats,
    };
  }
}
