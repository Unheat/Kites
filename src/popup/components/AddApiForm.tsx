import { useState } from 'react';
import type { CustomApiConfig } from '../../shared/types';
import { validateCompatibleBaseUrl } from '../../shared/customApi';

interface AddApiFormProps {
  onSave: (api: CustomApiConfig) => void;
  onCancel: () => void;
}

export default function AddApiForm({ onSave, onCancel }: AddApiFormProps) {
  const [provider, setProvider] = useState<CustomApiConfig['provider']>('openai');
  const [newModelName, setNewModelName] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');
  const [validationError, setValidationError] = useState('');
  const [isValidating, setIsValidating] = useState(false);

  /**
   * Validates the provider fields, tests the connection via offscreen, and saves on success.
   *
   * @returns Nothing; displays an inline error when verification fails.
   */
  const handleSave = async () => {
    if (!newModelName.trim() || !newApiKey.trim()) {
      setValidationError('Model name and API key are required.');
      return;
    }

    const compatibleBaseUrl = provider === 'openai-compatible'
      ? validateCompatibleBaseUrl(newBaseUrl)
      : undefined;
    if (compatibleBaseUrl?.error) {
      setValidationError(compatibleBaseUrl.error);
      return;
    }

    const newApi: CustomApiConfig = {
      id: `api_${crypto.randomUUID()}`,
      provider,
      modelName: newModelName.trim(),
      apiKey: newApiKey.trim(),
      ...(compatibleBaseUrl?.normalized ? { baseUrl: compatibleBaseUrl.normalized } : {}),
    };

    setIsValidating(true);
    setValidationError('');

    try {
      const response = await new Promise<{ status: string; error?: string }>((resolve) => {
        chrome.runtime.sendMessage({
          type: 'VALIDATE_CUSTOM_API',
          target: 'background',
          source: 'popup',
          request: true,
          payload: { config: newApi }
        }, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ status: 'error', error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { status: 'error', error: 'No response from background validator.' });
          }
        });
      });

      if (response.status === 'success') {
        onSave(newApi);
      } else {
        setValidationError(response.error || 'Failed to connect to API with provided credentials.');
      }
    } catch (err: any) {
      setValidationError(err?.message || 'Error validating custom API.');
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded flex flex-col gap-3 mt-2 text-left">
      <div>
        <label className="text-xs font-semibold text-[var(--color-dust)] uppercase mb-1 block">Provider</label>
        <select 
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value as CustomApiConfig['provider']);
            setValidationError('');
          }}
          disabled={isValidating}
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
          disabled={isValidating}
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
            disabled={isValidating}
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
          disabled={isValidating}
          className="w-full p-2 text-sm bg-[var(--color-paper)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-ink)] transition-colors placeholder:text-[var(--color-dust)]"
        />
      </div>
      
      {validationError && <p className="text-xs text-red-600 leading-tight" role="alert">{validationError}</p>}

      <div className="flex gap-2 mt-2">
        <button 
          onClick={handleSave}
          disabled={isValidating}
          className="flex-1 py-2 bg-[var(--color-ink)] text-[var(--color-paper)] text-sm font-bold rounded hover:bg-[var(--color-editorial)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isValidating ? 'Testing API...' : 'Save API'}
        </button>
        <button 
          onClick={onCancel}
          disabled={isValidating}
          className="flex-1 py-2 bg-transparent border border-[var(--color-dust)] text-[var(--color-ink)] text-sm font-bold rounded hover:bg-[var(--color-dust)] transition-colors cursor-pointer disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
