import type { PopupState } from '../../shared/types';
import { LANGUAGES } from '../../shared/utils/LanguageRegistry';

interface LanguageSelectorProps {
  state: PopupState;
  updateState: (updates: Partial<PopupState>) => void;
}

export default function LanguageSelector({ state, updateState }: LanguageSelectorProps) {
  return (
    <div className="flex gap-2">
      <div className="flex-1 flex flex-col gap-1.5">
        <label className="text-xs font-medium text-[var(--color-dust)] uppercase tracking-wider">Source</label>
        <select 
          value={state.sourceLang} 
          onChange={(e) => updateState({ sourceLang: e.target.value })}
          className="w-full p-2 text-sm bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md focus:outline-none focus:border-[var(--color-ink)] transition-colors cursor-pointer"
        >
          {LANGUAGES.map(lang => (
            <option key={`src-${lang.id}`} value={lang.id}>{lang.name}</option>
          ))}
        </select>
      </div>
      <div className="flex-1 flex flex-col gap-1.5">
        <label className="text-xs font-medium text-[var(--color-dust)] uppercase tracking-wider">Target</label>
        <select 
          value={state.targetLang} 
          onChange={(e) => updateState({ targetLang: e.target.value })}
          className="w-full p-2 text-sm bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md focus:outline-none focus:border-[var(--color-ink)] transition-colors cursor-pointer"
        >
          {LANGUAGES.filter(l => l.id !== 'auto').map(lang => (
            <option key={`tgt-${lang.id}`} value={lang.id}>{lang.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
