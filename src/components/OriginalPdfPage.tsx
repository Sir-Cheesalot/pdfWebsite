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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    renderOriginalPdfPage(source, pageNumber, canvas, zoom).catch((error) => {
      if (!cancelled) console.warn('Original PDF render failed:', error);
    });
    return () => { cancelled = true; };
  }, [source, pageNumber, zoom]);

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" aria-label="Original PDF page" />;
};
