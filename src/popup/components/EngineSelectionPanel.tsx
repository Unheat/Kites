import { useState, useEffect, useMemo, useRef } from 'react';
import { Download, ChevronDown, ChevronRight, Plus, Search, Check, Bold, Italic, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import type { PopupState, BubbleDetectionMode } from '../../shared/types';
import AddApiForm from './AddApiForm';
import MiniSearch from 'minisearch';
import { ModelRegistry } from '../services/ModelRegistry';
import { isLlmGpuAvailable } from '../../shared/utils/hardwareUtils';
import { RENDER_FONT_PRESETS, normalizeRenderFontPresetId } from '../../shared/renderFontPresets';
import { INPAINT_TIER_CATALOG } from '../../shared/inpaintTiers';
import { COLOR_TIER_CATALOG } from '../../shared/colorTiers';
import HelpTooltip from './HelpTooltip';

export interface BubbleModeOption {
  id: BubbleDetectionMode;
  name: string;
  tooltip: string;
  isModel?: boolean;
}

export const BUBBLE_MODE_OPTIONS: BubbleModeOption[] = [
  {
    id: 'off',
    name: 'Disabled',
    tooltip: 'Tightly hugs source text lines without bubble expansion (Cotrans MST).',
  },
  {
    id: 'heuristic',
    name: 'Heuristic',
    tooltip: 'Expands into white bubble whitespace with tail severing. Fast (<1ms), zero download.',
  },
  {
    id: 'neural',
    name: 'YOLO (AI)',
    tooltip: 'Neural segmentation mask with morphological tail severing on AI contours (~11 MB).',
    isModel: true,
  },
];

interface DownloadAcknowledgement {
  status?: 'success' | 'error';
  error?: string;
}

interface EngineSelectionPanelProps {
  state: PopupState;
  updateState: (updates: Partial<PopupState>) => void;
}

export interface Engine {
  id: string;
  name: string;
  type: 'local' | 'api' | 'custom';
  isDownloaded?: boolean;
  hardware?: 'CPU' | 'WebGPU';
  vramEstimate?: string;
}

/**
 * Canonical ordered list of the highest-performing WebLLM models by size tier (smallest to largest).
 * Selected from empirical translation benchmarks across 0.8B, 2B, 4B, 9B, and 70B scales.
 */
export const RECOMMENDED_TRANSLATION_MODELS = [
  'Qwen3.5-0.8B-q4f16_1-MLC',        // Sub-1B (~0.8B)
  'Qwen3.5-2B-q4f16_1-MLC',          // 1B - 2B (~2B)
  'Qwen3.5-4B-q4f16_1-MLC',          // 3B - 4B (~4B)
  'Qwen3.5-9B-q4f16_1-MLC',          // 7B - 9B (~9B)
  'Llama-3.1-70B-Instruct-q3f16_1-MLC', // 70B
] as const;

/**
 * Orders a changed model catalog without mutating React state.
 * For translation (defaultId === 'gg-translate'), enforces the canonical hierarchy:
 * Google Translate -> Cloud Shared Pool -> Custom APIs -> [Best of Each Size] -> [Other Models].
 *
 * @param engines - Models to order after a download or custom API addition.
 * @param defaultId - The model that must remain pinned first.
 * @returns The ordered model list.
 */
export function orderChangedCatalog(engines: readonly Engine[], defaultId: string): Engine[] {
  if (defaultId === 'gg-translate') {
    return [...engines].sort((left, right) => {
      // 1. Google Translate always pinned first
      if (left.id === 'gg-translate') return -1;
      if (right.id === 'gg-translate') return 1;

      // 2. Cloud Shared Pool pinned second
      if (left.id === 'cloudflare-translate') return -1;
      if (right.id === 'cloudflare-translate') return 1;

      // 3. Custom APIs pinned third
      if (left.type === 'custom' && right.type !== 'custom') return -1;
      if (right.type === 'custom' && left.type !== 'custom') return 1;

      // 4. Best of each size tier (smallest to largest)
      const leftRecIdx = RECOMMENDED_TRANSLATION_MODELS.indexOf(left.id as any);
      const rightRecIdx = RECOMMENDED_TRANSLATION_MODELS.indexOf(right.id as any);

      if (leftRecIdx !== -1 && rightRecIdx !== -1) {
        return leftRecIdx - rightRecIdx;
      }
      if (leftRecIdx !== -1) return -1;
      if (rightRecIdx !== -1) return 1;

      // 5. Other models: downloaded first, then lexical by name
      const downloadDiff = Number(Boolean(right.isDownloaded)) - Number(Boolean(left.isDownloaded));
      if (downloadDiff !== 0) return downloadDiff;

      return left.name.localeCompare(right.name);
    });
  }

  return [...engines].sort((left, right) =>
    Number(right.id === defaultId) - Number(left.id === defaultId) ||
    Number(Boolean(right.isDownloaded)) - Number(Boolean(left.isDownloaded)) ||
    left.name.localeCompare(right.name)
  );
}

export default function EngineSelectionPanel({ state, updateState }: EngineSelectionPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isOpenInpaint, setIsOpenInpaint] = useState(false);
  const [isOpenColor, setIsOpenColor] = useState(false);
  const [isOpenOcr, setIsOpenOcr] = useState(false);
  const [isOpenRenderFont, setIsOpenRenderFont] = useState(false);
  const [isOpenFontOptions, setIsOpenFontOptions] = useState(false);
  const [isOpenBubbleMode, setIsOpenBubbleMode] = useState(false);
  const [isNeuralDownloaded, setIsNeuralDownloaded] = useState(false);
  const [showAddApi, setShowAddApi] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [downloads, setDownloads] = useState<Record<string, { progress: number; status: string }>>({});
  const [translationOrder, setTranslationOrder] = useState<string[] | null>(null);
  const [pendingDownloadIds, setPendingDownloadIds] = useState<Set<string>>(() => new Set());
  const customApiIds = useRef<string[] | null>(null);
  const customApisRef = useRef(state.customApis);
  const readyModelIds = useRef(new Set<string>());
  const stateRef = useRef(state);
  const updateStateRef = useRef(updateState);
  updateStateRef.current = updateState;

  /**
   * Queues one model download through the background-owned RPC route.
   *
   * @param modelId - Registry model identifier.
   * @param category - Model subsystem that owns the download.
   * @returns A promise resolved after background/offscreen acknowledgement.
   */
  const requestDownload = async (modelId: string, category: 'translation' | 'inpaint' | 'ocr' | 'bubble' | 'color'): Promise<void> => {
    if (pendingDownloadIds.has(modelId) || downloads[modelId]?.status === 'Queued') return;
    setPendingDownloadIds(prev => new Set(prev).add(modelId));
    setDownloads(prev => ({ ...prev, [modelId]: { progress: 0, status: 'Queued' } }));

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'START_MODEL_DOWNLOAD',
        target: 'background',
        source: 'popup',
        request: true,
        payload: { modelId, category },
      }) as DownloadAcknowledgement | undefined;
      if (!response || response.status !== 'success') {
        throw new Error(response?.error || 'Download request was not acknowledged');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[EngineSelectionPanel] Failed to queue ${modelId}:`, error);
      setDownloads(prev => ({ ...prev, [modelId]: { progress: 0, status: `Failed: ${message}` } }));
    } finally {
      setPendingDownloadIds(prev => {
        const next = new Set(prev);
        next.delete(modelId);
        return next;
      });
    }
  };

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    // Query active downloads on mount
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_DOWNLOADS', target: 'background', source: 'popup', request: true }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[EngineSelectionPanel] Failed to query active downloads:', chrome.runtime.lastError.message);
        return;
      }
      if (response && response.status === 'success' && response.downloads) {
        setDownloads(response.downloads);
      }
    });

    const listener = (message: any) => {
      if (message.type === 'MODEL_DOWNLOAD_PROGRESS') {
        setDownloads(prev => ({
          ...prev,
          [message.payload.modelId]: {
            progress: message.payload.progress,
            status: message.payload.status
          }
        }));
        
        if (message.payload.progress >= 1 || message.payload.status === 'ready') {
          readyModelIds.current.add(message.payload.modelId);
          setBaseEngines(prev => {
            if (!prev.some(engine => engine.id === message.payload.modelId)) return prev;
            const ordered = orderChangedCatalog(
              prev.map(engine => engine.id === message.payload.modelId ? { ...engine, isDownloaded: true } : engine),
              'gg-translate'
            );
            setTranslationOrder(orderChangedCatalog([
              ...ordered,
              ...customApisRef.current.map(api => ({ id: api.id, name: `${api.modelName}`, type: 'custom' as const, isDownloaded: true })),
            ], 'gg-translate').map(engine => engine.id));
            return ordered;
          });
          setInpaintBaseEngines(prev => prev.some(engine => engine.id === message.payload.modelId)
            ? orderChangedCatalog(
              prev.map(engine => engine.id === message.payload.modelId ? { ...engine, isDownloaded: true } : engine),
              'simple'
            )
            : prev
          );
          setColorBaseEngines(prev => prev.some(engine => engine.id === message.payload.modelId)
            ? orderChangedCatalog(
              prev.map(engine => engine.id === message.payload.modelId ? { ...engine, isDownloaded: true } : engine),
              'none'
            )
            : prev
          );
          setOcrBaseEngines(prev => prev.some(engine => engine.id === message.payload.modelId)
            ? orderChangedCatalog(
              prev.map(engine => engine.id === message.payload.modelId ? { ...engine, isDownloaded: true } : engine),
              'v6-small'
            )
            : prev
          );
          if (message.payload.modelId === 'bubble-yolo') {
            setIsNeuralDownloaded(true);
          }
        }
      }

      if (message.type === 'MODEL_DOWNLOAD_ERROR') {
        // Surface the failure in the inline progress bar, and make sure the model
        // is never left looking downloaded/selectable just because a download was attempted.
        console.error(`[EngineSelectionPanel] Download failed for ${message.payload.modelId}:`, message.payload.error);
        setDownloads(prev => ({
          ...prev,
          [message.payload.modelId]: {
            progress: 0,
            status: `Failed: ${message.payload.error}`
          }
        }));
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const [inpaintBaseEngines, setInpaintBaseEngines] = useState<Engine[]>(() =>
    INPAINT_TIER_CATALOG.map((tier) => ({
      id: tier.id,
      name: tier.name,
      type: 'local' as const,
      isDownloaded: Boolean(tier.isBuiltin),
    })),
  );

  const [colorBaseEngines, setColorBaseEngines] = useState<Engine[]>(() =>
    COLOR_TIER_CATALOG.map((tier) => ({
      id: tier.id,
      name: tier.name,
      type: 'local' as const,
      isDownloaded: Boolean(tier.isBuiltin),
    })),
  );

  const [ocrBaseEngines, setOcrBaseEngines] = useState<Engine[]>([
    { id: 'v6-small', name: 'PaddleOCR v6 Small (Default)', type: 'local', isDownloaded: false },
    { id: 'v6-medium', name: 'PaddleOCR v6 Medium', type: 'local', isDownloaded: false },
    { id: 'v6-tiny', name: 'PaddleOCR v6 Tiny', type: 'local', isDownloaded: false },
    { id: 'v5-mobile', name: 'PaddleOCR v5 Mobile', type: 'local', isDownloaded: false },
    { id: 'v5-server', name: 'PaddleOCR v5 Server', type: 'local', isDownloaded: false },
    { id: 'v5-en-mobile', name: 'PaddleOCR v5 English Mobile', type: 'local', isDownloaded: false },
    { id: 'v4-mobile', name: 'PaddleOCR v4 Mobile', type: 'local', isDownloaded: false },
    { id: 'v4-server', name: 'PaddleOCR v4 Server', type: 'local', isDownloaded: false },
    { id: 'v3-mobile', name: 'PaddleOCR v3 Mobile', type: 'local', isDownloaded: false },
    { id: 'v3-japanese-mobile', name: 'PaddleOCR v3 Japanese Mobile', type: 'local', isDownloaded: false },
  ]);

  const [baseEngines, setBaseEngines] = useState<Engine[]>([]);
  const inpaintBaseEnginesRef = useRef(inpaintBaseEngines);
  inpaintBaseEnginesRef.current = inpaintBaseEngines;
  const colorBaseEnginesRef = useRef(colorBaseEngines);
  colorBaseEnginesRef.current = colorBaseEngines;
  const ocrBaseEnginesRef = useRef(ocrBaseEngines);
  ocrBaseEnginesRef.current = ocrBaseEngines;

  useEffect(() => {
    ModelRegistry.getAvailableEngines().then((engines) => {
      const initializedEngines = engines.map(engine => ({
        ...engine,
        isDownloaded: Boolean(engine.isDownloaded || readyModelIds.current.has(engine.id)),
      }));
      const completedDuringLoad = initializedEngines.some(engine => readyModelIds.current.has(engine.id));
      const nextEngines = completedDuringLoad
        ? orderChangedCatalog(initializedEngines, 'gg-translate')
        : initializedEngines;
      setBaseEngines(nextEngines);
      if (completedDuringLoad) {
        setTranslationOrder(orderChangedCatalog([
          ...nextEngines,
          ...customApisRef.current.map(api => ({ id: api.id, name: `${api.provider}/${api.modelName}`, type: 'custom' as const, isDownloaded: true })),
        ], 'gg-translate').map(engine => engine.id));
      }
      const modelIds = [
        ...engines.filter(engine => engine.hardware === 'WebGPU').map(engine => engine.id),
        ...inpaintBaseEnginesRef.current.map(engine => engine.id),
        ...colorBaseEnginesRef.current.map(engine => engine.id),
        ...ocrBaseEnginesRef.current.map(engine => engine.id),
        'bubble-yolo',
      ];
      chrome.runtime.sendMessage({ type: 'GET_MODEL_STATUSES', target: 'background', source: 'popup', request: true, payload: { modelIds } }, (response) => {
        if (chrome.runtime.lastError || response?.status !== 'success') {
          console.warn('[EngineSelectionPanel] Failed to hydrate model statuses:', chrome.runtime.lastError?.message || response?.error);
          return;
        }
        setDownloads(prev => ({ ...prev, ...response.downloads }));
        const isBubbleYoloReady = Boolean(readyModelIds.current.has('bubble-yolo') || response.statuses['bubble-yolo']);
        setIsNeuralDownloaded(isBubbleYoloReady);

        const hydrate = (items: Engine[]) => items.map(engine => ({
          ...engine,
          isDownloaded: Boolean(engine.isDownloaded || readyModelIds.current.has(engine.id) || response.statuses[engine.id]),
        }));
        const hydratedTranslation = hydrate(engines);
        const hydratedInpaint = hydrate(inpaintBaseEnginesRef.current);
        const hydratedColor = hydrate(colorBaseEnginesRef.current);
        const hydratedOcr = hydrate(ocrBaseEnginesRef.current);
        setBaseEngines(hydratedTranslation);
        setInpaintBaseEngines(hydratedInpaint);
        setColorBaseEngines(hydratedColor);
        setOcrBaseEngines(hydratedOcr);

        const currentState = stateRef.current;
        const selectedTranslation = hydratedTranslation.find((engine) => engine.id === currentState.activeEngineId);
        const translationUnavailable = selectedTranslation?.type === 'local' && !selectedTranslation.isDownloaded;
        const selectedInpaint = hydratedInpaint.find((engine) => engine.id === currentState.activeInpaintId);
        const inpaintUnavailable = Boolean(selectedInpaint && !selectedInpaint.isDownloaded);
        const selectedColor = hydratedColor.find((engine) => engine.id === (currentState.activeColorId || 'none'));
        const colorUnavailable = Boolean(selectedColor && !selectedColor.isDownloaded);
        const selectedOcr = hydratedOcr.find((engine) => engine.id === (currentState.activeOcrId || 'v6-small'));
        const ocrUnavailable = Boolean(selectedOcr && !selectedOcr.isDownloaded);
        const isNeuralActive = currentState.bubbleMode === 'neural';
        const bubbleUnavailable = isNeuralActive && !isBubbleYoloReady;
        const repairs: Partial<PopupState> = {};
        if (translationUnavailable && currentState.activeEngineId !== 'gg-translate') repairs.activeEngineId = 'gg-translate';
        if (inpaintUnavailable && currentState.activeInpaintId !== 'simple') repairs.activeInpaintId = 'simple';
        if (colorUnavailable && currentState.activeColorId !== 'none') repairs.activeColorId = 'none';
        if (ocrUnavailable && currentState.activeOcrId && currentState.activeOcrId !== 'v6-small') repairs.activeOcrId = 'v6-small';
        if (bubbleUnavailable && currentState.bubbleMode !== 'off') repairs.bubbleMode = 'off';
        if (Object.keys(repairs).length > 0) {
          console.warn('[EngineSelectionPanel] Resetting unavailable local model selections.', repairs);
          updateStateRef.current(repairs);
        }
      });
    });
  }, []);

  useEffect(() => {
    const currentIds = state.customApis.map(api => api.id);
    customApisRef.current = state.customApis;
    if (customApiIds.current !== null && currentIds.length > customApiIds.current.length) {
      const ordered = orderChangedCatalog([
        ...baseEngines,
        ...state.customApis.map(api => ({ id: api.id, name: `${api.provider}/${api.modelName}`, type: 'custom' as const, isDownloaded: true })),
      ], 'gg-translate');
      setTranslationOrder(ordered.map(engine => engine.id));
    }
    customApiIds.current = currentIds;
  }, [baseEngines, state.customApis]);

  const allEngines = useMemo(() => {
    let custom: Engine[] = (state.customApis || []).map(api => ({
      id: api.id,
      name: `${api.provider}/${api.modelName}`,
      type: 'custom' as const,
      isDownloaded: true
    }));
    
    let combined = [...baseEngines, ...custom];
    
    if (state.webgpuSupported === false) {
      combined = combined.filter(e => e.hardware !== 'WebGPU');
    }
    
    return orderChangedCatalog(combined, 'gg-translate');
  }, [baseEngines, state.customApis, state.webgpuSupported, translationOrder]);

  const miniSearch = useMemo(() => {
    if (allEngines.length === 0) return null;
    const ms = new MiniSearch({
      fields: ['name', 'id', 'hardware', 'type'],
      storeFields: ['id', 'name', 'type', 'isDownloaded', 'hardware'],
      searchOptions: { fuzzy: 0.2, prefix: true }
    });
    ms.addAll(allEngines);
    return ms;
  }, [allEngines]);

  const displayedEngines = useMemo(() => {
    if (!searchQuery.trim() || !miniSearch) {
      return allEngines.slice(0, 100);
    }
    const results = miniSearch.search(searchQuery);
    return results.slice(0, 100) as unknown as Engine[];
  }, [searchQuery, miniSearch, allEngines]);

  const activeEngine = allEngines.find((engine) => engine.id === state.activeEngineId && !(engine.type === 'local' && !engine.isDownloaded))
    || allEngines.find((engine) => engine.id === 'gg-translate')
    || allEngines[0]
    || { name: 'Loading...', id: '' };
  const activeRenderFontPresetId = normalizeRenderFontPresetId(state.renderFontPresetId);
  const activeRenderFontPreset = RENDER_FONT_PRESETS.find((preset) => preset.id === activeRenderFontPresetId)
    ?? RENDER_FONT_PRESETS[0];

  return (
    <div className="flex flex-col gap-3">
      {/* Translation Engine Selector */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 mb-1">
          <h2 className="text-sm font-medium">Translation Engine</h2>
          <HelpTooltip
            size="md"
            content={
              <>
                <span className="font-semibold text-[var(--color-paper)]">[CPU] Local</span> models run on your processor.{' '}
                <span className="font-semibold text-[var(--color-paper)]">[WEBGPU] Local</span> models use your graphics card for faster speeds.
              </>
            }
          />
        </div>

        <div className="relative flex flex-col">
          <button 
            onClick={() => setIsOpen(!isOpen)}
            className="w-full flex items-center justify-between p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer"
          >
            <span className="font-medium truncate pr-2">{activeEngine.name}</span>
            <ChevronDown size={16} className={`text-[var(--color-dust)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Redesigned INLINE progress bar (Task 6) */}
          {(() => {
            const downloadingEngine = allEngines.find(e => downloads[e.id] && downloads[e.id].progress < 1);
            if (!downloadingEngine) return null;
            const dl = downloads[downloadingEngine.id];
            return (
              <div className="mt-2 p-2 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md animate-in fade-in duration-200">
                <div className="flex justify-between items-end mb-1.5">
                  <span className="text-[10px] font-medium text-[var(--color-dust)] uppercase tracking-wider truncate max-w-[80%]">
                    {downloadingEngine.name}: {dl.status}
                  </span>
                  <span className="text-xs font-bold text-[var(--color-ink)]">
                    {Math.round(dl.progress * 100)}%
                  </span>
                </div>
                <div className="h-1.5 w-full bg-[var(--color-paper)] rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-[var(--color-editorial)] transition-all duration-300 ease-out" 
                    style={{ width: `${dl.progress * 100}%` }}
                  />
                </div>
              </div>
            );
          })()}

          {isOpen && (
            <div className="mt-1 bg-[var(--color-paper)] border border-[var(--color-dust)] rounded-md shadow-sm overflow-hidden flex flex-col max-h-[350px] z-50">
              {!showAddApi ? (
                <>
                  <div className="p-2 border-b border-[var(--color-dust)]">
                    <div className="relative">
                      <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-dust)]" />
                      <input 
                        type="text" 
                        placeholder="Search models..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-2 py-1.5 text-sm bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-ink)] transition-colors"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="overflow-y-auto flex-1 p-1 custom-scrollbar">
                    {displayedEngines.length > 0 ? displayedEngines.map((engine) => {
                      const isGpuDisabledForModel = engine.hardware === 'WebGPU' && !isLlmGpuAvailable(state);
                      const isUninstalledLocal = engine.type === 'local' && !engine.isDownloaded;
                      const isAuthRequired = engine.id === 'cloudflare-translate' && !state.userAccount?.signedIn;
                      const isSelectable = !isGpuDisabledForModel && !isUninstalledLocal && !isAuthRequired;
                      const isActive = state.activeEngineId === engine.id && isSelectable;
                      return (
                        <div key={engine.id} className="relative">
                          <div className="flex items-center">
                          <button
                            disabled={!isSelectable && !isActive}
                            onClick={() => {
                              if (isActive || !isSelectable) return;
                              updateState({ activeEngineId: engine.id });
                              setIsOpen(false);
                              setSearchQuery('');
                            }}
                            className={`min-w-0 flex-1 flex items-center justify-between p-2 text-left rounded-sm transition-colors ${
                              isActive
                                ? 'bg-[var(--color-vellum)] text-[var(--color-editorial)] font-semibold cursor-pointer'
                                : isAuthRequired
                                  ? 'opacity-40 blur-[0.4px] cursor-not-allowed select-none'
                                  : isGpuDisabledForModel
                                    ? 'text-[var(--color-dust)] opacity-40 cursor-not-allowed'
                                    : isUninstalledLocal
                                      ? 'text-[var(--color-dust)] opacity-50 cursor-not-allowed'
                                      : 'hover:bg-[var(--color-vellum)] cursor-pointer'
                            }`}
                          >
                            <div className="flex flex-col overflow-hidden">
                              <span className="truncate pr-2 text-sm">{engine.name}</span>
                              {isAuthRequired ? (
                                <span className="text-[10px] font-medium tracking-wide uppercase text-[var(--color-editorial)]">
                                  [Sign In Required]
                                </span>
                              ) : engine.hardware ? (
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${isGpuDisabledForModel ? 'text-amber-500/80' : ''}`}>
                                  [{engine.hardware}{isGpuDisabledForModel ? ' · GPU OFF' : ''}] {engine.type === 'local' ? 'Local' : ''}
                                </span>
                              ) : null}
                            </div>
                            <div className="flex-shrink-0 ml-2">
                              {isActive ? (
                                <Check size={14} className="text-[var(--color-editorial)]" />
                              ) : null}
                            </div>
                          </button>
                          {/* WORKAROUND: Keep download as a sibling of the disabled model-row
                              button. Browsers suppress all descendant clicks of a disabled native
                              button, which previously made this visible icon a silent no-op. */}
                          {isUninstalledLocal && !isGpuDisabledForModel ? (
                            <button
                              type="button"
                              disabled={pendingDownloadIds.has(engine.id) || downloads[engine.id]?.status === 'Queued'}
                              onClick={() => void requestDownload(engine.id, 'translation')}
                              className="p-2 rounded hover:bg-[var(--color-vellum)] transition-colors cursor-pointer text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-50"
                              title="Download model"
                              aria-label={`Download ${engine.name}`}
                            >
                              <Download size={14} />
                            </button>
                          ) : null}
                          </div>

                          {/* ? Help icon & tooltip for unauthenticated Cloudflare Shared Pool */}
                          {isAuthRequired && (
                            <div 
                              className="absolute right-2 top-1/2 -translate-y-1/2 z-20 flex items-center"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <HelpTooltip
                                size="sm"
                                width={210}
                                content={
                                  <>
                                    Sign in with Google in <span className="font-semibold text-[var(--color-editorial)]">Settings</span> to use the free shared pool (100 free translations/day).
                                  </>
                                }
                              />
                            </div>
                          )}
                        </div>
                      );
                    }) : (
                      <div className="p-4 text-center text-sm text-[var(--color-dust)]">
                        No models found
                      </div>
                    )}
                  </div>
                  
                  <div className="border-t border-[var(--color-dust)] p-1 bg-[var(--color-vellum)]">
                    <button 
                      onClick={() => setShowAddApi(true)}
                      className="w-full flex items-center gap-2 p-2 text-sm text-left hover:bg-[var(--color-paper)] rounded-sm cursor-pointer transition-colors"
                    >
                      <Plus size={14} className="text-[var(--color-editorial)]" />
                      <span className="text-[var(--color-editorial)] font-medium">Add Custom API Key</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="p-2">
                  <AddApiForm 
                    onSave={(api) => {
                      updateState({ customApis: [...state.customApis, api] });
                      setShowAddApi(false);
                      setIsOpen(false);
                    }}
                    onCancel={() => setShowAddApi(false)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Image Cleaning Engine Selector */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 mb-1">
          <h2 className="text-sm font-medium">Image Cleaning Engine</h2>
          <HelpTooltip
            size="md"
            content="Select inpainting engine for text removal. Higher tiers like LaMa & AOT-GAN provide seamless results."
          />
        </div>

        <div className="relative flex flex-col">
          <button 
            onClick={() => setIsOpenInpaint(!isOpenInpaint)}
            className="w-full flex items-center justify-between p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer"
          >
            <span className="font-medium truncate pr-2">
              {inpaintBaseEngines.find((engine) => engine.id === state.activeInpaintId && engine.isDownloaded)?.name
                || inpaintBaseEngines.find((engine) => engine.id === 'simple')?.name
                || 'Loading...'}
            </span>
            <ChevronDown size={16} className={`text-[var(--color-dust)] transition-transform ${isOpenInpaint ? 'rotate-180' : ''}`} />
          </button>

          {/* Redesigned INLINE progress bar for inpainting (Task 6) */}
          {(() => {
            const downloadingInpaint = inpaintBaseEngines.find(e => downloads[e.id] && downloads[e.id].progress < 1);
            if (!downloadingInpaint) return null;
            const dl = downloads[downloadingInpaint.id];
            return (
              <div className="mt-2 p-2 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md animate-in fade-in duration-200">
                <div className="flex justify-between items-end mb-1.5">
                  <span className="text-[10px] font-medium text-[var(--color-dust)] uppercase tracking-wider truncate max-w-[80%]">
                    {downloadingInpaint.name}: {dl.status}
                  </span>
                  <span className="text-xs font-bold text-[var(--color-ink)]">
                    {Math.round(dl.progress * 100)}%
                  </span>
                </div>
                <div className="h-1.5 w-full bg-[var(--color-paper)] rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-[var(--color-editorial)] transition-all duration-300 ease-out" 
                    style={{ width: `${dl.progress * 100}%` }}
                  />
                </div>
              </div>
            );
          })()}

          {isOpenInpaint && (
            <div className="mt-1 bg-[var(--color-paper)] border border-[var(--color-dust)] rounded-md shadow-sm overflow-hidden flex flex-col max-h-[350px] z-50">
              <div className="overflow-y-auto flex-1 p-1 custom-scrollbar">
                {inpaintBaseEngines.map((engine) => {
                  const isUninstalled = !engine.isDownloaded;
                  const isActive = state.activeInpaintId === engine.id && !isUninstalled;
                  return (
                    <button
                      key={engine.id}
                      onClick={() => {
                        // Task 5: User cannot select model until installed
                        if (isUninstalled) return;
                        updateState({ activeInpaintId: engine.id });
                        setIsOpenInpaint(false);
                      }}
                      className={`w-full flex items-center justify-between p-2 text-left rounded-sm transition-colors ${
                        isActive
                          ? 'bg-[var(--color-vellum)] text-[var(--color-editorial)] font-semibold cursor-pointer'
                          : isUninstalled
                            ? 'text-[var(--color-dust)] opacity-50 cursor-not-allowed'
                            : 'hover:bg-[var(--color-vellum)] cursor-pointer'
                      }`}
                    >
                      <div className="flex flex-col overflow-hidden">
                        <span className="truncate pr-2 text-sm">{engine.name}</span>
                      </div>
                      <div className="flex-shrink-0 ml-2">
                        {isActive ? (
                          <Check size={14} className="text-[var(--color-editorial)]" />
                        ) : isUninstalled ? (
                          <div 
                            onClick={(e) => {
                              e.stopPropagation();
                              // Only trigger the download here. The model becomes selectable
                              // once MODEL_DOWNLOAD_PROGRESS confirms it's actually ready —
                              // the user then clicks the row itself to select it.
                              void requestDownload(engine.id, 'inpaint');
                            }}
                            className="p-1 -mr-1 rounded hover:bg-[var(--color-vellum)] transition-colors cursor-pointer text-[var(--color-ink)] opacity-100"
                            title="Download model"
                          >
                            <Download size={14} />
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Manga Colorization Selector */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 mb-1">
          <h2 className="text-sm font-medium">Manga Colorization</h2>
          <HelpTooltip
            size="md"
            content="Colorizes black-and-white manga pages using neural SEResNeXt U-Net with CIELAB line preservation."
          />
        </div>

        <div className="relative flex flex-col">
          <button 
            onClick={() => setIsOpenColor(!isOpenColor)}
            className="w-full flex items-center justify-between p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer"
          >
            <span className="font-medium truncate pr-2">
              {colorBaseEngines.find((engine) => engine.id === (state.activeColorId || 'none') && engine.isDownloaded)?.name
                || colorBaseEngines.find((engine) => engine.id === 'none')?.name
                || 'Disabled'}
            </span>
            <ChevronDown size={16} className={`text-[var(--color-dust)] transition-transform ${isOpenColor ? 'rotate-180' : ''}`} />
          </button>

          {/* Inline progress bar for color model download */}
          {(() => {
            const downloadingColor = colorBaseEngines.find(e => downloads[e.id] && downloads[e.id].progress < 1);
            if (!downloadingColor) return null;
            const dl = downloads[downloadingColor.id];
            return (
              <div className="mt-2 p-2 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md animate-in fade-in duration-200">
                <div className="flex justify-between items-end mb-1.5">
                  <span className="text-[10px] font-medium text-[var(--color-dust)] uppercase tracking-wider truncate max-w-[80%]">
                    {downloadingColor.name}: {dl.status}
                  </span>
                  <span className="text-xs font-bold text-[var(--color-ink)]">
                    {Math.round(dl.progress * 100)}%
                  </span>
                </div>
                <div className="h-1.5 w-full bg-[var(--color-paper)] rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-[var(--color-editorial)] transition-all duration-300 ease-out" 
                    style={{ width: `${dl.progress * 100}%` }}
                  />
                </div>
              </div>
            );
          })()}

          {isOpenColor && (
            <div className="mt-1 bg-[var(--color-paper)] border border-[var(--color-dust)] rounded-md shadow-sm overflow-hidden flex flex-col max-h-[350px] z-50">
              <div className="overflow-y-auto flex-1 p-1 custom-scrollbar">
                {colorBaseEngines.map((engine) => {
                  const isUninstalled = !engine.isDownloaded;
                  const isActive = (state.activeColorId || 'none') === engine.id && !isUninstalled;
                  return (
                    <button
                      key={engine.id}
                      onClick={() => {
                        if (isUninstalled) return;
                        updateState({ activeColorId: engine.id });
                        setIsOpenColor(false);
                      }}
                      className={`w-full flex items-center justify-between p-2 text-left rounded-sm transition-colors ${
                        isActive
                          ? 'bg-[var(--color-vellum)] text-[var(--color-editorial)] font-semibold cursor-pointer'
                          : isUninstalled
                            ? 'text-[var(--color-dust)] opacity-50 cursor-not-allowed'
                            : 'hover:bg-[var(--color-vellum)] cursor-pointer'
                      }`}
                    >
                      <div className="flex flex-col overflow-hidden">
                        <span className="truncate pr-2 text-sm">{engine.name}</span>
                      </div>
                      <div className="flex-shrink-0 ml-2">
                        {isActive ? (
                          <Check size={14} className="text-[var(--color-editorial)]" />
                        ) : isUninstalled ? (
                          <div 
                            onClick={(e) => {
                              e.stopPropagation();
                              void requestDownload(engine.id, 'color');
                            }}
                            className="p-1 -mr-1 rounded hover:bg-[var(--color-vellum)] transition-colors cursor-pointer text-[var(--color-ink)] opacity-100"
                            title="Download model"
                          >
                            <Download size={14} />
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* OCR Engine Selector */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 mb-1">
          <h2 className="text-sm font-medium">OCR Engine</h2>
          <HelpTooltip
            size="md"
            content="Select PaddleOCR text detection and recognition model tier. v6-small is fast and lightweight. Higher tiers provide enhanced precision for specialized scripts."
          />
        </div>

        <div className="relative flex flex-col">
          <button 
            onClick={() => setIsOpenOcr(!isOpenOcr)}
            className="w-full flex items-center justify-between p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer"
          >
            <span className="font-medium truncate pr-2">
              {ocrBaseEngines.find((engine) => engine.id === (state.activeOcrId || 'v6-small') && engine.isDownloaded)?.name
                || ocrBaseEngines.find((engine) => engine.id === 'v6-small')?.name
                || 'Loading...'}
            </span>
            <ChevronDown size={16} className={`text-[var(--color-dust)] transition-transform ${isOpenOcr ? 'rotate-180' : ''}`} />
          </button>

          {/* Inline progress bar for OCR model download */}
          {(() => {
            const downloadingOcr = ocrBaseEngines.find(e => downloads[e.id] && downloads[e.id].progress < 1);
            if (!downloadingOcr) return null;
            const dl = downloads[downloadingOcr.id];
            return (
              <div className="mt-2 p-2 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md animate-in fade-in duration-200">
                <div className="flex justify-between items-end mb-1.5">
                  <span className="text-[10px] font-medium text-[var(--color-dust)] uppercase tracking-wider truncate max-w-[80%]">
                    {downloadingOcr.name}: {dl.status}
                  </span>
                  <span className="text-xs font-bold text-[var(--color-ink)]">
                    {Math.round(dl.progress * 100)}%
                  </span>
                </div>
                <div className="h-1.5 w-full bg-[var(--color-paper)] rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-[var(--color-editorial)] transition-all duration-300 ease-out" 
                    style={{ width: `${dl.progress * 100}%` }}
                  />
                </div>
              </div>
            );
          })()}

          {isOpenOcr && (
            <div className="mt-1 bg-[var(--color-paper)] border border-[var(--color-dust)] rounded-md shadow-sm overflow-hidden flex flex-col max-h-[350px] z-50">
              <div className="overflow-y-auto flex-1 p-1 custom-scrollbar">
                {ocrBaseEngines.map((engine) => {
                  const isUninstalled = !engine.isDownloaded;
                  const isActive = (state.activeOcrId || 'v6-small') === engine.id && !isUninstalled;
                  return (
                    <button
                      key={engine.id}
                      onClick={() => {
                        if (isUninstalled) return;
                        updateState({ activeOcrId: engine.id as any });
                        setIsOpenOcr(false);
                      }}
                      className={`w-full flex items-center justify-between p-2 text-left rounded-sm transition-colors ${
                        isActive 
                          ? 'bg-[var(--color-vellum)] text-[var(--color-editorial)] font-semibold cursor-pointer' 
                          : isUninstalled
                            ? 'text-[var(--color-dust)] opacity-50 cursor-not-allowed'
                            : 'hover:bg-[var(--color-vellum)] cursor-pointer'
                      }`}
                    >
                      <div className="flex flex-col overflow-hidden">
                        <span className="truncate pr-2 text-sm">{engine.name}</span>
                        {engine.hardware && (
                          <span className="text-[10px] font-bold uppercase tracking-wider">
                            [{engine.hardware}] {engine.type === 'local' ? 'Local' : ''}
                          </span>
                        )}
                      </div>
                      <div className="flex-shrink-0 ml-2">
                        {isActive ? (
                          <Check size={14} className="text-[var(--color-editorial)]" />
                        ) : isUninstalled ? (
                          <div 
                            onClick={(e) => {
                              e.stopPropagation();
                              void requestDownload(engine.id, 'ocr');
                            }}
                            className="p-1 -mr-1 rounded hover:bg-[var(--color-vellum)] transition-colors cursor-pointer text-[var(--color-ink)] opacity-100"
                            title="Download model"
                          >
                            <Download size={14} />
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Layout & Bubble Fit Selector */}
      {(() => {
        const activeBubbleMode = state.bubbleMode ?? 'off';

        return (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 mb-1">
              <h2 className="text-sm font-medium">Layout & Bubble Fit</h2>
              <HelpTooltip
                size="md"
                content="Speech bubbles expand horizontal layout space and center translated text inside the balloon chamber, preventing tiny 6px fonts."
              />
            </div>

            <div className="relative flex flex-col">
              <button
                aria-label="Layout and Bubble Fit"
                aria-expanded={isOpenBubbleMode}
                onClick={() => setIsOpenBubbleMode(!isOpenBubbleMode)}
                className="w-full flex items-center justify-between p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer"
              >
                <span className="font-medium truncate pr-2">
                  {activeBubbleMode === 'neural' && isNeuralDownloaded
                    ? 'YOLO (AI)'
                    : activeBubbleMode === 'heuristic'
                      ? 'Heuristic'
                      : 'Disabled'}
                </span>
                <ChevronDown size={16} className={`text-[var(--color-dust)] transition-transform ${isOpenBubbleMode ? 'rotate-180' : ''}`} />
              </button>

              {/* Inline progress bar for YOLO bubble detector download */}
              {(() => {
                const dl = downloads['bubble-yolo'];
                if (!dl || dl.progress >= 1) return null;
                return (
                  <div className="mt-2 p-2 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md animate-in fade-in duration-200">
                    <div className="flex justify-between items-end mb-1.5">
                      <span className="text-[10px] font-medium text-[var(--color-dust)] uppercase tracking-wider truncate max-w-[80%]">
                        YOLO Bubble: {dl.status}
                      </span>
                      <span className="text-xs font-bold text-[var(--color-ink)]">
                        {Math.round(dl.progress * 100)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-[var(--color-paper)] rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-[var(--color-editorial)] transition-all duration-300 ease-out" 
                        style={{ width: `${dl.progress * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })()}

              {isOpenBubbleMode && (
                <div className="mt-1 bg-[var(--color-paper)] border border-[var(--color-dust)] rounded-md shadow-sm flex flex-col z-50">
                  <div className="p-1">
                    {BUBBLE_MODE_OPTIONS.map((opt) => {
                      const isUninstalled = opt.isModel && !isNeuralDownloaded;
                      const isActive = activeBubbleMode === opt.id && !isUninstalled;
                      return (
                        <button
                          type="button"
                          key={opt.id}
                          aria-disabled={isUninstalled}
                          onClick={() => {
                            if (isUninstalled) return;
                            updateState({ bubbleMode: opt.id });
                            setIsOpenBubbleMode(false);
                          }}
                          className={`w-full flex items-center justify-between p-2 rounded-sm transition-colors text-left bg-transparent border-none ${
                            isActive
                              ? 'bg-[var(--color-vellum)] text-[var(--color-editorial)] font-semibold cursor-pointer'
                              : isUninstalled
                                ? 'text-[var(--color-dust)] opacity-50 cursor-not-allowed'
                                : 'hover:bg-[var(--color-vellum)] cursor-pointer'
                          }`}
                        >
                          <div className="min-w-0 flex-1 flex items-center gap-1.5">
                            <span className="truncate pr-1 text-sm">{opt.name}</span>
                            {opt.tooltip && (
                              <span
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center"
                              >
                                <HelpTooltip
                                  size="sm"
                                  width={220}
                                  content={opt.tooltip}
                                />
                              </span>
                            )}
                          </div>
                          <div className="flex-shrink-0 ml-2">
                            {isActive ? (
                              <Check size={14} className="text-[var(--color-editorial)]" />
                            ) : isUninstalled ? (
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void requestDownload('bubble-yolo', 'bubble');
                                }}
                                className="p-1 -mr-1 rounded hover:bg-[var(--color-vellum)] transition-colors cursor-pointer text-[var(--color-ink)] opacity-100"
                                title="Download model"
                              >
                                <Download size={14} />
                              </div>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Render Font Selector */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 mb-1">
          <h2 className="text-sm font-medium">Render Font</h2>
          <HelpTooltip
            size="sm"
            content="Typography used when rendering translated text back onto comic speech bubbles and artwork."
          />
        </div>

        <div className="relative flex flex-col">
          <button
            aria-label="Render Font"
            aria-expanded={isOpenRenderFont}
            onClick={() => setIsOpenRenderFont(!isOpenRenderFont)}
            className="w-full flex items-center justify-between p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer"
          >
            <span className="font-medium truncate pr-2" style={{ fontFamily: activeRenderFontPreset.fontFamily }}>{activeRenderFontPreset.label}</span>
            <ChevronDown size={16} className={`text-[var(--color-dust)] transition-transform ${isOpenRenderFont ? 'rotate-180' : ''}`} />
          </button>

          {isOpenRenderFont && (
            <div className="mt-1 bg-[var(--color-paper)] border border-[var(--color-dust)] rounded-md shadow-sm overflow-hidden flex flex-col max-h-[350px] z-50">
              <div className="overflow-y-auto flex-1 p-1 custom-scrollbar">
                {RENDER_FONT_PRESETS.map((preset) => {
                  const isActive = activeRenderFontPresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      onClick={() => {
                        updateState({ renderFontPresetId: normalizeRenderFontPresetId(preset.id) });
                        setIsOpenRenderFont(false);
                      }}
                      className={`w-full flex items-center justify-between p-2 text-left rounded-sm transition-colors ${
                        isActive
                          ? 'bg-[var(--color-vellum)] text-[var(--color-editorial)] font-semibold cursor-pointer'
                          : 'hover:bg-[var(--color-vellum)] cursor-pointer'
                      }`}
                    >
                      <div className="flex flex-col overflow-hidden">
                        <span className="truncate pr-2 text-sm" style={{ fontFamily: preset.fontFamily }}>{preset.label}</span>
                        {preset.description && (
                          <span className="text-[11px] text-[var(--color-dust)] truncate">{preset.description}</span>
                        )}
                      </div>
                      <div className="flex-shrink-0 ml-2">
                        {isActive ? <Check size={14} className="text-[var(--color-editorial)]" /> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Advanced Text Rendering Options */}
        <div className="flex flex-col mt-0.5">
          <button
            type="button"
            onClick={() => setIsOpenFontOptions(!isOpenFontOptions)}
            className="flex items-center gap-1.5 text-xs text-[var(--color-dust)] hover:text-[var(--color-ink)] transition-colors cursor-pointer py-1 self-start"
          >
            <ChevronRight
              size={13}
              className={`transition-transform duration-200 text-[var(--color-dust)] ${isOpenFontOptions ? 'rotate-90' : ''}`}
            />
            <span>Text Rendering Options</span>
            {(state.renderFontBold || state.renderFontItalic || state.renderFontStrokeDisabled || (state.renderFontAlignment && state.renderFontAlignment !== 'auto') || (state.renderFontMinSize && state.renderFontMinSize !== 6)) && (
              <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-[var(--color-vellum)] text-[var(--color-editorial)] border border-[var(--color-editorial)]/40 ml-1">
                Custom
              </span>
            )}
          </button>

          {isOpenFontOptions && (
            <div className="mt-1.5 p-3 rounded-md bg-[var(--color-vellum)]/60 border border-[var(--color-dust)]/50 space-y-3">
              {/* Row 1: Style Pills (Bold, Italic, Disable Stroke) */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  aria-label="Toggle Bold Font"
                  title={state.renderFontBold ? 'Bold text enabled (Click to use regular)' : 'Bold text disabled (Click to enable bold)'}
                  onClick={() => updateState({ renderFontBold: !state.renderFontBold })}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer border ${
                    state.renderFontBold
                      ? 'bg-[var(--color-paper)] border-[var(--color-editorial)] text-[var(--color-editorial)] shadow-xs'
                      : 'bg-transparent border-[var(--color-dust)] text-[var(--color-dust)] hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  <Bold size={13} className={state.renderFontBold ? 'stroke-[2.5]' : 'stroke-[2]'} />
                  <span>Bold</span>
                </button>

                <button
                  type="button"
                  aria-label="Toggle Italic Font"
                  title={state.renderFontItalic ? 'Italic text enabled' : 'Italic text disabled'}
                  onClick={() => updateState({ renderFontItalic: !state.renderFontItalic })}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer border ${
                    state.renderFontItalic
                      ? 'bg-[var(--color-paper)] border-[var(--color-editorial)] text-[var(--color-editorial)] shadow-xs'
                      : 'bg-transparent border-[var(--color-dust)] text-[var(--color-dust)] hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  <Italic size={13} className={state.renderFontItalic ? 'stroke-[2.5]' : 'stroke-[2]'} />
                  <span>Italic</span>
                </button>

                <button
                  type="button"
                  aria-label="Toggle Text Stroke"
                  title={state.renderFontStrokeDisabled ? 'Outline stroke disabled' : 'Outline stroke enabled'}
                  onClick={() => updateState({ renderFontStrokeDisabled: !state.renderFontStrokeDisabled })}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer border ${
                    state.renderFontStrokeDisabled
                      ? 'bg-[var(--color-paper)] border-[var(--color-editorial)] text-[var(--color-editorial)] shadow-xs'
                      : 'bg-transparent border-[var(--color-dust)] text-[var(--color-dust)] hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  <span>Disable Stroke</span>
                </button>
              </div>

              {/* Row 2: Text Alignment (Auto | Left | Center | Right) */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--color-dust)] font-medium">Text Alignment</span>
                <div className="flex items-center rounded-md border border-[var(--color-dust)] bg-[var(--color-paper)] p-0.5">
                  {(['auto', 'left', 'center', 'right'] as const).map((align) => {
                    const activeAlign = state.renderFontAlignment || 'auto';
                    const isSelected = activeAlign === align;
                    return (
                      <button
                        key={align}
                        type="button"
                        onClick={() => updateState({ renderFontAlignment: align })}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-[var(--color-editorial)] text-white shadow-xs'
                            : 'text-[var(--color-dust)] hover:text-[var(--color-ink)]'
                        }`}
                      >
                        {align === 'auto' ? 'Auto' : align === 'left' ? <AlignLeft size={12} /> : align === 'center' ? <AlignCenter size={12} /> : <AlignRight size={12} />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Row 3: Minimum Font Size */}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-[var(--color-dust)] font-medium shrink-0">Min Font Size</span>
                <div className="flex items-center gap-2 flex-1 max-w-[170px]">
                  <input
                    type="range"
                    min={4}
                    max={20}
                    step={1}
                    value={state.renderFontMinSize ?? 6}
                    onChange={(e) => updateState({ renderFontMinSize: Number(e.target.value) })}
                    className="w-full accent-[var(--color-editorial)] cursor-pointer"
                  />
                  <span className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded bg-[var(--color-paper)] border border-[var(--color-dust)] min-w-[34px] text-center">
                    {state.renderFontMinSize ?? 6}px
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
