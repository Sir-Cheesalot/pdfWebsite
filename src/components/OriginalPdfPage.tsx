import React, { useEffect, useRef } from 'react';
import { renderOriginalPdfPage } from '../core/pdf/PdfJsOperatorInspector';

interface OriginalPdfPageProps {
  source: ArrayBuffer;
  pageNumber: number;
  zoom: number;
}

/** A canvas painted by PDF.js directly from the source instruction stream. */
export const OriginalPdfPage: React.FC<OriginalPdfPageProps> = ({ source, pageNumber, zoom }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRenderRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (activeRenderRef.current) {
      try {
        activeRenderRef.current.cancel();
      } catch (_) {}
      activeRenderRef.current = null;
    }

    let cancelled = false;
    renderOriginalPdfPage(
      source,
      pageNumber,
      canvas,
      zoom,
      (task) => {
        if (!cancelled) {
          activeRenderRef.current = task;
        }
      },
    ).catch((error) => {
      if (!cancelled && error?.name !== 'RenderingCancelledException') {
        console.warn('Original PDF render warning:', error);
      }
    });

    return () => {
      cancelled = true;
      if (activeRenderRef.current) {
        try {
          activeRenderRef.current.cancel();
        } catch (_) {}
        activeRenderRef.current = null;
      }
    };
  }, [source, pageNumber, zoom]);

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" aria-label="Original PDF page" />;
};
