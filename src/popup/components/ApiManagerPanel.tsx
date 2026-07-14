import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { PopupState, CustomApiConfig } from '../index';

interface ApiManagerPanelProps {
  state: PopupState;
  updateState: (updates: Partial<PopupState>) => void;
  onClose: () => void;
}

export default function ApiManagerPanel({ state, updateState, onClose }: ApiManagerPanelProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [provider, setProvider] = useState<CustomApiConfig['provider']>('openai');
  const [newModelName, setNewModelName] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');

  const handleAddApi = () => {
    if (!newModelName.trim() || !newApiKey.trim()) return;
    
    const newApi: CustomApiConfig = {
      id: `api_${Date.now()}`,
      provider,
      modelName: newModelName.trim(),
      apiKey: newApiKey.trim(),
      ...(provider === 'openai-compatible' && newBaseUrl.trim() ? { baseUrl: newBaseUrl.trim() } : {})
    };

    updateState({
      customApis: [...state.customApis, newApi]
    });

    setNewModelName('');
    setNewApiKey('');
    setNewBaseUrl('');
    setIsAdding(false);
  };

  const handleDeleteApi = (id: string) => {
    updateState({
      customApis: state.customApis.filter(api => api.id !== id),
      fallbackChain: state.fallbackChain.filter(chainId => chainId !== id)
    });
  };

  return (
    <div className="p-3 bg-[var(--color-paper)] border border-[var(--color-dust)] rounded-md shadow-sm">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-bold text-[var(--color-editorial)]">Manage Custom APIs</h3>
        <div className="flex gap-2">
          {!isAdding && (
            <button 
              onClick={() => setIsAdding(true)}
              className="p-1 text-[var(--color-dust)] hover:text-[var(--color-ink)] transition-colors cursor-pointer"
              title="Add New API"
            >
              <Plus size={16} />
            </button>
          )}
          <button 
            onClick={onClose}
            className="p-1 text-[var(--color-dust)] hover:text-[var(--color-ink)] transition-colors cursor-pointer"
            title="Close Panel"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {state.customApis.map((api) => (
          <div key={api.id} className="flex items-center justify-between p-2 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded text-sm">
            <div className="flex flex-col">
              <span className="font-semibold text-xs uppercase text-[var(--color-dust)]">{api.provider}</span>
              <span className="font-mono text-[var(--color-ink)] truncate max-w-[200px]" title={api.modelName}>
                {api.modelName}
              </span>
            </div>
            <button 
              onClick={() => handleDeleteApi(api.id)}
              className="text-[var(--color-dust)] hover:text-red-500 transition-colors cursor-pointer p-1"
              title="Delete API"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        
        {state.customApis.length === 0 && !isAdding && (
          <div className="text-xs text-[var(--color-dust)] italic p-3 text-center border border-dashed border-[var(--color-dust)] rounded">
            No custom APIs configured.
          </div>
        )}

        {isAdding && (
          <div className="p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded flex flex-col gap-3 mt-2">
            <div>
              <label className="text-xs font-semibold text-[var(--color-dust)] uppercase mb-1 block">Provider</label>
              <select 
                value={provider}
                onChange={(e) => setProvider(e.target.value as CustomApiConfig['provider'])}
                className="w-full p-2 text-sm bg-[var(--color-paper)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-ink)] transition-colors cursor-pointer"
              >
                <option value="openai">OpenAI</option>
                <option value="openai-compatible">OpenAI Compatible (e.g. OpenRouter)</option>
                <option value="gemini">Google Gemini</option>
                <option value="claude">Anthropic Claude</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-[var(--color-dust)] uppercase mb-1 block">Model Name</label>
              <input 
                type="text" 
                placeholder="e.g. gpt-4o or claude-3-5-sonnet-20240620" 
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                className="w-full p-2 text-sm bg-[var(--color-paper)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-ink)] transition-colors placeholder:text-[var(--color-dust)]"
              />
            </div>

            {provider === 'openai-compatible' && (
              <div>
                <label className="text-xs font-semibold text-[var(--color-dust)] uppercase mb-1 block">Base URL</label>
                <input 
                  type="text" 
                  placeholder="https://openrouter.ai/api/v1" 
                  value={newBaseUrl}
                  onChange={(e) => setNewBaseUrl(e.target.value)}
                  className="w-full p-2 text-sm bg-[var(--color-paper)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-ink)] transition-colors placeholder:text-[var(--color-dust)]"
                />
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-[var(--color-dust)] uppercase mb-1 block">API Key</label>
              <input 
                type="password" 
                placeholder="sk-..." 
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                className="w-full p-2 text-sm bg-[var(--color-paper)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-ink)] transition-colors placeholder:text-[var(--color-dust)]"
              />
            </div>
            
            <div className="flex gap-2 mt-2">
              <button 
                onClick={handleAddApi}
                className="flex-1 py-2 bg-[var(--color-ink)] text-[var(--color-paper)] text-sm font-bold rounded hover:bg-[var(--color-editorial)] transition-colors cursor-pointer"
              >
                Save API
              </button>
              <button 
                onClick={() => setIsAdding(false)}
                className="flex-1 py-2 bg-transparent border border-[var(--color-dust)] text-[var(--color-ink)] text-sm font-bold rounded hover:bg-[var(--color-dust)] transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
