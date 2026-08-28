// Canonical Image Decoder for PDF Exporter
// Decodes PNG, JPEG, and browser image data URLs into raw PDF-compliant sample buffers
import * as pako from 'pako';

export interface DecodedImage {
  width: number;
  height: number;
  colorSpace: 'DeviceRGB' | 'DeviceGray';
  bitsPerComponent: 8;
  rgbData: Uint8Array;
  alphaData?: Uint8Array;
  hasTransparency: boolean;
  isDirectJpeg?: boolean;
  jpegBytes?: Uint8Array;
}

export class ImageDecoder {
  /**
   * Decodes an image data URL, base64 string, or raw Uint8Array into a canonical DecodedImage.
   */
  static decode(imageInput: string | Uint8Array, defaultWidth = 100, defaultHeight = 100): DecodedImage | null {
    const bytes = this.toBytes(imageInput);
    if (!bytes || bytes.length === 0) return null;

    // 1. Check for PNG signature (\x89PNG\r\n\x1a\n)
    if (this.isPng(bytes)) {
      const pngDecoded = this.decodePng(bytes);
      if (pngDecoded) return pngDecoded;
    }

    // 2. Check for JPEG signature (\xFF\xD8)
    if (this.isJpeg(bytes)) {
      const jpegDecoded = this.decodeJpeg(bytes, defaultWidth, defaultHeight);
      if (jpegDecoded) return jpegDecoded;
    }

    // 3. Fallback: Browser Canvas Decoding if available
    if (typeof document !== 'undefined' && typeof imageInput === 'string' && imageInput.startsWith('data:')) {
      const canvasDecoded = this.decodeViaCanvas(imageInput, defaultWidth, defaultHeight);
      if (canvasDecoded) return canvasDecoded;
    }

    return null;
  }

  private static toBytes(input: string | Uint8Array): Uint8Array | null {
    if (input instanceof Uint8Array) return input;
    if (typeof input !== 'string') return null;

    try {
      let b64 = input;
      if (input.includes(',')) {
        b64 = input.split(',')[1];
      }
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      return bytes;
    } catch {
      return null;
    }
  }

  private static isPng(bytes: Uint8Array): boolean {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }

  private static isJpeg(bytes: Uint8Array): boolean {
    return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
  }

