import type { PopupState } from '../../shared/types';
import LanguageSelector from './LanguageSelector';
import AutoTranslateControl from './AutoTranslateControl';
export type { Engine } from './EngineSelectionPanel';


interface EngineDropdownProps {
  state: PopupState;
  updateState: (updates: Partial<PopupState>) => void;
}

export default function EngineDropdown({ state, updateState }: EngineDropdownProps) {
  return (
    <div className="flex flex-col gap-5">
      {/* 1. Language Selection (Source & Target) on top */}
      <LanguageSelector state={state} updateState={updateState} />

      <hr className="border-[var(--color-dust)] opacity-50" />

      {/* 2. Auto-Translate & Manual Mode Controls below */}
      <AutoTranslateControl state={state} updateState={updateState} />
    </div>
  );
}
