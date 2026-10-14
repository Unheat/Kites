import { useState } from 'react';
import { X, Plus, Globe, Trash2 } from 'lucide-react';
import type { PopupState, SiteSelectorRule } from '../../shared/types';
import { normalizeDomain, isValidCssSelector } from '../../shared/siteRules';
import HelpTooltip from './HelpTooltip';

interface SiteRulesPanelProps {
  state: PopupState;
  updateState: (updates: Partial<PopupState>) => void;
  onClose: () => void;
}

/**
 * Management panel for disabled domains (blacklist) and site-specific custom image selectors.
 *
 * @param props - State, update callback, and panel close handler.
 * @returns The rendered site rules configuration panel.
 */
export default function SiteRulesPanel({ state, updateState, onClose }: SiteRulesPanelProps) {
  const disabledDomains = state.disabledDomains || [];
  const siteRules = state.siteRules || [];

  // Local form state
  const [newDomain, setNewDomain] = useState('');
  const [newRuleDomain, setNewRuleDomain] = useState('');
  const [newRuleSelector, setNewRuleSelector] = useState('');
  const [activeTab, setActiveTab] = useState<'disabled' | 'selectors'>('disabled');

  const handleAddDisabledDomain = () => {
    const clean = normalizeDomain(newDomain);
    if (!clean) return;
    if (disabledDomains.includes(clean)) {
      setNewDomain('');
      return;
    }
    updateState({ disabledDomains: [...disabledDomains, clean] });
    setNewDomain('');
  };

  const handleRemoveDisabledDomain = (domainToRemove: string) => {
    updateState({
      disabledDomains: disabledDomains.filter((d) => d !== domainToRemove),
    });
  };

  const handleAddSiteRule = () => {
    const cleanDomain = normalizeDomain(newRuleDomain);
    const cleanSelector = newRuleSelector.trim();
    if (!cleanDomain || !isValidCssSelector(cleanSelector)) return;

    // Replace if rule for domain already exists, else append
    const existingIndex = siteRules.findIndex((r) => r.domain === cleanDomain);
    let nextRules: SiteSelectorRule[];
    if (existingIndex >= 0) {
      nextRules = [...siteRules];
      nextRules[existingIndex] = { domain: cleanDomain, selector: cleanSelector, enabled: true };
    } else {
      nextRules = [...siteRules, { domain: cleanDomain, selector: cleanSelector, enabled: true }];
    }

    updateState({ siteRules: nextRules });
    setNewRuleDomain('');
    setNewRuleSelector('');
  };

  const handleToggleRule = (index: number) => {
    const nextRules = [...siteRules];
    nextRules[index] = { ...nextRules[index], enabled: !nextRules[index].enabled };
    updateState({ siteRules: nextRules });
  };

  const handleRemoveSiteRule = (index: number) => {
    updateState({ siteRules: siteRules.filter((_, i) => i !== index) });
  };

  return (
    <div className="bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-[var(--color-dust)]" />
          <span className="font-medium text-sm">Site Rules & Domains</span>
          <HelpTooltip
            size="sm"
            content="Disable Kites on specific domains or configure custom CSS image selectors for complex manga reader sites."
          />
        </div>
        <button
          aria-label="Close site rules panel"
          onClick={onClose}
          className="p-1 hover:bg-[var(--color-dust)] hover:bg-opacity-30 rounded cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-3 border-b border-[var(--color-dust)] border-opacity-30 pb-2">
        <button
          onClick={() => setActiveTab('disabled')}
          className={`text-xs font-medium pb-0.5 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'disabled'
              ? 'border-[var(--color-editorial)] text-[var(--color-editorial)]'
              : 'border-transparent text-[var(--color-dust)] hover:text-[var(--color-ink)]'
          }`}
        >
          Disabled Sites ({disabledDomains.length})
        </button>
        <button
          onClick={() => setActiveTab('selectors')}
          className={`text-xs font-medium pb-0.5 border-b-2 transition-colors cursor-pointer ${
            activeTab === 'selectors'
              ? 'border-[var(--color-editorial)] text-[var(--color-editorial)]'
              : 'border-transparent text-[var(--color-dust)] hover:text-[var(--color-ink)]'
          }`}
        >
          Custom Selectors ({siteRules.length})
        </button>
      </div>

      {/* Tab 1: Disabled Domains */}
      {activeTab === 'disabled' && (
        <div className="flex flex-col gap-2.5">
          <p className="text-[11px] text-[var(--color-dust)]">
            Kites runs everywhere by default. Sites listed below will be completely ignored.
          </p>

          {/* Add input */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. twitter.com or *.bato.to"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddDisabledDomain();
              }}
              className="flex-1 px-2.5 py-1 text-xs bg-[var(--color-paper)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-editorial)]"
            />
            <button
              onClick={handleAddDisabledDomain}
              disabled={!newDomain.trim()}
              className="p-1.5 bg-[var(--color-ink)] text-[var(--color-paper)] rounded disabled:opacity-40 cursor-pointer"
              title="Add to disabled sites"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* List */}
          {disabledDomains.length > 0 ? (
            <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto">
              {disabledDomains.map((domain) => (
                <div
                  key={domain}
                  className="flex items-center justify-between text-xs bg-[var(--color-paper)] rounded px-2.5 py-1.5 border border-[var(--color-dust)] border-opacity-30"
                >
                  <span className="font-mono text-[11px] truncate">{domain}</span>
                  <button
                    onClick={() => handleRemoveDisabledDomain(domain)}
                    className="p-0.5 hover:text-red-500 text-[var(--color-dust)] transition-colors cursor-pointer"
                    title="Re-enable domain"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-[var(--color-dust)] text-center py-2 italic">
              No domains disabled. Kites is active on all supported pages.
            </p>
          )}
        </div>
      )}

      {/* Tab 2: Custom Selectors */}
      {activeTab === 'selectors' && (
        <div className="flex flex-col gap-2.5">
          <p className="text-[11px] text-[var(--color-dust)]">
            Specify CSS image selectors to accurately target chapter panels on tricky reader layouts.
          </p>

          {/* Add rule form */}
          <div className="flex flex-col gap-1.5 p-2 bg-[var(--color-paper)] rounded border border-[var(--color-dust)] border-opacity-30">
            <input
              type="text"
              placeholder="Domain (e.g. mangadex.org)"
              value={newRuleDomain}
              onChange={(e) => setNewRuleDomain(e.target.value)}
              className="px-2 py-1 text-xs bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-editorial)] font-mono text-[11px]"
            />
            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder="CSS Selector (e.g. #readerarea img)"
                value={newRuleSelector}
                onChange={(e) => setNewRuleSelector(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddSiteRule();
                }}
                className="flex-1 px-2 py-1 text-xs bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded focus:outline-none focus:border-[var(--color-editorial)] font-mono text-[11px]"
              />
              <button
                onClick={handleAddSiteRule}
                disabled={!newRuleDomain.trim() || !newRuleSelector.trim()}
                className="px-2.5 py-1 bg-[var(--color-ink)] text-[var(--color-paper)] rounded text-xs font-medium disabled:opacity-40 cursor-pointer flex items-center gap-1"
                title="Save site selector rule"
              >
                <Plus size={12} />
                <span>Save</span>
              </button>
            </div>
          </div>

          {/* List */}
          {siteRules.length > 0 ? (
            <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto">
              {siteRules.map((rule, idx) => (
                <div
                  key={`${rule.domain}-${idx}`}
                  className="flex items-center justify-between text-xs bg-[var(--color-paper)] rounded px-2.5 py-1.5 border border-[var(--color-dust)] border-opacity-30 gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={() => handleToggleRule(idx)}
                      className="cursor-pointer accent-[var(--color-editorial)]"
                      title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="font-bold text-[11px] truncate">{rule.domain}</span>
                      <span className="font-mono text-[10px] text-[var(--color-dust)] truncate">{rule.selector}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveSiteRule(idx)}
                    className="p-0.5 hover:text-red-500 text-[var(--color-dust)] transition-colors cursor-pointer shrink-0"
                    title="Delete rule"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-[var(--color-dust)] text-center py-2 italic">
              No custom rules. Standard auto-detection and built-in manga presets are used.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
