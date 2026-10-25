import { useState } from 'react';
import { X, MessageSquare, Sparkles } from 'lucide-react';
import HelpTooltip from './HelpTooltip';

export const MAX_GLOBAL_CUSTOM_PROMPT_LENGTH = 250;

const PROMPT_PRESETS = [
  { label: 'Keep Honorifics', text: 'Keep -san/-kun honorifics.' },
  { label: 'Casual Slang', text: 'Use natural modern conversational slang.' },
  { label: 'Literal Accuracy', text: 'Prioritize literal accuracy over localization.' },
] as const;

export interface CustomPromptPanelProps {
  customPrompt: string;
  updateState: (patch: { customPrompt: string }) => void;
  onClose: () => void;
}

/**
 * Accordion panel for managing the shared global custom prompt.
 * Bounded to 250 characters (~60-80 tokens) to fit inside WebLLM's local WebGPU context window.
 * External APIs can override this with longer prompts inside Manage Custom APIs.
 *
 * @param props - Custom prompt state and mutation callback.
 * @returns The rendered custom prompt configuration panel.
 */
export default function CustomPromptPanel({
  customPrompt,
  updateState,
  onClose,
}: CustomPromptPanelProps) {
  const [draft, setDraft] = useState(customPrompt || '');

  const handleChange = (text: string) => {
    const trimmed = text.slice(0, MAX_GLOBAL_CUSTOM_PROMPT_LENGTH);
    setDraft(trimmed);
    updateState({ customPrompt: trimmed });
  };

  const handleApplyPreset = (presetText: string) => {
    const next = draft ? `${draft.trim()} ${presetText}` : presetText;
    handleChange(next);
  };

  const handleClear = () => {
    setDraft('');
    updateState({ customPrompt: '' });
  };

  const charCount = draft.length;
  const isNearLimit = charCount > 180;

  return (
    <div className="p-3 bg-[var(--color-paper)] border border-[var(--color-dust)] rounded-md shadow-sm">
      {/* Header */}
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-1.5">
          <MessageSquare size={16} className="text-[var(--color-editorial)]" />
          <h3 className="text-sm font-bold text-[var(--color-editorial)]">Custom Prompt</h3>
          <HelpTooltip
            id="custom-prompt-help"
            size="sm"
            content="Guide translation tone and phrasing across all engines. Kept concise so on-device WebLLM won't run out of GPU memory."
          />
        </div>
        <button
          onClick={onClose}
          className="p-1 text-[var(--color-dust)] hover:text-[var(--color-ink)] transition-colors cursor-pointer"
          title="Close Custom Prompt"
          aria-label="Close Custom Prompt"
        >
          <X size={16} />
        </button>
      </div>

      <p className="text-xs text-[var(--color-dust)] mb-2.5 leading-relaxed">
        Guide the character voice, phrasing, and translation rules across all models.
      </p>

      {/* Preset Quick Chips */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {PROMPT_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => handleApplyPreset(preset.text)}
            className="px-2 py-0.5 text-xs bg-[var(--color-vellum)] hover:bg-[var(--color-dust)]/20 text-[var(--color-ink)] border border-[var(--color-dust)]/50 rounded-full transition-colors cursor-pointer flex items-center gap-1"
          >
            <Sparkles size={11} className="text-[var(--color-editorial)]" />
            <span>+ {preset.label}</span>
          </button>
        ))}
      </div>

      {/* Textarea */}
      <div className="relative mb-1.5">
        <textarea
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          maxLength={MAX_GLOBAL_CUSTOM_PROMPT_LENGTH}
          rows={3}
          placeholder="e.g. Natural casual dialogue, keep -san/-kun honorifics, pirate slang..."
          className="w-full p-2 text-xs bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded text-[var(--color-ink)] placeholder-[var(--color-dust)]/70 focus:outline-none focus:border-[var(--color-editorial)] transition-colors resize-none leading-relaxed"
        />
      </div>

      {/* Footer Indicators & Controls */}
      <div className="flex justify-between items-center text-xs">
        <div className="flex items-center gap-1.5">
          <span className={`font-mono ${isNearLimit ? 'text-amber-500 font-semibold' : 'text-[var(--color-dust)]'}`}>
            {charCount}/{MAX_GLOBAL_CUSTOM_PROMPT_LENGTH}
          </span>
          <span className="text-[var(--color-dust)]">·</span>
          <span className={isNearLimit ? 'text-amber-500 font-medium' : 'text-emerald-600 dark:text-emerald-400 font-medium'}>
            {isNearLimit ? '▲ High WebLLM usage' : '● WebLLM & Cloud compatible'}
          </span>
        </div>

        {draft && (
          <button
            type="button"
            onClick={handleClear}
            className="text-[var(--color-dust)] hover:text-red-500 transition-colors cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>

      {/* Microcopy Callout */}
      <div className="mt-2.5 pt-2 border-t border-[var(--color-dust)]/30 text-[11px] text-[var(--color-dust)] leading-relaxed">
        ℹ️ Kept brief so local WebLLM won&apos;t exceed WebGPU memory. Need longer guidelines? Configure per API in <strong className="text-[var(--color-ink)]">Manage Custom APIs</strong>.
      </div>
    </div>
  );
}
