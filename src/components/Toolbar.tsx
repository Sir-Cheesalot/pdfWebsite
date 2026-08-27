import React, { useRef } from 'react';
import {
  ArrowDownNarrowWide,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  MousePointer,
  Redo2,
  ScanText,
  Square,
  Table as TableIcon,
  Type,
  Undo2,
  Upload,
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
  isLoading?: boolean;
  onRunFullPageOcr?: () => void;
  isOcrRunning?: boolean;
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
  isLoading,
  onRunFullPageOcr,
  isOcrRunning,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onOpenPdf(e.target.files[0]);
      e.target.value = '';
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onInsertImageFile(e.target.files[0]);
      e.target.value = '';
    }
  };

  return (
    <header className="h-13 bg-white/90 backdrop-blur-xl border-b border-black/[0.08] flex items-center justify-between px-4 select-none shrink-0 z-30 shadow-xs">
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

      {/* Left section: Clean App Name & File Actions */}
      <div className="flex items-center space-x-2">
        <div className="flex items-center space-x-2 pr-3 border-r border-black/[0.08]">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-b from-[#1d1d1f] to-[#3a3a3c] flex items-center justify-center font-bold text-white shadow-xs text-xs">
            PDF
          </div>
          <span className="font-semibold text-xs tracking-tight text-[#1d1d1f] hidden sm:inline">
            Editor
          </span>
        </div>

        {/* Upload Button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#1d1d1f] bg-[#f5f5f7] hover:bg-[#e8e8ed] transition-colors border border-black/[0.04] disabled:opacity-50"
          title="Open local PDF"
        >
          <Upload className="w-3.5 h-3.5 text-[#0071e3]" />
          <span>Upload PDF</span>
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
          className="bg-[#f5f5f7] hover:bg-[#e8e8ed] text-[#424245] text-xs rounded-lg px-2.5 py-1.5 border border-black/[0.04] focus:outline-none focus:ring-1 focus:ring-[#0071e3] transition-colors cursor-pointer"
        >
          <option value="" disabled>
            Samples
          </option>
          <option value="invoice">Invoice with Table</option>
          <option value="academic">Academic Report</option>
          <option value="new">Blank Document</option>
        </select>

        {/* Undo / Redo */}
        <div className="flex items-center space-x-0.5 pl-1.5 border-l border-black/[0.08]">
          <button
            onClick={onUndo}
            disabled={!historyState.canUndo}
            className={`p-1.5 rounded-md text-[#424245] transition-colors ${
              historyState.canUndo
                ? 'hover:bg-[#f5f5f7] hover:text-[#1d1d1f]'
                : 'opacity-30 cursor-not-allowed'
            }`}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRedo}
            disabled={!historyState.canRedo}
            className={`p-1.5 rounded-md text-[#424245] transition-colors ${
              historyState.canRedo
                ? 'hover:bg-[#f5f5f7] hover:text-[#1d1d1f]'
                : 'opacity-30 cursor-not-allowed'
            }`}
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Center section: Apple Segmented Tool Palette */}
      <div className="flex items-center space-x-1 bg-[#efeff4] p-0.5 rounded-xl border border-black/[0.04]">
        <button
          onClick={() => onSelectTool('select')}
          className={`flex items-center space-x-1 px-3 py-1 rounded-lg text-xs transition-all ${
            currentTool === 'select'
              ? 'bg-white text-[#1d1d1f] font-semibold shadow-xs'
              : 'text-[#6e6e73] hover:text-[#1d1d1f] font-medium'
          }`}
          title="Select & Move (V)"
        >
          <MousePointer className="w-3.5 h-3.5" />
          <span>Select</span>
        </button>

        <button
          onClick={() => onSelectTool('text')}
          className={`flex items-center space-x-1 px-3 py-1 rounded-lg text-xs transition-all ${
            currentTool === 'text'
              ? 'bg-white text-[#1d1d1f] font-semibold shadow-xs'
              : 'text-[#6e6e73] hover:text-[#1d1d1f] font-medium'
          }`}
          title="Add or Edit Text (T)"
        >
          <Type className="w-3.5 h-3.5" />
          <span>Text</span>
        </button>

        <button
          onClick={() => imageInputRef.current?.click()}
          className="flex items-center space-x-1 px-3 py-1 rounded-lg text-xs font-medium text-[#6e6e73] hover:text-[#1d1d1f] transition-all"
          title="Insert Image (I)"
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <span>Image</span>
        </button>

        <button
          onClick={() => onSelectTool('shape_rect')}
          className={`flex items-center space-x-1 px-3 py-1 rounded-lg text-xs transition-all ${
            currentTool.startsWith('shape')
              ? 'bg-white text-[#1d1d1f] font-semibold shadow-xs'
              : 'text-[#6e6e73] hover:text-[#1d1d1f] font-medium'
          }`}
          title="Add Rectangle"
        >
          <Square className="w-3.5 h-3.5" />
          <span>Shape</span>
        </button>

        <button
          onClick={onOpenTableModal}
          className="flex items-center space-x-1 px-3 py-1 rounded-lg text-xs font-medium text-[#6e6e73] hover:text-[#1d1d1f] transition-all"
          title="Insert Logical Table"
        >
          <TableIcon className="w-3.5 h-3.5" />
          <span>Table</span>
        </button>

        <button
          onClick={() => onSelectTool('smart_push')}
          className={`flex items-center space-x-1 px-3 py-1 rounded-lg text-xs transition-all ${
            currentTool === 'smart_push'
              ? 'bg-[#0071e3] text-white font-semibold shadow-xs'
              : 'text-[#0071e3] hover:bg-white/60 font-medium'
          }`}
          title="Smart Push: Displace downstream content downward"
        >
          <ArrowDownNarrowWide className="w-3.5 h-3.5" />
          <span>Smart Push</span>
        </button>

        {onRunFullPageOcr && (
          <button
            onClick={onRunFullPageOcr}
            disabled={isOcrRunning}
            className="flex items-center space-x-1 px-3 py-1 rounded-lg text-xs font-medium text-[#0071e3] hover:bg-white/80 transition-all border border-[#0071e3]/20 disabled:opacity-50"
            title="Scan entire page with Tesseract OCR & fix corrupted text"
          >
            {isOcrRunning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0071e3]" />
            ) : (
              <ScanText className="w-3.5 h-3.5 text-[#0071e3]" />
            )}
            <span>{isOcrRunning ? 'Scanning OCR...' : 'OCR Fix Page'}</span>
          </button>
        )}
      </div>

      {/* Right section: Zoom, Page Navigation & Clean Apple Blue Export */}
      <div className="flex items-center space-x-3">
        {/* Zoom controls */}
        <div className="flex items-center space-x-1 bg-[#efeff4] rounded-lg px-1.5 py-0.5 border border-black/[0.04]">
          <button
            onClick={() => onZoomChange(Math.max(0.4, zoom - 0.15))}
            className="p-1 text-[#6e6e73] hover:text-[#1d1d1f] rounded"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-medium text-[#1d1d1f] w-10 text-center font-mono">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => onZoomChange(Math.min(2.5, zoom + 0.15))}
            className="p-1 text-[#6e6e73] hover:text-[#1d1d1f] rounded"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Page Switcher */}
        <div className="flex items-center space-x-1 text-xs text-[#6e6e73] font-medium bg-[#efeff4] px-1.5 py-0.5 rounded-lg border border-black/[0.04]">
          <button
            onClick={() => onPageChange(Math.max(0, currentPageIndex - 1))}
            disabled={currentPageIndex <= 0}
            className="p-1 hover:text-[#1d1d1f] disabled:opacity-30"
          >
            <ChevronLeft className="w-3 h-3" />
          </button>
          <span className="px-1 text-[#1d1d1f]">
            {currentPageIndex + 1} / {doc.pages.length}
          </span>
          <button
            onClick={() => onPageChange(Math.min(doc.pages.length - 1, currentPageIndex + 1))}
            disabled={currentPageIndex >= doc.pages.length - 1}
            className="p-1 hover:text-[#1d1d1f] disabled:opacity-30"
          >
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>

        {/* Apple Blue Export Button */}
        <button
          onClick={onExportPdf}
          className="flex items-center space-x-1.5 bg-[#0071e3] hover:bg-[#0077ed] active:scale-[0.98] text-white text-xs font-medium px-3.5 py-1.5 rounded-lg shadow-xs transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export PDF</span>
        </button>
      </div>
    </header>
  );
};
