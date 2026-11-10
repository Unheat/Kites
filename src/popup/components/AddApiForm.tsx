import { useMemo, useState } from 'react';
import type { CustomApiConfig } from '../../shared/types';
import {
  STRUCTURED_OUTPUT_MODES,
  detectStructuredOutputMode,
  supportsStructuredOutputSelection,
  validateCompatibleBaseUrl,
  type StructuredOutputModeId,
} from '../../shared/customApi';

/**
 * Matches upstream rejections caused by the structured-output request fields themselves, so the
 * inline error can name the exact control the user has to change.
 */
const STRUCTURED_OUTPUT_REJECTION_PATTERN = /response_format|json_schema|json_object|structured output/i;

/** Appended to a rejection error so the fix is actionable without reading provider docs. */
const STRUCTURED_OUTPUT_REJECTION_HINT =
  ' This endpoint rejected structured output; switch Output Constraints to JSON Object or Prompt Only and retry.';

interface AddApiFormProps {
  onSave: (api: CustomApiConfig) => void;
  onCancel: () => void;
}

export default function AddApiForm({ onSave, onCancel }: AddApiFormProps) {
  const [provider, setProvider] = useState<CustomApiConfig['provider']>('openai');
  const [newModelName, setNewModelName] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  // null means "follow detection"; any id means the user pinned that tier for this form session.
  const [outputModeOverride, setOutputModeOverride] = useState<StructuredOutputModeId | null>(null);

  const showOutputModeControl = supportsStructuredOutputSelection(provider);
  const detectedOutputMode = useMemo(
    () => detectStructuredOutputMode(provider, newBaseUrl),
    [provider, newBaseUrl]
  );
  const effectiveOutputMode = outputModeOverride ?? detectedOutputMode;
  const effectiveOutputModeEntry = STRUCTURED_OUTPUT_MODES.find((mode) => mode.id === effectiveOutputMode)
    ?? STRUCTURED_OUTPUT_MODES[0];

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

    const trimmedCustomPrompt = customPrompt.trim().slice(0, 4000);
    const newApi: CustomApiConfig = {
      id: `api_${crypto.randomUUID()}`,
      provider,
      modelName: newModelName.trim(),
      apiKey: newApiKey.trim(),
      ...(compatibleBaseUrl?.normalized ? { baseUrl: compatibleBaseUrl.normalized } : {}),
      ...(trimmedCustomPrompt ? { customPrompt: trimmedCustomPrompt } : {}),
      ...(showOutputModeControl ? { outputMode: effectiveOutputMode } : {}),
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
        const message = response.error || 'Failed to connect to API with provided credentials.';
        setValidationError(
          STRUCTURED_OUTPUT_REJECTION_PATTERN.test(message)
            ? `${message}${STRUCTURED_OUTPUT_REJECTION_HINT}`
            : message
        );
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
        <label className="text-xs font-semibold text-[var(--color-muted)] uppercase mb-1 block">Provider</label>
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
        <label className="text-xs font-semibold text-[var(--color-muted)] uppercase mb-1 block">Model Name</label>
        <input 
          autoFocus
          type="text" 
          placeholder="e.g. gpt-4o or claude-3-5-sonnet" 
          value={newModelName}
          onChange={(e) => setNewModelName(e.target.value)}
          disabled={isValidating}
          className="w-full p-2 text-sm bg-[var(--color-paper)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-ink)] transition-colors placeholder:text-[var(--color-muted)]"
        />
      </div>

      {provider === 'openai-compatible' && (
        <div>
          <label className="text-xs font-semibold text-[var(--color-muted)] uppercase mb-1 block">Base URL</label>
          <input 
            type="text" 
            placeholder="https://openrouter.ai/api/v1" 
            value={newBaseUrl}
            onChange={(e) => setNewBaseUrl(e.target.value)}
            disabled={isValidating}
            className="w-full p-2 text-sm bg-[var(--color-paper)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-ink)] transition-colors placeholder:text-[var(--color-muted)]"
          />
        </div>
      )}

      {showOutputModeControl && (
        <div>
          <div className="flex items-baseline justify-between mb-1 gap-2">
            <label className="text-xs font-semibold text-[var(--color-muted)] uppercase">Output Constraints</label>
            {outputModeOverride === null ? (
              <span className="text-[11px] text-[var(--color-muted)] truncate">
                Auto-detected: {effectiveOutputModeEntry.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setOutputModeOverride(null)}
                disabled={isValidating}
                className="text-[11px] text-[var(--color-editorial)] hover:underline shrink-0 cursor-pointer disabled:opacity-50"
              >
                Manual · reset to auto
              </button>
            )}
          </div>
          <div role="group" aria-label="Output constraints" className="grid grid-cols-3 gap-1">
            {STRUCTURED_OUTPUT_MODES.map((mode) => {
              const selected = mode.id === effectiveOutputMode;
              return (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={isValidating}
                  onClick={() => {
                    setOutputModeOverride(mode.id);
                    setValidationError('');
                  }}
                  className={`py-1.5 text-xs font-semibold rounded border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    selected
                      ? 'bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]'
                      : 'bg-[var(--color-paper)] text-[var(--color-ink)] border-[var(--color-dust)] hover:bg-[var(--color-dust)]'
                  }`}
                >
                  {mode.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-muted)] leading-tight">
            {effectiveOutputModeEntry.description}
          </p>
        </div>
      )}

      <div>
        <label className="text-xs font-semibold text-[var(--color-muted)] uppercase mb-1 block">API Key</label>
        <input 
          type="password" 
          placeholder="sk-..." 
          value={newApiKey}
          onChange={(e) => setNewApiKey(e.target.value)}
          disabled={isValidating}
          className="w-full p-2 text-sm bg-[var(--color-paper)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-ink)] transition-colors placeholder:text-[var(--color-muted)]"
        />
      </div>

      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-[var(--color-editorial)] font-medium hover:underline flex items-center gap-1 cursor-pointer"
        >
          <span>{showAdvanced ? '▾' : '▸'} Custom Prompt Override (Optional)</span>
        </button>

        {showAdvanced && (
          <div className="mt-2 flex flex-col gap-1">
            <textarea
              placeholder="Detailed system prompt for this API (overrides global prompt)..."
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value.slice(0, 4000))}
              disabled={isValidating}
              rows={3}
              className="w-full p-2 text-xs bg-[var(--color-paper)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-ink)] transition-colors placeholder:text-[var(--color-muted)] resize-none"
            />
            <div className="flex justify-between items-center text-[11px] text-[var(--color-muted)]">
              <span>Overrides global Custom Prompt for this API.</span>
              <span className="font-mono">{customPrompt.length}/4000</span>
            </div>
          </div>
        )}
      </div>
      
      {validationError && <p className="text-xs text-red-600 leading-tight" role="alert">{validationError}</p>}

      <div className="flex gap-2 mt-2">
        <button 
          onClick={handleSave}
          disabled={isValidating}
          className="flex-1 py-2 bg-[var(--color-ink)] text-[var(--color-paper)] text-sm font-bold rounded hover:bg-[var(--color-accent-fill)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
