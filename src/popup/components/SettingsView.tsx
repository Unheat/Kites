import { useState } from 'react';
import type { PopupState, HistoryRetentionPeriod } from '../../shared/types';
import { DEFAULT_POPUP_STATE } from '../../shared/types';
import { KeyRound, Network, BookOpen, Globe, MessageSquare, Pencil } from 'lucide-react';
import GlossaryPanel from './GlossaryPanel';
import CustomPromptPanel from './CustomPromptPanel';
import SiteRulesPanel from './SiteRulesPanel';
import ReadingShortcutsHelp from './ReadingShortcutsHelp';
import ApiManagerPanel from './ApiManagerPanel';
import FallbackConfigPanel from './FallbackConfigPanel';
import EngineSelectionPanel from './EngineSelectionPanel';
import GpuAccelerationPanel from './GpuAccelerationPanel';
import { AccountCard } from './AccountCard';

import HelpTooltip from './HelpTooltip';

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
  return <HelpTooltip id={id} content={children} size="sm" />;
}

export default function SettingsView({ state, updateState }: SettingsViewProps) {
  const [showApiManager, setShowApiManager] = useState(false);
  const [showFallbackConfig, setShowFallbackConfig] = useState(false);
  const [showGlossary, setShowGlossary] = useState(false);
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);
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

      {/* Section 1: AI Engines */}
      <div className="flex flex-col gap-3">
        <EngineSelectionPanel state={state} updateState={updateState} />
      </div>

      {/* Section 2: Reading & Interaction */}
      <div className="flex flex-col gap-3 pt-1">
        <h3 className="text-xs font-semibold tracking-wider uppercase text-[var(--color-dust)]">
          Reading & Interaction
        </h3>

        {/* Manual Selection Method */}
        <div className="flex flex-col gap-2">
          <span className="font-medium block text-sm px-0.5">Manual Selection Method</span>
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
          <p className="text-xs text-[var(--color-dust)] px-0.5 leading-relaxed">
            {state.manualMode === 'hover' 
              ? 'translate button appears when hovering over images' 
              : 'translate button is pinned to every detectable image'}
          </p>
        </div>

        {/* Max Queue Capacity Slider */}
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between items-center">
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
          <div className="flex justify-between text-xs text-[var(--color-dust)]">
            <span>1</span>
            <span>5</span>
          </div>
        </div>

        {/* History Retention / Auto-Delete */}
        <div className="flex justify-between items-center py-0.5">
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

        {/* Keyboard Shortcuts Reference */}
        <ReadingShortcutsHelp />
      </div>

      {/* Section 3: Advanced & Integrations */}
      <div className="flex flex-col gap-3 pt-1">
        <h3 className="text-xs font-semibold tracking-wider uppercase text-[var(--color-dust)]">
          Advanced & Integrations
        </h3>

        <GpuAccelerationPanel state={state} updateState={updateState} />

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
              <Pencil size={14} className="text-[var(--color-editorial)] shrink-0" aria-hidden="true" />
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
              <Pencil size={14} className="text-[var(--color-editorial)] shrink-0" aria-hidden="true" />
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
              <Pencil size={14} className="text-[var(--color-editorial)] shrink-0" aria-hidden="true" />
            </button>
          ) : (
            <GlossaryPanel
              glossaryEnabled={state.glossaryEnabled ?? false}
              glossaryEntries={state.glossaryEntries ?? []}
              updateState={updateState}
              onClose={() => setShowGlossary(false)}
            />
          )}

          {!showCustomPrompt ? (
            <button
              onClick={() => setShowCustomPrompt(true)}
              className="w-full flex items-center justify-between p-2.5 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md hover:border-[var(--color-ink)] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <MessageSquare size={16} className="text-[var(--color-dust)]" />
                <span className="font-medium text-sm">Custom Prompt</span>
              </div>
              <Pencil size={14} className="text-[var(--color-editorial)] shrink-0" aria-hidden="true" />
            </button>
          ) : (
            <CustomPromptPanel
              customPrompt={state.customPrompt ?? ''}
              updateState={updateState}
              onClose={() => setShowCustomPrompt(false)}
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
              <Pencil size={14} className="text-[var(--color-editorial)] shrink-0" aria-hidden="true" />
            </button>
          ) : (
            <SiteRulesPanel
              state={state}
              updateState={updateState}
              onClose={() => setShowSiteRules(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
