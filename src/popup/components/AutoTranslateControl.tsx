import type { PopupState } from '../../shared/types';

interface AutoTranslateControlProps {
  state: PopupState;
  updateState: (updates: Partial<PopupState>) => void;
}

export default function AutoTranslateControl({ state, updateState }: AutoTranslateControlProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* Main Auto-Translate Toggle Card */}
      <div className="flex items-center justify-between p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md">
        <div>
          <span className="font-medium block text-sm">Auto-Translate</span>
          <span className="text-xs text-[var(--color-dust)]">
            {state.isAuto ? 'Translates visible images automatically' : 'Requires manual activation'}
          </span>
        </div>
        <button 
          onClick={() => updateState({ isAuto: !state.isAuto })}
          className="kites-switch kites-switch-md"
          data-state={state.isAuto ? 'checked' : 'unchecked'}
        >
          <span className="sr-only">Toggle auto-translate</span>
          <span className="kites-switch-thumb" />
        </button>
      </div>
    </div>
  );
}
