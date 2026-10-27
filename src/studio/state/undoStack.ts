import type {
  BoundedDirtyRectPatch,
  ImageLayer,
  TextObject,
  UndoAction,
} from '../types';

/** Maximum number of history states retained in memory. */
export const MAX_UNDO_STACK_SIZE = 50;

export interface UndoStackListeners {
  onStackChange?: (canUndo: boolean, canRedo: boolean) => void;
}

export type UndoStackListener = (canUndo: boolean, canRedo: boolean) => void;

export class UndoStack {
  private undoEntries: UndoAction[] = [];
  private redoEntries: UndoAction[] = [];
  private subscriberSet = new Set<UndoStackListener>();
  private listeners: UndoStackListeners;

  constructor(listeners: UndoStackListeners = {}) {
    this.listeners = listeners;
  }

  /**
   * Subscribes a listener to stack availability transitions.
   * Immediately calls the listener with current state and returns an unsubscribe cleanup.
   */
  public subscribe(listener: UndoStackListener): () => void {
    this.subscriberSet.add(listener);
    listener(this.canUndo(), this.canRedo());
    return () => {
      this.subscriberSet.delete(listener);
    };
  }

  /**
   * Pushes a new action onto the undo stack and clears redo history.
   *
   * @param action - Action containing dirty-rect patches or scene graphs.
   */
  public push(action: UndoAction): void {
    this.undoEntries.push(action);
    if (this.undoEntries.length > MAX_UNDO_STACK_SIZE) {
      this.undoEntries.shift();
    }
    this.redoEntries = [];
    this.notify();
  }

  /**
   * Determines whether an undo operation is available.
   */
  public canUndo(): boolean {
    return this.undoEntries.length > 0;
  }

  /**
   * Determines whether a redo operation is available.
   */
  public canRedo(): boolean {
    return this.redoEntries.length > 0;
  }

  /**
   * Undoes the most recent action and invokes restoration handlers.
   *
   * @param handlers - Callbacks applying restored state to canvas and scene graph.
   * @returns Undone action or null if stack was empty.
   */
  public undo(handlers: {
    applyRasterPatch?: (patch: BoundedDirtyRectPatch) => void;
    applyTextObjects?: (objects: TextObject[]) => void;
    applyImageLayers?: (layers: ImageLayer[]) => void;
    applyColorState?: (isColorized: boolean) => void;
  }): UndoAction | null {
    const action = this.undoEntries.pop();
    if (!action) return null;

    if (action.rasterPatch && handlers.applyRasterPatch) {
      handlers.applyRasterPatch(action.rasterPatch.before);
    }
    if (action.textObjects && handlers.applyTextObjects) {
      handlers.applyTextObjects(action.textObjects.before);
    }
    if (action.imageLayers && handlers.applyImageLayers) {
      handlers.applyImageLayers(action.imageLayers.before);
    }
    if (action.colorState && handlers.applyColorState) {
      handlers.applyColorState(action.colorState.before);
    }

    this.redoEntries.push(action);
    this.notify();
    return action;
  }

  /**
   * Redoes the previously undone action and invokes restoration handlers.
   *
   * @param handlers - Callbacks applying redo state to canvas and scene graph.
   * @returns Redone action or null if stack was empty.
   */
  public redo(handlers: {
    applyRasterPatch?: (patch: BoundedDirtyRectPatch) => void;
    applyTextObjects?: (objects: TextObject[]) => void;
    applyImageLayers?: (layers: ImageLayer[]) => void;
    applyColorState?: (isColorized: boolean) => void;
  }): UndoAction | null {
    const action = this.redoEntries.pop();
    if (!action) return null;

    if (action.rasterPatch && handlers.applyRasterPatch) {
      handlers.applyRasterPatch(action.rasterPatch.after);
    }
    if (action.textObjects && handlers.applyTextObjects) {
      handlers.applyTextObjects(action.textObjects.after);
    }
    if (action.imageLayers && handlers.applyImageLayers) {
      handlers.applyImageLayers(action.imageLayers.after);
    }
    if (action.colorState && handlers.applyColorState) {
      handlers.applyColorState(action.colorState.after);
    }

    this.undoEntries.push(action);
    this.notify();
    return action;
  }

  /**
   * Resets all undo and redo history.
   */
  public clear(): void {
    this.undoEntries = [];
    this.redoEntries = [];
    this.notify();
  }

  private notify(): void {
    const u = this.canUndo();
    const r = this.canRedo();
    if (this.listeners.onStackChange) {
      this.listeners.onStackChange(u, r);
    }
    this.subscriberSet.forEach((listener) => listener(u, r));
  }
}

export const studioUndoStack = new UndoStack();
