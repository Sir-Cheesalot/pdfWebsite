// Modal for Creating / Configuring Tables
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
  const [headerBg, setHeaderBg] = useState('#1e293b');
  const [headerTextColor, setHeaderTextColor] = useState('#ffffff');
  const [cellBg, setCellBg] = useState('#f8fafc');
  const [borderColor, setBorderColor] = useState('#cbd5e1');

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
          textColor: isHeaderRow ? headerTextColor : '#0f172a',
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-2 text-indigo-400">
            <TableIcon className="w-5 h-5" />
            <h3 className="text-base font-semibold text-white">Insert Table</h3>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 py-4">
          {/* Row & Col count */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Rows</label>
              <input
                type="number"
                min={1}
                max={20}
                value={rows}
                onChange={(e) => setRows(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Columns</label>
              <input
                type="number"
                min={1}
                max={10}
                value={cols}
                onChange={(e) => setCols(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Header toggle */}
          <div className="flex items-center space-x-2 pt-2">
            <input
              type="checkbox"
              id="hdr"
              checked={includeHeader}
              onChange={(e) => setIncludeHeader(e.target.checked)}
              className="w-4 h-4 rounded text-indigo-600 bg-slate-800 border-slate-700 focus:ring-indigo-500"
            />
            <label htmlFor="hdr" className="text-xs text-slate-300 select-none cursor-pointer">
              Include styled Header Row
            </label>
          </div>

          {/* Colors */}
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Header Color</label>
              <div className="flex items-center space-x-2">
                <input
                  type="color"
                  value={headerBg}
                  onChange={(e) => setHeaderBg(e.target.value)}
                  className="w-8 h-8 rounded border-0 bg-transparent cursor-pointer"
                />
                <span className="text-xs text-slate-400 font-mono">{headerBg}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Border Color</label>
              <div className="flex items-center space-x-2">
                <input
                  type="color"
                  value={borderColor}
                  onChange={(e) => setBorderColor(e.target.value)}
                  className="w-8 h-8 rounded border-0 bg-transparent cursor-pointer"
                />
                <span className="text-xs text-slate-400 font-mono">{borderColor}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-all"
          >
            Insert Table
          </button>
        </div>
      </div>
    </div>
  );
};
