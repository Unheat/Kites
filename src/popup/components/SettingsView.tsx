import { useState } from 'react';
import type { PopupState } from '../index';
import { Moon, Sun, KeyRound, Network } from 'lucide-react';
import ApiManagerPanel from './ApiManagerPanel';
import FallbackConfigPanel from './FallbackConfigPanel';

interface SettingsViewProps {
  state: PopupState;
  updateState: (updates: Partial<PopupState>) => void;
}

export default function SettingsView({ state, updateState }: SettingsViewProps) {
  const [showApiManager, setShowApiManager] = useState(false);
  const [showFallbackConfig, setShowFallbackConfig] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      
      {/* Theme Toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-[var(--color-dust)]">Preferences</h2>
        <button 
          onClick={() => updateState({ isDark: !state.isDark })}
          className="p-1.5 rounded-md hover:bg-[var(--color-vellum)] transition-colors cursor-pointer text-[var(--color-ink)]"
          title={state.isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          {state.isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      {/* Auto-Translate Toggle */}
      <div className="flex items-center justify-between p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md">
        <div>
          <span className="font-medium block text-sm">Auto-Translate</span>
          <span className="text-xs text-[var(--color-dust)]">
            {state.isAuto ? 'Translates visible images' : 'Requires manual activation'}
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

      {/* Manual Selection Method */}
      <div className={`transition-opacity ${state.isAuto ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
        <span className="font-medium block text-sm mb-2">Manual Translation Trigger</span>
        <div className="flex p-1 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md">
          <button
            onClick={() => updateState({ manualMode: 'hover' })}
            className={`flex-1 py-1.5 text-sm font-medium rounded-sm transition-colors cursor-pointer ${
              state.manualMode === 'hover' ? 'bg-[var(--color-paper)] text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-dust)] hover:text-[var(--color-ink)]'
            }`}
          >
            Hover Overlay
          </button>
          <button
            onClick={() => updateState({ manualMode: 'persistent' })}
            className={`flex-1 py-1.5 text-sm font-medium rounded-sm transition-colors cursor-pointer ${
              state.manualMode === 'persistent' ? 'bg-[var(--color-paper)] text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-dust)] hover:text-[var(--color-ink)]'
            }`}
          >
            Always Visible
          </button>
        </div>
        <p className="text-xs text-[var(--color-dust)] mt-2 leading-relaxed">
          {state.manualMode === 'hover' 
            ? 'A subtle button fades in when you hover over images.' 
            : 'A persistent button is pinned to every detectable image.'}
        </p>
      </div>



      {/* Advanced Configurations */}
      <div>
        <div className="flex justify-between items-center mb-2 mt-4">
          <span className="font-medium text-sm">Advanced Configuration</span>
        </div>
      
      <div className="flex flex-col gap-5">
          {/* Advanced Configurations */}
          <div className="flex flex-col gap-2">
            {!showApiManager ? (
              <button 
                onClick={() => setShowApiManager(true)}
                className="w-full flex items-center justify-between p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <KeyRound size={16} className="text-[var(--color-dust)]" />
                  <span className="font-medium text-sm">Manage Custom APIs</span>
                </div>
                <span className="text-xs text-[var(--color-editorial)] font-medium">Edit</span>
              </button>
            ) : (
              <ApiManagerPanel state={state} updateState={updateState} onClose={() => setShowApiManager(false)} />
            )}

            {!showFallbackConfig ? (
              <button 
                onClick={() => setShowFallbackConfig(true)}
                className="w-full flex items-center justify-between p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Network size={16} className="text-[var(--color-dust)]" />
                  <span className="font-medium text-sm">Configure Fallback Chain</span>
                </div>
                <span className="text-xs text-[var(--color-editorial)] font-medium">Edit</span>
              </button>
            ) : (
              <FallbackConfigPanel state={state} updateState={updateState} onClose={() => setShowFallbackConfig(false)} />
            )}
          </div>

          {/* Concurrency Slider */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="font-medium text-sm">Max Concurrent Translations</span>
              <span className="text-sm font-bold text-[var(--color-editorial)]">{state.concurrency}</span>
            </div>
            <input 
              type="range" 
              min="1" 
              max="10" 
              value={state.concurrency}
              onChange={(e) => updateState({ concurrency: parseInt(e.target.value) })}
              className="w-full h-2 bg-[var(--color-vellum)] rounded-lg appearance-none cursor-pointer accent-[var(--color-editorial)]"
            />
            <div className="flex justify-between text-xs text-[var(--color-dust)] mt-1">
              <span>1</span>
              <span>10</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
