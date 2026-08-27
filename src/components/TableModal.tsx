// Minimalist Apple White Modal for Creating Tables
import React, { useState } from 'react';
import { Table as TableIcon, X } from 'lucide-react';
import { TableCell, TableObject } from '../core/types/model';

interface TableModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateTable: (table: TableObject) => void;
  pageIndex: number;
}

export const TableModal: React.FC<TableModalProps> = ({
  isOpen,
  onClose,
  onCreateTable,
  pageIndex,
}) => {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [includeHeader, setIncludeHeader] = useState(true);
  const [headerBg, setHeaderBg] = useState('#1d1d1f');
  const [headerTextColor, setHeaderTextColor] = useState('#ffffff');
  const [cellBg, setCellBg] = useState('#f5f5f7');
  const [borderColor, setBorderColor] = useState('#d1d1d6');

  if (!isOpen) return null;

  const handleCreate = () => {
    const defaultColWidth = 100;
    const defaultRowHeight = 28;
    const colWidths = Array(cols).fill(defaultColWidth);
    const rowHeights = Array(rows).fill(defaultRowHeight);

    const cells: TableCell[][] = [];
    for (let r = 0; r < rows; r++) {
      const rowCells: TableCell[] = [];
      const isHeaderRow = includeHeader && r === 0;

      for (let c = 0; c < cols; c++) {
        rowCells.push({
          id: `cell_${r}_${c}_${Date.now()}`,
          row: r,
          col: c,
          text: isHeaderRow ? `Header ${c + 1}` : `Data ${r},${c + 1}`,
          fontName: isHeaderRow ? 'Helvetica-Bold' : 'Helvetica',
          fontSize: isHeaderRow ? 11 : 10,
          textColor: isHeaderRow ? headerTextColor : '#1d1d1f',
          bgColor: isHeaderRow ? headerBg : r % 2 === 1 ? cellBg : '#ffffff',
          borderWidth: 1,
          borderColor: borderColor,
          bold: isHeaderRow,
          italic: false,
          alignment: 'left',
          padding: 6,
        });
      }
      cells.push(rowCells);
    }

    const tableW = cols * defaultColWidth;
    const tableH = rows * defaultRowHeight;

    const tableObj: TableObject = {
      id: `table_${Date.now()}`,
      type: 'table',
      origin: 'user_created',
      pageIndex,
      pdfBounds: { x: 50, y: 500, width: tableW, height: tableH },
      matrix: [1, 0, 0, 1, 50, 500],
      rotation: 0,
      zIndex: 20,
      opacity: 1,
      visible: true,
      locked: false,
      rows,
      cols,
      colWidths,
      rowHeights,
      cells,
      globalBorderColor: borderColor,
      globalBorderWidth: 1,
    };

    onCreateTable(tableObj);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-black/[0.08] rounded-2xl max-w-sm w-full p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150 text-[#1d1d1f]">
        <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
          <div className="flex items-center space-x-1.5 text-[#1d1d1f]">
            <TableIcon className="w-4 h-4 text-[#0071e3]" />
            <h3 className="text-sm font-semibold">Insert Table</h3>
          </div>
          <button onClick={onClose} className="p-1 text-[#86868b] hover:text-[#1d1d1f] rounded-md">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3.5 py-4">
          {/* Row & Col count */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#6e6e73] mb-1">Rows</label>
              <input
                type="number"
                min={1}
                max={20}
                value={rows}
                onChange={(e) => setRows(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full bg-[#f5f5f7] border border-black/[0.08] rounded-lg px-3 py-1.5 text-xs text-[#1d1d1f] focus:outline-none focus:ring-1 focus:ring-[#0071e3]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6e6e73] mb-1">Columns</label>
              <input
                type="number"
                min={1}
                max={10}
                value={cols}
                onChange={(e) => setCols(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full bg-[#f5f5f7] border border-black/[0.08] rounded-lg px-3 py-1.5 text-xs text-[#1d1d1f] focus:outline-none focus:ring-1 focus:ring-[#0071e3]"
              />
            </div>
          </div>

          {/* Header toggle */}
          <div className="flex items-center space-x-2 pt-1">
            <input
              type="checkbox"
              id="hdr"
              checked={includeHeader}
              onChange={(e) => setIncludeHeader(e.target.checked)}
              className="w-4 h-4 rounded text-[#0071e3] border-black/[0.1] focus:ring-[#0071e3]"
            />
            <label htmlFor="hdr" className="text-xs text-[#1d1d1f] select-none cursor-pointer">
              Styled Header Row
            </label>
          </div>

          {/* Colors */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-xs font-medium text-[#6e6e73] mb-1">Header Color</label>
              <div className="flex items-center space-x-2">
                <input
                  type="color"
                  value={headerBg}
                  onChange={(e) => setHeaderBg(e.target.value)}
                  className="w-7 h-7 rounded-lg border border-black/[0.1] bg-transparent cursor-pointer"
                />
                <span className="text-[10px] text-[#86868b] font-mono">{headerBg}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6e6e73] mb-1">Border Color</label>
              <div className="flex items-center space-x-2">
                <input
                  type="color"
                  value={borderColor}
                  onChange={(e) => setBorderColor(e.target.value)}
                  className="w-7 h-7 rounded-lg border border-black/[0.1] bg-transparent cursor-pointer"
                />
                <span className="text-[10px] text-[#86868b] font-mono">{borderColor}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end space-x-2 pt-3 border-t border-black/[0.06]">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-[#6e6e73] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[#0071e3] hover:bg-[#0077ed] text-white shadow-xs transition-all"
          >
            Insert Table
          </button>
        </div>
      </div>
    </div>
  );
};
