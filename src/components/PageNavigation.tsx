// Left Sidebar for Page Thumbnails and Management
import React from 'react';
import { Copy, FilePlus, Layers, Trash2 } from 'lucide-react';
import { DocumentModel } from '../core/types/model';

interface PageNavigationProps {
  doc: DocumentModel;
  activePageIndex: number;
  onSelectPage: (index: number) => void;
  onAddPage: () => void;
  onDuplicatePage: (index: number) => void;
  onDeletePage: (index: number) => void;
}

export const PageNavigation: React.FC<PageNavigationProps> = ({
  doc,
  activePageIndex,
  onSelectPage,
  onAddPage,
  onDuplicatePage,
  onDeletePage,
}) => {
  return (
    <aside className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col h-full select-none shrink-0 z-20">
      {/* Header */}
      <div className="p-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2 text-slate-300">
          <Layers className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-semibold uppercase tracking-wider">Pages ({doc.pages.length})</span>
        </div>
        <button
          onClick={onAddPage}
          className="p-1 rounded bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 hover:text-white transition-colors"
          title="Add Blank Page"
        >
          <FilePlus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Thumbnails list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {doc.pages.map((page, idx) => {
          const isActive = idx === activePageIndex;
          const aspectRatio = (page.height / page.width) * 100;

          return (
            <div
              key={`page_thumb_${idx}`}
              onClick={() => onSelectPage(idx)}
              className={`group relative rounded-lg p-2 cursor-pointer transition-all border ${
                isActive
                  ? 'bg-slate-800/90 border-indigo-500 shadow-md shadow-indigo-500/10 ring-1 ring-indigo-500'
                  : 'bg-slate-950/40 border-slate-800 hover:bg-slate-800/50 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5 px-0.5">
                <span className={`text-[11px] font-semibold ${isActive ? 'text-indigo-400' : 'text-slate-400'}`}>
                  Page {idx + 1}
                </span>
                <span className="text-[10px] text-slate-500">
                  {page.objects.length} obj
                </span>
              </div>

              {/* Page Visual Preview Box */}
              <div
                className="w-full bg-white rounded shadow-inner relative overflow-hidden flex flex-col items-center justify-center border border-slate-300"
                style={{ paddingBottom: `${Math.min(130, aspectRatio)}%` }}
              >
                {/* Micro preview representations */}
                <div className="absolute inset-2 flex flex-col space-y-1 overflow-hidden opacity-60">
                  {page.objects.slice(0, 6).map((obj) => (
                    <div
                      key={obj.id}
                      className={`h-1.5 rounded-xs ${
                        obj.type === 'text'
                          ? 'bg-slate-700 w-3/4'
                          : obj.type === 'table'
                          ? 'bg-indigo-400 w-full'
                          : obj.type === 'image'
                          ? 'bg-sky-400 w-1/2 h-3'
                          : 'bg-amber-400 w-2/3'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Quick actions on hover */}
              <div className="absolute top-2 right-2 hidden group-hover:flex items-center space-x-1 bg-slate-900/90 backdrop-blur-xs p-1 rounded border border-slate-700 shadow-lg">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicatePage(idx);
                  }}
                  className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                  title="Duplicate Page"
                >
                  <Copy className="w-3 h-3" />
                </button>
                {doc.pages.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeletePage(idx);
                    }}
                    className="p-1 text-red-400 hover:text-red-300 rounded hover:bg-red-950"
                    title="Delete Page"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
};
