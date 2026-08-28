// Minimalist Apple White WYSIWYG Interactive PDF Canvas
import React, { useEffect, useRef, useState } from 'react';
import {
  EditableObject,
  ImageObject,
  PageModel,
  Rect,
  ShapeObject,
  TableObject,
  TextObject,
} from '../core/types/model';
import { CoordinateSystem } from '../core/coords/CoordinateSystem';
import { OperatorTextLine } from '../core/pdf/PdfJsOperatorInspector';
import { OriginalPdfPage } from './OriginalPdfPage';
import { ToolMode } from './Toolbar';
import { FontFamilyHelper } from '../core/fonts/FontFamilyHelper';

interface CanvasProps {
  page: PageModel;
  zoom: number;
  selectedObjectId: string | null;
  currentTool: ToolMode;
  onSelectObject: (id: string | null) => void;
  onUpdateObject: (updated: Partial<EditableObject>) => void;
  onCommitObjectMove: (objectId: string, dxPdf: number, dyPdf: number) => void;
  onCommitObjectResize: (objectId: string, newBounds: Rect, oldBounds: Rect) => void;
  onCommitTextEdit: (objectId: string, newText: string, oldText: string) => void;
  onCommitTableCellEdit: (tableId: string, row: number, col: number, newText: string) => void;
  onInsertNewObject: (obj: EditableObject) => void;
  onSmartPush: (thresholdPdfY: number, deltaHeight: number, excludeId: string) => void;
  operatorTextLines?: OperatorTextLine[];
  onCommitOperatorText?: (line: OperatorTextLine, text: string) => void;
  sourcePdf?: ArrayBuffer | null;
}

type ResizeHandle = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br' | 'rot';

