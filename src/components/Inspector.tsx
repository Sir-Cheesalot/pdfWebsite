// Right Inspector Panel for Properties, Typography, Smart Push & Layer Tree
import React, { useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDownNarrowWide,
  Bold,
  Eye,
  EyeOff,
  Italic,
  Layers,
  Lock,
  MousePointer,
  MoveDown,
  MoveUp,
  Plus,
  Sliders,
  Table as TableIcon,
  Trash2,
  Type,
  Underline,
  Unlock,
} from 'lucide-react';
import { EditableObject, PageModel, ShapeObject, TableObject, TextObject } from '../core/types/model';

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
    <aside className="w-72 bg-slate-900 border-l border-slate-800 flex flex-col h-full select-none shrink-0 z-20 overflow-hidden text-slate-200 text-xs">
      {/* Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-950/40">
        <button
          onClick={() => setActiveTab('properties')}
          className={`flex-1 py-2.5 flex items-center justify-center space-x-1.5 font-medium border-b-2 transition-colors ${
            activeTab === 'properties'
              ? 'border-indigo-500 text-indigo-400 bg-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Properties</span>
        </button>
        <button
          onClick={() => setActiveTab('layers')}
          className={`flex-1 py-2.5 flex items-center justify-center space-x-1.5 font-medium border-b-2 transition-colors ${
            activeTab === 'layers'
              ? 'border-indigo-500 text-indigo-400 bg-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Layers ({activePage.objects.length})</span>
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {activeTab === 'properties' ? (
          selectedObject ? (
            <>
              {/* Header Info */}
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div>
                  <span className="font-semibold text-slate-100 uppercase tracking-wider text-[11px]">
                    {selectedObject.type} Object
                  </span>
                  <div className="text-[10px] text-slate-500">
                    Origin: {selectedObject.origin === 'pdf_source' ? '📄 PDF Content Stream' : '✨ User Element'}
                  </div>
                </div>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => onUpdateObject({ locked: !selectedObject.locked })}
                    className={`p-1.5 rounded ${
                      selectedObject.locked
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                    title={selectedObject.locked ? 'Unlock' : 'Lock'}
                  >
                    {selectedObject.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => onDeleteObject(selectedObject.id)}
                    className="p-1.5 rounded text-red-400 hover:text-red-300 hover:bg-red-950/40 transition-colors"
                    title="Delete Object"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Typography Section (Text Objects) */}
              {isText && textObj && (
                <div className="space-y-3 bg-slate-950/40 p-3 rounded-lg border border-slate-800">
                  <div className="flex items-center space-x-1.5 text-indigo-400 font-semibold text-[11px]">
                    <Type className="w-3.5 h-3.5" />
                    <span>Typography</span>
                  </div>

                  {/* Font Family */}
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Font Family</label>
                    <select
                      value={textObj.fontName}
                      onChange={(e) => onUpdateObject({ fontName: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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

                  {/* Font Size & Line Height */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Size (pt)</label>
                      <input
                        type="number"
                        min={6}
                        max={120}
                        value={Math.round(textObj.fontSize)}
                        onChange={(e) => onUpdateObject({ fontSize: Number(e.target.value) || 12 })}
                        className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Spacing (pt)</label>
                      <input
                        type="number"
                        step={0.5}
                        value={textObj.charSpacing || 0}
                        onChange={(e) => onUpdateObject({ charSpacing: Number(e.target.value) || 0 })}
                        className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  {/* Text Color & Formats */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center space-x-1.5">
                      <button
                        onClick={() => onUpdateObject({ bold: !textObj.bold })}
                        className={`p-1.5 rounded ${
                          textObj.bold ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
                        }`}
                        title="Bold"
                      >
                        <Bold className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onUpdateObject({ italic: !textObj.italic })}
                        className={`p-1.5 rounded ${
                          textObj.italic ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
                        }`}
                        title="Italic"
                      >
                        <Italic className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onUpdateObject({ underline: !textObj.underline })}
                        className={`p-1.5 rounded ${
                          textObj.underline ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
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
                        className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer"
                        title="Text Color"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Shape Properties */}
              {isShape && shapeObj && (
                <div className="space-y-3 bg-slate-950/40 p-3 rounded-lg border border-slate-800">
                  <span className="font-semibold text-indigo-400 text-[11px]">Shape Style</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Fill Color</label>
                      <input
                        type="color"
                        value={shapeObj.fillColor && shapeObj.fillColor.startsWith('#') ? shapeObj.fillColor : '#6366f1'}
                        onChange={(e) => onUpdateObject({ fillColor: e.target.value })}
                        className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Stroke Color</label>
                      <input
                        type="color"
                        value={shapeObj.strokeColor && shapeObj.strokeColor.startsWith('#') ? shapeObj.strokeColor : '#000000'}
                        onChange={(e) => onUpdateObject({ strokeColor: e.target.value })}
                        className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Stroke Width</label>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={shapeObj.strokeWidth}
                      onChange={(e) => onUpdateObject({ strokeWidth: Number(e.target.value) || 1 })}
                      className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200"
                    />
                  </div>
                </div>
              )}

              {/* Table Properties */}
              {isTable && tableObj && (
                <div className="space-y-3 bg-slate-950/40 p-3 rounded-lg border border-slate-800">
                  <div className="flex items-center space-x-1.5 text-emerald-400 font-semibold text-[11px]">
                    <TableIcon className="w-3.5 h-3.5" />
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
                      className="px-2 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium flex items-center justify-center space-x-1"
                    >
                      <Plus className="w-3 h-3 text-emerald-400" />
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
                      className="px-2 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium disabled:opacity-40"
                    >
                      Remove Row
                    </button>
                  </div>
                </div>
              )}

              {/* Geometry & Transform Coordinates */}
              <div className="space-y-3 bg-slate-950/40 p-3 rounded-lg border border-slate-800">
                <span className="font-semibold text-slate-300 text-[11px]">PDF Coordinates & Size</span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">X (pt)</label>
                    <input
                      type="number"
                      value={Math.round(selectedObject.pdfBounds.x)}
                      onChange={(e) =>
                        onUpdateObject({
                          pdfBounds: { ...selectedObject.pdfBounds, x: Number(e.target.value) || 0 },
                          matrix: [selectedObject.matrix[0], selectedObject.matrix[1], selectedObject.matrix[2], selectedObject.matrix[3], Number(e.target.value) || 0, selectedObject.matrix[5]],
                        })
                      }
                      className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Y (pt)</label>
                    <input
                      type="number"
                      value={Math.round(selectedObject.pdfBounds.y)}
                      onChange={(e) =>
                        onUpdateObject({
                          pdfBounds: { ...selectedObject.pdfBounds, y: Number(e.target.value) || 0 },
                          matrix: [selectedObject.matrix[0], selectedObject.matrix[1], selectedObject.matrix[2], selectedObject.matrix[3], selectedObject.matrix[4], Number(e.target.value) || 0],
                        })
                      }
                      className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Width (pt)</label>
                    <input
                      type="number"
                      value={Math.round(selectedObject.pdfBounds.width)}
                      onChange={(e) =>
                        onUpdateObject({
                          pdfBounds: { ...selectedObject.pdfBounds, width: Number(e.target.value) || 10 },
                        })
                      }
                      className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Height (pt)</label>
                    <input
                      type="number"
                      value={Math.round(selectedObject.pdfBounds.height)}
                      onChange={(e) =>
                        onUpdateObject({
                          pdfBounds: { ...selectedObject.pdfBounds, height: Number(e.target.value) || 10 },
                        })
                      }
                      className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200"
                    />
                  </div>
                </div>
              </div>

              {/* Smart Push Layout Repositioner */}
              <div className="space-y-3 bg-amber-950/20 p-3 rounded-lg border border-amber-800/40">
                <div className="flex items-center space-x-1.5 text-amber-400 font-semibold text-[11px]">
                  <ArrowDownNarrowWide className="w-3.5 h-3.5" />
                  <span>Smart Layout Push</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Shift all PDF elements below this object downward to create room or adapt to new content.
                </p>
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    min={5}
                    max={300}
                    step={10}
                    value={pushDelta}
                    onChange={(e) => setPushDelta(Number(e.target.value) || 50)}
                    className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 text-center"
                  />
                  <span className="text-slate-400">pt</span>
                  <button
                    onClick={() => onSmartPush(selectedObject.pdfBounds.y, pushDelta, selectedObject.id)}
                    className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-semibold py-1 px-2.5 rounded shadow-sm transition-colors"
                  >
                    Push Down
                  </button>
                </div>
              </div>

              {/* Layer Ordering Buttons */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <span className="font-semibold text-slate-400 text-[10px] uppercase">Z-Order & Arrangement</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onReorderObject(selectedObject.id, 'front')}
                    className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
                  >
                    Bring to Front
                  </button>
                  <button
                    onClick={() => onReorderObject(selectedObject.id, 'back')}
                    className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
                  >
                    Send to Back
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-slate-500 space-y-2">
              <MousePointer className="w-8 h-8 mx-auto opacity-40 text-indigo-400" />
              <p>Click on any text, table, shape, or image on the canvas to inspect and edit its properties.</p>
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
                  className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border ${
                    isSelected
                      ? 'bg-indigo-600/20 border-indigo-500 text-white'
                      : 'bg-slate-950/40 border-slate-800/60 hover:bg-slate-800/60 text-slate-300'
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    <span className="text-[10px] font-mono text-slate-500 w-4">
                      {idx + 1}
                    </span>
                    <span className="font-medium truncate">
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
                      className="p-1 text-slate-400 hover:text-white"
                      title={obj.visible ? 'Hide' : 'Show'}
                    >
                      {obj.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-slate-600" />}
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
