import { useState, useEffect, useMemo, useRef } from 'react';
import { Download, ChevronDown, Plus, Search, Check } from 'lucide-react';
import type { PopupState } from '../../shared/types';
import AddApiForm from './AddApiForm';
import MiniSearch from 'minisearch';
import { ModelRegistry } from '../services/ModelRegistry';
import { isLlmGpuAvailable } from '../../shared/utils/hardwareUtils';
import { RENDER_FONT_PRESETS, normalizeRenderFontPresetId } from '../../shared/renderFontPresets';

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
 * Orders a changed model catalog without mutating React state.
 *
 * @param engines - Models to order after a download or custom API addition.
 * @param defaultId - The model that must remain pinned first.
 * @returns The ordered model list.
 */
export function orderChangedCatalog(engines: readonly Engine[], defaultId: string): Engine[] {
  return [...engines].sort((left, right) =>
    Number(right.id === defaultId) - Number(left.id === defaultId) ||
    Number(Boolean(right.isDownloaded)) - Number(Boolean(left.isDownloaded)) ||
    left.name.localeCompare(right.name)
  );
}

export default function EngineSelectionPanel({ state, updateState }: EngineSelectionPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isOpenInpaint, setIsOpenInpaint] = useState(false);
  const [isOpenOcr, setIsOpenOcr] = useState(false);
  const [isOpenRenderFont, setIsOpenRenderFont] = useState(false);
  const [showAddApi, setShowAddApi] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [downloads, setDownloads] = useState<Record<string, { progress: number; status: string }>>({});
  const [translationOrder, setTranslationOrder] = useState<string[] | null>(null);
  const [pendingDownloadIds, setPendingDownloadIds] = useState<Set<string>>(() => new Set());
  const customApiIds = useRef<string[] | null>(null);
  const customApisRef = useRef(state.customApis);
  const readyModelIds = useRef(new Set<string>());
  const stateRef = useRef(state);

  /**
   * Queues one model download through the background-owned RPC route.
   *
   * @param modelId - Registry model identifier.
   * @param category - Model subsystem that owns the download.
   * @returns A promise resolved after background/offscreen acknowledgement.
   */
  const requestDownload = async (modelId: string, category: 'translation' | 'inpaint' | 'ocr'): Promise<void> => {
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
          setOcrBaseEngines(prev => prev.some(engine => engine.id === message.payload.modelId)
            ? orderChangedCatalog(
              prev.map(engine => engine.id === message.payload.modelId ? { ...engine, isDownloaded: true } : engine),
              'v6-small'
            )
            : prev
          );
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

  const [inpaintBaseEngines, setInpaintBaseEngines] = useState<Engine[]>([
    { id: 'none', name: 'None', type: 'local', isDownloaded: true },
    { id: 'simple', name: 'Simple Fill', type: 'local', isDownloaded: true },
    { id: 'telea', name: 'Telea Diffusion', type: 'local', isDownloaded: true },
    { id: 'aotgan', name: 'AOT-GAN', type: 'local', isDownloaded: false },
    { id: 'lama-manga', name: 'LaMa Manga', type: 'local', isDownloaded: false },
  ]);

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
        ...inpaintBaseEngines.map(engine => engine.id),
        ...ocrBaseEngines.map(engine => engine.id),
      ];
      chrome.runtime.sendMessage({ type: 'GET_MODEL_STATUSES', target: 'background', source: 'popup', request: true, payload: { modelIds } }, (response) => {
        if (chrome.runtime.lastError || response?.status !== 'success') {
          console.warn('[EngineSelectionPanel] Failed to hydrate model statuses:', chrome.runtime.lastError?.message || response?.error);
          return;
        }
        setDownloads(prev => ({ ...prev, ...response.downloads }));
        const hydrate = (items: Engine[]) => items.map(engine => ({
          ...engine,
          isDownloaded: Boolean(engine.isDownloaded || readyModelIds.current.has(engine.id) || response.statuses[engine.id]),
        }));
        const hydratedTranslation = hydrate(engines);
        const hydratedInpaint = hydrate(inpaintBaseEngines);
        const hydratedOcr = hydrate(ocrBaseEngines);
        setBaseEngines(hydratedTranslation);
        setInpaintBaseEngines(hydratedInpaint);
        setOcrBaseEngines(hydratedOcr);

        const currentState = stateRef.current;
        const selectedTranslation = hydratedTranslation.find((engine) => engine.id === currentState.activeEngineId);
        const translationUnavailable = selectedTranslation?.type === 'local' && !selectedTranslation.isDownloaded;
        const selectedInpaint = hydratedInpaint.find((engine) => engine.id === currentState.activeInpaintId);
        const inpaintUnavailable = Boolean(selectedInpaint && !selectedInpaint.isDownloaded);
        const selectedOcr = hydratedOcr.find((engine) => engine.id === (currentState.activeOcrId || 'v6-small'));
        const ocrUnavailable = Boolean(selectedOcr && !selectedOcr.isDownloaded);
        const repairs: Partial<PopupState> = {};
        if (translationUnavailable) repairs.activeEngineId = 'gg-translate';
        if (inpaintUnavailable) repairs.activeInpaintId = 'simple';
        if (ocrUnavailable) repairs.activeOcrId = 'v6-small';
        if (Object.keys(repairs).length > 0) {
          console.warn('[EngineSelectionPanel] Resetting unavailable local model selections.', repairs);
          updateState(repairs);
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
      return allEngines.slice(0, 50);
    }
    const results = miniSearch.search(searchQuery);
    return results.slice(0, 50) as unknown as Engine[];
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
        <div className="flex items-center gap-1.5 mb-1 relative">
          <h2 className="text-sm font-medium">Translation Engine</h2>
          <div className="peer w-4 h-4 rounded-full border border-[var(--color-dust)] flex items-center justify-center text-[10px] text-[var(--color-dust)] cursor-help hover:bg-[var(--color-dust)] hover:text-[var(--color-paper)] transition-colors">?</div>
          
          <div className="absolute left-0 top-full pt-1.5 w-[280px] max-w-[85vw] z-50 opacity-0 pointer-events-none peer-hover:opacity-100 transition-opacity">
            <div className="p-2.5 bg-[var(--color-ink)] text-[var(--color-paper)] text-xs rounded-md shadow-xl">
              <span className="font-semibold text-[var(--color-paper)]">[CPU] Local</span> models run on your processor. <span className="font-semibold text-[var(--color-paper)]">[WEBGPU] Local</span> models use your graphics card for faster speeds.
            </div>
          </div>
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
                              <div className="peer w-3.5 h-3.5 rounded-full border border-[var(--color-dust)] flex items-center justify-center text-[9px] text-[var(--color-dust)] cursor-help hover:bg-[var(--color-dust)] hover:text-[var(--color-paper)] transition-colors flex-shrink-0">
                                ?
                              </div>
                              <div className="absolute right-0 top-full mt-1.5 w-[210px] z-50 opacity-0 pointer-events-none peer-hover:opacity-100 transition-opacity">
                                <div className="p-2 bg-[var(--color-ink)] text-[var(--color-paper)] text-[11px] leading-snug rounded-md shadow-xl border border-[var(--color-dust)]/20">
                                  Sign in with Google in <span className="font-semibold text-[var(--color-editorial)]">Settings</span> to use the free shared pool (100 free translations/day).
                                </div>
                              </div>
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
        <div className="flex items-center gap-1.5 mb-1 relative">
          <h2 className="text-sm font-medium">Image Cleaning Engine</h2>
          <div className="peer w-4 h-4 rounded-full border border-[var(--color-dust)] flex items-center justify-center text-[10px] text-[var(--color-dust)] cursor-help hover:bg-[var(--color-dust)] hover:text-[var(--color-paper)] transition-colors">?</div>
          
          <div className="absolute left-0 top-full pt-1.5 w-[280px] max-w-[85vw] z-50 opacity-0 pointer-events-none peer-hover:opacity-100 transition-opacity">
            <div className="p-2.5 bg-[var(--color-ink)] text-[var(--color-paper)] text-xs rounded-md shadow-xl">
              Select inpainting engine for text removal. Higher tiers like LaMa & AOT-GAN provide seamless results.
            </div>
          </div>
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

      {/* OCR Engine Selector */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 mb-1 relative">
          <h2 className="text-sm font-medium">OCR Engine</h2>
          <div className="peer w-4 h-4 rounded-full border border-[var(--color-dust)] flex items-center justify-center text-[10px] text-[var(--color-dust)] cursor-help hover:bg-[var(--color-dust)] hover:text-[var(--color-paper)] transition-colors">?</div>
          
          <div className="absolute left-0 top-full pt-1.5 w-[280px] max-w-[85vw] z-50 opacity-0 pointer-events-none peer-hover:opacity-100 transition-opacity">
            <div className="p-2.5 bg-[var(--color-ink)] text-[var(--color-paper)] text-xs rounded-md shadow-xl">
              Select PaddleOCR text detection and recognition model tier. v6-small is fast and lightweight. Higher tiers provide enhanced precision for specialized scripts.
            </div>
          </div>
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

      {/* Render Font Selector */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 mb-1 relative">
          <h2 className="text-sm font-medium">Render Font</h2>
        </div>

        <div className="relative flex flex-col">
          <button
            aria-label="Render Font"
            aria-expanded={isOpenRenderFont}
            onClick={() => setIsOpenRenderFont(!isOpenRenderFont)}
            className="w-full flex items-center justify-between p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer"
          >
            <span className="font-medium truncate pr-2">{activeRenderFontPreset.label}</span>
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
                        <span className="truncate pr-2 text-sm">{preset.label}</span>
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
      </div>
    </div>

  );
}
