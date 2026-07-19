import { useState, useEffect, useMemo } from 'react';
import { Download, Upload, ChevronDown, Plus, Search, Check } from 'lucide-react';
import type { PopupState } from '../index';
import AddApiForm from './AddApiForm';
import MiniSearch from 'minisearch';
import { ModelRegistry } from '../services/ModelRegistry';

interface EngineDropdownProps {
  state: PopupState;
  updateState: (updates: Partial<PopupState>) => void;
}

export interface Engine {
  id: string;
  name: string;
  type: 'local' | 'api' | 'custom';
  isDownloaded?: boolean;
  hardware?: 'CPU' | 'WebGPU';
}

export default function EngineDropdown({ state, updateState }: EngineDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isOpenInpaint, setIsOpenInpaint] = useState(false);
  const [showAddApi, setShowAddApi] = useState(false);
  const [showWebGpuConfig, setShowWebGpuConfig] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const inpaintingEngines = useMemo(() => [
    { id: 'none', name: 'None', type: 'local', isDownloaded: true },
    { id: 'simple', name: 'Simple Fill', type: 'local', isDownloaded: true },
    { id: 'telea', name: 'Telea Diffusion', type: 'local', isDownloaded: true },
    { id: 'aot', name: 'AOT-GAN', type: 'local', isDownloaded: false },
    { id: 'lama', name: 'LaMa Base', type: 'local', isDownloaded: false },
    { id: 'lama-manga', name: 'LaMa Manga', type: 'local', isDownloaded: false },
  ], []);
  
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
    
    // WebGPU Filtering Logic
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
      
      {/* Translation Mode Toggles */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md">
          <div>
            <span className="font-medium block text-sm">Auto-Translate</span>
            <span className="text-xs text-[var(--color-dust)]">
              {state.isAuto ? 'Translates visible images' : 'Requires manual activation'}
            </span>
          </div>
          <button 
            onClick={() => updateState({ isAuto: !state.isAuto })}
            className="kites-switch kites-switch-md"
            data-state={state.isAuto ? 'checked' : 'unchecked'}
          >
            <span className="sr-only">Toggle auto-translate</span>
            <span className="kites-switch-thumb" />
          </button>
        </div>

        {/* Manual Selection Method - Only show if Auto is OFF */}
        {!state.isAuto && (
          <div className="animate-in fade-in slide-in-from-top-2 duration-200">
            <span className="font-medium block text-sm mb-1.5 px-1">Manual Selection Method</span>
            <div className="flex p-1 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md">
              <button
                onClick={() => updateState({ manualMode: 'hover' })}
                className={`flex-1 py-1.5 text-sm font-medium rounded-sm transition-colors cursor-pointer ${
                  state.manualMode === 'hover' ? 'bg-[var(--color-paper)] text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-dust)] hover:text-[var(--color-ink)]'
                }`}
              >
                Hover
              </button>
              <button
                onClick={() => updateState({ manualMode: 'persistent' })}
                className={`flex-1 py-1.5 text-sm font-medium rounded-sm transition-colors cursor-pointer ${
                  state.manualMode === 'persistent' ? 'bg-[var(--color-paper)] text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-dust)] hover:text-[var(--color-ink)]'
                }`}
              >
                Persistent
              </button>
            </div>
          </div>
        )}
      </div>

      <hr className="border-[var(--color-dust)] opacity-50" />

      {/* Engine Selection */}
      <div className="flex flex-col gap-6">
        
        {/* Translation Engine */}
        <div className="relative mt-2">
          <div className="flex items-center gap-1.5 mb-2 relative">
            <h2 className="text-sm font-medium">Translation Engine</h2>
            <div className="peer w-4 h-4 rounded-full border border-[var(--color-dust)] flex items-center justify-center text-[10px] text-[var(--color-dust)] cursor-help hover:bg-[var(--color-dust)] hover:text-[var(--color-paper)] transition-colors">?</div>
            
            <div className="absolute left-0 top-full pt-1.5 w-[280px] max-w-[85vw] z-50 opacity-0 pointer-events-none peer-hover:opacity-100 peer-hover:pointer-events-auto hover:opacity-100 hover:pointer-events-auto transition-opacity">
              <div className="p-2.5 bg-[var(--color-ink)] text-[var(--color-paper)] text-xs rounded-md shadow-xl">
                <span className="font-semibold text-[var(--color-paper)]">[CPU] Local</span> models run on your processor. <span className="font-semibold text-[var(--color-paper)]">[WEBGPU] Local</span> models use your graphics card for faster speeds with the exact same accuracy.
              </div>
            </div>
          </div>

        <div className="relative">
          <button 
            onClick={() => setIsOpen(!isOpen)}
            className="w-full flex items-center justify-between p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer"
          >
            <span className="font-medium truncate pr-2">{activeEngine.name}</span>
            <ChevronDown size={16} className={`text-[var(--color-dust)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>

          {isOpen && (
            <div className="mt-1 bg-[var(--color-paper)] border border-[var(--color-dust)] rounded-md shadow-sm overflow-hidden flex flex-col max-h-[350px]">
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
                    {displayedEngines.length > 0 ? displayedEngines.map((engine) => (
                      <button
                        key={engine.id}
                        onClick={() => {
                          updateState({ activeEngineId: engine.id });
                          setIsOpen(false);
                          setSearchQuery('');
                        }}
                        className={`w-full flex items-center justify-between p-2 text-left rounded-sm cursor-pointer ${
                          state.activeEngineId === engine.id ? 'bg-[var(--color-vellum)] text-[var(--color-editorial)] font-semibold' : 'hover:bg-[var(--color-vellum)]'
                        }`}
                      >
                        <div className="flex flex-col overflow-hidden">
                          <span className="truncate pr-2 text-sm">{engine.name}</span>
                          {engine.hardware && (
                            <span className="text-[10px] font-bold text-[var(--color-dust)] uppercase tracking-wider">
                              [{engine.hardware}] {engine.type === 'local' ? 'Local' : ''}
                            </span>
                          )}
                        </div>
                        <div className="flex-shrink-0 ml-2">
                          {state.activeEngineId === engine.id ? (
                            <Check size={14} className="text-[var(--color-editorial)]" />
                          ) : engine.type === 'local' && !engine.isDownloaded ? (
                            <Download size={14} className="text-[var(--color-dust)] hover:text-[var(--color-ink)]" />
                          ) : null}
                        </div>
                      </button>
                    )) : (
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
                    <button className="w-full flex items-center gap-2 p-2 text-sm text-left hover:bg-[var(--color-paper)] rounded-sm cursor-pointer transition-colors">
                      <Upload size={14} className="text-[var(--color-dust)]" />
                      <span>Import Local .onnx Model</span>
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

        {/* Image Cleaning Engine */}
        <div className="relative mt-2">
          <div className="flex items-center gap-1.5 mb-2 relative">
            <h2 className="text-sm font-medium">Image Cleaning Engine</h2>
            <div className="peer w-4 h-4 rounded-full border border-[var(--color-dust)] flex items-center justify-center text-[10px] text-[var(--color-dust)] cursor-help hover:bg-[var(--color-dust)] hover:text-[var(--color-paper)] transition-colors">?</div>
            
            <div className="absolute left-0 top-full pt-1.5 w-[280px] max-w-[85vw] z-50 opacity-0 pointer-events-none peer-hover:opacity-100 peer-hover:pointer-events-auto hover:opacity-100 hover:pointer-events-auto transition-opacity">
              <div className="p-2.5 bg-[var(--color-ink)] text-[var(--color-paper)] text-xs rounded-md shadow-xl">
                Your device {state.webgpuSupported === true ? 'supports' : 'does not support'} WebGPU acceleration. If unsupported, the system gracefully falls back to your CPU. Accuracy remains exactly the same, but processing will be slower.
              </div>
            </div>
          </div>

        <div className="relative">
          <button 
            onClick={() => setIsOpenInpaint(!isOpenInpaint)}
            className="w-full flex items-center justify-between p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer"
          >
            <span className="font-medium truncate pr-2">
              {inpaintingEngines.find(e => e.id === state.activeInpaintId)?.name || 'Loading...'}
            </span>
            <ChevronDown size={16} className={`text-[var(--color-dust)] transition-transform ${isOpenInpaint ? 'rotate-180' : ''}`} />
          </button>

          {isOpenInpaint && (
            <div className="mt-1 bg-[var(--color-paper)] border border-[var(--color-dust)] rounded-md shadow-sm overflow-hidden flex flex-col max-h-[350px]">
              <div className="overflow-y-auto flex-1 p-1 custom-scrollbar">
                {inpaintingEngines.map((engine) => (
                  <button
                    key={engine.id}
                    onClick={() => {
                      updateState({ activeInpaintId: engine.id });
                      setIsOpenInpaint(false);
                    }}
                    className={`w-full flex items-center justify-between p-2 text-left rounded-sm cursor-pointer ${
                      state.activeInpaintId === engine.id ? 'bg-[var(--color-vellum)] text-[var(--color-editorial)] font-semibold' : 'hover:bg-[var(--color-vellum)]'
                    }`}
                  >
                    <div className="flex flex-col overflow-hidden">
                      <span className="truncate pr-2 text-sm">{engine.name}</span>
                    </div>
                    <div className="flex-shrink-0 ml-2">
                      {state.activeInpaintId === engine.id ? (
                        <Check size={14} className="text-[var(--color-editorial)]" />
                      ) : !engine.isDownloaded ? (
                        <Download size={14} className="text-[var(--color-dust)] hover:text-[var(--color-ink)]" />
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      </div>

      <div className="relative mt-2">
        <div className="flex items-center gap-1.5 mb-2 relative">
          <span className="font-medium text-sm">GPU Acceleration</span>
          <div className="peer w-4 h-4 rounded-full border border-[var(--color-dust)] flex items-center justify-center text-[10px] text-[var(--color-dust)] cursor-help hover:bg-[var(--color-dust)] hover:text-[var(--color-paper)] transition-colors">?</div>
          
          <div className="absolute left-0 top-full pt-1.5 w-[260px] max-w-[85vw] z-50 opacity-0 pointer-events-none peer-hover:opacity-100 peer-hover:pointer-events-auto hover:opacity-100 hover:pointer-events-auto transition-opacity">
            <div className="p-2.5 bg-[var(--color-ink)] text-[var(--color-paper)] text-xs rounded-md shadow-xl">
              Run models locally on your graphics card for maximum speed. Turn off specific pipelines below if you run out of memory.
            </div>
          </div>
        </div>

        <div className="relative">
          {/* Master Switch */}
          <button 
            onClick={() => {
              if (state.webgpuSupported === true && state.webgpuMaster) {
                setShowWebGpuConfig(!showWebGpuConfig);
              }
            }}
            className={`w-full flex items-center justify-between p-3 bg-[var(--color-paper)] border-2 transition-colors ${state.webgpuSupported === true && state.webgpuMaster ? 'border-[var(--color-dust)] cursor-pointer hover:border-[var(--color-editorial)]' : 'border-[var(--color-dust)] border-opacity-50'} rounded-lg shadow-sm`}
          >
            <div className="flex items-center gap-2">
              <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium flex items-center justify-center ${
                state.webgpuSupported === true ? 'bg-green-500/10 text-green-500 border border-green-500/30' : 
                state.webgpuSupported === false ? 'bg-red-500/10 text-red-500 border border-red-500/30' : 
                'bg-gray-500/10 text-gray-400 border border-gray-500/30'
              }`}>
                {state.webgpuSupported === true ? '✓' : 
                 state.webgpuSupported === false ? '✗' : 
                 '...'}
              </span>
              
              {state.webgpuSupported !== null && (
                <button 
                  onClick={async (e) => {
                    e.stopPropagation();
                    const { checkWebGPUAvailability } = await import('../../offscreen/utils/hardware');
                    updateState({ webgpuSupported: null });
                    const supported = await checkWebGPUAvailability();
                    updateState({ webgpuSupported: supported });
                  }}
                  className="px-2 py-0.5 border border-[var(--color-dust)] hover:border-[var(--color-ink)] text-[10px] text-[var(--color-dust)] hover:text-[var(--color-ink)] font-medium rounded transition-colors cursor-pointer"
                >
                  Re-check
                </button>
              )}
            </div>

            <div className="flex items-center gap-4">
              {state.webgpuSupported === true && state.webgpuMaster && (
                <ChevronDown size={18} className={`text-[var(--color-ink)] transition-transform duration-200 ${showWebGpuConfig ? 'rotate-180' : ''}`} />
              )}
              
              <div onClick={(e) => e.stopPropagation()}>
                <button 
                  onClick={() => {
                    if (state.webgpuSupported === true) {
                      updateState({ webgpuMaster: !state.webgpuMaster });
                      if (!state.webgpuMaster) setShowWebGpuConfig(true);
                      else setShowWebGpuConfig(false);
                    }
                  }}
                  disabled={state.webgpuSupported !== true}
                  className="kites-switch kites-switch-md"
                  data-state={state.webgpuMaster && state.webgpuSupported === true ? 'checked' : 'unchecked'}
                  data-disabled={state.webgpuSupported !== true ? 'true' : 'false'}
                >
                  <span className="sr-only">Toggle WebGPU Master</span>
                  <span className="kites-switch-thumb" />
                </button>
              </div>
            </div>
          </button>

          {/* Granular Toggles (Child Switches) */}
          {showWebGpuConfig && state.webgpuSupported === true && state.webgpuMaster && (
            <div className="mt-2 bg-[var(--color-vellum)] border border-[var(--color-dust)] border-opacity-40 rounded-lg overflow-hidden flex flex-col p-1.5 gap-1 shadow-inner">
              
              <div className="flex items-center justify-between p-2.5 rounded-md hover:bg-[var(--color-paper)] transition-colors">
                <div className="flex flex-col text-left">
                  <span className="font-medium text-sm text-[var(--color-ink)]">Translation</span>
                  <span className="text-[10px] text-[var(--color-dust)] font-medium">High VRAM (3-4GB)</span>
                </div>
                <button 
                  onClick={() => updateState({ webgpuOverrides: { ...state.webgpuOverrides, llm: !state.webgpuOverrides.llm }})}
                  className="kites-switch kites-switch-sm"
                  data-state={state.webgpuOverrides?.llm !== false ? 'checked' : 'unchecked'}
                >
                  <span className="kites-switch-thumb" />
                </button>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-md hover:bg-[var(--color-paper)] transition-colors">
                <div className="flex flex-col text-left">
                  <span className="font-medium text-sm text-[var(--color-ink)]">Image Cleaning</span>
                  <span className="text-[10px] text-[var(--color-dust)] font-medium">Low VRAM (~200MB)</span>
                </div>
                <button 
                  onClick={() => updateState({ webgpuOverrides: { ...state.webgpuOverrides, inpaint: !state.webgpuOverrides.inpaint }})}
                  className="kites-switch kites-switch-sm"
                  data-state={state.webgpuOverrides?.inpaint !== false ? 'checked' : 'unchecked'}
                >
                  <span className="kites-switch-thumb" />
                </button>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-md hover:bg-[var(--color-paper)] transition-colors">
                <div className="flex flex-col text-left">
                  <span className="font-medium text-sm text-[var(--color-ink)]">Text Detection</span>
                  <span className="text-[10px] text-[var(--color-dust)] font-medium">Tiny VRAM (~100MB)</span>
                </div>
                <button 
                  onClick={() => updateState({ webgpuOverrides: { ...state.webgpuOverrides, ocr: !state.webgpuOverrides.ocr }})}
                  className="kites-switch kites-switch-sm"
                  data-state={state.webgpuOverrides?.ocr !== false ? 'checked' : 'unchecked'}
                >
                  <span className="kites-switch-thumb" />
                </button>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
