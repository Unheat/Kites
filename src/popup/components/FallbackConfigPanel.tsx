import { useState, useEffect } from 'react';
import { X, ChevronDown, Plus } from 'lucide-react';
import type { PopupState } from '../../shared/types';
import type { Engine } from './EngineDropdown';
import { ModelRegistry } from '../services/ModelRegistry';
import { isLlmGpuAvailable } from '../../shared/utils/hardwareUtils';

interface FallbackConfigPanelProps {
  state: PopupState;
  updateState: (updates: Partial<PopupState>) => void;
  onClose: () => void;
}

export default function FallbackConfigPanel({ state, updateState, onClose }: FallbackConfigPanelProps) {
  const [baseEngines, setBaseEngines] = useState<Engine[]>([]);
  
  useEffect(() => {
    ModelRegistry.getAvailableEngines().then(setBaseEngines);
  }, []);
  
  const allEngines: Engine[] = [
    ...baseEngines,
    ...(state.customApis || []).map(api => ({
      id: api.id,
      name: `${api.provider}/${api.modelName}`,
      type: 'custom' as const,
      isDownloaded: true
    }))
  ];
  const availableEngines = allEngines.filter((engine) =>
    (engine.type !== 'local' || engine.isDownloaded) &&
    (engine.hardware !== 'WebGPU' || isLlmGpuAvailable(state)) &&
    (engine.id !== 'cloudflare-translate' || state.userAccount?.signedIn)
  );

  /**
   * Lists engines available to one fallback row while excluding the primary and other fallback stages.
   *
   * @param index - Index of current fallback row.
   * @returns Selectable engines for the row.
   */
  const getRowEngines = (index: number): Engine[] => {
    const currentId = state.fallbackChain[index];
    const usedIds = new Set([state.activeEngineId, ...state.fallbackChain.filter((_, chainIndex) => chainIndex !== index)]);
    return availableEngines.filter((engine) => engine.id === currentId || !usedIds.has(engine.id));
  };

  const handleUpdateChain = (index: number, newId: string) => {
    const newChain = [...state.fallbackChain];
    newChain[index] = newId;
    updateState({ fallbackChain: newChain });
  };

  const handleRemoveFallback = (index: number) => {
    const newChain = [...state.fallbackChain];
    newChain.splice(index, 1);
    updateState({ fallbackChain: newChain });
  };

  const handleAddFallback = () => {
    const usedIds = new Set([state.activeEngineId, ...state.fallbackChain]);
    const nextEngine = availableEngines.find((engine) => engine.id === 'gg-translate' && !usedIds.has(engine.id))
      || availableEngines.find((engine) => !usedIds.has(engine.id));
    if (nextEngine) updateState({ fallbackChain: [...state.fallbackChain, nextEngine.id] });
  };

  return (
    <div className="p-3 bg-[var(--color-paper)] border border-[var(--color-dust)] rounded-md shadow-sm">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-bold text-[var(--color-editorial)]">Waterfall Fallback Chain</h3>
        <button 
          onClick={onClose}
          className="p-1 text-[var(--color-dust)] hover:text-[var(--color-ink)] transition-colors cursor-pointer"
          title="Close Panel"
        >
          <X size={16} />
        </button>
      </div>

      <p className="text-xs text-[var(--color-dust)] mb-4">
        If the primary engine fails (e.g. rate limit, WebGPU crash), Kites will automatically try the engines below in order.
      </p>

      <div className="flex flex-col relative">
        {/* Visual Root Node: The Primary Engine from Home */}
        <div className="relative flex flex-col items-center">
          <div className="w-full flex items-center gap-2 p-3 bg-[var(--color-vellum)] border border-dashed border-[var(--color-dust)] rounded-md opacity-60">
            <span className="text-xs font-bold text-[var(--color-editorial)] flex-1 truncate">
              Primary: {allEngines.find(e => e.id === state.activeEngineId)?.name || 'Unknown'}
            </span>
            <span className="text-[10px] text-[var(--color-dust)] uppercase tracking-wider">Set in Home</span>
          </div>
        </div>

        {state.fallbackChain.map((engineId, index) => {
          const rowEngines = getRowEngines(index);
          return (
            <div key={`${index}-${engineId}`} className="relative flex flex-col items-center">
              
              {/* Arrow pointing down from the item above */}
              <div className="w-px h-4 bg-[var(--color-dust)] relative">
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-[var(--color-dust)]" />
              </div>

              <div className="w-full flex items-center gap-2">
                <div className="relative flex-1">
                  <select
                    value={engineId}
                    onChange={(e) => handleUpdateChain(index, e.target.value)}
                    className="w-full appearance-none p-3 pr-8 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer text-sm font-medium text-[var(--color-ink)]"
                  >
                    <optgroup label="Available Engines">
                      {rowEngines.filter(e => e.type !== 'custom').map(e => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </optgroup>
                    {rowEngines.some(e => e.type === 'custom') && (
                      <optgroup label="Custom APIs">
                        {rowEngines.filter(e => e.type === 'custom').map(e => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-dust)] pointer-events-none" />
                </div>
                
                <button 
                  onClick={() => handleRemoveFallback(index)}
                  className="p-3 text-[var(--color-dust)] hover:text-red-500 hover:bg-[var(--color-vellum)] rounded-md border border-transparent transition-colors cursor-pointer"
                  title="Remove Fallback"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          );
        })}

        {/* Add Fallback Button */}
        <button
          onClick={handleAddFallback}
          className="mt-2 w-full py-2 border border-dashed border-[var(--color-dust)] text-[var(--color-dust)] text-xs font-bold rounded-md hover:border-[var(--color-ink)] hover:text-[var(--color-ink)] transition-colors cursor-pointer flex justify-center items-center gap-1"
        >
          <Plus size={14} /> Add Fallback Engine
        </button>

      </div>
    </div>
  );
}
