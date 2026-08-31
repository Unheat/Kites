import { useState, useEffect, useMemo } from 'react';
import { Download, ChevronDown, Plus, Search, Check } from 'lucide-react';
import type { PopupState } from '../../shared/types';
import AddApiForm from './AddApiForm';
import MiniSearch from 'minisearch';
import { ModelRegistry } from '../services/ModelRegistry';
import { ocrRegistry } from '../../offscreen/engines/ocr/ocrRegistry';

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

export default function EngineSelectionPanel({ state, updateState }: EngineSelectionPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isOpenInpaint, setIsOpenInpaint] = useState(false);
  const [isOpenOcr, setIsOpenOcr] = useState(false);
  const [showAddApi, setShowAddApi] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [downloads, setDownloads] = useState<Record<string, { progress: number; status: string }>>({});

  useEffect(() => {
    // Query active downloads on mount
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_DOWNLOADS' }, (response) => {
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
          setBaseEngines(prev => prev.map(e => e.id === message.payload.modelId ? { ...e, isDownloaded: true } : e));
          setInpaintBaseEngines(prev => prev.map(e => e.id === message.payload.modelId ? { ...e, isDownloaded: true } : e));
          setOcrBaseEngines(prev => prev.map(e => e.id === message.payload.modelId ? { ...e, isDownloaded: true } : e));
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
    { id: 'lama-base', name: 'LaMa Base', type: 'local', isDownloaded: false },
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

  useEffect(() => {
    (async () => {
      try {
        const hasCache = await caches.has('kites-inpaint-models-v1');
        if (hasCache) {
          const cache = await caches.open('kites-inpaint-models-v1');
          const keys = await cache.keys();
          const urls = keys.map(k => k.url);
          setInpaintBaseEngines(prev => prev.map(e => {
            if (e.id === 'aotgan') return { ...e, isDownloaded: urls.some(u => u.includes('aotgan')) };
            if (e.id === 'lama-base') return { ...e, isDownloaded: urls.some(u => u.includes('lama-base')) };
            if (e.id === 'lama-manga') return { ...e, isDownloaded: urls.some(u => u.includes('lama-manga')) };
            return e;
          }));
        }

        const hasOcrCache = await caches.has('kites-ocr-models-v1');
        if (hasOcrCache) {
          const ocrCache = await caches.open('kites-ocr-models-v1');
          const ocrKeys = await ocrCache.keys();
          const ocrUrls = ocrKeys.map(k => k.url);
          setOcrBaseEngines(prev => prev.map(e => {
            const entry = ocrRegistry[e.id];
            if (!entry) return e;
            const isDownloaded = ocrUrls.includes(entry.detectionUrl) &&
                                 ocrUrls.includes(entry.recognitionUrl) &&
                                 ocrUrls.includes(entry.charactersDictionaryUrl);
            return { ...e, isDownloaded };
          }));
        }
      } catch (e) {
        console.warn('Model cache check failed:', e);
      }
    })();
  }, []);

  const [baseEngines, setBaseEngines] = useState<Engine[]>([]);

  useEffect(() => {
    ModelRegistry.getAvailableEngines().then(setBaseEngines);
  }, []);

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
    
    return combined;
  }, [baseEngines, state.customApis, state.webgpuSupported]);

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

  const activeEngine = allEngines.find(e => e.id === state.activeEngineId) || allEngines[0] || { name: 'Loading...', id: '' };

  return (
    <div className="flex flex-col gap-5">
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
                      const isUninstalledLocal = engine.type === 'local' && !engine.isDownloaded;
                      return (
                        <button
                          key={engine.id}
                          onClick={() => {
                            if (state.activeEngineId === engine.id) return;
                            // Task 5: User cannot select model until installed
                            if (isUninstalledLocal) return;
                            updateState({ activeEngineId: engine.id });
                            setIsOpen(false);
                            setSearchQuery('');
                          }}
                          className={`w-full flex items-center justify-between p-2 text-left rounded-sm transition-colors ${
                            state.activeEngineId === engine.id 
                              ? 'bg-[var(--color-vellum)] text-[var(--color-editorial)] font-semibold cursor-pointer' 
                              : isUninstalledLocal
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
                            {state.activeEngineId === engine.id ? (
                              <Check size={14} className="text-[var(--color-editorial)]" />
                            ) : isUninstalledLocal ? (
                              <div 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Only trigger the download here. The model becomes selectable
                                  // once MODEL_DOWNLOAD_PROGRESS confirms it's actually ready —
                                  // the user then clicks the row itself to select it.
                                  chrome.runtime.sendMessage({ type: 'START_MODEL_DOWNLOAD', payload: { modelId: engine.id } });
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
              {inpaintBaseEngines.find(e => e.id === state.activeInpaintId)?.name || 'Loading...'}
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
                        state.activeInpaintId === engine.id 
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
                        {state.activeInpaintId === engine.id ? (
                          <Check size={14} className="text-[var(--color-editorial)]" />
                        ) : isUninstalled ? (
                          <div 
                            onClick={(e) => {
                              e.stopPropagation();
                              // Only trigger the download here. The model becomes selectable
                              // once MODEL_DOWNLOAD_PROGRESS confirms it's actually ready —
                              // the user then clicks the row itself to select it.
                              chrome.runtime.sendMessage({ type: 'START_MODEL_DOWNLOAD', payload: { modelId: engine.id, category: 'inpaint' } });
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
      <div className="flex flex-col gap-1.5 mt-4">
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
              {ocrBaseEngines.find(e => e.id === (state.activeOcrId || 'v6-small'))?.name || 'Loading...'}
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
                  const isActive = (state.activeOcrId || 'v6-small') === engine.id;
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
                              chrome.runtime.sendMessage({ type: 'START_MODEL_DOWNLOAD', payload: { modelId: engine.id, category: 'ocr' } });
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
    </div>

  );
}
