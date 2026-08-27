// Minimalist Apple White Left Sidebar for Page Thumbnails and Management
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
    <aside className="w-52 bg-white border-r border-black/[0.08] flex flex-col h-full select-none shrink-0 z-20">
      {/* Header */}
      <div className="px-3.5 py-3 border-b border-black/[0.06] flex items-center justify-between">
        <div className="flex items-center space-x-1.5 text-[#1d1d1f]">
          <Layers className="w-3.5 h-3.5 text-[#0071e3]" />
          <span className="text-xs font-semibold tracking-tight">Pages ({doc.pages.length})</span>
        </div>
        <button
          onClick={onAddPage}
          className="p-1 rounded-md text-[#0071e3] hover:bg-[#f5f5f7] transition-colors"
          title="Add Blank Page"
        >
          <FilePlus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Thumbnails list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {doc.pages.map((page, idx) => {
          const isActive = idx === activePageIndex;
          const aspectRatio = (page.height / page.width) * 100;

          return (
            <div
              key={`page_thumb_${idx}`}
              onClick={() => onSelectPage(idx)}
              className={`group relative rounded-xl p-2 cursor-pointer transition-all border ${
                isActive
                  ? 'bg-[#f5f5f7] border-[#0071e3] ring-1 ring-[#0071e3] shadow-xs'
                  : 'bg-white border-black/[0.06] hover:bg-[#fafafa] hover:border-black/[0.12]'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5 px-0.5">
                <span className={`text-[11px] font-medium ${isActive ? 'text-[#0071e3] font-semibold' : 'text-[#6e6e73]'}`}>
                  Page {idx + 1}
                </span>
                <span className="text-[10px] text-[#86868b]">
                  {page.objects.length} obj
                </span>
              </div>

              {/* Page Visual Preview Box */}
              <div
                className="w-full bg-white rounded-lg shadow-xs relative overflow-hidden flex flex-col items-center justify-center border border-black/[0.08]"
                style={{ paddingBottom: `${Math.min(130, aspectRatio)}%` }}
              >
                {/* Micro preview representations */}
                <div className="absolute inset-2 flex flex-col space-y-1 overflow-hidden opacity-40">
                  {page.objects.slice(0, 5).map((obj) => (
                    <div
                      key={obj.id}
                      className={`h-1.5 rounded-xs ${
                        obj.type === 'text'
                          ? 'bg-[#1d1d1f] w-3/4'
                          : obj.type === 'table'
                          ? 'bg-[#0071e3] w-full'
                          : obj.type === 'image'
                          ? 'bg-[#34c759] w-1/2 h-2.5'
                          : 'bg-[#ff9500] w-2/3'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Quick actions on hover */}
              <div className="absolute top-2 right-2 hidden group-hover:flex items-center space-x-1 bg-white/95 backdrop-blur-xs p-0.5 rounded-lg border border-black/[0.08] shadow-xs">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicatePage(idx);
                  }}
                  className="p-1 text-[#6e6e73] hover:text-[#1d1d1f] rounded-md hover:bg-[#f5f5f7]"
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
                    className="p-1 text-[#ff3b30] hover:text-[#d70015] rounded-md hover:bg-red-50"
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
