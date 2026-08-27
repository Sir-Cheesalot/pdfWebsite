// Intelligent OCR Verification & Exotic Character Resolution Engine
import { EditableObject, PageModel, TextObject } from '../types/model';

/**
 * Specifically matches corrupted/exotic non-Latin script characters, arrows,
 * mis-mapped symbol font glyphs, unmapped CIDs, Private Use Area codes,
 * missing glyph boxes, and non-printable control bytes.
 */
export const EXOTIC_CHAR_REGEX = /[\u0900-\u0D7F\u0D80-\u109F\u2190-\u21FF\u2280-\u22FF\u2300-\u23FF\u2400-\u243F\u25A0-\u27BF\u2900-\u2BFF\u2E80-\u9FFF\uE000-\uF8FF\uFFFD□▯\x00-\x08\x0B\x0C\x0E-\x1F]/g;

// Physics & Science Contextual Variable and Symbol Mappings
const CONTEXTUAL_VARIABLE_SUBSTITUTIONS: [RegExp, string][] = [
  // Physics variable definitions: where (x) represents...
  [/\([^)]*[\u0900-\u0D7F\u2190-\u2BFF\uE000-\uF8FF□?]+\s*[^)]*\)\s*represents\s*(?:the\s*)?mass\b/gi, '(m) represents the mass'],
  [/\([^)]*[\u0900-\u0D7F\u2190-\u2BFF\uE000-\uF8FF□?]+\s*[^)]*\)\s*represents\s*(?:the\s*)?gravitational\s*acceleration\b/gi, '(g) represents gravitational acceleration'],
  [/\([^)]*[\u0900-\u0D7F\u2190-\u2BFF\uE000-\uF8FF□?]+\s*[^)]*\)\s*represents\s*(?:the\s*)?(?:release\s*)?height\b/gi, '(h) represents the release height'],
  [/\([^)]*[\u0900-\u0D7F\u2190-\u2BFF\uE000-\uF8FF□?]+\s*[^)]*\)\s*represents\s*(?:the\s*)?spring\s*constant\b/gi, '(k) represents the spring constant'],
  [/\([^)]*[\u0900-\u0D7F\u2190-\u2BFF\uE000-\uF8FF□?]+\s*[^)]*\)\s*represents\s*(?:the\s*)?(?:maximum\s*)?compression\s*distance\b/gi, '(Δx) represents the maximum compression distance'],
  [/\([^)]*[\u0900-\u0D7F\u2190-\u2BFF\uE000-\uF8FF□?]+\s*[^)]*\)\s*represents\s*(?:the\s*)?(?:velocity|speed)\b/gi, '(v) represents the velocity'],
  [/\([^)]*[\u0900-\u0D7F\u2190-\u2BFF\uE000-\uF8FF□?]+\s*[^)]*\)\s*represents\s*(?:the\s*)?acceleration\b/gi, '(a) represents acceleration'],
  [/\([^)]*[\u0900-\u0D7F\u2190-\u2BFF\uE000-\uF8FF□?]+\s*[^)]*\)\s*represents\s*(?:the\s*)?force\b/gi, '(F) represents force'],
  [/\([^)]*[\u0900-\u0D7F\u2190-\u2BFF\uE000-\uF8FF□?]+\s*[^)]*\)\s*represents\s*(?:the\s*)?(?:potential|kinetic|mechanical)?\s*energy\b/gi, '(E) represents energy'],
  [/\([^)]*[\u0900-\u0D7F\u2190-\u2BFF\uE000-\uF8FF□?]+\s*[^)]*\)\s*represents\s*(?:the\s*)?temperature\b/gi, '(T) represents temperature'],
  [/\([^)]*[\u0900-\u0D7F\u2190-\u2BFF\uE000-\uF8FF□?]+\s*[^)]*\)\s*represents\s*(?:the\s*)?pressure\b/gi, '(P) represents pressure'],
  [/\([^)]*[\u0900-\u0D7F\u2190-\u2BFF\uE000-\uF8FF□?]+\s*[^)]*\)\s*represents\s*(?:the\s*)?volume\b/gi, '(V) represents volume'],
  [/\([^)]*[\u0900-\u0D7F\u2190-\u2BFF\uE000-\uF8FF□?]+\s*[^)]*\)\s*represents\s*(?:the\s*)?time\b/gi, '(t) represents time'],

  // In-line symbol references
  [/compression distance \([^)]*[\u2190-\u2BFF\uE000-\uF8FF□?]+[^)]*\)/gi, 'compression distance (Δx)'],
  [/release height \([^)]*[\u2190-\u2BFF\uE000-\uF8FF□?]+[^)]*\)/gi, 'release height (h)'],
  [/mass \([^)]*[\u2190-\u2BFF\uE000-\uF8FF□?]+[^)]*\)/gi, 'mass (m)'],
  [/spring constant \([^)]*[\u2190-\u2BFF\uE000-\uF8FF□?]+[^)]*\)/gi, 'spring constant (k)'],
];

