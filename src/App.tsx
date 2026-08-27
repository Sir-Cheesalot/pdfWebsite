// Main Application Component for True WYSIWYG PDF Editor (Apple White Edition)
import React, { useEffect, useMemo, useState } from 'react';
import {
  DocumentModel,
  EditableObject,
  ImageObject,
  PageModel,
  Rect,
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
import { SamplePdfs } from './core/samples/SamplePdfs';
import { PdfWriter } from './core/exporter/PdfWriter';
import { Toolbar, ToolMode } from './components/Toolbar';
import { PageNavigation } from './components/PageNavigation';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/Inspector';
import { TableModal } from './components/TableModal';
import { Loader2, Upload } from 'lucide-react';

export const App: React.FC = () => {
  const [doc, setDoc] = useState<DocumentModel>(() => SamplePdfs.createInvoiceSample());
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [currentTool, setCurrentTool] = useState<ToolMode>('select');
  const [zoom, setZoom] = useState(1.0);
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

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
      if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        if (file.name.toLowerCase().endsWith('.pdf')) {
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
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedObjectId) {
          e.preventDefault();
          handleDeleteObject(selectedObjectId);
        }
      } else if (e.key === 'Escape') {
        setSelectedObjectId(null);
        setCurrentTool('select');
      } else if (e.key === 'v' || e.key === 'V') {
        setCurrentTool('select');
      } else if (e.key === 't' || e.key === 'T') {
        setCurrentTool('text');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [doc, activePageIndex, selectedObjectId]);

  const handleUndo = () => {
    const newDoc = commandManager.undo(doc);
    setDoc(newDoc);
  };

  const handleRedo = () => {
    const newDoc = commandManager.redo(doc);
    setDoc(newDoc);
  };

  const handleCommitTextEdit = (objectId: string, newText: string, oldText: string) => {
    const cmd = new EditTextCommand(activePageIndex, objectId, newText, oldText);
    const newDoc = commandManager.execute(cmd, doc);
    setDoc(newDoc);
  };

  const handleCommitObjectMove = (objectId: string, dxPdf: number, dyPdf: number) => {
    const cmd = new MoveObjectCommand(activePageIndex, objectId, dxPdf, dyPdf);
    const newDoc = commandManager.execute(cmd, doc);
    setDoc(newDoc);
  };

  const handleCommitObjectResize = (objectId: string, newBounds: Rect, oldBounds: Rect) => {
    const cmd = new ResizeObjectCommand(activePageIndex, objectId, newBounds, oldBounds);
    const newDoc = commandManager.execute(cmd, doc);
    setDoc(newDoc);
  };

  const handleInsertNewObject = (newObj: EditableObject) => {
    const cmd = new InsertObjectCommand(activePageIndex, newObj);
    const newDoc = commandManager.execute(cmd, doc);
    setDoc(newDoc);
    setSelectedObjectId(newObj.id);
    setCurrentTool('select');
  };

  const handleDeleteObject = (objectId: string) => {
    const cmd = new DeleteObjectCommand(activePageIndex, objectId);
    const newDoc = commandManager.execute(cmd, doc);
    setDoc(newDoc);
    setSelectedObjectId(null);
  };

  const handleUpdateObject = (updatedProps: Partial<EditableObject>) => {
    if (!selectedObjectId) return;
    const oldObj = activePage.objects.find((o) => o.id === selectedObjectId);
    if (!oldObj) return;

    const oldProps: any = {};
    for (const key of Object.keys(updatedProps)) {
      oldProps[key] = (oldObj as any)[key];
    }

    const cmd = new ChangeStyleCommand(activePageIndex, selectedObjectId, updatedProps as any, oldProps);
    const newDoc = commandManager.execute(cmd, doc);
    setDoc(newDoc);
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
  };

  const handleSmartPush = (thresholdPdfY: number, deltaHeight: number, excludeId: string) => {
    const cmd = new SmartPushCommand(activePageIndex, thresholdPdfY, deltaHeight, excludeId ? [excludeId] : []);
    const newDoc = commandManager.execute(cmd, doc);
    setDoc(newDoc);
  };

  const handleReorderObject = (id: string, direction: 'front' | 'back' | 'up' | 'down') => {
    const objs = [...activePage.objects];
    const idx = objs.findIndex((o) => o.id === id);
    if (idx === -1) return;

    const [target] = objs.splice(idx, 1);
    if (direction === 'front') objs.push(target);
    else if (direction === 'back') objs.unshift(target);
    else if (direction === 'up') objs.splice(Math.min(objs.length, idx + 1), 0, target);
    else if (direction === 'down') objs.splice(Math.max(0, idx - 1), 0, target);

    setDoc({
      ...doc,
      pages: doc.pages.map((p, pIdx) => (pIdx === activePageIndex ? { ...p, objects: objs } : p)),
    });
  };

  const handleAddPage = () => {
    const newPage = DocumentModelManager.createBlankPage(doc.pages.length);
    setDoc({
      ...doc,
      pages: [...doc.pages, newPage],
    });
    setActivePageIndex(doc.pages.length);
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
  };

  const handleDeletePage = (pageIdx: number) => {
    if (doc.pages.length <= 1) return;
    const newPages = doc.pages.filter((_, i) => i !== pageIdx).map((p, i) => ({ ...p, pageIndex: i }));
    setDoc({
      ...doc,
      pages: newPages,
    });
    setActivePageIndex(Math.max(0, pageIdx - 1));
  };

  const handleOpenPdf = async (file: File) => {
    setIsLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const { doc: loadedDoc } = await DocumentModelManager.loadPdfFromBuffer(buffer, file.name);
      setDoc(loadedDoc);
      setActivePageIndex(0);
      setSelectedObjectId(null);
      commandManager.clear();
    } catch (err) {
      console.error('Failed to open PDF:', err);
      alert('Could not parse PDF file. Ensure it is a valid PDF document.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadSample = (sampleType: 'invoice' | 'academic') => {
    const sampleDoc =
      sampleType === 'invoice' ? SamplePdfs.createInvoiceSample() : SamplePdfs.createAcademicSample();
    setDoc(sampleDoc);
    setActivePageIndex(0);
    setSelectedObjectId(null);
    commandManager.clear();
  };

  const handleNewDocument = () => {
    const newDoc = DocumentModelManager.createBlankDocument('Untitled Document.pdf', 1);
    setDoc(newDoc);
    setActivePageIndex(0);
    setSelectedObjectId(null);
    commandManager.clear();
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
        };
        handleInsertNewObject(newImageObj);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const handleExportPdf = () => {
    try {
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
    } catch (err) {
      console.error('PDF Export Error:', err);
      alert('Error during PDF serialization: ' + err);
    }
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
        onLoadSample={handleLoadSample}
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

      {/* Table Creator Modal */}
      <TableModal
        isOpen={isTableModalOpen}
        onClose={() => setIsTableModalOpen(false)}
        onCreateTable={handleInsertNewObject}
        pageIndex={activePageIndex}
      />

      {/* Loading Overlay */}
      {isLoading && (
        <div className="fixed inset-0 bg-white/70 backdrop-blur-xs z-50 flex items-center justify-center space-x-2 text-[#1d1d1f]">
          <Loader2 className="w-5 h-5 animate-spin text-[#0071e3]" />
          <span className="text-xs font-semibold">Parsing PDF structure...</span>
        </div>
      )}

      {/* Drag and Drop Full Screen Overlay */}
      {isDraggingFile && (
        <div className="fixed inset-0 bg-[#0071e3]/10 backdrop-blur-xs z-50 flex items-center justify-center p-8 pointer-events-none">
          <div className="bg-white/95 rounded-2xl border-2 border-dashed border-[#0071e3] p-10 flex flex-col items-center space-y-3 shadow-2xl">
            <Upload className="w-10 h-10 text-[#0071e3] animate-bounce" />
            <h3 className="text-sm font-semibold text-[#1d1d1f]">Drop PDF to Open</h3>
            <p className="text-xs text-[#86868b]">Release file anywhere to edit</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
