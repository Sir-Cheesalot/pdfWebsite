import { getDocument, GlobalWorkerOptions, OPS } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export interface OperatorTextLine {
  id: string;
  x: number;
  y: number;
  fontSize: number;
  text: string;
  operatorIndexes: number[];
  segments: OperatorTextSegment[];
  /** Mutates the in-memory PDF.js operator arguments for inspection/debugging. */
  applyEdit: (text: string) => number[];
}

export interface OperatorTextSegment {
  operatorIndex: number;
  text: string;
  start: number;
  end: number;
}

function glyphText(args: unknown[]): string {
  const glyphs = Array.isArray(args[0]) ? args[0] : [];
  return glyphs
    .map((glyph) => (glyph && typeof glyph === 'object' && 'unicode' in glyph ? String(glyph.unicode ?? '') : ''))
    .join('');
}

function replaceGlyphText(args: unknown[], nextText: string) {
  const glyphs = Array.isArray(args[0]) ? args[0] : [];
  let charIndex = 0;
  for (const glyph of glyphs) {
    if (glyph && typeof glyph === 'object' && 'unicode' in glyph) {
      // PDF.js uses glyph objects rather than the original PDF string bytes.
      // This is intentionally an in-memory edit record; the incremental writer
      // will apply the same change to the original Tj/TJ instruction on export.
      (glyph as { unicode: string }).unicode = nextText[charIndex++] ?? '';
    }
  }
}

export async function inspectPdfOperatorText(
  source: ArrayBuffer,
  pageNumber: number,
): Promise<OperatorTextLine[]> {
  const task = getDocument({ data: new Uint8Array(source.slice(0)) });
  const pdf = await task.promise;
  const page = await pdf.getPage(pageNumber);
  const operatorList = await page.getOperatorList();
  const textOps = new Set<number>([
    OPS.showText,
    OPS.showSpacedText,
    OPS.nextLineShowText,
    OPS.nextLineSetSpacingShowText,
  ].filter((value): value is number => typeof value === 'number'));

  const lines = new Map<string, Omit<OperatorTextLine, 'applyEdit'>>();
  let matrix: number[] = [1, 0, 0, 1, 0, 0];

  for (let index = 0; index < operatorList.fnArray.length; index++) {
    const op = operatorList.fnArray[index];
    const args = (operatorList.argsArray[index] ?? []) as unknown[];
    if (op === OPS.setTextMatrix && args.length >= 6) {
      matrix = args.slice(0, 6).map(Number);
      continue;
    }
    if (!textOps.has(op)) continue;

    const text = glyphText(args);
    if (!text) continue;
    const [a, b, , , x, y] = matrix;
    const key = `${Math.round(y * 10) / 10}`;
    const existing = lines.get(key) ?? {
      id: `operator_line_${pageNumber}_${key}`,
      x,
      y,
      fontSize: Math.max(1, Math.hypot(a, b)),
      text: '',
      operatorIndexes: [],
      segments: [],
    };
    existing.x = Math.min(existing.x, x);
    const start = existing.text.length;
    existing.text += text;
    existing.operatorIndexes.push(index);
    existing.segments.push({ operatorIndex: index, text, start, end: start + text.length });
    lines.set(key, existing);
  }

  return [...lines.values()].map((line) => ({
    ...line,
    applyEdit(nextText: string) {
      const previousText = line.text;
      let prefixLength = 0;
      while (
        prefixLength < previousText.length &&
        prefixLength < nextText.length &&
        previousText[prefixLength] === nextText[prefixLength]
      ) prefixLength++;

      let suffixLength = 0;
      while (
        suffixLength < previousText.length - prefixLength &&
        suffixLength < nextText.length - prefixLength &&
        previousText[previousText.length - 1 - suffixLength] === nextText[nextText.length - 1 - suffixLength]
      ) suffixLength++;

      const oldEnd = previousText.length - suffixLength;
      const newEnd = nextText.length - suffixLength;
      const changedSegments = line.segments.filter(
        (segment) => segment.start < oldEnd && segment.end > prefixLength,
      );

      // The common case—typing within one PDF text-show operator—changes
      // exactly one operator and preserves every neighbouring instruction.
      if (changedSegments.length === 1) {
        const segment = changedSegments[0];
        const originalSegmentLength = segment.text.length;
        const replacement =
          segment.text.slice(0, prefixLength - segment.start) +
          nextText.slice(prefixLength, newEnd) +
          segment.text.slice(oldEnd - segment.start);
        replaceGlyphText(operatorList.argsArray[segment.operatorIndex] as unknown[], replacement);
        segment.text = replacement;
        segment.end = segment.start + replacement.length;
        const delta = replacement.length - originalSegmentLength;
        for (const following of line.segments) {
          if (following.start > segment.start) {
            following.start += delta;
            following.end += delta;
          }
        }
        line.text = nextText;
        return [segment.operatorIndex];
      }

      // Cross-segment edits are deliberately retained as a multi-segment edit
      // record. The incremental writer must handle their spacing and encoding;
      // we never replace an unrelated operator with the whole line.
      line.text = nextText;
      return changedSegments.map((segment) => segment.operatorIndex);
    },
  }));
}

/** Render the original PDF drawing instructions without translating them into
 * HTML objects. This is the visual source of truth for an untouched page. */
export async function renderOriginalPdfPage(
  source: ArrayBuffer,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
) {
  const task = getDocument({ data: new Uint8Array(source.slice(0)) });
  const pdf = await task.promise;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const outputScale = window.devicePixelRatio || 1;
  canvas.width = Math.ceil(viewport.width * outputScale);
  canvas.height = Math.ceil(viewport.height * outputScale);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable.');
  await (page as any).render({
    canvasContext: context,
    viewport,
    canvas,
    transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
  }).promise;
}
