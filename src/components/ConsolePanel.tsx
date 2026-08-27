// Apple-Style Live PDF Drawing & Edit Activity Console
import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Code2,
  Copy,
  Info,
  Layers,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react';

export interface LogEntry {
  id: string;
  timestamp: string;
  category: 'PARSE' | 'EDIT' | 'OPERATOR' | 'STREAM' | 'STATE' | 'INFO' | 'WARN';
  message: string;
  details?: any;
}

interface ConsolePanelProps {
  logs: LogEntry[];
  onClearLogs: () => void;
  editedCount: number;
  totalObjectsCount: number;
}

export const ConsolePanel: React.FC<ConsolePanelProps> = ({
  logs,
  onClearLogs,
  editedCount,
  totalObjectsCount,
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'EDIT' | 'OPERATOR' | 'STATE'>('ALL');

  const filteredLogs = logs.filter((log) => {
    if (activeFilter === 'ALL') return true;
    return log.category === activeFilter;
  });

  const getBadgeColor = (category: LogEntry['category']) => {
    switch (category) {
      case 'EDIT':
        return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
      case 'OPERATOR':
        return 'bg-[#0071e3]/10 text-[#0071e3] border-[#0071e3]/20';
      case 'STREAM':
        return 'bg-purple-500/10 text-purple-600 border-purple-500/20';
      case 'STATE':
        return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
      case 'WARN':
        return 'bg-rose-500/10 text-rose-600 border-rose-500/20';
      default:
        return 'bg-black/5 text-[#6e6e73] border-black/10';
    }
  };

  return (
    <div className="border-t border-black/[0.08] bg-white text-[#1d1d1f] shadow-lg flex flex-col transition-all z-30">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#fbfbfd] border-b border-black/[0.06] select-none">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center space-x-1.5 text-xs font-semibold text-[#1d1d1f] hover:text-[#0071e3] transition-colors"
          >
            <Terminal className="w-4 h-4 text-[#0071e3]" />
            <span>PDF Engine Live Console</span>
            {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-[#86868b]" /> : <ChevronUp className="w-3.5 h-3.5 text-[#86868b]" />}
          </button>

          {/* State Trackers */}
          <div className="flex items-center space-x-2 pl-3 border-l border-black/[0.1] text-[11px]">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium border border-emerald-200/60">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
              Unedited: {Math.max(0, totalObjectsCount - editedCount)} (100% Original)
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium border border-amber-200/60">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5" />
              Edited: {editedCount}
            </span>
          </div>
        </div>

        {/* Filter Controls & Clear */}
        <div className="flex items-center space-x-2">
          {isOpen && (
            <div className="flex items-center bg-black/[0.04] p-0.5 rounded-lg text-[11px]">
              {(['ALL', 'EDIT', 'OPERATOR', 'STATE'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setActiveFilter(filter)}
                  className={`px-2.5 py-0.5 rounded-md font-medium transition-all ${
                    activeFilter === filter
                      ? 'bg-white text-[#1d1d1f] shadow-xs'
                      : 'text-[#86868b] hover:text-[#1d1d1f]'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={onClearLogs}
            title="Clear Console Logs"
            className="p-1 text-[#86868b] hover:text-[#e02020] rounded hover:bg-black/[0.04] transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Expandable Log Feed */}
      {isOpen && (
        <div className="h-36 overflow-y-auto p-2.5 font-mono text-[11px] leading-relaxed bg-[#fbfbfd] space-y-1 select-text">
          {filteredLogs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[#86868b] italic">
              No activity logs recorded yet. Upload a PDF or edit any text element to trace drawing instructions.
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-start space-x-2 py-0.5 px-1.5 rounded hover:bg-black/[0.03] transition-colors group"
              >
                <span className="text-[#86868b] shrink-0 font-sans text-[10px] pt-0.5">{log.timestamp}</span>
                <span
                  className={`inline-block px-1.5 py-0.2 rounded text-[9px] font-bold border uppercase tracking-wider ${getBadgeColor(
                    log.category
                  )}`}
                >
                  {log.category}
                </span>
                <span className="text-[#1d1d1f] flex-1 break-all">{log.message}</span>
                {log.details && (
                  <span className="text-[#86868b] text-[10px] group-hover:text-[#1d1d1f] transition-colors">
                    {typeof log.details === 'string' ? log.details : JSON.stringify(log.details)}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
