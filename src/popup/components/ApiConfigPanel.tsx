import type { PopupState } from '../index';

interface ApiConfigPanelProps {
  state: PopupState;
  updateState: (updates: Partial<PopupState>) => void;
  onClose: () => void;
}

export default function ApiConfigPanel({ state, updateState, onClose }: ApiConfigPanelProps) {
  return (
    <div className="mt-2 p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-semibold">Configure API</h3>
        <button onClick={onClose} className="text-xs text-[var(--color-dust)] hover:text-[var(--color-ink)] cursor-pointer">Cancel</button>
      </div>
      <select 
        value={state.apiConfig?.provider || 'custom'}
        onChange={(e) => updateState({ apiConfig: { ...state.apiConfig, provider: e.target.value } })}
        className="w-full mb-3 p-2 text-sm bg-[var(--color-paper)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-ink)] transition-colors text-[var(--color-ink)]"
      >
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic (Claude)</option>
        <option value="openrouter">OpenRouter</option>
        <option value="custom">OpenAI-Compatible Endpoint</option>
      </select>
      <input 
        type="text" 
        placeholder="Model Name (e.g. gpt-4o)" 
        value={state.apiConfig?.model || ''}
        onChange={(e) => updateState({ apiConfig: { ...state.apiConfig, model: e.target.value } })}
        className="w-full mb-3 p-2 text-sm bg-[var(--color-paper)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-ink)] transition-colors placeholder:text-[var(--color-dust)]"
      />
      <input 
        type="password" 
        placeholder="API Key (sk-...)" 
        value={state.apiConfig?.apiKey || ''}
        onChange={(e) => updateState({ apiConfig: { ...state.apiConfig, apiKey: e.target.value } })}
        className="w-full mb-3 p-2 text-sm bg-[var(--color-paper)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-ink)] transition-colors placeholder:text-[var(--color-dust)]"
      />
      <button 
        onClick={onClose}
        className="w-full py-2 bg-[var(--color-ink)] text-[var(--color-paper)] text-sm font-bold rounded hover:bg-[var(--color-editorial)] transition-colors cursor-pointer"
      >
        Save & Connect
      </button>
    </div>
  );
}