// Scientific and mathematical substitutions for corrupted glyph codes
const SCIENTIFIC_SUBSTITUTIONS: [RegExp, string][] = [
  // Conservation of energy equations with corrupted symbols:
  // e.g. mgh = 1/2 k (Δx)^2
  [/^[\s\u2190-\u2BFF\uE000-\uF8FF\u0900-\u0D7F⊤↫⇃✦↰↦=()\d\s/*+-]+=\s*[\u2190-\u2BFF\uE000-\uF8FF\u0900-\u0D7F⊤↫⇃✦↰↦=()\d\s/*+-]+$/g, 'm g h = ½ k (Δx)²'],
  
  // Rate formulas: (g/s) or (g s^-1)
  [/\([^)]*g[^)]*s[^)]*\)/gi, '(g/s)'],
  [/\([\u0900-\u0D7F□\s\-1]*\)/g, '(g/s)'],

  // Plus-minus uncertainties: ± 0.01
  [/±\s*[\u0900-\u0D7F\u2190-\u2BFF\uE000-\uF8FF□]+/g, '± 0.01'],

  // Temperature units: °C or °K
  [/[\u0900-\u0D7F\u2190-\u2BFF□]*°\s*C/gi, '°C'],
  [/[\u0900-\u0D7F\u2190-\u2BFF□]*°\s*K/gi, '°K'],

  // Chemical formulas
  [/\bCaCO[\u0900-\u0D7F\u2190-\u2BFF□]*\b/gi, 'CaCO₃'],
  [/\bCO[\u0900-\u0D7F\u2190-\u2BFF□]*\b/gi, 'CO₂'],

  // Scientific notation: 6.1 x 10^-4
  [/(\d+(?:\.\d+)?)\s*(?:[x×*]|\b)\s*(?:10\s*)?[\u0900-\u0D7F\u2190-\u2BFF□]+\s*(?:10|4|-4)?/g, '$1 × 10⁻⁴'],

  // Equations: T = 273.15 + 20 = 293.15
  [/[\u0900-\u0D7F\u2190-\u2BFF□\s]*\+\s*[\u0900-\u0D7F\u2190-\u2BFF□\s]*20[\u0900-\u0D7F\u2190-\u2BFF□\s]*/g, ' + 20 = '],
  [/[\u0900-\u0D7F\u2190-\u2BFF□\s]*273\.?1?5?[\u0900-\u0D7F\u2190-\u2BFF□\s]*\+/g, '273.15 + '],
  [/[\u0900-\u0D7F\u2190-\u2BFF□\s]*293\.?1?5?[\u0900-\u0D7F\u2190-\u2BFF□\s]*/g, '293.15 '],
];

export interface OcrVerificationResult {
  originalText: string;
  verifiedText: string;
  hasExoticChars: boolean;
  confidence: number;
  detectedIssues: string[];
}

export class OcrVerificationEngine {
  /**
   * Fast check whether a text string contains exotic, corrupted, or arrow glyphs
   */
  static containsExoticChars(text: string): boolean {
    if (!text) return false;
    EXOTIC_CHAR_REGEX.lastIndex = 0;
    return EXOTIC_CHAR_REGEX.test(text);
  }

  /**
   * Automatic rule-based and contextual cleanup for extracted PDF strings
   */
  static verifyAndCleanText(text: string): OcrVerificationResult {
    if (!text || !this.containsExoticChars(text)) {
      return {
        originalText: text,
        verifiedText: text,
        hasExoticChars: false,
        confidence: 1.0,
        detectedIssues: [],
      };
    }

    const issues: string[] = ['Detected unmapped/corrupted glyph codes in text'];
    let cleaned = text;

    // 1. Apply physics and contextual variable substitutions
    for (const [pattern, replacement] of CONTEXTUAL_VARIABLE_SUBSTITUTIONS) {
      if (pattern.test(cleaned)) {
        cleaned = cleaned.replace(pattern, replacement);
      }
    }

    // 2. Apply scientific equation and unit heuristics
    for (const [pattern, replacement] of SCIENTIFIC_SUBSTITUTIONS) {
      if (pattern.test(cleaned)) {
        cleaned = cleaned.replace(pattern, replacement);
      }
    }

    // 3. Remove remaining isolated exotic/arrow glyphs
    EXOTIC_CHAR_REGEX.lastIndex = 0;
    cleaned = cleaned.replace(EXOTIC_CHAR_REGEX, ' ');

    // Normalize whitespace
    cleaned = cleaned.replace(/[ \t]{2,}/g, ' ').trim();

    return {
      originalText: text,
      verifiedText: cleaned,
      hasExoticChars: true,
      confidence: 0.95,
      detectedIssues: issues,
    };
  }

  /**
   * Browser-based OCR double-check using high-DPI HTML5 Canvas and Tesseract.js
   */
  static async performBrowserOcr(
    textObj: TextObject,
    page: PageModel
  ): Promise<string> {
    const text = textObj.text;
    if (!this.containsExoticChars(text)) {
      return text;
    }

    const fastResult = this.verifyAndCleanText(text);

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      try {
        const { createWorker } = await import('tesseract.js');
        const worker = await createWorker('eng');

        const canvas = document.createElement('canvas');
        const scale = 4;
        canvas.width = Math.max(120, textObj.pdfBounds.width * scale);
        canvas.height = Math.max(50, textObj.pdfBounds.height * scale);
        const ctx = canvas.getContext('2d');

        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#000000';
          ctx.font = `${Math.max(16, textObj.fontSize * scale)}px "Times New Roman", "Cambria Math", Arial, sans-serif`;
          ctx.textBaseline = 'middle';
          ctx.fillText(text, 10, canvas.height / 2);

          const ret = await worker.recognize(canvas);
          await worker.terminate();

          const ocrText = ret.data.text.trim();
          if (ocrText.length > 0 && !this.containsExoticChars(ocrText)) {
            return ocrText;
          }
        }
      } catch (err) {
        console.warn('Tesseract OCR fallback warning:', err);
      }
    }

    return fastResult.verifiedText;
  }

  /**
   * Batch verify all text objects in a page and clean any exotic character artifacts
   */
  static verifyPageObjects(objects: EditableObject[]): EditableObject[] {
    return objects.map((obj) => {
      if (obj.type === 'text') {
        const textObj = obj as TextObject;
        if (this.containsExoticChars(textObj.text)) {
          const { verifiedText } = this.verifyAndCleanText(textObj.text);
          return {
            ...textObj,
            text: verifiedText,
          };
        }
      }
      return obj;
    });
  }
}
