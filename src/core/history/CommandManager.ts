// Command Pattern & Undo/Redo Manager
import {
  DocumentModel,
  EditableObject,
  ImageObject,
  PageModel,
  ShapeObject,
  TableCell,
  TableObject,
  TextObject,
} from '../types/model';
import { HistoryState, ICommand } from '../types/history';
import { SmartLayoutEngine } from '../model/SmartLayoutEngine';

export class CommandManager {
  private undoStack: ICommand[] = [];
  private redoStack: ICommand[] = [];
  private maxHistory = 100;

  constructor(private onStateChange?: (state: HistoryState) => void) {}

  execute(command: ICommand, doc: DocumentModel): DocumentModel {
    const newDoc = command.execute(doc);
    newDoc.isDirty = true;
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = []; // clear redo on new action
    this.notify();
    return newDoc;
  }

  undo(doc: DocumentModel): DocumentModel {
    if (this.undoStack.length === 0) return doc;
    const command = this.undoStack.pop()!;
    const newDoc = command.undo(doc);
    newDoc.isDirty = true;
    this.redoStack.push(command);
    this.notify();
    return newDoc;
  }

  redo(doc: DocumentModel): DocumentModel {
    if (this.redoStack.length === 0) return doc;
    const command = this.redoStack.pop()!;
    const newDoc = command.execute(doc);
    newDoc.isDirty = true;
    this.undoStack.push(command);
    this.notify();
    return newDoc;
  }

  getState(): HistoryState {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoStackSize: this.undoStack.length,
      redoStackSize: this.redoStack.length,
      lastActionName: this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].name : undefined,
    };
  }

  private notify() {
    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }
}

// Deep clone helper for immutable document updates
function cloneDoc(doc: DocumentModel): DocumentModel {
  return {
    ...doc,
    pages: doc.pages.map((p) => ({
      ...p,
      objects: p.objects.map((obj) => {
        if (obj.type === 'table') {
          return {
            ...obj,
            colWidths: [...obj.colWidths],
            rowHeights: [...obj.rowHeights],
            cells: obj.cells.map((row) => row.map((c) => ({ ...c }))),
            pdfBounds: { ...obj.pdfBounds },
            matrix: [...obj.matrix],
          };
        }
        return {
          ...obj,
          pdfBounds: { ...obj.pdfBounds },
          matrix: [...obj.matrix],
        };
      }),
    })),
  };
}

/**
 * Command: Edit Text Content
 */
export class EditTextCommand implements ICommand {
  name = 'Edit Text';
  description: string;

  constructor(
    private pageIndex: number,
    private objectId: string,
    private newText: string,
    private oldText: string
  ) {
    this.description = `Edit text: "${newText.slice(0, 20)}..."`;
  }

  execute(doc: DocumentModel): DocumentModel {
    const nextDoc = cloneDoc(doc);
    const obj = nextDoc.pages[this.pageIndex]?.objects.find((o) => o.id === this.objectId);
    if (obj && obj.type === 'text') {
      obj.text = this.newText;
    }
    return nextDoc;
  }

  undo(doc: DocumentModel): DocumentModel {
    const nextDoc = cloneDoc(doc);
    const obj = nextDoc.pages[this.pageIndex]?.objects.find((o) => o.id === this.objectId);
    if (obj && obj.type === 'text') {
      obj.text = this.oldText;
    }
    return nextDoc;
  }
}

/**
 * Command: Move Object
 */
export class MoveObjectCommand implements ICommand {
  name = 'Move Object';
  description = 'Move object';

  constructor(
    private pageIndex: number,
    private objectId: string,
    private dxPdf: number,
    private dyPdf: number
  ) {}

