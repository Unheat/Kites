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

      {/* Manual Selection Method - Only shown when Auto-Translate is OFF */}
      {!state.isAuto && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-200 flex flex-col gap-2">
          <span className="font-medium block text-sm px-1">Manual Selection Method</span>
          <div className="flex p-1 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md">
            <button
              onClick={() => updateState({ manualMode: 'hover' })}
              className={`flex-1 py-1.5 text-sm font-medium rounded-sm transition-colors cursor-pointer ${
                state.manualMode === 'hover' 
                  ? 'bg-[var(--color-paper)] text-[var(--color-ink)] shadow-sm' 
                  : 'text-[var(--color-dust)] hover:text-[var(--color-ink)]'
              }`}
            >
              Hover
            </button>
            <button
              onClick={() => updateState({ manualMode: 'persistent' })}
              className={`flex-1 py-1.5 text-sm font-medium rounded-sm transition-colors cursor-pointer ${
                state.manualMode === 'persistent' 
                  ? 'bg-[var(--color-paper)] text-[var(--color-ink)] shadow-sm' 
                  : 'text-[var(--color-dust)] hover:text-[var(--color-ink)]'
              }`}
            >
              Persistent
            </button>
          </div>
          {/* Dynamic Helper Text */}
          <p className="text-xs text-[var(--color-dust)] px-1 leading-relaxed">
            {state.manualMode === 'hover' 
              ? 'A subtle button fades in when you hover over images.' 
              : 'A persistent button is pinned to every detectable image.'}
          </p>
        </div>
      )}
    </div>
  );
}
