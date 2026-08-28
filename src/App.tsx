// Main Application Component for True WYSIWYG PDF Editor (Apple White Edition)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DocumentModel,
  EditableObject,
  ImageObject,
  PageModel,
  Rect,
  ShapeObject,
  TableObject,
  TextObject,
} from './core/types/model';
import { HistoryState } from './core/types/history';
import {
  ChangeStyleCommand,
  CommandManager,
  DeleteObjectCommand,
  EditTextCommand,
  InsertObjectCommand,
  MoveObjectCommand,
  ResizeObjectCommand,
  SmartPushCommand,
  UpdateTableCommand,
} from './core/history/CommandManager';
import { DocumentModelManager } from './core/model/DocumentModel';
import { PdfWriter } from './core/exporter/PdfWriter';
import { Toolbar, ToolMode } from './components/Toolbar';
import { PageNavigation } from './components/PageNavigation';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/Inspector';
import { TableModal } from './components/TableModal';
import { ConsolePanel, LogEntry } from './components/ConsolePanel';
import { Loader2, Upload } from 'lucide-react';
import { inspectPdfOperatorText, OperatorTextLine } from './core/pdf/PdfJsOperatorInspector';

export const App: React.FC = () => {
  const [doc, setDoc] = useState<DocumentModel>(() => DocumentModelManager.createBlankDocument('Untitled Document.pdf'));
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [currentTool, setCurrentTool] = useState<ToolMode>('select');
  const [zoom, setZoom] = useState(1.0);
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [operatorTextLines, setOperatorTextLines] = useState<OperatorTextLine[]>([]);
  const [currentSourcePdf, setCurrentSourcePdf] = useState<ArrayBuffer | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: 'init_1',
      timestamp: new Date().toLocaleTimeString(),
      category: 'INFO',
      message: 'PDF Engine ready. Upload a document or create elements.',
    },
  ]);
  const pdfSourceRef = useRef<ArrayBuffer | null>(null);

  const addLog = (category: LogEntry['category'], message: string, details?: any) => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString() + '.' + String(now.getMilliseconds()).padStart(3, '0');
    const entry: LogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: timeStr,
      category,
      message,
      details,
    };
    setLogs((prev) => [entry, ...prev.slice(0, 199)]);
  };

  const [historyState, setHistoryState] = useState<HistoryState>({
    canUndo: false,
    canRedo: false,
    undoStackSize: 0,
    redoStackSize: 0,
  });

  const commandManager = useMemo(() => {
    return new CommandManager((state) => setHistoryState(state));
  }, []);

  const activePage = doc.pages[activePageIndex] || doc.pages[0];
  const selectedObject = activePage?.objects.find((o) => o.id === selectedObjectId) || null;

  const totalObjectsCount = doc.pages.reduce((acc, p) => acc + p.objects.length, 0);
  const editedCount = doc.pages.reduce(
    (acc, p) => acc + p.objects.filter((o) => o.isModified || o.origin === 'user_created').length,
    0
  );

  useEffect(() => {
    if (!pdfSourceRef.current) return;
    let cancelled = false;
    inspectPdfOperatorText(pdfSourceRef.current, activePageIndex + 1)
      .then((lines) => {
        if (!cancelled) {
          setOperatorTextLines(lines);
          addLog(
            'OPERATOR',
            `Page ${activePageIndex + 1}: Indexed ${lines.length} PDF text operator instructions (Tj/TJ/showText)`
          );
        }
      })
      .catch((error) => {
        console.warn('PDF operator inspection unavailable:', error);
        if (!cancelled) setOperatorTextLines([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activePageIndex, doc.id]);

  // --- Global Drag and Drop File Upload ---
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types.includes('Files')) {
        setIsDraggingFile(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      if (e.clientX === 0 || e.clientY === 0) {
        setIsDraggingFile(false);
      }
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingFile(false);
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
          await handleOpenPdf(file);
        }
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedObjectId) {
          e.preventDefault();
          handleDeleteObject(selectedObjectId);
        }
      } else if (e.key.toLowerCase() === 'v') {
        setCurrentTool('select');
      } else if (e.key.toLowerCase() === 't') {
        setCurrentTool('text');
      } else if (e.key.toLowerCase() === 'r') {
        setCurrentTool('shape_rect');
      } else if (e.key.toLowerCase() === 'c') {
        setCurrentTool('shape_circle');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedObjectId, doc]);

  // --- Actions ---
  const handleUndo = () => {
    const newDoc = commandManager.undo(doc);
    setDoc(newDoc);
    addLog('STATE', 'Undo executed');
  };

  const handleRedo = () => {
    const newDoc = commandManager.redo(doc);
    setDoc(newDoc);
    addLog('STATE', 'Redo executed');
  };

  const handleCommitTextEdit = (objectId: string, newText: string, oldText: string) => {
    const cmd = new EditTextCommand(activePageIndex, objectId, newText, oldText);
    const newDoc = commandManager.execute(cmd, doc);
    setDoc(newDoc);

    addLog('EDIT', `Text modified: "${oldText}" ➔ "${newText}"`, { objectId, page: activePageIndex + 1 });

    // Surgically update the underlying PDF.js drawing instruction
    const targetObj = activePage?.objects.find((o) => o.id === objectId);
    if (targetObj && targetObj.type === 'text') {
      const targetText = targetObj as TextObject;
      const matchingLine = operatorTextLines.find((line) => {
        const baselineY = targetText.pdfBounds.y + 0.22 * targetText.fontSize;
        return (
          Math.abs(line.y - baselineY) < 3.5 ||
          (oldText.length > 3 && line.text.includes(oldText.slice(0, 8)))
        );
      });
      if (matchingLine) {
        matchingLine.applyEdit(newText);
        setOperatorTextLines([...operatorTextLines]);
        addLog(
          'STREAM',
          `Mutated PDF drawing instruction at baseline Y=${matchingLine.y.toFixed(1)} (Ops: [${matchingLine.operatorIndexes.join(
            ', '
          )}])`
        );
      }
    }
  };

  const handleCommitObjectMove = (objectId: string, dxPdf: number, dyPdf: number, initialBounds?: Rect) => {
    const targetObj = activePage?.objects.find((o) => o.id === objectId);
    let newDoc = doc;

    if (targetObj && targetObj.origin === 'pdf_source' && initialBounds) {
      // Create a solid background mask over the source coordinates to erase the original canvas image/text
      const maskShape: ShapeObject = {
        id: `mask_${Date.now()}`,
        type: 'shape',
        shapeType: 'rect',
        origin: 'user_created',
        pageIndex: activePageIndex,
        pdfBounds: { ...initialBounds },
        matrix: [1, 0, 0, 1, initialBounds.x, initialBounds.y],
        rotation: 0,
        zIndex: 0,
        opacity: 1,
        visible: true,
        locked: true,
        fillColor: '#ffffff',
        strokeColor: 'transparent',
        strokeWidth: 0,
        isModified: true,
      };
      const insertMaskCmd = new InsertObjectCommand(activePageIndex, maskShape);
      newDoc = commandManager.execute(insertMaskCmd, newDoc);
      targetObj.origin = 'user_created';
    }

    const cmd = new MoveObjectCommand(activePageIndex, objectId, dxPdf, dyPdf);
    newDoc = commandManager.execute(cmd, newDoc);
    setDoc(newDoc);
    addLog('EDIT', `Moved object "${objectId}" by (Δx: ${dxPdf.toFixed(1)}pt, Δy: ${dyPdf.toFixed(1)}pt)`);
  };

  const handleCommitObjectResize = (objectId: string, newBounds: Rect, oldBounds: Rect) => {
    const targetObj = activePage?.objects.find((o) => o.id === objectId);
    let newDoc = doc;

    if (targetObj && targetObj.origin === 'pdf_source' && oldBounds) {
      const maskShape: ShapeObject = {
        id: `mask_${Date.now()}`,
        type: 'shape',
        shapeType: 'rect',
        origin: 'user_created',
        pageIndex: activePageIndex,
        pdfBounds: { ...oldBounds },
        matrix: [1, 0, 0, 1, oldBounds.x, oldBounds.y],
        rotation: 0,
        zIndex: 0,
        opacity: 1,
        visible: true,
        locked: true,
        fillColor: '#ffffff',
        strokeColor: 'transparent',
        strokeWidth: 0,
        isModified: true,
      };
      const insertMaskCmd = new InsertObjectCommand(activePageIndex, maskShape);
      newDoc = commandManager.execute(insertMaskCmd, newDoc);
      targetObj.origin = 'user_created';
    }

    const cmd = new ResizeObjectCommand(activePageIndex, objectId, newBounds, oldBounds);
    newDoc = commandManager.execute(cmd, newDoc);
    setDoc(newDoc);
    addLog('EDIT', `Resized object "${objectId}" to (${newBounds.width.toFixed(1)} × ${newBounds.height.toFixed(1)}) pt`);
  };

  const handleInsertNewObject = (newObj: EditableObject) => {
    const cmd = new InsertObjectCommand(activePageIndex, newObj);
    const newDoc = commandManager.execute(cmd, doc);
    setDoc(newDoc);
    setSelectedObjectId(newObj.id);
    setCurrentTool('select');
    addLog('EDIT', `Inserted new ${newObj.type} object ("${newObj.id}")`);
  };

  const handleDeleteObject = (objectId: string) => {
    const targetObj = activePage?.objects.find((o) => o.id === objectId);
    let newDoc = doc;

    if (targetObj && targetObj.origin === 'pdf_source') {
      // Create a solid background mask over the source coordinates to erase the original canvas image/text
      const maskShape: ShapeObject = {
        id: `mask_${Date.now()}`,
        type: 'shape',
        shapeType: 'rect',
        origin: 'user_created',
        pageIndex: activePageIndex,
        pdfBounds: { ...targetObj.pdfBounds },
        matrix: [1, 0, 0, 1, targetObj.pdfBounds.x, targetObj.pdfBounds.y],
        rotation: 0,
        zIndex: 0,
        opacity: 1,
        visible: true,
        locked: true,
        fillColor: '#ffffff',
        strokeColor: 'transparent',
        strokeWidth: 0,
        isModified: true,
      };
      const insertMaskCmd = new InsertObjectCommand(activePageIndex, maskShape);
      newDoc = commandManager.execute(insertMaskCmd, newDoc);
    }

    const cmd = new DeleteObjectCommand(activePageIndex, objectId);
    newDoc = commandManager.execute(cmd, newDoc);
    setDoc(newDoc);
    setSelectedObjectId(null);
    addLog('EDIT', `Deleted object "${objectId}"`);
  };

  const handleUpdateObject = (updatedProps: Partial<EditableObject>) => {
    if (!selectedObjectId) return;
    const oldObj = activePage.objects.find((o) => o.id === selectedObjectId);
    if (!oldObj) return;

    // When font family changes, reset font-specific spacing that was calibrated
    // for the original font's character widths (Tc/Tw operators in PDF).
    const propsToApply = { ...updatedProps } as any;
    if ('fontName' in propsToApply && oldObj.type === 'text') {
      const textObj = oldObj as TextObject;
      if (propsToApply.fontName !== textObj.fontName) {
        if (textObj.charSpacing && !('charSpacing' in updatedProps)) {
          propsToApply.charSpacing = 0;
        }
        if (textObj.wordSpacing && !('wordSpacing' in updatedProps)) {
          propsToApply.wordSpacing = 0;
        }
      }
    }

    const oldProps: any = {};
    for (const key of Object.keys(propsToApply)) {
      oldProps[key] = (oldObj as any)[key];
    }

    const cmd = new ChangeStyleCommand(activePageIndex, selectedObjectId, propsToApply, oldProps);
    const newDoc = commandManager.execute(cmd, doc);
    setDoc(newDoc);
    addLog('EDIT', `Updated properties for "${selectedObjectId}"`, Object.keys(propsToApply));
  };

  const handleCommitTableCellEdit = (tableId: string, row: number, col: number, newText: string) => {
    const table = activePage.objects.find((o) => o.id === tableId) as TableObject;
    if (!table || table.type !== 'table') return;

    const newCells = table.cells.map((rList, rIdx) =>
      rList.map((cCell, cIdx) => (rIdx === row && cIdx === col ? { ...cCell, text: newText } : { ...cCell }))
    );

    const cmd = new UpdateTableCommand(
      activePageIndex,
      tableId,
      { cells: newCells },
      { cells: table.cells }
    );
    const newDoc = commandManager.execute(cmd, doc);
    setDoc(newDoc);
    addLog('EDIT', `Updated table "${tableId}" cell [${row}, ${col}] ➔ "${newText}"`);
  };

  const handleSmartPush = (thresholdPdfY: number, deltaHeight: number, excludeId: string) => {
    const cmd = new SmartPushCommand(activePageIndex, thresholdPdfY, deltaHeight, excludeId ? [excludeId] : []);
    const newDoc = commandManager.execute(cmd, doc);
    setDoc(newDoc);
    addLog('EDIT', `Smart-pushed layout below Y=${thresholdPdfY.toFixed(1)}pt by ${deltaHeight}pt`);
  };

  const handleReorderObject = (id: string, direction: 'front' | 'back' | 'up' | 'down') => {
    const objs = [...activePage.objects];
    const idx = objs.findIndex((o) => o.id === id);
    if (idx === -1) return;

    const item = objs[idx];
    objs.splice(idx, 1);

    if (direction === 'front') {
      objs.push(item);
    } else if (direction === 'back') {
      objs.unshift(item);
    } else if (direction === 'up') {
      objs.splice(Math.min(objs.length, idx + 1), 0, item);
    } else if (direction === 'down') {
      objs.splice(Math.max(0, idx - 1), 0, item);
    }

    objs.forEach((o, i) => {
      o.zIndex = i + 1;
    });

    const updatedPages = [...doc.pages];
    updatedPages[activePageIndex] = { ...activePage, objects: objs };
    setDoc({ ...doc, pages: updatedPages, isDirty: true });
    addLog('STATE', `Reordered object "${id}" (${direction})`);
  };

  const handleAddPage = () => {
    const newPage = DocumentModelManager.createBlankPage(doc.pages.length, 612, 792);
    setDoc({
      ...doc,
      pages: [...doc.pages, newPage],
    });
    setActivePageIndex(doc.pages.length);
    addLog('STATE', `Added new blank page #${doc.pages.length + 1}`);
  };

  const handleDuplicatePage = (pageIdx: number) => {
    const srcPage = doc.pages[pageIdx];
    const newPage: PageModel = {
      ...srcPage,
      pageIndex: doc.pages.length,
      objects: srcPage.objects.map((o) => ({ ...o, id: `${o.id}_copy_${Date.now()}` })),
    };
    setDoc({
      ...doc,
      pages: [...doc.pages, newPage],
    });
    setActivePageIndex(doc.pages.length);
    addLog('STATE', `Duplicated page #${pageIdx + 1}`);
  };

  const handleDeletePage = (pageIdx: number) => {
    if (doc.pages.length <= 1) return;
    const newPages = doc.pages.filter((_, i) => i !== pageIdx).map((p, i) => ({ ...p, pageIndex: i }));
    setDoc({
      ...doc,
      pages: newPages,
    });
    setActivePageIndex(Math.max(0, pageIdx - 1));
    addLog('STATE', `Deleted page #${pageIdx + 1}`);
  };

  const handleOpenPdf = async (file: File) => {
    setIsLoading(true);
    addLog('PARSE', `Opening "${file.name}" (${(file.size / 1024).toFixed(1)} KB)...`);
    try {
      const buffer = await file.arrayBuffer();
      const { doc: loadedDoc } = await DocumentModelManager.loadPdfFromBuffer(buffer, file.name);
      pdfSourceRef.current = buffer;
      setCurrentSourcePdf(buffer);
      setDoc(loadedDoc);
      setActivePageIndex(0);
      setSelectedObjectId(null);
      commandManager.clear();

      const totalParsedObjs = loadedDoc.pages.reduce((acc, p) => acc + p.objects.length, 0);
      addLog(
        'PARSE',
        `Successfully parsed "${file.name}" (${loadedDoc.pages.length} pages, ${totalParsedObjs} total objects)`
      );
      addLog(
        'STATE',
        `Document state: 100% unedited (${totalParsedObjs} objects displaying original PDF drawing instructions)`
      );
    } catch (err) {
      console.error('Failed to open PDF:', err);
      addLog('WARN', `Failed to open PDF: ${err}`);
      alert('Could not parse PDF file. Ensure it is a valid PDF document.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInsertImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const aspect = img.width / img.height;
        const width = 160;
        const height = width / aspect;

        const newImageObj: ImageObject = {
          id: `img_user_${Date.now()}`,
          type: 'image',
          origin: 'user_created',
          pageIndex: activePageIndex,
          pdfBounds: { x: 50, y: 500, width, height },
          matrix: [1, 0, 0, 1, 50, 500],
          rotation: 0,
          zIndex: activePage.objects.length + 1,
          opacity: 1,
          visible: true,
          locked: false,
          src,
          width,
          height,
          naturalWidth: img.width,
          naturalHeight: img.height,
          mimeType: file.type || 'image/png',
          isModified: true,
        };
        handleInsertNewObject(newImageObj);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const handleExportPdf = () => {
    try {
      addLog(
        'STREAM',
        `Exporting PDF (${editedCount === 0 ? 'Exact original binary stream' : `${editedCount} modified objects serialized`})...`
      );
      const writer = new PdfWriter();
      const pdfBytes = writer.exportDocument(doc);

      const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.title || 'edited_document'}_export.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addLog('STREAM', `Export complete: Downloaded ${a.download}`);
    } catch (err) {
      console.error('PDF Export Error:', err);
      addLog('WARN', `Export error: ${err}`);
      alert('Error during PDF serialization: ' + err);
    }
  };

  const handleNewDocument = () => {
    const newDoc = DocumentModelManager.createBlankDocument('Untitled Document.pdf', 1);
    pdfSourceRef.current = null;
    setCurrentSourcePdf(null);
    setDoc(newDoc);
    setActivePageIndex(0);
    setSelectedObjectId(null);
    commandManager.clear();
    addLog('STATE', 'Created new blank document');
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-[#f5f5f7] text-[#1d1d1f] overflow-hidden font-sans">
      {/* Top Toolbar */}
      <Toolbar
        currentTool={currentTool}
        onSelectTool={setCurrentTool}
        doc={doc}
        historyState={historyState}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onExportPdf={handleExportPdf}
        onOpenPdf={handleOpenPdf}
        onNewDocument={handleNewDocument}
        zoom={zoom}
        onZoomChange={setZoom}
        currentPageIndex={activePageIndex}
        onPageChange={setActivePageIndex}
        onInsertImageFile={handleInsertImageFile}
        onOpenTableModal={() => setIsTableModalOpen(true)}
        isLoading={isLoading}
      />

      {/* Main Workspace Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Page Navigation Strip */}
        <PageNavigation
          doc={doc}
          activePageIndex={activePageIndex}
          onSelectPage={(idx) => {
            setActivePageIndex(idx);
            setSelectedObjectId(null);
          }}
          onAddPage={handleAddPage}
          onDuplicatePage={handleDuplicatePage}
          onDeletePage={handleDeletePage}
        />

        {/* Central WYSIWYG Canvas */}
        <Canvas
          page={activePage}
          zoom={zoom}
          selectedObjectId={selectedObjectId}
          currentTool={currentTool}
          onSelectObject={setSelectedObjectId}
          onUpdateObject={handleUpdateObject}
          onCommitObjectMove={handleCommitObjectMove}
          onCommitObjectResize={handleCommitObjectResize}
          onCommitTextEdit={handleCommitTextEdit}
          onCommitTableCellEdit={handleCommitTableCellEdit}
          onInsertNewObject={handleInsertNewObject}
          onSmartPush={handleSmartPush}
          sourcePdf={currentSourcePdf}
          operatorTextLines={operatorTextLines}
          onCommitOperatorText={(line, text) => {
            setOperatorTextLines((currentLines) =>
              currentLines.map((currentLine) =>
                currentLine.id === line.id ? { ...currentLine, text } : currentLine,
              ),
            );
          }}
        />

        {/* Right Properties Inspector & Layer Tree */}
        <Inspector
          selectedObject={selectedObject}
          activePage={activePage}
          onUpdateObject={handleUpdateObject}
          onDeleteObject={handleDeleteObject}
          onReorderObject={handleReorderObject}
          onSmartPush={handleSmartPush}
          onSelectObject={setSelectedObjectId}
        />
      </div>

      {/* Live PDF Engine Activity & State Console */}
      <ConsolePanel
        logs={logs}
        onClearLogs={() => setLogs([])}
        editedCount={editedCount}
        totalObjectsCount={totalObjectsCount}
      />

      {/* Insert Table Modal Dialog */}
      <TableModal
        isOpen={isTableModalOpen}
        onClose={() => setIsTableModalOpen(false)}
        onCreateTable={(table) => handleInsertNewObject(table)}
        pageIndex={activePageIndex}
      />

      {/* Drag and Drop Fullscreen Overlay */}
      {isDraggingFile && (
        <div className="fixed inset-0 bg-[#0071e3]/10 backdrop-blur-xs border-4 border-dashed border-[#0071e3] z-50 flex flex-col items-center justify-center pointer-events-none">
          <Upload className="w-16 h-16 text-[#0071e3] animate-bounce mb-4" />
          <p className="text-xl font-semibold text-[#1d1d1f]">Drop PDF file anywhere to open</p>
          <p className="text-sm text-[#6e6e73]">Release to parse and start editing</p>
        </div>
      )}
    </div>
  );
};

export default App;