  execute(doc: DocumentModel): DocumentModel {
    const nextDoc = cloneDoc(doc);
    const obj = nextDoc.pages[this.pageIndex]?.objects.find((o) => o.id === this.objectId);
    if (obj) {
      obj.pdfBounds.x += this.dxPdf;
      obj.pdfBounds.y += this.dyPdf;
      obj.matrix[4] += this.dxPdf;
      obj.matrix[5] += this.dyPdf;
    }
    return nextDoc;
  }

  undo(doc: DocumentModel): DocumentModel {
    const nextDoc = cloneDoc(doc);
    const obj = nextDoc.pages[this.pageIndex]?.objects.find((o) => o.id === this.objectId);
    if (obj) {
      obj.pdfBounds.x -= this.dxPdf;
      obj.pdfBounds.y -= this.dyPdf;
      obj.matrix[4] -= this.dxPdf;
      obj.matrix[5] -= this.dyPdf;
    }
    return nextDoc;
  }
}

/**
 * Command: Resize Object
 */
export class ResizeObjectCommand implements ICommand {
  name = 'Resize Object';
  description = 'Resize object';

  constructor(
    private pageIndex: number,
    private objectId: string,
    private newBounds: { x: number; y: number; width: number; height: number },
    private oldBounds: { x: number; y: number; width: number; height: number }
  ) {}

  execute(doc: DocumentModel): DocumentModel {
    const nextDoc = cloneDoc(doc);
    const obj = nextDoc.pages[this.pageIndex]?.objects.find((o) => o.id === this.objectId);
    if (obj) {
      obj.pdfBounds = { ...this.newBounds };
      obj.matrix[4] = this.newBounds.x;
      obj.matrix[5] = this.newBounds.y;
    }
    return nextDoc;
  }

  undo(doc: DocumentModel): DocumentModel {
    const nextDoc = cloneDoc(doc);
    const obj = nextDoc.pages[this.pageIndex]?.objects.find((o) => o.id === this.objectId);
    if (obj) {
      obj.pdfBounds = { ...this.oldBounds };
      obj.matrix[4] = this.oldBounds.x;
      obj.matrix[5] = this.oldBounds.y;
    }
    return nextDoc;
  }
}

/**
 * Command: Insert Object (Text, Image, Shape, Table)
 */
export class InsertObjectCommand implements ICommand {
  name: string;
  description: string;

  constructor(private pageIndex: number, private object: EditableObject) {
    this.name = `Insert ${object.type.toUpperCase()}`;
    this.description = `Insert new ${object.type}`;
  }

  execute(doc: DocumentModel): DocumentModel {
    const nextDoc = cloneDoc(doc);
    const page = nextDoc.pages[this.pageIndex];
    if (page) {
      page.objects.push({ ...this.object });
    }
    return nextDoc;
  }

  undo(doc: DocumentModel): DocumentModel {
    const nextDoc = cloneDoc(doc);
    const page = nextDoc.pages[this.pageIndex];
    if (page) {
      page.objects = page.objects.filter((o) => o.id !== this.object.id);
    }
    return nextDoc;
  }
}

/**
 * Command: Delete Object
 */
export class DeleteObjectCommand implements ICommand {
  name = 'Delete Object';
  description = 'Delete object';
  private deletedObject: EditableObject | null = null;
  private deletedIndex: number = -1;

  constructor(private pageIndex: number, private objectId: string) {}

  execute(doc: DocumentModel): DocumentModel {
    const nextDoc = cloneDoc(doc);
    const page = nextDoc.pages[this.pageIndex];
    if (page) {
      this.deletedIndex = page.objects.findIndex((o) => o.id === this.objectId);
      if (this.deletedIndex !== -1) {
        this.deletedObject = page.objects[this.deletedIndex];
        page.objects.splice(this.deletedIndex, 1);
      }
    }
    return nextDoc;
  }

  undo(doc: DocumentModel): DocumentModel {
    const nextDoc = cloneDoc(doc);
    const page = nextDoc.pages[this.pageIndex];
    if (page && this.deletedObject && this.deletedIndex !== -1) {
      page.objects.splice(this.deletedIndex, 0, this.deletedObject);
    }
    return nextDoc;
  }
}

