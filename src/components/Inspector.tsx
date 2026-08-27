import React, { useState } from 'react';
import {
  ArrowDownNarrowWide,
  Bold,
  Eye,
  EyeOff,
  Italic,
  Layers,
  Lock,
  MousePointer,
  Plus,
  ScanText,
  Sliders,
  Table as TableIcon,
  Trash2,
  Type,
  Underline,
  Unlock,
} from 'lucide-react';
import { EditableObject, PageModel, ShapeObject, TableObject, TextObject } from '../core/types/model';
import { OcrVerificationEngine } from '../core/ocr/OcrVerificationEngine';

interface InspectorProps {
  selectedObject: EditableObject | null;
  activePage: PageModel;
  onUpdateObject: (updated: Partial<EditableObject>) => void;
  onDeleteObject: (id: string) => void;
  onReorderObject: (id: string, direction: 'front' | 'back' | 'up' | 'down') => void;
  onSmartPush: (thresholdPdfY: number, deltaHeight: number, excludeId: string) => void;
  onSelectObject: (id: string) => void;
}

export const Inspector: React.FC<InspectorProps> = ({
  selectedObject,
  activePage,
  onUpdateObject,
  onDeleteObject,
  onReorderObject,
  onSmartPush,
  onSelectObject,
}) => {
  const [activeTab, setActiveTab] = useState<'properties' | 'layers'>('properties');
  const [pushDelta, setPushDelta] = useState(50);

  const isText = selectedObject?.type === 'text';
  const isImage = selectedObject?.type === 'image';
  const isShape = selectedObject?.type === 'shape';
  const isTable = selectedObject?.type === 'table';

  const textObj = isText ? (selectedObject as TextObject) : null;
  const shapeObj = isShape ? (selectedObject as ShapeObject) : null;
  const tableObj = isTable ? (selectedObject as TableObject) : null;

  return (
    <aside className="w-72 bg-white border-l border-black/[0.08] flex flex-col h-full select-none shrink-0 z-20 overflow-hidden text-[#1d1d1f] text-xs">
      {/* Apple-style Segmented Tabs */}
      <div className="p-2.5 border-b border-black/[0.06]">
        <div className="flex bg-[#efeff4] p-0.5 rounded-xl border border-black/[0.04]">
          <button
            onClick={() => setActiveTab('properties')}
            className={`flex-1 py-1.5 flex items-center justify-center space-x-1.5 rounded-lg transition-all ${
              activeTab === 'properties'
                ? 'bg-white text-[#1d1d1f] font-semibold shadow-xs'
                : 'text-[#6e6e73] hover:text-[#1d1d1f] font-medium'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Inspector</span>
          </button>
          <button
            onClick={() => setActiveTab('layers')}
            className={`flex-1 py-1.5 flex items-center justify-center space-x-1.5 rounded-lg transition-all ${
              activeTab === 'layers'
                ? 'bg-white text-[#1d1d1f] font-semibold shadow-xs'
                : 'text-[#6e6e73] hover:text-[#1d1d1f] font-medium'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Layers ({activePage.objects.length})</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {activeTab === 'properties' ? (
          selectedObject ? (
            <>
              {/* Header Info */}
              <div className="flex items-center justify-between pb-2 border-b border-black/[0.06]">
                <div>
                  <span className="font-semibold text-[#1d1d1f] uppercase tracking-wider text-[11px]">
                    {selectedObject.type}
                  </span>
                  <div className="text-[10px] text-[#86868b]">
                    {selectedObject.origin === 'pdf_source' ? 'Original PDF Content' : 'Inserted Element'}
                  </div>
                </div>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => onUpdateObject({ locked: !selectedObject.locked })}
                    className={`p-1.5 rounded-md ${
                      selectedObject.locked
                        ? 'bg-amber-100 text-amber-700'
                        : 'text-[#6e6e73] hover:text-[#1d1d1f] hover:bg-[#f5f5f7]'
                    }`}
                    title={selectedObject.locked ? 'Unlock' : 'Lock'}
                  >
                    {selectedObject.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => onDeleteObject(selectedObject.id)}
                    className="p-1.5 rounded-md text-[#ff3b30] hover:text-[#d70015] hover:bg-red-50 transition-colors"
                    title="Delete Object"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Typography Section (Text Objects) */}
              {isText && textObj && (
                <div className="space-y-2.5 bg-[#f5f5f7] p-3 rounded-xl border border-black/[0.04]">
                  <div className="flex items-center space-x-1.5 text-[#1d1d1f] font-semibold text-[11px]">
                    <Type className="w-3.5 h-3.5 text-[#0071e3]" />
                    <span>Typography</span>
                  </div>

                  {/* Font Family */}
                  <div>
                    <label className="block text-[10px] text-[#86868b] mb-1">Font Family</label>
                    <select
                      value={textObj.fontName}
                      onChange={(e) => onUpdateObject({ fontName: e.target.value })}
                      className="w-full bg-white border border-black/[0.08] rounded-lg px-2 py-1 text-[#1d1d1f] focus:outline-none focus:ring-1 focus:ring-[#0071e3]"
                    >
                      <option value="Helvetica">Helvetica (Sans-Serif)</option>
                      <option value="Helvetica-Bold">Helvetica Bold</option>
                      <option value="Times-Roman">Times Roman (Serif)</option>
                      <option value="Times-Bold">Times Bold</option>
                      <option value="Times-Italic">Times Italic</option>
                      <option value="Courier">Courier (Monospace)</option>
                      <option value="Courier-Bold">Courier Bold</option>
                    </select>
                  </div>

                  {/* Font Size & Spacing */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-[#86868b] mb-1">Size (pt)</label>
                      <input
                        type="number"
                        min={6}
                        max={120}
                        value={Math.round(textObj.fontSize)}
                        onChange={(e) => onUpdateObject({ fontSize: Number(e.target.value) || 12 })}
                        className="w-full bg-white border border-black/[0.08] rounded-lg px-2 py-1 text-[#1d1d1f] focus:outline-none focus:ring-1 focus:ring-[#0071e3]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#86868b] mb-1">Spacing (pt)</label>
                      <input
                        type="number"
                        step={0.5}
                        value={textObj.charSpacing || 0}
                        onChange={(e) => onUpdateObject({ charSpacing: Number(e.target.value) || 0 })}
                        className="w-full bg-white border border-black/[0.08] rounded-lg px-2 py-1 text-[#1d1d1f] focus:outline-none focus:ring-1 focus:ring-[#0071e3]"
                      />
                    </div>
                  </div>

                  {/* Text Style & Color */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => onUpdateObject({ bold: !textObj.bold })}
                        className={`p-1.5 rounded-lg border transition-all ${
                          textObj.bold
                            ? 'bg-[#0071e3] text-white border-transparent shadow-xs'
                            : 'bg-white border-black/[0.08] text-[#424245] hover:text-[#1d1d1f]'
                        }`}
                        title="Bold"
                      >
                        <Bold className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onUpdateObject({ italic: !textObj.italic })}
                        className={`p-1.5 rounded-lg border transition-all ${
                          textObj.italic
                            ? 'bg-[#0071e3] text-white border-transparent shadow-xs'
                            : 'bg-white border-black/[0.08] text-[#424245] hover:text-[#1d1d1f]'
                        }`}
                        title="Italic"
                      >
                        <Italic className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onUpdateObject({ underline: !textObj.underline })}
                        className={`p-1.5 rounded-lg border transition-all ${
                          textObj.underline
                            ? 'bg-[#0071e3] text-white border-transparent shadow-xs'
                            : 'bg-white border-black/[0.08] text-[#424245] hover:text-[#1d1d1f]'
                        }`}
                        title="Underline"
                      >
                        <Underline className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Color picker */}
                    <div className="flex items-center space-x-1.5">
                      <input
                        type="color"
                        value={textObj.fillColor.startsWith('#') ? textObj.fillColor : '#000000'}
                        onChange={(e) => onUpdateObject({ fillColor: e.target.value })}
                        className="w-7 h-7 rounded-lg border border-black/[0.1] bg-transparent cursor-pointer"
                        title="Text Color"
                      />
                    </div>
                  </div>

                  {/* OCR Double-Check */}
                  <div className="pt-2 border-t border-black/[0.06] flex items-center justify-between">
                    <div className="flex items-center space-x-1 text-[10px] text-[#6e6e73]">
                      <ScanText className="w-3 h-3 text-[#0071e3]" />
                      <span>OCR Verify</span>
                    </div>
                    <button
                      onClick={async () => {
                        const verified = await OcrVerificationEngine.performBrowserOcr(textObj, activePage);
                        onUpdateObject({ text: verified });
                      }}
                      className="px-2.5 py-1 bg-white hover:bg-[#fafafa] border border-black/[0.08] text-[#0071e3] text-[10px] font-medium rounded-lg shadow-xs transition-colors"
                      title="Double-check with OCR and fix exotic or corrupted glyphs"
                    >
                      Verify Text
                    </button>
                  </div>
                </div>
              )}

              {/* Shape Properties */}
              {isShape && shapeObj && (
                <div className="space-y-2.5 bg-[#f5f5f7] p-3 rounded-xl border border-black/[0.04]">
                  <span className="font-semibold text-[#1d1d1f] text-[11px]">Shape Style</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-[#86868b] mb-1">Fill Color</label>
                      <input
                        type="color"
                        value={shapeObj.fillColor && shapeObj.fillColor.startsWith('#') ? shapeObj.fillColor : '#0071e3'}
                        onChange={(e) => onUpdateObject({ fillColor: e.target.value })}
                        className="w-7 h-7 rounded-lg border border-black/[0.1] bg-transparent cursor-pointer"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#86868b] mb-1">Stroke Color</label>
                      <input
                        type="color"
                        value={shapeObj.strokeColor && shapeObj.strokeColor.startsWith('#') ? shapeObj.strokeColor : '#000000'}
                        onChange={(e) => onUpdateObject({ strokeColor: e.target.value })}
                        className="w-7 h-7 rounded-lg border border-black/[0.1] bg-transparent cursor-pointer"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#86868b] mb-1">Stroke Width</label>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={shapeObj.strokeWidth}
                      onChange={(e) => onUpdateObject({ strokeWidth: Number(e.target.value) || 1 })}
                      className="w-full bg-white border border-black/[0.08] rounded-lg px-2 py-1 text-[#1d1d1f]"
                    />
                  </div>
                </div>
              )}

              {/* Table Properties */}
              {isTable && tableObj && (
                <div className="space-y-2.5 bg-[#f5f5f7] p-3 rounded-xl border border-black/[0.04]">
                  <div className="flex items-center space-x-1.5 text-[#1d1d1f] font-semibold text-[11px]">
                    <TableIcon className="w-3.5 h-3.5 text-[#0071e3]" />
                    <span>Table Structure</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        const newRow = tableObj.cells[tableObj.rows - 1].map((c, ci) => ({
                          ...c,
                          id: `c_${tableObj.rows}_${ci}_${Date.now()}`,
                          row: tableObj.rows,
                          text: `Data`,
                          bgColor: '#ffffff',
                          bold: false,
                        }));
                        onUpdateObject({
                          rows: tableObj.rows + 1,
                          rowHeights: [...tableObj.rowHeights, 28],
                          cells: [...tableObj.cells, newRow],
                          pdfBounds: {
                            ...tableObj.pdfBounds,
                            height: tableObj.pdfBounds.height + 28,
                            y: tableObj.pdfBounds.y - 28,
                          },
                        });
                      }}
                      className="px-2 py-1.5 rounded-lg bg-white border border-black/[0.08] hover:bg-[#fafafa] text-[#1d1d1f] font-medium flex items-center justify-center space-x-1 shadow-xs"
                    >
                      <Plus className="w-3 h-3 text-[#0071e3]" />
                      <span>Add Row</span>
                    </button>
                    <button
                      onClick={() => {
                        if (tableObj.rows <= 1) return;
                        const newCells = tableObj.cells.slice(0, -1);
                        const removedH = tableObj.rowHeights[tableObj.rows - 1];
                        onUpdateObject({
                          rows: tableObj.rows - 1,
                          rowHeights: tableObj.rowHeights.slice(0, -1),
                          cells: newCells,
                          pdfBounds: {
                            ...tableObj.pdfBounds,
                            height: tableObj.pdfBounds.height - removedH,
                            y: tableObj.pdfBounds.y + removedH,
                          },
                        });
                      }}
                      disabled={tableObj.rows <= 1}
                      className="px-2 py-1.5 rounded-lg bg-white border border-black/[0.08] hover:bg-[#fafafa] text-[#1d1d1f] font-medium disabled:opacity-40 shadow-xs"
                    >
                      Remove Row
                    </button>
                  </div>
                </div>
              )}

              {/* Geometry & PDF Coordinates */}
              <div className="space-y-2.5 bg-[#f5f5f7] p-3 rounded-xl border border-black/[0.04]">
                <span className="font-semibold text-[#1d1d1f] text-[11px]">Coordinates & Dimensions</span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-[#86868b] mb-1">X (pt)</label>
                    <input
                      type="number"
                      value={Math.round(selectedObject.pdfBounds.x)}
                      onChange={(e) =>
                        onUpdateObject({
                          pdfBounds: { ...selectedObject.pdfBounds, x: Number(e.target.value) || 0 },
                          matrix: [selectedObject.matrix[0], selectedObject.matrix[1], selectedObject.matrix[2], selectedObject.matrix[3], Number(e.target.value) || 0, selectedObject.matrix[5]],
                        })
                      }
                      className="w-full bg-white border border-black/[0.08] rounded-lg px-2 py-1 text-[#1d1d1f]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#86868b] mb-1">Y (pt)</label>
                    <input
                      type="number"
                      value={Math.round(selectedObject.pdfBounds.y)}
                      onChange={(e) =>
                        onUpdateObject({
                          pdfBounds: { ...selectedObject.pdfBounds, y: Number(e.target.value) || 0 },
                          matrix: [selectedObject.matrix[0], selectedObject.matrix[1], selectedObject.matrix[2], selectedObject.matrix[3], selectedObject.matrix[4], Number(e.target.value) || 0],
                        })
                      }
                      className="w-full bg-white border border-black/[0.08] rounded-lg px-2 py-1 text-[#1d1d1f]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#86868b] mb-1">Width (pt)</label>
                    <input
                      type="number"
                      value={Math.round(selectedObject.pdfBounds.width)}
                      onChange={(e) =>
                        onUpdateObject({
                          pdfBounds: { ...selectedObject.pdfBounds, width: Number(e.target.value) || 10 },
                        })
                      }
                      className="w-full bg-white border border-black/[0.08] rounded-lg px-2 py-1 text-[#1d1d1f]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#86868b] mb-1">Height (pt)</label>
                    <input
                      type="number"
                      value={Math.round(selectedObject.pdfBounds.height)}
                      onChange={(e) =>
                        onUpdateObject({
                          pdfBounds: { ...selectedObject.pdfBounds, height: Number(e.target.value) || 10 },
                        })
                      }
                      className="w-full bg-white border border-black/[0.08] rounded-lg px-2 py-1 text-[#1d1d1f]"
                    />
                  </div>
                </div>
              </div>

              {/* Smart Layout Push Repositioner */}
              <div className="space-y-2.5 bg-[#f5f5f7] p-3 rounded-xl border border-black/[0.04]">
                <div className="flex items-center space-x-1.5 text-[#1d1d1f] font-semibold text-[11px]">
                  <ArrowDownNarrowWide className="w-3.5 h-3.5 text-[#0071e3]" />
                  <span>Smart Layout Push</span>
                </div>
                <p className="text-[10px] text-[#86868b] leading-relaxed">
                  Shift all PDF elements below this object downward to adapt layout.
                </p>
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    min={5}
                    max={300}
                    step={10}
                    value={pushDelta}
                    onChange={(e) => setPushDelta(Number(e.target.value) || 50)}
                    className="w-20 bg-white border border-black/[0.08] rounded-lg px-2 py-1 text-[#1d1d1f] text-center"
                  />
                  <span className="text-[#86868b]">pt</span>
                  <button
                    onClick={() => onSmartPush(selectedObject.pdfBounds.y, pushDelta, selectedObject.id)}
                    className="flex-1 bg-[#0071e3] hover:bg-[#0077ed] text-white font-medium py-1 px-2.5 rounded-lg shadow-xs transition-colors"
                  >
                    Push Down
                  </button>
                </div>
              </div>

              {/* Layer Ordering Buttons */}
              <div className="space-y-2 pt-2 border-t border-black/[0.06]">
                <span className="font-semibold text-[#86868b] text-[10px] uppercase">Z-Order & Arrangement</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onReorderObject(selectedObject.id, 'front')}
                    className="p-1.5 rounded-lg bg-[#f5f5f7] hover:bg-[#e8e8ed] text-[#1d1d1f] font-medium border border-black/[0.04]"
                  >
                    Bring to Front
                  </button>
                  <button
                    onClick={() => onReorderObject(selectedObject.id, 'back')}
                    className="p-1.5 rounded-lg bg-[#f5f5f7] hover:bg-[#e8e8ed] text-[#1d1d1f] font-medium border border-black/[0.04]"
                  >
                    Send to Back
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-[#86868b] space-y-2">
              <MousePointer className="w-7 h-7 mx-auto opacity-30 text-[#0071e3]" />
              <p className="text-xs">Click on any text, table, shape, or image on the canvas to inspect and edit properties.</p>
            </div>
          )
        ) : (
          /* Layers Tab */
          <div className="space-y-1">
            {activePage.objects.map((obj, idx) => {
              const isSelected = selectedObject?.id === obj.id;
              return (
                <div
                  key={obj.id}
                  onClick={() => onSelectObject(obj.id)}
                  className={`flex items-center justify-between p-2 rounded-xl cursor-pointer transition-all border ${
                    isSelected
                      ? 'bg-[#f5f5f7] border-[#0071e3] ring-1 ring-[#0071e3] text-[#1d1d1f] font-semibold'
                      : 'bg-white border-black/[0.04] hover:bg-[#fafafa] text-[#424245]'
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    <span className="text-[10px] font-mono text-[#86868b] w-4">
                      {idx + 1}
                    </span>
                    <span className="truncate text-xs">
                      {obj.type === 'text'
                        ? `"${(obj as TextObject).text.slice(0, 16)}..."`
                        : obj.type === 'table'
                        ? `Table (${(obj as TableObject).rows}x${(obj as TableObject).cols})`
                        : obj.type === 'image'
                        ? 'Image'
                        : 'Shape'}
                    </span>
                  </div>

                  <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => onUpdateObject({ visible: !obj.visible })}
                      className="p-1 text-[#86868b] hover:text-[#1d1d1f]"
                      title={obj.visible ? 'Hide' : 'Show'}
                    >
                      {obj.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-[#d1d1d6]" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};
