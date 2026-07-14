import { useState } from 'react';
import type { PopupState } from '../index';
import { Moon, Sun, KeyRound } from 'lucide-react';
import ApiConfigPanel from './ApiConfigPanel';

interface SettingsViewProps {
  state: PopupState;
  updateState: (updates: Partial<PopupState>) => void;
}

export default function SettingsView({ state, updateState }: SettingsViewProps) {
  const [showApiConfig, setShowApiConfig] = useState(false);
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
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none cursor-pointer ${
            state.isAuto ? 'bg-[var(--color-editorial)]' : 'bg-[var(--color-dust)]'
          }`}
        >
          <span className="sr-only">Toggle auto-translate</span>
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-[var(--color-paper)] transition-transform ${
              state.isAuto ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Manual Selection Method */}
      <div className={`transition-opacity ${state.isAuto ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
        <span className="font-medium block text-sm mb-2">Manual Selection Method</span>
        <div className="flex p-1 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md">
          <button
            onClick={() => updateState({ manualMode: 'hover' })}
            className={`flex-1 py-1.5 text-sm font-medium rounded-sm transition-colors cursor-pointer ${
              state.manualMode === 'hover' ? 'bg-[var(--color-paper)] text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-dust)] hover:text-[var(--color-ink)]'
            }`}
          >
            Hover
          </button>
          <button
            onClick={() => updateState({ manualMode: 'persistent' })}
            className={`flex-1 py-1.5 text-sm font-medium rounded-sm transition-colors cursor-pointer ${
              state.manualMode === 'persistent' ? 'bg-[var(--color-paper)] text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-dust)] hover:text-[var(--color-ink)]'
            }`}
          >
            Persistent
          </button>
        </div>
        <p className="text-xs text-[var(--color-dust)] mt-2 leading-relaxed">
          {state.manualMode === 'hover' 
            ? 'A subtle button appears only when hovering over an image.' 
            : 'A persistent button is injected above every detectable image on the page.'}
        </p>
      </div>

      {/* API Configuration */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <span className="font-medium text-sm">Custom API Provider</span>
        </div>
        {!showApiConfig ? (
          <button 
            onClick={() => setShowApiConfig(true)}
            className="w-full flex items-center justify-between p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <KeyRound size={16} className="text-[var(--color-dust)]" />
              <span className="font-medium text-sm">
                {state.apiConfig?.apiKey ? 'Configure API (Key Saved)' : 'Add Custom API Key'}
              </span>
            </div>
            <span className="text-xs text-[var(--color-editorial)] font-medium">Edit</span>
          </button>
        ) : (
          <ApiConfigPanel state={state} updateState={updateState} onClose={() => setShowApiConfig(false)} />
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
  );
}
