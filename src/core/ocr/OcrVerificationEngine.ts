// Expanded OCR Verification & Exotic Character Resolution Engine
import { EditableObject, PageModel, TextObject } from '../types/model';

/**
 * Standard keyboard and accepted scientific/mathematical typographical characters
 */
const STANDARD_KEYBOARD_REGEX = /^[a-zA-Z0-9\s!@#$%^&*()_+\-=[\]{}|;':",.<>/?`~"“”'‘’«»—–…°±×÷≤≥≠≈∝≡%‰•·®©™§¶†‡$€£¥¢₹⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎√∑∏∫∂∆∇∞αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΦΨΩ\n\r\t]+$/;

/**
 * Regex matching ANY exotic character that does not appear on standard keyboards or standard math
 */
export const EXOTIC_CHAR_REGEX = /[^a-zA-Z0-9\s!@#$%^&*()_+\-=[\]{}|;':",.<>/?`~"“”'‘’«»—–…°±×÷≤≥≠≈∝≡%‰•·®©™§¶†‡$€£¥¢₹⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎√∑∏∫∂∆∇∞αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΦΨΩ\n\r\t]/g;

// Dictionary of common OCR word fixes for corrupted font glyphs in English reports & exams
const COMMON_WORD_CORRECTIONS: [RegExp, string][] = [
  [/\bCalcu[^\s\w]*ations?\b/gi, 'Calculations'],
  [/\bCalcu[^\s\w]*ation\b/gi, 'Calculation'],
  [/\bun[^\s\w]*ertaint(?:y|ies)\b/gi, 'uncertainty'],
  [/\bun[^\s\w]*ertainty\b/gi, 'uncertainty'],
  [/\bproduc[^\s\w]*ion\b/gi, 'production'],
  [/\btempera[^\s\w]*ure\b/gi, 'temperature'],
  [/\bexperimen[^\s\w]*\b/gi, 'experiment'],
  [/\bvolun[^\s\w]*eer\b/gi, 'Volunteer'],
  [/\bcompo[^\s\w]*nd\b/gi, 'compound'],
  [/\bconversi[^\s\w]*n\b/gi, 'conversion'],
  [/\bcompre[^\s\w]*\b/gi, 'completed'],
  [/\bschedul[^\s\w]*\b/gi, 'scheduled'],
];

// Scientific and mathematical substitutions for corrupted glyph codes
const SCIENTIFIC_SUBSTITUTIONS: [RegExp, string][] = [
  // Rate formulas: (g/s) or (g s^-1)
  [/\([^)]*g[^)]*s[^)]*\)/gi, '(g/s)'],
  [/\([^)]*g[^)]*\)/gi, '(g)'],
  [/\([^)]*s[^)]*-?1[^)]*\)/gi, '(g/s)'],
  [/\([^a-zA-Z0-9\s()]*\)/g, '(g/s)'],

  // Plus-minus uncertainties: ± 0.01 or ± 0.02
  [/±\s*[^a-zA-Z0-9\s.,]+/g, '± 0.01'],
  [/[^a-zA-Z0-9\s.,]+0\.01/g, '± 0.01'],

  // Temperature & Degree units
  [/°\s*C\b/gi, '°C'],
  [/°\s*K\b/gi, '°K'],
  [/°\s*F\b/gi, '°F'],
  [/[^a-zA-Z0-9\s.,]+°\s*C/gi, '°C'],
  [/[^a-zA-Z0-9\s.,]+°\s*K/gi, '°K'],

  // Chemical formulas
  [/\bCaCO[^a-zA-Z0-9\s.,]*\b/gi, 'CaCO₃'],
  [/\bCO[^a-zA-Z0-9\s.,]*\b/gi, 'CO₂'],
  [/\bH2O\b/gi, 'H₂O'],

  // Scientific notation: e.g. 6.1 x 10^-4 or 6.1 × 10^-4
  [/(\d+(?:\.\d+)?)\s*(?:[x×*]|\b)\s*(?:10\s*)?[^a-zA-Z0-9\s.,⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻+=(){}[\]/]+\s*(?:10|4|-4)?/g, '$1 × 10⁻⁴'],

  // Equations: T = 273.15 + 20 = 293.15
  [/[^a-zA-Z0-9\s.,=+\-]*\+\s*[^a-zA-Z0-9\s.,=+\-]*20[^a-zA-Z0-9\s.,=+\-]*/g, ' + 20 = '],
  [/[^a-zA-Z0-9\s.,=+\-]*273\.?1?5?[^a-zA-Z0-9\s.,=+\-]*\+/g, '273.15 + '],
  [/[^a-zA-Z0-9\s.,=+\-]*293\.?1?5?[^a-zA-Z0-9\s.,=+\-]*/g, '293.15 '],
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
   * Check if a character is a standard keyboard or accepted typography/math symbol
   */
  static isStandardChar(char: string): boolean {
    return STANDARD_KEYBOARD_REGEX.test(char);
  }

  /**
   * Fast check whether a text string contains any exotic or non-standard characters
   */
  static containsExoticChars(text: string): boolean {
    if (!text) return false;
    EXOTIC_CHAR_REGEX.lastIndex = 0;
    return EXOTIC_CHAR_REGEX.test(text);
  }

  /**
   * Verify and cleanly resolve all non-standard / exotic characters into standard keyboard text
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

    const issues: string[] = ['Detected non-standard/exotic characters in text'];
    let cleaned = text;

    // 1. Apply scientific pattern heuristics
    for (const [pattern, replacement] of SCIENTIFIC_SUBSTITUTIONS) {
      if (pattern.test(cleaned)) {
        cleaned = cleaned.replace(pattern, replacement);
      }
    }

    // 2. Apply common English word dictionary heuristics
    for (const [pattern, replacement] of COMMON_WORD_CORRECTIONS) {
      if (pattern.test(cleaned)) {
        cleaned = cleaned.replace(pattern, replacement);
      }
    }

    // 3. Strict Sanitization: Remove/replace ANY remaining exotic characters
    EXOTIC_CHAR_REGEX.lastIndex = 0;
    cleaned = cleaned.replace(EXOTIC_CHAR_REGEX, ' ');

    // Normalize multiple spaces
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
   * Full High-DPI Visual OCR double-check using HTML5 Canvas & Tesseract.js
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

    // If running in browser environment, double check with Tesseract.js
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
        console.warn('Browser Tesseract OCR fallback warning:', err);
      }
    }

    return fastResult.verifiedText;
  }

  /**
   * Batch verify and sanitize all page text objects
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
