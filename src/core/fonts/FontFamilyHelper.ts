// Font Family Resolution and CSS Typography Helper

export interface FontCategory {
  category: string;
  fonts: { id: string; name: string; css: string }[];
}

export class FontFamilyHelper {
  /**
   * Cleans raw PDF font name (e.g. "ABCDEE+Calibri-Bold" -> "Calibri")
   */
  static getCleanFontName(rawName: string): string {
    if (!rawName) return 'Helvetica';
    // Remove subset prefix: "ABCDEF+"
    let clean = rawName.replace(/^[A-Z]{6}\+/, '');
    // Remove PostScript/MT suffixes
    clean = clean.replace(/,.*$/, '').replace(/-(Bold|Italic|BoldItalic|Regular|Roman|Oblique|BoldOblique|Light|Medium|Black)$/i, '');
    clean = clean.replace(/(MT|PSMT|Pro|BT)$/i, '').trim();
    return clean || rawName;
  }

  /**
   * Returns a rich, accurate CSS font-family stack for any given PDF font name
   */
  static getEffectiveCssFontFamily(fontName: string): string {
    if (!fontName) {
      return '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Helvetica, Arial, sans-serif';
    }

    const clean = this.getCleanFontName(fontName).toLowerCase();
    const raw = fontName.toLowerCase();

    // 1. Math / Symbol Fonts
    if (raw.includes('math') || raw.includes('cambriamath') || raw.includes('stix')) {
      return '"Cambria Math", "STIX Two Math", "Segoe UI Symbol", "DejaVu Math TeX Gyre", serif';
    }
    if (raw.includes('symbol') || raw.includes('zapf') || raw.includes('wingdings')) {
      return 'Symbol, "Segoe UI Symbol", "Apple Symbols", "Zapf Dingbats", serif';
    }

    // 2. Specific Popular Sans-Serif Fonts
    if (clean.includes('calibri') || clean.includes('carlito')) {
      return '"Calibri", "Carlito", "Segoe UI", Candara, "Bitstream Vera Sans", "DejaVu Sans", sans-serif';
    }
    if (clean.includes('arial') || clean.includes('liberation sans')) {
      return '"Arial", "Liberation Sans", "Helvetica Neue", Helvetica, sans-serif';
    }
    if (clean.includes('inter')) {
      return '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    }
    if (clean.includes('roboto')) {
      return '"Roboto", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif';
    }
    if (clean.includes('open sans')) {
      return '"Open Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    }
    if (clean.includes('lato')) {
      return '"Lato", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    }
    if (clean.includes('montserrat')) {
      return '"Montserrat", -apple-system, BlinkMacSystemFont, sans-serif';
    }
    if (clean.includes('verdana') || clean.includes('dejavu sans')) {
      return '"Verdana", "DejaVu Sans", "Bitstream Vera Sans", sans-serif';
    }
    if (clean.includes('trebuchet')) {
      return '"Trebuchet MS", "Lucida Grande", "Lucida Sans Unicode", sans-serif';
    }
    if (clean.includes('tahoma')) {
      return '"Tahoma", "Geneva", sans-serif';
    }
    if (clean.includes('segoe') || clean.includes('sf pro')) {
      return '"Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
    }
    if (clean.includes('helvetica')) {
      return '"Helvetica Neue", Helvetica, "Inter", Arial, sans-serif';
    }

    // 3. Serif Fonts
    if (clean.includes('times') || clean.includes('tinos') || clean.includes('liberation serif')) {
      return '"Times New Roman", "Liberation Serif", "Tinos", Times, serif';
    }
    if (clean.includes('georgia')) {
      return '"Georgia", "Cambria", "Bitstream Charter", serif';
    }
    if (clean.includes('cambria')) {
      return '"Cambria", "Georgia", "Liberation Serif", serif';
    }
    if (clean.includes('garamond') || clean.includes('eb garamond')) {
      return '"Garamond", "EB Garamond", "Baskerville", "Georgia", serif';
    }
    if (clean.includes('baskerville')) {
      return '"Baskerville", "Garamond", "Georgia", serif';
    }
    if (clean.includes('palatino')) {
      return '"Palatino", "Palatino Linotype", "Book Antiqua", Georgia, serif';
    }
    if (clean.includes('playfair')) {
      return '"Playfair Display", Georgia, serif';
    }

    // 4. Monospace Fonts
    if (clean.includes('courier') || clean.includes('liberation mono') || clean.includes('cousine')) {
      return '"Courier New", "Liberation Mono", "Cousine", Courier, monospace';
    }
    if (clean.includes('fira') || clean.includes('fira code')) {
      return '"Fira Code", "Consolas", "Monaco", monospace';
    }
    if (clean.includes('consolas') || clean.includes('monaco') || clean.includes('menlo') || clean.includes('source code')) {
      return '"Consolas", "Monaco", "Menlo", "Source Code Pro", monospace';
    }

    // Fallback: If original font name is specified, include it directly first, followed by system fallbacks
    const escaped = fontName.replace(/["\\]/g, '');
    return `"${escaped}", -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Helvetica, Arial, sans-serif`;
  }

  /**
   * Returns categorized fonts including dynamically detected fonts from the loaded PDF
   */
  static getCategorizedFonts(documentFontNames: string[] = []): FontCategory[] {
    const categories: FontCategory[] = [];

    // 1. Detected Document Fonts
    if (documentFontNames.length > 0) {
      const uniqueDetected = Array.from(new Set(documentFontNames.filter(Boolean)));
      if (uniqueDetected.length > 0) {
        categories.push({
          category: '✨ Detected in Document',
          fonts: uniqueDetected.map((raw) => ({
            id: raw,
            name: `${this.getCleanFontName(raw)} (${raw.replace(/^[A-Z]{6}\+/, '')})`,
            css: this.getEffectiveCssFontFamily(raw),
          })),
        });
      }
    }

    // 2. Standard & Modern Sans-Serif
    categories.push({
      category: 'Sans-Serif (Clean & Modern)',
      fonts: [
        { id: 'Inter', name: 'Inter (Modern UI)', css: this.getEffectiveCssFontFamily('Inter') },
        { id: 'Helvetica', name: 'Helvetica / SF Pro', css: this.getEffectiveCssFontFamily('Helvetica') },
        { id: 'Arial', name: 'Arial', css: this.getEffectiveCssFontFamily('Arial') },
        { id: 'Calibri', name: 'Calibri (Office Standard)', css: this.getEffectiveCssFontFamily('Calibri') },
        { id: 'Roboto', name: 'Roboto', css: this.getEffectiveCssFontFamily('Roboto') },
        { id: 'Open Sans', name: 'Open Sans', css: this.getEffectiveCssFontFamily('Open Sans') },
        { id: 'Lato', name: 'Lato', css: this.getEffectiveCssFontFamily('Lato') },
        { id: 'Montserrat', name: 'Montserrat', css: this.getEffectiveCssFontFamily('Montserrat') },
        { id: 'Segoe UI', name: 'Segoe UI', css: this.getEffectiveCssFontFamily('Segoe UI') },
        { id: 'Verdana', name: 'Verdana', css: this.getEffectiveCssFontFamily('Verdana') },
        { id: 'Trebuchet MS', name: 'Trebuchet MS', css: this.getEffectiveCssFontFamily('Trebuchet MS') },
      ],
    });

    // 3. Elegant Serif
    categories.push({
      category: 'Serif (Editorial & Classic)',
      fonts: [
        { id: 'Times-Roman', name: 'Times New Roman', css: this.getEffectiveCssFontFamily('Times') },
        { id: 'Georgia', name: 'Georgia', css: this.getEffectiveCssFontFamily('Georgia') },
        { id: 'Garamond', name: 'Garamond', css: this.getEffectiveCssFontFamily('Garamond') },
        { id: 'Cambria', name: 'Cambria', css: this.getEffectiveCssFontFamily('Cambria') },
        { id: 'Playfair Display', name: 'Playfair Display', css: this.getEffectiveCssFontFamily('Playfair') },
        { id: 'Palatino', name: 'Palatino', css: this.getEffectiveCssFontFamily('Palatino') },
      ],
    });

    // 4. Monospace (Code & Technical)
    categories.push({
      category: 'Monospace (Code & Data)',
      fonts: [
        { id: 'Fira Code', name: 'Fira Code', css: this.getEffectiveCssFontFamily('Fira Code') },
        { id: 'Consolas', name: 'Consolas', css: this.getEffectiveCssFontFamily('Consolas') },
        { id: 'Courier', name: 'Courier New', css: this.getEffectiveCssFontFamily('Courier') },
      ],
    });

    // 5. Math & Symbols
    categories.push({
      category: 'Math & Technical Symbols',
      fonts: [
        { id: 'Cambria Math', name: 'Cambria Math (Formulas)', css: this.getEffectiveCssFontFamily('Cambria Math') },
        { id: 'Symbol', name: 'Symbol (Greek / Math)', css: this.getEffectiveCssFontFamily('Symbol') },
      ],
    });

    return categories;
  }
}