export const Canvas: React.FC<CanvasProps> = ({
  page,
  zoom,
  selectedObjectId,
  currentTool,
  onSelectObject,
  onUpdateObject,
  onCommitObjectMove,
  onCommitObjectResize,
  onCommitTextEdit,
  onCommitTableCellEdit,
  onInsertNewObject,
  onSmartPush,
  operatorTextLines = [],
  onCommitOperatorText,
  sourcePdf,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ tableId: string; row: number; col: number } | null>(null);
  const [activeDrag, setActiveDrag] = useState<{
    type: 'move' | 'resize' | 'smart_push';
    handle?: ResizeHandle;
    startX: number;
    startY: number;
    initialBounds: Rect;
    initialScreenBounds: Rect;
  } | null>(null);

  const selectedObject = page.objects.find((o) => o.id === selectedObjectId) || null;

  const pageWidthPx = page.width * zoom;
  const pageHeightPx = page.height * zoom;

  const handlePageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== containerRef.current && (e.target as HTMLElement).dataset.pageBackground !== 'true') {
      return;
    }

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const clickScreenX = e.clientX - rect.left;
    const clickScreenY = e.clientY - rect.top;
    const pdfPt = CoordinateSystem.screenToPdfPoint({ x: clickScreenX, y: clickScreenY }, page, zoom);

    if (currentTool === 'text') {
      const fontSize = 14;
      const height = 20;
      const pdfY = Math.max(0, pdfPt.y - height);
      const baselineY = pdfY + 4;

      const newText: TextObject = {
        id: `txt_user_${Date.now()}`,
        type: 'text',
        origin: 'user_created',
        pageIndex: page.pageIndex,
        pdfBounds: { x: pdfPt.x, y: pdfY, width: 140, height },
        matrix: [1, 0, 0, 1, pdfPt.x, baselineY],
        rotation: 0,
        zIndex: page.objects.length + 1,
        opacity: 1,
        visible: true,
        locked: false,
        text: 'Enter text here',
        runs: [],
        fontName: 'Helvetica',
        fontSize,
        lineHeight: 18,
        charSpacing: 0,
        wordSpacing: 0,
        fillColor: '#1d1d1f',
        bold: false,
        italic: false,
        underline: false,
        alignment: 'left',
        isModified: true,
      };
      onInsertNewObject(newText);
      setEditingTextId(newText.id);
    } else if (currentTool === 'shape_rect') {
      const newShape: ShapeObject = {
        id: `shape_user_${Date.now()}`,
        type: 'shape',
        shapeType: 'rect',
        origin: 'user_created',
        pageIndex: page.pageIndex,
        pdfBounds: { x: pdfPt.x, y: pdfPt.y - 60, width: 120, height: 60 },
        matrix: [1, 0, 0, 1, pdfPt.x, pdfPt.y - 60],
        rotation: 0,
        zIndex: page.objects.length + 1,
        opacity: 1,
        visible: true,
        locked: false,
        fillColor: '#ffffff',
        strokeColor: '#0071e3',
        strokeWidth: 2,
        isModified: true,
      };
      onInsertNewObject(newShape);
    } else if (currentTool === 'shape_circle') {
      const newShape: ShapeObject = {
        id: `shape_user_${Date.now()}`,
        type: 'shape',
        shapeType: 'circle',
        origin: 'user_created',
        pageIndex: page.pageIndex,
        pdfBounds: { x: pdfPt.x, y: pdfPt.y - 60, width: 60, height: 60 },
        matrix: [1, 0, 0, 1, pdfPt.x, pdfPt.y - 60],
        rotation: 0,
        zIndex: page.objects.length + 1,
        opacity: 1,
        visible: true,
        locked: false,
        fillColor: '#ffffff',
        strokeColor: '#0071e3',
        strokeWidth: 2,
        isModified: true,
      };
      onInsertNewObject(newShape);
    } else if (currentTool === 'smart_push') {
      onSmartPush(pdfPt.y, 40, '');
    } else {
      onSelectObject(null);
      setEditingTextId(null);
      setEditingCell(null);
    }
  };

  const handleMouseDown = (e: React.MouseEvent, obj: EditableObject, handle?: ResizeHandle) => {
    if (obj.locked || editingTextId === obj.id) return;
    e.stopPropagation();

    if (currentTool === 'smart_push') {
      onSmartPush(obj.pdfBounds.y, 40, obj.id);
      return;
    }

    onSelectObject(obj.id);

    // If in text tool, single-click enters inline edit mode immediately
    if (currentTool === 'text' && obj.type === 'text') {
      setEditingTextId(obj.id);
      return;
    }

    const screenBounds = CoordinateSystem.pdfRectToScreenRect(obj.pdfBounds, page, zoom);
    setActiveDrag({
      type: handle ? 'resize' : 'move',
      handle,
      startX: e.clientX,
      startY: e.clientY,
      initialBounds: { ...obj.pdfBounds },
      initialScreenBounds: screenBounds,
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!activeDrag || !selectedObject) return;

      const dxScreen = (e.clientX - activeDrag.startX) / zoom;
      const dyScreen = (e.clientY - activeDrag.startY) / zoom;

      if (activeDrag.type === 'move') {
        const dxPdf = dxScreen;
        const dyPdf = -dyScreen;

        const newPdfX = activeDrag.initialBounds.x + dxPdf;
        const newPdfY = activeDrag.initialBounds.y + dyPdf;

        onUpdateObject({
          pdfBounds: {
            ...selectedObject.pdfBounds,
            x: newPdfX,
            y: newPdfY,
          },
          matrix: [
            selectedObject.matrix[0],
            selectedObject.matrix[1],
            selectedObject.matrix[2],
            selectedObject.matrix[3],
            newPdfX,
            newPdfY,
          ],
          isModified: true,
          origin: 'user_created',
        });
      } else if (activeDrag.type === 'resize' && activeDrag.handle) {
        let newW = activeDrag.initialBounds.width;
        let newH = activeDrag.initialBounds.height;
        let newX = activeDrag.initialBounds.x;
        let newY = activeDrag.initialBounds.y;

        switch (activeDrag.handle) {
          case 'tr':
            newW = Math.max(10, activeDrag.initialBounds.width + dxScreen);
            newH = Math.max(10, activeDrag.initialBounds.height - dyScreen);
            break;
          case 'br':
            newW = Math.max(10, activeDrag.initialBounds.width + dxScreen);
            newH = Math.max(10, activeDrag.initialBounds.height + dyScreen);
            newY = activeDrag.initialBounds.y - dyScreen;
            break;
          case 'tl':
            newW = Math.max(10, activeDrag.initialBounds.width - dxScreen);
            newH = Math.max(10, activeDrag.initialBounds.height - dyScreen);
            newX = activeDrag.initialBounds.x + dxScreen;
            break;
          case 'bl':
            newW = Math.max(10, activeDrag.initialBounds.width - dxScreen);
            newH = Math.max(10, activeDrag.initialBounds.height + dyScreen);
            newX = activeDrag.initialBounds.x + dxScreen;
            newY = activeDrag.initialBounds.y - dyScreen;
            break;
          case 'mr':
            newW = Math.max(10, activeDrag.initialBounds.width + dxScreen);
            break;
          case 'bc':
            newH = Math.max(10, activeDrag.initialBounds.height + dyScreen);
            newY = activeDrag.initialBounds.y - dyScreen;
            break;
        }

        onUpdateObject({
          pdfBounds: { x: newX, y: newY, width: newW, height: newH },
          isModified: true,
          origin: 'user_created',
        });
      }
    };

    const handleMouseUp = () => {
      if (activeDrag && selectedObject) {
        if (activeDrag.type === 'move') {
          const dxPdf = selectedObject.pdfBounds.x - activeDrag.initialBounds.x;
          const dyPdf = selectedObject.pdfBounds.y - activeDrag.initialBounds.y;
          if (Math.abs(dxPdf) > 0.1 || Math.abs(dyPdf) > 0.1) {
            onCommitObjectMove(selectedObject.id, dxPdf, dyPdf);
          }
        } else if (activeDrag.type === 'resize') {
          onCommitObjectResize(selectedObject.id, selectedObject.pdfBounds, activeDrag.initialBounds);
        }
      }
      setActiveDrag(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeDrag, selectedObject, zoom, page]);

  return (
    <div className="flex-1 overflow-auto bg-[#f5f5f7] flex items-center justify-center p-8 relative select-none">
      {/* Page Canvas Container */}
      <div
        ref={containerRef}
        onClick={handlePageClick}
        data-page-background="true"
        style={{
          width: `${pageWidthPx}px`,
          height: `${pageHeightPx}px`,
        }}
        className="relative bg-white shadow-[0_12px_40px_rgba(0,0,0,0.07)] border border-black/[0.08] rounded-xs transition-all cursor-default overflow-hidden"
      >
        {/* Pixel-Perfect Original PDF Drawing Instructions */}
        {sourcePdf && (
          <OriginalPdfPage
            key={`orig_pdf_page_${page.pageIndex}_${zoom}`}
            source={sourcePdf}
            pageNumber={page.pageIndex + 1}
            zoom={zoom}
          />
        )}

        {/* Interactive WYSIWYG Editable Layer */}
        {page.objects.map((obj) => {
          if (!obj.visible) return null;
          const screenRect = CoordinateSystem.pdfRectToScreenRect(obj.pdfBounds, page, zoom);
          const isSelected = selectedObjectId === obj.id;
          const isEditingText = editingTextId === obj.id;
          const isModified = obj.origin === 'user_created' || obj.isModified;
          const shouldShowOpaque = !sourcePdf || isModified;

          return (
            <div
              key={obj.id}
              style={{
                position: 'absolute',
                left: `${screenRect.x}px`,
                top: `${screenRect.y}px`,
                width: `${screenRect.width}px`,
                height: `${screenRect.height}px`,
                opacity: obj.opacity,
                zIndex: obj.zIndex,
                transform: obj.rotation ? `rotate(${obj.rotation}deg)` : undefined,
                transformOrigin: 'center center',
              }}
              onMouseDown={(e) => handleMouseDown(e, obj)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (obj.type === 'text') setEditingTextId(obj.id);
              }}
              className={`group transition-all ${
                isSelected && !isEditingText
                  ? 'ring-1.5 ring-[#0071e3] bg-[#0071e3]/10 rounded shadow-xs'
                  : 'hover:ring-1 hover:ring-[#0071e3]/40 hover:bg-[#0071e3]/5 rounded'
              } ${obj.locked ? 'cursor-not-allowed' : obj.type === 'text' ? 'cursor-text' : 'cursor-move'}`}
            >
              {/* Text Object Rendering */}
              {obj.type === 'text' && (
                <div className="w-full h-full flex items-start relative">
                  {/* Floating Contextual Font & Style Pill on Selection */}
                  {isSelected && !isEditingText && (
                    <div className="absolute -top-7 left-0 flex items-center space-x-1.5 px-2 py-0.5 bg-[#1d1d1f] text-white text-[10px] rounded-md shadow-md pointer-events-none whitespace-nowrap z-50 animate-in fade-in zoom-in-95">
                      <span className="font-semibold text-[#0071e3]">
                        {FontFamilyHelper.getCleanFontName((obj as TextObject).fontName)}
                      </span>
                      <span className="text-white/40">•</span>
                      <span>{Math.round((obj as TextObject).fontSize)} pt</span>
                      {(obj as TextObject).bold && <span className="font-bold text-amber-300">B</span>}
                      {(obj as TextObject).italic && <span className="italic text-amber-300">I</span>}
                      {(obj as TextObject).origin === 'pdf_source' && (
                        <>
                          <span className="text-white/40">•</span>
                          <span className="text-[#30d158]">
                            {(obj as TextObject).pdfFontKey ? `/${(obj as TextObject).pdfFontKey}` : 'Detected Font'}
                          </span>
                        </>
                      )}
                    </div>
                  )}

                  {isEditingText ? (
                    <textarea
                      autoFocus
                      defaultValue={(obj as TextObject).text}
                      onBlur={(e) => {
                        const newTxt = e.target.value;
                        if (newTxt !== (obj as TextObject).text) {
                          onCommitTextEdit(obj.id, newTxt, (obj as TextObject).text);
                        }
                        setEditingTextId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditingTextId(null);
                      }}
                      style={{
                        fontFamily: FontFamilyHelper.getEffectiveCssFontFamily((obj as TextObject).fontName),
                        fontSize: `${(obj as TextObject).fontSize * zoom}px`,
                        color: (obj as TextObject).fillColor || '#1d1d1f',
                        fontWeight: (obj as TextObject).bold ? 'bold' : 'normal',
                        fontStyle: (obj as TextObject).italic ? 'italic' : 'normal',
                        lineHeight: (obj as TextObject).lineHeight && (obj as TextObject).fontSize
                          ? `${((obj as TextObject).lineHeight / (obj as TextObject).fontSize).toFixed(2)}`
                          : '1.2',
                        textAlign: (obj as TextObject).alignment || 'left',
                      }}
                      className="w-full h-full bg-white text-[#1d1d1f] border border-[#0071e3] rounded px-1 py-0.5 resize-none focus:outline-none shadow-md z-50 ring-2 ring-[#0071e3]/20"
                    />
                  ) : (
                    <div
                      style={{
                        fontFamily: FontFamilyHelper.getEffectiveCssFontFamily((obj as TextObject).fontName),
                        fontSize: `${(obj as TextObject).fontSize * zoom}px`,
                        // When unedited, keep transparent so the original PDF drawing instructions show with 100% fidelity!
                        color: shouldShowOpaque ? ((obj as TextObject).fillColor || '#1d1d1f') : 'transparent',
                        fontWeight: (obj as TextObject).bold ? 'bold' : 'normal',
                        fontStyle: (obj as TextObject).italic ? 'italic' : 'normal',
                        textDecoration: (obj as TextObject).underline ? 'underline' : 'none',
                        letterSpacing: `${((obj as TextObject).charSpacing || 0) * zoom}px`,
                        lineHeight: (obj as TextObject).lineHeight && (obj as TextObject).fontSize
                          ? `${((obj as TextObject).lineHeight / (obj as TextObject).fontSize).toFixed(2)}`
                          : '1.2',
                        textAlign: (obj as TextObject).alignment || 'left',
                        whiteSpace: 'pre',
                        overflow: 'visible',
                        padding: 0,
                        margin: 0,
                        backgroundColor: shouldShowOpaque && sourcePdf
                          ? (() => {
                              // Must fully mask original PDF text below when overlay is showing modified content.
                              // Detect if text is light-colored (would be invisible on white bg).
                              const fc = ((obj as TextObject).fillColor || '#000000').toLowerCase();
                              const isLightText = fc === '#ffffff' || fc === 'white' || fc === 'rgb(255, 255, 255)' || fc === '#fff';
                              // Light text: use near-black background to remain visible (banner/dark-card context).
                              // Dark text: use white background to mask original PDF text.
                              return isLightText ? '#1a1a2e' : '#ffffff';
                            })()
                          : isSelected && sourcePdf
                          ? 'rgba(0, 113, 227, 0.06)'
                          : 'transparent',
                        boxShadow: shouldShowOpaque && sourcePdf
                          ? '0 0 0 1.5px rgba(0,0,0,0.08)'
                          : undefined,
                        borderRadius: isSelected ? '2px' : undefined,
                      }}
                      className="w-full h-full select-none flex items-start"
                    >
                      {(obj as TextObject).text}
                    </div>
                  )}
                </div>
              )}

              {/* Image Object Rendering */}
              {obj.type === 'image' && (obj as ImageObject).src && (
                <img
                  src={(obj as ImageObject).src}
                  alt="PDF Image"
                  className="w-full h-full object-fill pointer-events-none select-none"
                  draggable={false}
                />
              )}

              {/* Shape Object Rendering */}
              {obj.type === 'shape' && (
                <svg className="w-full h-full overflow-visible pointer-events-none">
                  {(obj as ShapeObject).shapeType === 'rect' && (
                    <rect
                      x={0}
                      y={0}
                      width={screenRect.width}
                      height={screenRect.height}
                      fill={(obj as ShapeObject).fillColor || 'transparent'}
                      stroke={(obj as ShapeObject).strokeColor}
                      strokeWidth={(obj as ShapeObject).strokeWidth * zoom}
                    />
                  )}
                  {(obj as ShapeObject).shapeType === 'circle' && (
                    <ellipse
                      cx={screenRect.width / 2}
                      cy={screenRect.height / 2}
                      rx={screenRect.width / 2}
                      ry={screenRect.height / 2}
                      fill={(obj as ShapeObject).fillColor || 'transparent'}
                      stroke={(obj as ShapeObject).strokeColor}
                      strokeWidth={(obj as ShapeObject).strokeWidth * zoom}
                    />
                  )}
                  {(obj as ShapeObject).shapeType === 'line' && (
                    <line
                      x1={0}
                      y1={0}
                      x2={screenRect.width}
                      y2={screenRect.height}
                      stroke={(obj as ShapeObject).strokeColor}
                      strokeWidth={(obj as ShapeObject).strokeWidth * zoom}
                    />
                  )}
                </svg>
              )}

              {/* Table Object Rendering */}
              {obj.type === 'table' && (
                <div className="w-full h-full overflow-hidden border border-black/[0.1] shadow-xs">
                  <table className="w-full h-full border-collapse">
                    <tbody>
                      {(obj as TableObject).cells.map((rowCells, r) => (
                        <tr key={`r_${r}`} style={{ height: `${(obj as TableObject).rowHeights[r] * zoom}px` }}>
                          {rowCells.map((cell, c) => {
                            const isEditingThisCell =
                              editingCell?.tableId === obj.id && editingCell?.row === r && editingCell?.col === c;

                            return (
                              <td
                                key={cell.id}
                                style={{
                                  width: `${(obj as TableObject).colWidths[c] * zoom}px`,
                                  backgroundColor: cell.bgColor,
                                  border: `${cell.borderWidth * zoom}px solid ${cell.borderColor}`,
                                  color: cell.textColor,
                                  fontSize: `${cell.fontSize * zoom}px`,
                                  fontWeight: cell.bold ? 'bold' : 'normal',
                                  fontStyle: cell.italic ? 'italic' : 'normal',
                                  textAlign: cell.alignment,
                                  padding: `${cell.padding * zoom}px`,
                                }}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  setEditingCell({ tableId: obj.id, row: r, col: c });
                                }}
                                className="relative select-none hover:ring-1 hover:ring-[#0071e3]"
                              >
                                {isEditingThisCell ? (
                                  <input
                                    autoFocus
                                    defaultValue={cell.text}
                                    onBlur={(e) => {
                                      onCommitTableCellEdit(obj.id, r, c, e.target.value);
                                      setEditingCell(null);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === 'Escape') {
                                        onCommitTableCellEdit(obj.id, r, c, (e.target as HTMLInputElement).value);
                                        setEditingCell(null);
                                      }
                                    }}
                                    className="w-full h-full bg-white text-[#1d1d1f] px-1 rounded focus:outline-none ring-2 ring-[#0071e3]"
                                  />
                                ) : (
                                  cell.text
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Apple-Style Transform & Resize Handles */}
              {isSelected && !isEditingText && (
                <>
                  <div
                    onMouseDown={(e) => handleMouseDown(e, obj, 'tl')}
                    className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-[#0071e3] rounded-full cursor-nwse-resize shadow-xs"
                  />
                  <div
                    onMouseDown={(e) => handleMouseDown(e, obj, 'tr')}
                    className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-[#0071e3] rounded-full cursor-nesw-resize shadow-xs"
                  />
                  <div
                    onMouseDown={(e) => handleMouseDown(e, obj, 'bl')}
                    className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-[#0071e3] rounded-full cursor-nesw-resize shadow-xs"
                  />
                  <div
                    onMouseDown={(e) => handleMouseDown(e, obj, 'br')}
                    className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-[#0071e3] rounded-full cursor-nwse-resize shadow-xs"
                  />
                  <div
                    onMouseDown={(e) => handleMouseDown(e, obj, 'mr')}
                    className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-3 h-3 bg-white border-2 border-[#0071e3] rounded-full cursor-ew-resize shadow-xs"
                  />
                  <div
                    onMouseDown={(e) => handleMouseDown(e, obj, 'bc')}
                    className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-2 border-[#0071e3] rounded-full cursor-ns-resize shadow-xs"
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
