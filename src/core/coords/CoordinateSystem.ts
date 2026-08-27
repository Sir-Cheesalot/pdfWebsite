// Centralized Coordinate Transformation System
import { Point, Rect, Matrix2D, PageModel } from '../types/model';

export class CoordinateSystem {
  /**
   * Identity 2D affine matrix [1, 0, 0, 1, 0, 0]
   */
  static identity(): Matrix2D {
    return [1, 0, 0, 1, 0, 0];
  }

  /**
   * Multiply two 3x3 affine matrices: A x B
   * [ a1 c1 e1 ]   [ a2 c2 e2 ]
   * [ b1 d1 f1 ] x [ b2 d2 f2 ]
   * [ 0  0  1  ]   [ 0  0  1  ]
   */
  static multiply(m1: Matrix2D, m2: Matrix2D): Matrix2D {
    const [a1, b1, c1, d1, e1, f1] = m1;
    const [a2, b2, c2, d2, e2, f2] = m2;

    return [
      a1 * a2 + c1 * b2,
      b1 * a2 + d1 * b2,
      a1 * c2 + c1 * d2,
      b1 * c2 + d1 * d2,
      a1 * e2 + c1 * f2 + e1,
      b1 * e2 + d1 * f2 + f1,
    ];
  }

  /**
   * Invert a 2D affine matrix
   */
  static invert(m: Matrix2D): Matrix2D | null {
    const [a, b, c, d, e, f] = m;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-10) return null;

    const invDet = 1.0 / det;
    return [
      d * invDet,
      -b * invDet,
      -c * invDet,
      a * invDet,
      (c * f - d * e) * invDet,
      (b * e - a * f) * invDet,
    ];
  }

  /**
   * Transform a point (x, y) by an affine matrix
   */
  static transformPoint(p: Point, m: Matrix2D): Point {
    const [a, b, c, d, e, f] = m;
    return {
      x: a * p.x + c * p.y + e,
      y: b * p.x + d * p.y + f,
    };
  }

  /**
   * Convert a PDF point (origin at bottom-left of page)
   * to Screen / Editor coordinates (origin at top-left of page container, in pixels)
   */
  static pdfToScreenPoint(
    p: Point,
    page: PageModel,
    zoom: number = 1.0
  ): Point {
    const cropX = page.cropBox ? page.cropBox[0] : page.mediaBox[0] || 0;
    const cropY = page.cropBox ? page.cropBox[1] : page.mediaBox[1] || 0;
    const pageH = page.height;

    // Standard unrotated conversion
    const relX = p.x - cropX;
    const relY = p.y - cropY;

    // Flip Y axis
    const unrotatedScreenX = relX * zoom;
    const unrotatedScreenY = (pageH - relY) * zoom;

    if (!page.rotation || page.rotation === 0) {
      return { x: unrotatedScreenX, y: unrotatedScreenY };
    }

    // Handle rotation (90, 180, 270)
    const rad = (page.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = (page.width * zoom) / 2;
    const cy = (page.height * zoom) / 2;

    const dx = unrotatedScreenX - cx;
    const dy = unrotatedScreenY - cy;

    return {
      x: cx + (dx * cos - dy * sin),
      y: cy + (dx * sin + dy * cos),
    };
  }

  /**
   * Convert Screen / Editor coordinate back to PDF point
   */
  static screenToPdfPoint(
    p: Point,
    page: PageModel,
    zoom: number = 1.0
  ): Point {
    const cropX = page.cropBox ? page.cropBox[0] : page.mediaBox[0] || 0;
    const cropY = page.cropBox ? page.cropBox[1] : page.mediaBox[1] || 0;
    const pageH = page.height;

    let sx = p.x;
    let sy = p.y;

    if (page.rotation && page.rotation !== 0) {
      const rad = (-page.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const cx = (page.width * zoom) / 2;
      const cy = (page.height * zoom) / 2;

      const dx = sx - cx;
      const dy = sy - cy;
      sx = cx + (dx * cos - dy * sin);
      sy = cy + (dx * sin + dy * cos);
    }

    const relX = sx / zoom;
    const relY = pageH - sy / zoom;

    return {
      x: relX + cropX,
      y: relY + cropY,
    };
  }

  /**
   * Convert a PDF bounding rectangle to Screen rectangle
   * PDF rect: x, y is bottom-left
   * Screen rect: x, y is top-left
   */
  static pdfRectToScreenRect(
    rect: Rect,
    page: PageModel,
    zoom: number = 1.0
  ): Rect {
    const cropX = page.cropBox ? page.cropBox[0] : page.mediaBox[0] || 0;
    const cropY = page.cropBox ? page.cropBox[1] : page.mediaBox[1] || 0;
    const pageH = page.height;

    const screenX = (rect.x - cropX) * zoom;
    const screenY = (pageH - (rect.y - cropY) - rect.height) * zoom;
    const screenW = rect.width * zoom;
    const screenH = rect.height * zoom;

    return {
      x: screenX,
      y: screenY,
      width: Math.max(1, screenW),
      height: Math.max(1, screenH),
    };
  }

  /**
   * Convert a Screen bounding rectangle back to PDF rectangle
   */
  static screenRectToPdfRect(
    rect: Rect,
    page: PageModel,
    zoom: number = 1.0
  ): Rect {
    const cropX = page.cropBox ? page.cropBox[0] : page.mediaBox[0] || 0;
    const cropY = page.cropBox ? page.cropBox[1] : page.mediaBox[1] || 0;
    const pageH = page.height;

    const pdfW = rect.width / zoom;
    const pdfH = rect.height / zoom;
    const pdfX = rect.x / zoom + cropX;
    const pdfY = pageH - (rect.y / zoom + pdfH) + cropY;

    return {
      x: pdfX,
      y: pdfY,
      width: pdfW,
      height: pdfH,
    };
  }

  /**
   * Calculate bounding box of transformed polygon / rect
   */
  static getTransformedBBox(points: Point[]): Rect {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const pt of points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }

    return {
      x: minX,
      y: minY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    };
  }
}
