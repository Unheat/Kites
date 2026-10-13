import { useSyncExternalStore } from 'react';
import type {
  BrushShape,
  EditorAppearanceSettings,
  EraseRestoreSource,
  ImageLayer,
  PaintSourceMode,
  StudioTool,
  TextObject,
} from '../types';

/** Minimum permitted zoom factor. */
export const MIN_ZOOM_LEVEL = 0.05;

/** Maximum permitted zoom factor. */
export const MAX_ZOOM_LEVEL = 8.0;

/** Default brush size in canvas pixels. */
export const DEFAULT_BRUSH_SIZE = 30;

/** Default brush feather radius in canvas pixels. */
export const DEFAULT_BRUSH_FEATHER = 8;

export interface EraseSettingsState {
  source: EraseRestoreSource;
  shape: BrushShape;
  size: number;
  feather: number;
}

export interface PaintSettingsState {
  mode: PaintSourceMode;
  color: string;
  patternUrl: string | null;
  patternScale: number;
  blurRadius: number;
  transparencyAlpha: number;
  shape: BrushShape;
  size: number;
  feather: number;
}

export interface InpaintSettingsState {
  shape: BrushShape;
  size: number;
}

export interface OcrSettingsState {
  shape: BrushShape;
  size: number;
}

export interface StudioState {
  // Navigation & Viewport
  activeTool: StudioTool;
  zoom: number;
  pan: { x: number; y: number };
  isSpacePanning: boolean;
  isShowingOriginal: boolean;
  isCanvasFlipped: boolean;
  hideBoxes: boolean;
  activeJobId: number | null;
  imageDimensions: { width: number; height: number };

  // Brush Configurations
  eraseSettings: EraseSettingsState;
  paintSettings: PaintSettingsState;
  inpaintSettings: InpaintSettingsState;
  ocrSettings: OcrSettingsState;

  // Scene Graph: Text and Stickers
  textObjects: TextObject[];
  selectedTextId: string | null;
  selectedTextIds: string[];
  clipboardStyle: Partial<TextObject> | null;
  globalEditMode: boolean;

  imageLayers: ImageLayer[];
  selectedImageLayerId: string | null;

  // Modals & UI Appearance
  activeModal:
    | 'findReplace'
    | 'exportTranscript'
    | 'shortcuts'
    | 'fontManager'
    | 'appearance'
    | null;
  appearance: EditorAppearanceSettings;
}

const initialAppearance: EditorAppearanceSettings = {
  selectedBoxBorderColor: '#f4446d',
  unselectedBoxBorderColor: 'rgba(255, 255, 255, 0.35)',
  caretColor: '#f4446d',
  brushCursorColor: 'rgba(244, 68, 109, 0.85)',
};

const initialState: StudioState = {
  activeTool: 'select',
  zoom: 1.0,
  pan: { x: 0, y: 0 },
  isSpacePanning: false,
  isShowingOriginal: false,
  isCanvasFlipped: false,
  hideBoxes: false,
  activeJobId: null,
  imageDimensions: { width: 0, height: 0 },

  eraseSettings: {
    source: 'inpainted',
    shape: 'circle',
    size: DEFAULT_BRUSH_SIZE,
    feather: DEFAULT_BRUSH_FEATHER,
  },
  paintSettings: {
    mode: 'color',
    color: '#ffffff',
    patternUrl: null,
    patternScale: 1.0,
    blurRadius: 6,
    transparencyAlpha: 1.0,
    shape: 'circle',
    size: DEFAULT_BRUSH_SIZE,
    feather: 0,
  },
  inpaintSettings: {
    shape: 'circle',
    size: 40,
  },
  ocrSettings: {
    shape: 'circle',
    size: 40,
  },

  textObjects: [],
  selectedTextId: null,
  selectedTextIds: [],
  clipboardStyle: null,
  globalEditMode: false,

  imageLayers: [],
  selectedImageLayerId: null,

  activeModal: null,
  appearance: initialAppearance,
};

type Listener = () => void;

class StudioStore {
  private state: StudioState = initialState;
  private listeners = new Set<Listener>();

  /**
   * Returns instantaneous snapshot of Studio state.
   */
  public getState = (): StudioState => {
    return this.state;
  };

  /**
   * Subscribes a listener to state transitions.
   *
   * @param listener - Callback invoked on state changes.
   * @returns Unsubscribe function.
   */
  public subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Updates studio state and notifies registered subscribers.
   *
   * @param updater - Partial object or state transition callback.
   */
  public setState = (
    updater: Partial<StudioState> | ((prev: StudioState) => Partial<StudioState>)
  ): void => {
    const nextPartial = typeof updater === 'function' ? updater(this.state) : updater;
    this.state = { ...this.state, ...nextPartial };
    this.listeners.forEach((listener) => listener());
  };

  /**
   * Clamps zoom level within boundaries and updates viewport.
   *
   * @param targetZoom - Unclamped target zoom factor.
   */
  public setClampedZoom = (targetZoom: number): void => {
    const clamped = Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, targetZoom));
    this.setState({ zoom: clamped });
  };
}

export const studioStore = new StudioStore();

/**
 * React hook for reading and subscribing to Studio store slices.
 *
 * @param selector - Mapping function extracting specific state slices.
 * @returns Selected state slice.
 */
export function useStudioStore<T>(selector: (state: StudioState) => T): T {
  return useSyncExternalStore(
    studioStore.subscribe,
    () => selector(studioStore.getState()),
    () => selector(studioStore.getState())
  );
}