  /**
   * Pure TypeScript PNG decoder (RFC 2083)
   */
  private static decodePng(bytes: Uint8Array): DecodedImage | null {
    try {
      let offset = 8;
      let width = 0;
      let height = 0;
      let bitDepth = 8;
      let colorType = 2; // 0=Gray, 2=RGB, 3=Indexed, 4=Gray+Alpha, 6=RGBA
      let palette: Uint8Array | null = null;
      let trns: Uint8Array | null = null;
      const idatChunks: Uint8Array[] = [];

      while (offset + 8 <= bytes.length) {
        const length =
          ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
        const type = String.fromCharCode(
          bytes[offset + 4],
          bytes[offset + 5],
          bytes[offset + 6],
          bytes[offset + 7]
        );
        const chunkDataStart = offset + 8;
        const chunkDataEnd = chunkDataStart + length;

        if (chunkDataEnd > bytes.length) break;

        if (type === 'IHDR') {
          width =
            ((bytes[chunkDataStart] << 24) |
              (bytes[chunkDataStart + 1] << 16) |
              (bytes[chunkDataStart + 2] << 8) |
              bytes[chunkDataStart + 3]) >>>
            0;
          height =
            ((bytes[chunkDataStart] << 24) |
              (bytes[chunkDataStart + 1] << 16) |
              (bytes[chunkDataStart + 2] << 8) |
              bytes[chunkDataStart + 3]) >>>
            0;
          bitDepth = bytes[chunkDataStart + 8];
          colorType = bytes[chunkDataStart + 9];
        } else if (type === 'PLTE') {
          palette = bytes.subarray(chunkDataStart, chunkDataEnd);
        } else if (type === 'tRNS') {
          trns = bytes.subarray(chunkDataStart, chunkDataEnd);
        } else if (type === 'IDAT') {
          idatChunks.push(bytes.subarray(chunkDataStart, chunkDataEnd));
        } else if (type === 'IEND') {
          break;
        }

        offset = chunkDataEnd + 4; // skip CRC
      }

      if (width <= 0 || height <= 0 || idatChunks.length === 0) return null;

      // Concatenate all IDAT chunks
      const totalIdatLen = idatChunks.reduce((sum, c) => sum + c.length, 0);
      const idatCombined = new Uint8Array(totalIdatLen);
      let idatOffset = 0;
      for (const chunk of idatChunks) {
        idatCombined.set(chunk, idatOffset);
        idatOffset += chunk.length;
      }

      // Decompress IDAT payload with zlib inflate
      const rawData = pako.inflate(idatCombined);

      // Determine channels and scanline stride
      let channels = 3;
      if (colorType === 0) channels = 1; // Grayscale
      else if (colorType === 2) channels = 3; // RGB
      else if (colorType === 3) channels = 1; // Indexed
      else if (colorType === 4) channels = 2; // Gray + Alpha
      else if (colorType === 6) channels = 4; // RGBA

      const bytesPerPixel = Math.max(1, Math.ceil((channels * bitDepth) / 8));
      const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
      const stride = rowBytes + 1;

      // Unfilter PNG scanlines (RFC 2083)
      const unfilt = new Uint8Array(height * rowBytes);
      let prevRow = new Uint8Array(rowBytes);

      for (let r = 0; r < height; r++) {
        const rowStart = r * stride;
        if (rowStart >= rawData.length) break;

        const filterType = rawData[rowStart];
        const currentRow = new Uint8Array(rowBytes);

        for (let i = 0; i < rowBytes; i++) {
          const raw = rawData[rowStart + 1 + i] || 0;
          const left = i >= bytesPerPixel ? currentRow[i - bytesPerPixel] : 0;
          const up = prevRow[i];
          const upLeft = i >= bytesPerPixel ? prevRow[i - bytesPerPixel] : 0;

          let val = raw;
          if (filterType === 1) {
            val = (raw + left) & 0xff;
          } else if (filterType === 2) {
            val = (raw + up) & 0xff;
          } else if (filterType === 3) {
            val = (raw + Math.floor((left + up) / 2)) & 0xff;
          } else if (filterType === 4) {
            val = (raw + this.paeth(left, up, upLeft)) & 0xff;
          }

          currentRow[i] = val;
          unfilt[r * rowBytes + i] = val;
        }
        prevRow = currentRow;
      }

      const totalPixels = width * height;
      let rgbData: Uint8Array;
      let alphaData: Uint8Array | undefined = undefined;
      let hasTransparency = false;
      let colorSpace: 'DeviceRGB' | 'DeviceGray' = 'DeviceRGB';

      if (colorType === 6) {
        // RGBA (4 bytes per pixel)
        rgbData = new Uint8Array(totalPixels * 3);
        alphaData = new Uint8Array(totalPixels);
        for (let i = 0; i < totalPixels; i++) {
          const srcIdx = i * 4;
          const r = unfilt[srcIdx];
          const g = unfilt[srcIdx + 1];
          const b = unfilt[srcIdx + 2];
          const a = unfilt[srcIdx + 3];

          rgbData[i * 3] = r;
          rgbData[i * 3 + 1] = g;
          rgbData[i * 3 + 2] = b;
          alphaData[i] = a;
          if (a < 255) hasTransparency = true;
        }
      } else if (colorType === 2) {
        // RGB (3 bytes per pixel)
        rgbData = unfilt;
        if (trns && trns.length >= 6) {
          // Transparent RGB key
          const tR = trns[1];
          const tG = trns[3];
          const tB = trns[5];
          alphaData = new Uint8Array(totalPixels);
          for (let i = 0; i < totalPixels; i++) {
            const r = rgbData[i * 3];
            const g = rgbData[i * 3 + 1];
            const b = rgbData[i * 3 + 2];
            if (r === tR && g === tG && b === tB) {
              alphaData[i] = 0;
              hasTransparency = true;
            } else {
              alphaData[i] = 255;
            }
          }
        }
      } else if (colorType === 3 && palette) {
        // Indexed Palette (1 byte per pixel)
        rgbData = new Uint8Array(totalPixels * 3);
        if (trns) {
          alphaData = new Uint8Array(totalPixels);
        }

        for (let i = 0; i < totalPixels; i++) {
          const idx = unfilt[i];
          const palIdx = idx * 3;
          rgbData[i * 3] = palIdx < palette.length ? palette[palIdx] : 0;
          rgbData[i * 3 + 1] = palIdx + 1 < palette.length ? palette[palIdx + 1] : 0;
          rgbData[i * 3 + 2] = palIdx + 2 < palette.length ? palette[palIdx + 2] : 0;

          if (trns && alphaData) {
            const a = idx < trns.length ? trns[idx] : 255;
            alphaData[i] = a;
            if (a < 255) hasTransparency = true;
          }
        }
      } else if (colorType === 4) {
        // Gray + Alpha (2 bytes per pixel)
        colorSpace = 'DeviceGray';
        rgbData = new Uint8Array(totalPixels);
        alphaData = new Uint8Array(totalPixels);
        for (let i = 0; i < totalPixels; i++) {
          const gray = unfilt[i * 2];
          const a = unfilt[i * 2 + 1];
          rgbData[i] = gray;
          alphaData[i] = a;
          if (a < 255) hasTransparency = true;
        }
      } else {
        // Grayscale (1 byte per pixel)
        colorSpace = 'DeviceGray';
        rgbData = unfilt;
      }

      return {
        width,
        height,
        colorSpace,
        bitsPerComponent: 8,
        rgbData,
        alphaData: hasTransparency ? alphaData : undefined,
        hasTransparency,
      };
    } catch (err) {
      console.warn('ImageDecoder: PNG decode failed, trying fallback:', err);
      return null;
    }
  }

