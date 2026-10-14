import { useState } from 'react';
import { X, Plus, BookOpen, Trash2 } from 'lucide-react';
import {
  normalizeGlossaryEntries,
  MAX_GLOSSARY_ENTRIES,
  MAX_GLOSSARY_TERM_LENGTH,
  type GlossaryEntry,
} from '../../shared/glossary';

/**
 * Minimal glossary state slice; the caller owns persistence and complete popup state.
 */
export interface GlossaryPanelProps {
  glossaryEnabled: boolean;
  glossaryEntries: GlossaryEntry[];
  updateState: (patch: {
    glossaryEnabled?: boolean;
    glossaryEntries?: GlossaryEntry[];
  }) => void;
  onClose: () => void;
}

/**
 * Collapsible panel for managing source-to-preferred-translation glossary mappings.
 * Stored in popupState; passed per-request to LLM engines via TranslationOptions.
 * Glossary mappings are treated as untrusted literal data in prompts, never instructions.
 *
 * @param props - Glossary state slice and mutation callback.
 * @returns The rendered glossary management panel.
 */
export default function GlossaryPanel({
  glossaryEnabled,
  glossaryEntries,
  updateState,
  onClose,
}: GlossaryPanelProps) {
  const [draftSource, setDraftSource] = useState('');
  const [draftTarget, setDraftTarget] = useState('');

  const entries = normalizeGlossaryEntries(glossaryEntries);
  const atCapacity = entries.length >= MAX_GLOSSARY_ENTRIES;

  /**
   * Normalizes, deduplicates, and persists a new mapping from the draft fields.
   * Silently ignores empty or duplicate source terms.
   * @returns Nothing; persists valid drafts through updateState.
   */
  const handleAdd = () => {
    const source = draftSource.trim().slice(0, MAX_GLOSSARY_TERM_LENGTH).trim();
    const target = draftTarget.trim().slice(0, MAX_GLOSSARY_TERM_LENGTH).trim();
    if (!source || !target) return;
    if (entries.some((e) => e.source === source)) return; // duplicate source
    if (atCapacity) return;
    updateState({ glossaryEntries: [...entries, { source, target }] });
    setDraftSource('');
    setDraftTarget('');
  };

  /**
   * Removes a mapping by index and persists the reduced set.
   *
   * @param index - Position of the entry to remove.
   * @returns Nothing; persists the remaining normalized mappings.
   */
  const handleRemove = (index: number) => {
    updateState({ glossaryEntries: entries.filter((_, i) => i !== index) });
  };

  return (
    <div className="bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md p-3">
      {/* Header with toggle and close */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-[var(--color-dust)]" />
          <span className="font-medium text-sm">Translation Glossary</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={glossaryEnabled}
            aria-label="Enable translation glossary"
            onClick={() => updateState({ glossaryEnabled: !glossaryEnabled })}
            className="kites-switch kites-switch-sm"
            data-state={glossaryEnabled ? 'checked' : 'unchecked'}
          >
            <span className="sr-only">Enable translation glossary</span>
            <span className="kites-switch-thumb" />
          </button>
          <button
            aria-label="Close translation glossary"
            onClick={onClose}
            className="p-1 hover:bg-[var(--color-dust)] hover:bg-opacity-30 rounded cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <p className="text-[11px] text-[var(--color-dust)] mb-2">
        Map source terms to preferred translations for WebLLM, Custom API, and Shared Pool.
        LLMs may not always follow these preferences. Google Translate does not support glossary in Kites.
      </p>

      {/* Privacy notice for cloud/custom engines */}
      <p className="text-[10px] text-[var(--color-dust)] mb-3 italic">
        When using Custom API or Shared Pool, glossary terms are included in translation prompts
        sent to the respective cloud provider. Do not add sensitive data.
      </p>

      {/* Existing entries */}
      {entries.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-3 max-h-36 overflow-y-auto">
          {entries.map((entry, index) => (
            <div
              key={`${entry.source}-${index}`}
              className="flex items-center gap-2 text-xs bg-[var(--color-paper)] rounded px-2 py-1.5 border border-[var(--color-dust)] border-opacity-30"
            >
              <span className="flex-1 truncate font-medium" title={entry.source}>
                {entry.source}
              </span>
              <span className="text-[var(--color-dust)]">&rarr;</span>
              <span className="flex-1 truncate" title={entry.target}>
                {entry.target}
              </span>
              <button
                onClick={() => handleRemove(index)}
                className="p-0.5 hover:bg-red-100 dark:hover:bg-red-900 rounded cursor-pointer text-[var(--color-dust)] hover:text-red-500 transition-colors"
                title="Remove entry"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add new entry row */}
      <div className="flex gap-1.5 items-end">
        <div className="flex-1">
          <label className="text-[10px] text-[var(--color-dust)] block mb-0.5">Source</label>
          <input
            type="text"
            aria-label="Source"
            value={draftSource}
            onChange={(e) => setDraftSource(e.target.value)}
            placeholder="e.g. 先輩"
            maxLength={MAX_GLOSSARY_TERM_LENGTH}
            className="w-full px-2 py-1 text-xs bg-[var(--color-paper)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-editorial)] text-[var(--color-ink)]"
          />
        </div>
        <div className="flex-1">
          <label className="text-[10px] text-[var(--color-dust)] block mb-0.5">Preferred</label>
          <input
            type="text"
            aria-label="Preferred"
            value={draftTarget}
            onChange={(e) => setDraftTarget(e.target.value)}
            placeholder="e.g. Senpai"
            maxLength={MAX_GLOSSARY_TERM_LENGTH}
            className="w-full px-2 py-1 text-xs bg-[var(--color-paper)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-editorial)] text-[var(--color-ink)]"
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={atCapacity || !draftSource.trim() || !draftTarget.trim()}
          className="p-1.5 bg-[var(--color-editorial)] text-white rounded hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-opacity"
          title={atCapacity ? `Maximum ${MAX_GLOSSARY_ENTRIES} entries reached` : 'Add glossary entry'}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Capacity indicator */}
      {entries.length > 0 && (
        <p className="text-[10px] text-[var(--color-dust)] mt-1.5 text-right">
          {entries.length}/{MAX_GLOSSARY_ENTRIES} entries
        </p>
      )}
    </div>
  );
}
