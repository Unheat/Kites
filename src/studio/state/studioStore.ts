import { useSyncExternalStore } from 'react';
import { STORAGE_KEYS } from '../../shared/constants';
import type {
  BrushShape,
  EditorAppearanceSettings,
  EraseRestoreSource,
  ImageLayer,
  InpaintSource,
  PaintSourceMode,
  StudioTool,
  StudioViewMode,
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
  source: InpaintSource;
  shape: BrushShape;
  size: number;
}

export type OcrScanSource = 'original' | 'background' | 'composition';

export interface OcrSettingsState {
  scanSource: OcrScanSource;
  shape: BrushShape;
  size: number;
  translate: boolean;
  inpaint: boolean;
}

/**
 * Extracts a complete typography style snapshot from a TextObject for clipboard copying.
 * Includes all font parameters, colors, gradients, stroke, drop shadows, casing, and spacing.
 */
export function extractTypographyStyle(obj: TextObject): Partial<TextObject> {
  return {
    fontFamily: obj.fontFamily,
    fontSize: obj.fontSize,
    color: obj.color,
    color2: obj.color2,
    isGradient: obj.isGradient,
    gradientAngle: obj.gradientAngle,
    strokeColor: obj.strokeColor,
    strokeColor2: obj.strokeColor2,
    isStrokeGradient: obj.isStrokeGradient,
    strokeWidth: obj.strokeWidth,
    strokeBlur: obj.strokeBlur,
    shadowAngle: obj.shadowAngle,
    shadowDistance: obj.shadowDistance,
    shadowBlur: obj.shadowBlur,
    shadowColor: obj.shadowColor,
    isVertical: obj.isVertical,
    direction: obj.direction,
    align: obj.align,
    bold: obj.bold,
    italic: obj.italic,
    uppercase: obj.uppercase,
    lowercase: obj.lowercase,
    letterSpacing: obj.letterSpacing,
    lineSpacing: obj.lineSpacing,
    backgroundFill: obj.backgroundFill,
    backgroundPadding: obj.backgroundPadding,
    backgroundBorderRadius: obj.backgroundBorderRadius,
    opacity: obj.opacity,
  };
}

export interface StudioState {
  // Navigation & Viewport
  activeTool: StudioTool;
  zoom: number;
  pan: { x: number; y: number };
  isSpacePanning: boolean;
  isAiProcessing: boolean;
  viewMode: StudioViewMode;
  isShowingOriginal: boolean;
  isCanvasFlipped: boolean;
  hideBoxes: boolean;
  isInfoPanelOpen: boolean;
  activeJobId: number | null;
  imageDimensions: { width: number; height: number };

  // Engine Tiers & Global Sync
  syncWithGlobal: boolean;
  selectedInpaintEngineId: string;
  selectedOcrEngineId: string;
  selectedTranslationEngineId: string;
  modelDownloads: Record<string, { progress: number; status: string }>;
  downloadedModelIds: string[];

  // Brush Configurations
  eraseSettings: EraseSettingsState;
  paintSettings: PaintSettingsState;
  inpaintSettings: InpaintSettingsState;
  ocrSettings: OcrSettingsState;

  // Scene Graph: Text and Stickers
  textObjects: TextObject[];
  selectedTextId: string | null;
  selectedTextIds: string[];
  editingTextId: string | null;
  clipboardStyle: Partial<TextObject> | null;
  globalEditMode: boolean;
  inlineSelection: { textId: string; start: number; end: number } | null;
  originalImage: HTMLImageElement | null;

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
  activeTool: 'text',
  zoom: 1.0,
  pan: { x: 0, y: 0 },
  isSpacePanning: false,
  isAiProcessing: false,
  viewMode: 'translated',
  isShowingOriginal: false,
  isCanvasFlipped: false,
  hideBoxes: false,
  isInfoPanelOpen: false,
  activeJobId: null,
  imageDimensions: { width: 0, height: 0 },