  private static paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  /**
   * Parse JPEG dimensions and color space for direct DCTDecode embedding
   */
  private static decodeJpeg(bytes: Uint8Array, defaultWidth: number, defaultHeight: number): DecodedImage | null {
    try {
      let width = defaultWidth;
      let height = defaultHeight;
      let numComponents = 3;

      // Scan for SOF markers (Start Of Frame)
      let offset = 2;
      while (offset + 4 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = bytes[offset + 1];
        if (
          marker === 0xc0 ||
          marker === 0xc1 ||
          marker === 0xc2 ||
          marker === 0xc3 ||
          marker === 0xc5 ||
          marker === 0xc6 ||
          marker === 0xc7 ||
          marker === 0xc9 ||
          marker === 0xca ||
          marker === 0xcb ||
          marker === 0xcd ||
          marker === 0xce ||
          marker === 0xcf
        ) {
          height = (bytes[offset + 5] << 8) | bytes[offset + 6];
          width = (bytes[offset + 7] << 8) | bytes[offset + 8];
          numComponents = bytes[offset + 9];
          break;
        }

        const len = (bytes[offset + 2] << 8) | bytes[offset + 3];
        offset += 2 + len;
      }

      return {
        width: Math.max(1, width),
        height: Math.max(1, height),
        colorSpace: numComponents === 1 ? 'DeviceGray' : 'DeviceRGB',
        bitsPerComponent: 8,
        rgbData: bytes,
        isDirectJpeg: true,
        jpegBytes: bytes,
        hasTransparency: false,
      };
    } catch {
      return null;
    }
  }

  /**
   * Browser Canvas fallback for WebP, GIF, SVG, etc.
   */
  private static decodeViaCanvas(dataUrl: string, width: number, height: number): DecodedImage | null {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;

      const img = new Image();
      img.src = dataUrl;
      if (!img.complete || img.naturalWidth === 0) return null;

      const w = img.naturalWidth || width;
      const h = img.naturalHeight || height;
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);

      const imgData = ctx.getImageData(0, 0, w, h);
      const totalPixels = w * h;
      const rgbData = new Uint8Array(totalPixels * 3);
      const alphaData = new Uint8Array(totalPixels);
      let hasTransparency = false;

      for (let i = 0; i < totalPixels; i++) {
        const srcIdx = i * 4;
        rgbData[i * 3] = imgData.data[srcIdx];
        rgbData[i * 3 + 1] = imgData.data[srcIdx + 1];
        rgbData[i * 3 + 2] = imgData.data[srcIdx + 2];
        const a = imgData.data[srcIdx + 3];
        alphaData[i] = a;
        if (a < 255) hasTransparency = true;
      }

      return {
        width: w,
        height: h,
        colorSpace: 'DeviceRGB',
        bitsPerComponent: 8,
        rgbData,
        alphaData: hasTransparency ? alphaData : undefined,
        hasTransparency,
      };
    } catch {
      return null;
    }
  }
}
