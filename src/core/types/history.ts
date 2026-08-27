// Command & History Interface Types

import { DocumentModel } from './model';

export interface ICommand {
  name: string;
  description: string;
  execute(doc: DocumentModel): DocumentModel;
  undo(doc: DocumentModel): DocumentModel;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoStackSize: number;
  redoStackSize: number;
  lastActionName?: string;
}
