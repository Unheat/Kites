import { useState } from 'react';
import type { CustomApiConfig } from '../../shared/types';

interface AddApiFormProps {
  onSave: (api: CustomApiConfig) => void;
  onCancel: () => void;
}

export default function AddApiForm({ onSave, onCancel }: AddApiFormProps) {
  const [provider, setProvider] = useState<CustomApiConfig['provider']>('openai');
  const [newModelName, setNewModelName] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');

  const handleSave = () => {
    if (!newModelName.trim() || !newApiKey.trim()) return;
    
    const newApi: CustomApiConfig = {
      id: `api_${Date.now()}`,
      provider,
      modelName: newModelName.trim(),
      apiKey: newApiKey.trim(),
      ...(provider === 'openai-compatible' && newBaseUrl.trim() ? { baseUrl: newBaseUrl.trim() } : {})
    };

    onSave(newApi);
  };

  return (
    <div className="p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded flex flex-col gap-3 mt-2 text-left">
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
          autoFocus
          type="text" 
          placeholder="e.g. gpt-4o or claude-3-5-sonnet" 
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
          onClick={handleSave}
          className="flex-1 py-2 bg-[var(--color-ink)] text-[var(--color-paper)] text-sm font-bold rounded hover:bg-[var(--color-editorial)] transition-colors cursor-pointer"
        >
          Save API
        </button>
        <button 
          onClick={onCancel}
          className="flex-1 py-2 bg-transparent border border-[var(--color-dust)] text-[var(--color-ink)] text-sm font-bold rounded hover:bg-[var(--color-dust)] transition-colors cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