/**
 * Command: Change Style (Typography, Color, Size, Stroke)
 */
export class ChangeStyleCommand implements ICommand {
  name = 'Change Style';
  description = 'Change object style';

  constructor(
    private pageIndex: number,
    private objectId: string,
    private newProps: Record<string, any>,
    private oldProps: Record<string, any>
  ) {}

  execute(doc: DocumentModel): DocumentModel {
    const nextDoc = cloneDoc(doc);
    const obj = nextDoc.pages[this.pageIndex]?.objects.find((o) => o.id === this.objectId);
    if (obj) {
      Object.assign(obj, this.newProps);
    }
    return nextDoc;
  }

  undo(doc: DocumentModel): DocumentModel {
    const nextDoc = cloneDoc(doc);
    const obj = nextDoc.pages[this.pageIndex]?.objects.find((o) => o.id === this.objectId);
    if (obj) {
      Object.assign(obj, this.oldProps);
    }
    return nextDoc;
  }
}

/**
 * Command: Smart Push Downstream Content
 */
export class SmartPushCommand implements ICommand {
  name = 'Smart Push Layout';
  description = 'Push downstream content downward';
  private repositionResult: any = null;

  constructor(
    private pageIndex: number,
    private insertionThresholdPdfY: number,
    private deltaHeightPdf: number,
    private excludeIds: string[] = []
  ) {}

  execute(doc: DocumentModel): DocumentModel {
    const nextDoc = cloneDoc(doc);
    const page = nextDoc.pages[this.pageIndex];
    if (page) {
      this.repositionResult = SmartLayoutEngine.pushDownstreamContent(
        page,
        this.insertionThresholdPdfY,
        this.deltaHeightPdf,
        new Set(this.excludeIds)
      );
    }
    return nextDoc;
  }

  undo(doc: DocumentModel): DocumentModel {
    const nextDoc = cloneDoc(doc);
    const page = nextDoc.pages[this.pageIndex];
    if (page && this.repositionResult) {
      SmartLayoutEngine.revertReposition(page, this.repositionResult);
    }
    return nextDoc;
  }
}

/**
 * Command: Update Table Cell / Structure
 */
export class UpdateTableCommand implements ICommand {
  name = 'Update Table';
  description = 'Update table content or structure';

  constructor(
    private pageIndex: number,
    private tableId: string,
    private newTableState: Partial<TableObject>,
    private oldTableState: Partial<TableObject>
  ) {}

  execute(doc: DocumentModel): DocumentModel {
    const nextDoc = cloneDoc(doc);
    const table = nextDoc.pages[this.pageIndex]?.objects.find((o) => o.id === this.tableId) as TableObject;
    if (table && table.type === 'table') {
      Object.assign(table, this.newTableState);
    }
    return nextDoc;
  }

  undo(doc: DocumentModel): DocumentModel {
    const nextDoc = cloneDoc(doc);
    const table = nextDoc.pages[this.pageIndex]?.objects.find((o) => o.id === this.tableId) as TableObject;
    if (table && table.type === 'table') {
      Object.assign(table, this.oldTableState);
    }
    return nextDoc;
  }
}

/**
 * Batch Command: Group multiple operations into single undo step
 */
export class BatchCommand implements ICommand {
  name: string;
  description: string;

  constructor(name: string, private commands: ICommand[]) {
    this.name = name;
    this.description = name;
  }

  execute(doc: DocumentModel): DocumentModel {
    let curDoc = doc;
    for (const cmd of this.commands) {
      curDoc = cmd.execute(curDoc);
    }
    return curDoc;
  }

  undo(doc: DocumentModel): DocumentModel {
    let curDoc = doc;
    for (let i = this.commands.length - 1; i >= 0; i--) {
      curDoc = this.commands[i].undo(curDoc);
    }
    return curDoc;
  }
}
