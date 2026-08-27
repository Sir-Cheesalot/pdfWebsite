// Top Toolbar Component
import React, { useRef } from 'react';
import {
  ArrowDownNarrowWide,
  Circle,
  Download,
  FolderOpen,
  Image as ImageIcon,
  Minus,
  MousePointer,
  Plus,
  Redo2,
  RotateCcw,
  Square,
  Table as TableIcon,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { DocumentModel } from '../core/types/model';
import { HistoryState } from '../core/types/history';

export type ToolMode = 'select' | 'text' | 'image' | 'shape_rect' | 'shape_circle' | 'shape_line' | 'table' | 'smart_push';

interface ToolbarProps {
  currentTool: ToolMode;
  onSelectTool: (tool: ToolMode) => void;
  doc: DocumentModel;
  historyState: HistoryState;
  onUndo: () => void;
  onRedo: () => void;
  onExportPdf: () => void;
  onOpenPdf: (file: File) => void;
  onLoadSample: (sampleType: 'invoice' | 'academic') => void;
  onNewDocument: () => void;
  zoom: number;
  onZoomChange: (newZoom: number) => void;
  currentPageIndex: number;
  onPageChange: (index: number) => void;
  onInsertImageFile: (file: File) => void;
  onOpenTableModal: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  currentTool,
  onSelectTool,
  doc,
  historyState,
  onUndo,
  onRedo,
  onExportPdf,
  onOpenPdf,
  onLoadSample,
  onNewDocument,
  zoom,
  onZoomChange,
  currentPageIndex,
  onPageChange,
  onInsertImageFile,
  onOpenTableModal,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onOpenPdf(e.target.files[0]);
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onInsertImageFile(e.target.files[0]);
    }
  };

  return (
    <header className="h-14 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 select-none shrink-0 z-30">
      {/* Hidden file inputs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".pdf"
        className="hidden"
      />
      <input
        type="file"
        ref={imageInputRef}
        onChange={handleImageChange}
        accept="image/*"
        className="hidden"
      />

      {/* Left section: App Brand & File Operations */}
      <div className="flex items-center space-x-2">
        <div className="flex items-center space-x-2 pr-3 border-r border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-500/20 text-sm">
            PDF
          </div>
          <span className="font-semibold text-sm tracking-wide text-slate-100 hidden sm:inline">
            WYSIWYG <span className="text-indigo-400 font-bold">Pro</span>
          </span>
        </div>

        {/* File Actions */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
          title="Open local PDF"
        >
          <FolderOpen className="w-4 h-4 text-sky-400" />
          <span>Open PDF</span>
        </button>

        {/* Sample selector */}
        <select
          onChange={(e) => {
            if (e.target.value === 'invoice') onLoadSample('invoice');
            if (e.target.value === 'academic') onLoadSample('academic');
            if (e.target.value === 'new') onNewDocument();
            e.target.value = '';
          }}
          defaultValue=""
          className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-md px-2 py-1.5 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
        >
          <option value="" disabled>
            ⚡ Load Sample
          </option>
          <option value="invoice">💼 Invoice with Table & Layout</option>
          <option value="academic">📄 Academic Research Report</option>
          <option value="new">✨ Blank Document</option>
        </select>

        {/* Undo / Redo */}
        <div className="flex items-center space-x-0.5 pl-2 border-l border-slate-800">
          <button
            onClick={onUndo}
            disabled={!historyState.canUndo}
            className={`p-1.5 rounded text-slate-300 transition-colors ${
              historyState.canUndo
                ? 'hover:bg-slate-800 hover:text-white'
                : 'opacity-40 cursor-not-allowed'
            }`}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={onRedo}
            disabled={!historyState.canRedo}
            className={`p-1.5 rounded text-slate-300 transition-colors ${
              historyState.canRedo
                ? 'hover:bg-slate-800 hover:text-white'
                : 'opacity-40 cursor-not-allowed'
            }`}
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Center section: Editing Tools */}
      <div className="flex items-center space-x-1 bg-slate-950/70 p-1 rounded-lg border border-slate-800">
        <button
          onClick={() => onSelectTool('select')}
          className={`flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-medium transition-all ${
            currentTool === 'select'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title="Select & Move (V)"
        >
          <MousePointer className="w-3.5 h-3.5" />
          <span>Select</span>
        </button>

        <button
          onClick={() => onSelectTool('text')}
          className={`flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-medium transition-all ${
            currentTool === 'text'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title="Add or Edit Text (T)"
        >
          <Type className="w-3.5 h-3.5" />
          <span>Text</span>
        </button>

        <button
          onClick={() => imageInputRef.current?.click()}
          className="flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all"
          title="Insert Image (I)"
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <span>Image</span>
        </button>

        {/* Shape dropdown */}
        <button
          onClick={() => onSelectTool('shape_rect')}
          className={`flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-medium transition-all ${
            currentTool.startsWith('shape')
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title="Add Rectangle"
        >
          <Square className="w-3.5 h-3.5" />
          <span>Shape</span>
        </button>

        {/* Table creator */}
        <button
          onClick={onOpenTableModal}
          className="flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all"
          title="Insert Logical Table"
        >
          <TableIcon className="w-3.5 h-3.5 text-emerald-400" />
          <span>Table</span>
        </button>

        {/* Smart Push Tool */}
        <button
          onClick={() => onSelectTool('smart_push')}
          className={`flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-medium transition-all ${
            currentTool === 'smart_push'
              ? 'bg-amber-600 text-white shadow-sm ring-1 ring-amber-400'
              : 'text-amber-400 hover:text-amber-300 hover:bg-slate-800'
          }`}
          title="Smart Push: Displace downstream content downward"
        >
          <ArrowDownNarrowWide className="w-3.5 h-3.5" />
          <span>Smart Push</span>
        </button>
      </div>

      {/* Right section: Zoom, Page Navigation & Export */}
      <div className="flex items-center space-x-3">
        {/* Zoom controls */}
        <div className="flex items-center space-x-1 bg-slate-800/80 rounded-md px-1.5 py-0.5 border border-slate-700">
          <button
            onClick={() => onZoomChange(Math.max(0.4, zoom - 0.15))}
            className="p-1 text-slate-400 hover:text-white rounded"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-medium text-slate-300 w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => onZoomChange(Math.min(2.5, zoom + 0.15))}
            className="p-1 text-slate-400 hover:text-white rounded"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Page Switcher */}
        <div className="flex items-center space-x-1 text-xs text-slate-400">
          <button
            onClick={() => onPageChange(Math.max(0, currentPageIndex - 1))}
            disabled={currentPageIndex <= 0}
            className="p-1 hover:text-white disabled:opacity-30"
          >
            &lt;
          </button>
          <span>
            {currentPageIndex + 1} / {doc.pages.length}
          </span>
          <button
            onClick={() => onPageChange(Math.min(doc.pages.length - 1, currentPageIndex + 1))}
            disabled={currentPageIndex >= doc.pages.length - 1}
            className="p-1 hover:text-white disabled:opacity-30"
          >
            &gt;
          </button>
        </div>

        {/* Export Button */}
        <button
          onClick={onExportPdf}
          className="flex items-center space-x-1.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold px-3.5 py-1.5 rounded-md shadow-md shadow-indigo-500/25 transition-all transform active:scale-95"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export PDF</span>
        </button>
      </div>
    </header>
  );
};
