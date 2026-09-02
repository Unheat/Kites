import type { PopupState } from '../../shared/types';
import LanguageSelector from './LanguageSelector';
import AutoTranslateControl from './AutoTranslateControl';
import { isWebLlmModel, isLlmGpuAvailable } from '../../shared/utils/hardwareUtils';
export type { Engine } from './EngineSelectionPanel';

interface EngineDropdownProps {
  state: PopupState;
  updateState: (updates: Partial<PopupState>) => void;
}

export default function EngineDropdown({ state, updateState }: EngineDropdownProps) {
  const isSelectedWebLlm = isWebLlmModel(state.activeEngineId);
  const isGpuReady = isLlmGpuAvailable(state);
  const showGpuWarning = isSelectedWebLlm && !isGpuReady;

  return (
    <div className="flex flex-col gap-3">
      {/* Reactive Warning Banner when active translation model requires GPU but GPU is disabled */}
      {showGpuWarning && (
        <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-md flex flex-col gap-2 text-xs text-amber-600 dark:text-amber-400 animate-in fade-in duration-200">
          <div className="flex items-center gap-1.5 font-semibold">
            <span>⚠️</span>
            <span>GPU Acceleration is off for active model</span>
          </div>
          <p className="text-[11px] leading-tight text-[var(--color-ink)] opacity-80">
            The selected model ({state.activeEngineId}) needs GPU acceleration to run.
          </p>
          <div className="flex items-center gap-2 pt-0.5">
            <button
              onClick={() => {
                updateState({
                  webgpuMaster: true,
                  webgpuOverrides: {
                    ...state.webgpuOverrides,
                    llm: true
                  }
                });
              }}
              className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded font-medium text-[11px] transition-colors cursor-pointer"
            >
              Enable GPU
            </button>
            <button
              onClick={() => updateState({ activeEngineId: 'gg-translate' })}
              className="px-2 py-1 bg-[var(--color-vellum)] hover:bg-[var(--color-paper)] border border-[var(--color-dust)] text-[var(--color-ink)] rounded font-medium text-[11px] transition-colors cursor-pointer"
            >
              Use Google Translate
            </button>
          </div>
        </div>
      )}

      {/* 1. Language Selection (Source & Target) on top */}
      <LanguageSelector state={state} updateState={updateState} />

      <hr className="border-[var(--color-dust)] opacity-50" />

      {/* 2. Auto-Translate & Manual Mode Controls below */}
      <AutoTranslateControl state={state} updateState={updateState} />
    </div>
  );
}
