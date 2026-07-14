import { useState } from 'react';
import { Download, Check, Upload, KeyRound, ChevronDown } from 'lucide-react';
import type { PopupState } from '../index';
import ApiConfigPanel from './ApiConfigPanel';

interface EngineDropdownProps {
  state: PopupState;
  updateState: (updates: Partial<PopupState>) => void;
}

interface Engine {
  id: string;
  name: string;
  type: 'local' | 'api' | 'custom';
  isDownloaded?: boolean;
}

const AVAILABLE_ENGINES: Engine[] = [
  { id: 'nllb-200', name: 'NLLB-200 Distilled (~600MB)', type: 'local', isDownloaded: false },
  { id: 'marian-mt', name: 'Marian-MT (Dynamic Pairs)', type: 'local', isDownloaded: true },
  { id: 'llama-1b', name: 'Llama-3.2-1B (WebLLM)', type: 'local', isDownloaded: false },
  { id: 'qwen-1.5b', name: 'Qwen2.5-1.5B (WebLLM)', type: 'local', isDownloaded: false },
];

export default function EngineDropdown({ state, updateState }: EngineDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeEngineId, setActiveEngineId] = useState('nllb-200');
  const [showApiConfig, setShowApiConfig] = useState(false);

  const activeEngine = AVAILABLE_ENGINES.find(e => e.id === activeEngineId) || AVAILABLE_ENGINES[0];

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
            <div className="mt-1 bg-[var(--color-paper)] border border-[var(--color-dust)] rounded-md shadow-sm overflow-hidden flex flex-col max-h-[250px]">
              <div className="overflow-y-auto flex-1 p-1">
                {AVAILABLE_ENGINES.map((engine) => (
                  <button
                    key={engine.id}
                    onClick={() => {
                      setActiveEngineId(engine.id);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center justify-between p-2 text-left rounded-sm cursor-pointer ${
                      activeEngineId === engine.id ? 'bg-[var(--color-vellum)] text-[var(--color-editorial)] font-semibold' : 'hover:bg-[var(--color-vellum)]'
                    }`}
                  >
                    <span className="truncate pr-2 text-sm">{engine.name}</span>
                    <div className="flex-shrink-0">
                      {activeEngineId === engine.id ? (
                        <Check size={14} className="text-[var(--color-editorial)]" />
                      ) : engine.type === 'local' && !engine.isDownloaded ? (
                        <Download size={14} className="text-[var(--color-dust)] hover:text-[var(--color-ink)]" />
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
              
              <div className="border-t border-[var(--color-dust)] p-1 bg-[var(--color-vellum)]">
                <button className="w-full flex items-center gap-2 p-2 text-sm text-left hover:bg-[var(--color-paper)] rounded-sm cursor-pointer transition-colors">
                  <Upload size={14} className="text-[var(--color-dust)]" />
                  <span>Import Local .onnx Model</span>
                </button>
                <button 
                  onClick={() => {
                    setIsOpen(false);
                    setShowApiConfig(true);
                  }}
                  className="w-full flex items-center gap-2 p-2 text-sm text-left hover:bg-[var(--color-paper)] rounded-sm cursor-pointer transition-colors"
                >
                  <KeyRound size={14} className="text-[var(--color-editorial)]" />
                  <span className="text-[var(--color-editorial)] font-medium">Add Custom API Key</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {showApiConfig && (
          <ApiConfigPanel state={state} updateState={updateState} onClose={() => setShowApiConfig(false)} />
        )}
      </div>
    </div>
  );
}
