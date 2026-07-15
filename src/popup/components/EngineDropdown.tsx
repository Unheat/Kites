import { useState, useEffect, useMemo } from 'react';
import { Download, Check, Upload, ChevronDown, Plus, Search } from 'lucide-react';
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
  const [showAddApi, setShowAddApi] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [baseEngines, setBaseEngines] = useState<Engine[]>([]);
  
  useEffect(() => {
    ModelRegistry.getAvailableEngines().then(setBaseEngines);
  }, []);

  const allEngines = useMemo(() => {
    const custom: Engine[] = (state.customApis || []).map(api => ({
      id: api.id,
      name: `${api.provider}/${api.modelName}`,
      type: 'custom' as const,
      isDownloaded: true
    }));
    return [...baseEngines, ...custom];
  }, [baseEngines, state.customApis]);

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
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none cursor-pointer ${
              state.isAuto ? 'bg-[var(--color-editorial)]' : 'bg-[var(--color-dust)]'
            }`}
          >
            <span className="sr-only">Toggle auto-translate</span>
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-[var(--color-paper)] transition-transform ${
                state.isAuto ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
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
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium">Translation Engine</h2>
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
                  <div className="overflow-y-auto flex-1 p-1">
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
    </div>
  );
}
