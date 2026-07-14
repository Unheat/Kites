import { useState } from 'react';
import { Download, Check, Upload, KeyRound, ChevronDown } from 'lucide-react';

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

export default function EngineDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeEngineId, setActiveEngineId] = useState('marian-mt');
  const [showApiConfig, setShowApiConfig] = useState(false);

  const activeEngine = AVAILABLE_ENGINES.find(e => e.id === activeEngineId) || AVAILABLE_ENGINES[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-[var(--color-dust)]">Translation Engine</h2>
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
          <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--color-paper)] border border-[var(--color-dust)] rounded-md shadow-lg z-10 overflow-hidden flex flex-col max-h-[250px]">
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
            
            {/* Action Buttons at bottom of dropdown */}
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

      {/* Sub-view for API Config */}
      {showApiConfig && (
        <div className="mt-2 p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold">Configure API</h3>
            <button onClick={() => setShowApiConfig(false)} className="text-xs text-[var(--color-dust)] hover:text-[var(--color-ink)] cursor-pointer">Cancel</button>
          </div>
          <select className="w-full mb-3 p-2 text-sm bg-[var(--color-paper)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-ink)]">
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openrouter">OpenRouter</option>
            <option value="custom">OpenAI-Compatible Endpoint</option>
          </select>
          <input 
            type="password" 
            placeholder="sk-..." 
            className="w-full mb-3 p-2 text-sm bg-[var(--color-paper)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-ink)]"
          />
          <button className="w-full py-2 bg-[var(--color-ink)] text-[var(--color-paper)] text-sm font-bold rounded hover:bg-[var(--color-editorial)] transition-colors cursor-pointer">
            Save & Connect
          </button>
        </div>
      )}
    </div>
  );
}
