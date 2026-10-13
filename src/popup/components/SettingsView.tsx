import { useState } from 'react';
import type { PopupState, HistoryRetentionPeriod } from '../../shared/types';
import { DEFAULT_POPUP_STATE } from '../../shared/types';
import { Moon, Sun, KeyRound, Network, BookOpen, Globe } from 'lucide-react';
import GlossaryPanel from './GlossaryPanel';
import SiteRulesPanel from './SiteRulesPanel';
import ReadingShortcutsHelp from './ReadingShortcutsHelp';
import ApiManagerPanel from './ApiManagerPanel';
import FallbackConfigPanel from './FallbackConfigPanel';
import EngineSelectionPanel from './EngineSelectionPanel';
import GpuAccelerationPanel from './GpuAccelerationPanel';
import { AccountCard } from './AccountCard';

interface SettingsViewProps {
  state: PopupState;
  updateState: (updates: Partial<PopupState>) => void;
}

/**
 * Hover-only "?" hint matching the engine panel tooltip pattern; keeps long
 * descriptions out of the popup flow. Content stays in the DOM for screen readers.
 *
 * @param props - Optional id for aria-describedby wiring plus the hint content.
 * @returns The rendered help icon with its tooltip.
 */
function FieldHint({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <div className="relative flex items-center">
      <div className="peer w-3.5 h-3.5 rounded-full border border-[var(--color-dust)] flex items-center justify-center text-[9px] text-[var(--color-dust)] cursor-help hover:bg-[var(--color-dust)] hover:text-[var(--color-paper)] transition-colors flex-shrink-0">
        ?
      </div>
      <div className="absolute left-0 top-full mt-1.5 w-[210px] z-50 opacity-0 pointer-events-none peer-hover:opacity-100 transition-opacity">
        <div id={id} className="p-2 bg-[var(--color-ink)] text-[var(--color-paper)] text-[11px] leading-snug rounded-md shadow-xl border border-[var(--color-dust)]/20">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function SettingsView({ state, updateState }: SettingsViewProps) {
  const [showApiManager, setShowApiManager] = useState(false);
  const [showFallbackConfig, setShowFallbackConfig] = useState(false);
  const [showGlossary, setShowGlossary] = useState(false);
  const [showSiteRules, setShowSiteRules] = useState(false);

  const concurrency = Math.min(5, Math.max(1, state.concurrency));

  return (
    <div className="flex flex-col gap-3.5">
      {/* Google Sign-in & Shared Pool Pass */}
      <AccountCard
        userAccount={state.userAccount}
        onAccountChange={(account) => {
          if (!account && state.activeEngineId === 'cloudflare-translate') {
            updateState({
              userAccount: undefined,
              activeEngineId: DEFAULT_POPUP_STATE.activeEngineId,
              fallbackChain: (state.fallbackChain ?? []).filter((id) => id !== 'cloudflare-translate'),
            });
          } else {
            updateState({ userAccount: account });
          }
        }}
      />

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

      <EngineSelectionPanel state={state} updateState={updateState} />

      <hr className="border-[var(--color-dust)] opacity-50" />

      <GpuAccelerationPanel state={state} updateState={updateState} />

      <hr className="border-[var(--color-dust)] opacity-50" />

      {/* Advanced Configuration */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <span className="font-medium text-sm">Advanced Configuration</span>
        </div>
      
        <div className="flex flex-col gap-3.5">
          {/* Custom APIs & Fallback Chain */}
          <div className="flex flex-col gap-2">
            {!showApiManager ? (
              <button 
                onClick={() => setShowApiManager(true)}
                className="w-full flex items-center justify-between p-2.5 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer"
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
                className="w-full flex items-center justify-between p-2.5 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer"
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

            {!showGlossary ? (
              <button
                onClick={() => setShowGlossary(true)}
                className="w-full flex items-center justify-between p-2.5 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <BookOpen size={16} className="text-[var(--color-dust)]" />
                  <span className="font-medium text-sm">Name Dictionary</span>
                </div>
                <span className="text-xs text-[var(--color-editorial)] font-medium">Edit</span>
              </button>
            ) : (
              <GlossaryPanel
                glossaryEnabled={state.glossaryEnabled ?? false}
                glossaryEntries={state.glossaryEntries ?? []}
                updateState={updateState}
                onClose={() => setShowGlossary(false)}
              />
            )}

            {!showSiteRules ? (
              <button
                onClick={() => setShowSiteRules(true)}
                className="w-full flex items-center justify-between p-2.5 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Globe size={16} className="text-[var(--color-dust)]" />
                  <span className="font-medium text-sm">Site Rules & Domains</span>
                </div>
                <span className="text-xs text-[var(--color-editorial)] font-medium">Edit</span>
              </button>
            ) : (
              <SiteRulesPanel
                state={state}
                updateState={updateState}
                onClose={() => setShowSiteRules(false)}
              />
            )}
          </div>

          {/* Manual Selection Method */}
          <div className="pt-2 border-t border-[var(--color-dust)] border-opacity-30 flex flex-col gap-2">
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
                ? 'translate button appears when hovering over images' 
                : 'translate button is pinned to every detectable image'}
            </p>
          </div>

          {/* Max Queue Capacity Slider */}
          <div className="pt-2 border-t border-[var(--color-dust)] border-opacity-30">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-sm">Max Queue Capacity</span>
                <FieldHint>
                  Maximum images allowed in translation queue. Processed sequentially for GPU stability.
                </FieldHint>
              </div>
              <span className="text-sm font-bold text-[var(--color-editorial)]">{state.concurrency}</span>
            </div>
            <input
              type="range"
              min="1"
              max="5"
              value={concurrency}
              onChange={(e) => updateState({ concurrency: parseInt(e.target.value, 10) })}
              className="w-full h-2 bg-[var(--color-vellum)] rounded-lg appearance-none cursor-pointer accent-[var(--color-editorial)]"
            />
            <div className="flex justify-between text-xs text-[var(--color-dust)] mt-1">
              <span>1</span>
              <span>5</span>
            </div>
          </div>

          {/* History Retention / Auto-Delete (Torii parity) */}
          <div className="pt-2 border-t border-[var(--color-dust)] border-opacity-30">
            <div className="flex justify-between items-center mb-1">
              <div className="flex items-center gap-1.5">
                <label htmlFor="history-retention" className="font-medium text-sm">Auto-delete History</label>
                <FieldHint id="history-retention-description">
                  {state.historyRetention === 'never'
                    ? 'Auto-delete is disabled. History is kept until you delete it manually.'
                    : 'Deletes inactive job records and their cached images and text older than the selected window. Queued, downloading, and processing jobs are kept.'}
                </FieldHint>
              </div>
              <select
                id="history-retention"
                aria-describedby="history-retention-description"
                value={state.historyRetention ?? DEFAULT_POPUP_STATE.historyRetention}
                onChange={(e) => updateState({ historyRetention: e.target.value as HistoryRetentionPeriod })}
                className="px-2.5 py-1 text-xs bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded font-medium text-[var(--color-ink)] cursor-pointer focus:outline-none focus:border-[var(--color-editorial)]"
              >
                <option value="1day">1 day</option>
                <option value="1week">1 week (Default)</option>
                <option value="1month">1 month</option>
                <option value="never">Never</option>
              </select>
            </div>
          </div>
          <ReadingShortcutsHelp />
        </div>
      </div>
    </div>
  );
}
