// Smart Layout & Downstream Repositioning Engine
import { EditableObject, PageModel } from '../types/model';

export interface RepositionResult {
  modifiedObjects: {
    id: string;
    oldPdfY: number;
    newPdfY: number;
    oldMatrixY: number;
    newMatrixY: number;
    wasModified?: boolean;
  }[];
  deltaHeight: number;
  thresholdY: number;
}

export class SmartLayoutEngine {
  /**
   * Intelligently pushes downstream PDF objects downward when a new element is inserted,
   * resized, or moved between existing content.
   *
   * Note on PDF coordinates: Y = 0 is at the bottom of the page, and Y = pageHeight is at the top.
   * "Below" in visual page terms means a SMALLER Y value in PDF coordinates.
   *
   * @param page The target page model
   * @param insertionThresholdPdfY The vertical PDF Y below which objects should be shifted
   * @param deltaHeight The vertical displacement in PDF points (positive = shift downward on page)
   * @param excludeIds Object IDs to exclude from shifting (e.g. newly inserted object itself)
   */
  static pushDownstreamContent(
    page: PageModel,
    insertionThresholdPdfY: number,
    deltaHeight: number,
    excludeIds: Set<string> = new Set()
  ): RepositionResult {
    const result: RepositionResult = {
      modifiedObjects: [],
      deltaHeight,
      thresholdY: insertionThresholdPdfY,
    };

    for (const obj of page.objects) {
      if (excludeIds.has(obj.id)) continue;

      // Check if this object is located below the insertion point in visual page coordinates
      // (meaning obj.pdfBounds.y < insertionThresholdPdfY or obj top <= threshold)
      const objTopPdfY = obj.pdfBounds.y + obj.pdfBounds.height;
      if (objTopPdfY <= insertionThresholdPdfY || obj.pdfBounds.y < insertionThresholdPdfY) {
        const oldPdfY = obj.pdfBounds.y;
        const newPdfY = Math.max(0, oldPdfY - deltaHeight);
        const oldMatrixY = obj.matrix[5];
        const newMatrixY = oldMatrixY - deltaHeight;
        const wasModified = !!obj.isModified;

        // Apply shift directly to internal object model
        obj.pdfBounds.y = newPdfY;
        obj.matrix[5] = newMatrixY;
        obj.isModified = true;

        // If text, shift individual text runs in sync
        if (obj.type === 'text' && (obj as any).runs) {
          for (const run of (obj as any).runs) {
            if (typeof run.y === 'number') {
              run.y -= deltaHeight;
            }
          }
        }

        result.modifiedObjects.push({
          id: obj.id,
          oldPdfY,
          newPdfY,
          oldMatrixY,
          newMatrixY,
          wasModified,
        });
      }
    }

    return result;
  }

  /**
   * Revert a reposition result (used for undo)
   */
  static revertReposition(page: PageModel, result: RepositionResult): void {
    const map = new Map(result.modifiedObjects.map((m) => [m.id, m]));
    for (const obj of page.objects) {
      const record = map.get(obj.id);
      if (record) {
        obj.pdfBounds.y = record.oldPdfY;
        obj.matrix[5] = record.oldMatrixY;
        obj.isModified = record.wasModified ?? false;

        if (obj.type === 'text' && (obj as any).runs) {
          const delta = record.newPdfY - record.oldPdfY;
          for (const run of (obj as any).runs) {
            if (typeof run.y === 'number') {
              run.y -= delta;
            }
          }
        }
      }
    }
  }

  /**
   * Analyze page vertical sections to detect natural gaps between blocks
   */
  static analyzeVerticalGaps(page: PageModel): { y: number; height: number }[] {
    const sorted = [...page.objects]
      .filter((o) => o.visible)
      .sort((a, b) => (b.pdfBounds.y + b.pdfBounds.height) - (a.pdfBounds.y + a.pdfBounds.height));

    const gaps: { y: number; height: number }[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      const currentBottom = current.pdfBounds.y;
      const nextTop = next.pdfBounds.y + next.pdfBounds.height;
      const gap = currentBottom - nextTop;

      if (gap > 5) {
        gaps.push({ y: currentBottom, height: gap });
      }
    }
    return gaps;
  }
}