  syncWithGlobal: true,
  selectedInpaintEngineId: 'lama-manga',
  selectedOcrEngineId: 'v6-small',
  selectedTranslationEngineId: 'gg-translate',
  modelDownloads: {},
  downloadedModelIds: ['none', 'simple', 'telea', 'gg-translate', 'cloudflare-translate'],

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
    source: 'background',
    shape: 'circle',
    size: 40,
  },
  ocrSettings: {
    scanSource: 'original',
    shape: 'circle',
    size: 40,
    translate: true,
    inpaint: true,
  },

  textObjects: [],
  selectedTextId: null,
  selectedTextIds: [],
  editingTextId: null,
  clipboardStyle: null,
  globalEditMode: false,
  inlineSelection: null,
  originalImage: null,

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
   * Synchronizes viewMode with legacy isShowingOriginal and isCanvasFlipped flags.
   *
   * @param updater - Partial object or state transition callback.
   */
  public setState = (
    updater: Partial<StudioState> | ((prev: StudioState) => Partial<StudioState>)
  ): void => {
    const nextPartial = typeof updater === 'function' ? updater(this.state) : updater;
    const synchronized: Partial<StudioState> = { ...nextPartial };

    if ('viewMode' in nextPartial && nextPartial.viewMode !== undefined) {
      synchronized.isShowingOriginal = nextPartial.viewMode === 'original';
      synchronized.isCanvasFlipped = nextPartial.viewMode === 'original';
    } else if ('isShowingOriginal' in nextPartial && nextPartial.isShowingOriginal !== undefined) {
      synchronized.viewMode = nextPartial.isShowingOriginal
        ? 'original'
        : this.state.viewMode === 'original'
          ? 'translated'
          : this.state.viewMode;
      synchronized.isCanvasFlipped = nextPartial.isShowingOriginal;
    } else if ('isCanvasFlipped' in nextPartial && nextPartial.isCanvasFlipped !== undefined) {
      synchronized.viewMode = nextPartial.isCanvasFlipped
        ? 'original'
        : this.state.viewMode === 'original'
          ? 'translated'
          : this.state.viewMode;
      synchronized.isShowingOriginal = nextPartial.isCanvasFlipped;
    }

    this.state = { ...this.state, ...synchronized };
    this.listeners.forEach((listener) => listener());
  };

  /**
   * Sets current active canvas presentation mode.
   *
   * @param mode - Target view presentation mode ('original' | 'inpainted' | 'translated').
   */
  public setViewMode = (mode: StudioViewMode): void => {
    this.setState({
      viewMode: mode,
      isShowingOriginal: mode === 'original',
      isCanvasFlipped: mode === 'original',
    });
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

  private storageWriteQueue: Promise<void> = Promise.resolve();

  /**
   * Persists an engine selection update sequentially to chrome.storage.local,
   * avoiding write races and preserving storage ordering invariants.
   *
   * @param updates - Partial PopupState updates to persist.
   */
  private persistGlobalEngine(updates: Record<string, unknown>): void {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    this.storageWriteQueue = this.storageWriteQueue
      .catch(() => undefined)
      .then(async () => {
        const data = await chrome.storage.local.get(STORAGE_KEYS.POPUP_STATE);
        const current = (data[STORAGE_KEYS.POPUP_STATE] as Record<string, unknown>) || {};
        await chrome.storage.local.set({
          [STORAGE_KEYS.POPUP_STATE]: { ...current, ...updates },
        });
      })
      .catch((err) => {
        console.error('[StudioStore] Failed to persist engine selection:', err);
      });
  }

  /**
   * Updates an engine selection, optionally persisting to chrome.storage.local (popupState) if syncWithGlobal is enabled.
   */
  public setEngineSelection = (
    category: 'inpaint' | 'ocr' | 'translation',
    engineId: string
  ): void => {
    const { syncWithGlobal } = this.state;
    if (category === 'inpaint') {
      this.setState({ selectedInpaintEngineId: engineId });
      if (syncWithGlobal) {
        this.persistGlobalEngine({ activeInpaintId: engineId });
      }
    } else if (category === 'ocr') {
      this.setState({ selectedOcrEngineId: engineId });
      if (syncWithGlobal) {
        this.persistGlobalEngine({ activeOcrId: engineId });
      }
    } else if (category === 'translation') {
      this.setState({ selectedTranslationEngineId: engineId });
      if (syncWithGlobal) {
        this.persistGlobalEngine({ activeEngineId: engineId });
      }
    }
  };

  /**
   * Hydrates engine selections from popupState in chrome.storage.local.
   */
  public hydrateFromStorage = (): void => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    chrome.storage.local.get(STORAGE_KEYS.POPUP_STATE, (data) => {
      const state = data[STORAGE_KEYS.POPUP_STATE] as any;
      if (state) {
        this.setState({
          selectedInpaintEngineId: state.activeInpaintId || this.state.selectedInpaintEngineId,
          selectedOcrEngineId: state.activeOcrId || this.state.selectedOcrEngineId,
          selectedTranslationEngineId: state.activeEngineId || this.state.selectedTranslationEngineId,
        });
      }
    });
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
