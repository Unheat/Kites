import { StrictMode, useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css'; 

import EngineDropdown from './components/EngineDropdown';
import SettingsView from './components/SettingsView';
import BatchScanPanel from './components/BatchScanPanel';

import { Settings, Home, Power, Crop, Globe, Layers, Sun, Moon } from 'lucide-react';

import type { PopupState } from '../shared/types';
import { DEFAULT_POPUP_STATE } from '../shared/types';
import { STORAGE_KEYS } from '../shared/constants';
import { isDomainDisabled, normalizeDomain } from '../shared/siteRules';

/**
 * Completes persisted popup settings and preserves nested WebGPU defaults.
 *
 * @param state - Partial state loaded from storage or a state update.
 * @returns A complete popup state.
 */
export function completePopupState(state?: Partial<PopupState>): PopupState {
  return {
    ...DEFAULT_POPUP_STATE,
    ...(state ?? {}),
    webgpuOverrides: {
      ...DEFAULT_POPUP_STATE.webgpuOverrides,
      ...(state?.webgpuOverrides ?? {}),
    },
  };
}

function PopupApp() {
  const [activeTab, setActiveTab] = useState<'home' | 'batch' | 'settings'>('home');
  const [isLoaded, setIsLoaded] = useState(false);
  const [state, setState] = useState<PopupState>(DEFAULT_POPUP_STATE);
  const [currentDomain, setCurrentDomain] = useState<string | null>(null);
  const storageWriteQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab?.url) {
          try {
            const url = new URL(tab.url);
            if (url.protocol === 'http:' || url.protocol === 'https:') {
              setCurrentDomain(url.hostname.toLowerCase());
            }
          } catch {}
        }
      });
    }
  }, []);

  const isCurrentDomainDisabled = currentDomain
    ? isDomainDisabled(currentDomain, state.disabledDomains)
    : false;

  const handleToggleCurrentDomain = () => {
    if (!currentDomain) return;
    const currentDisabled = state.disabledDomains || [];
    let next: string[];
    if (isCurrentDomainDisabled) {
      next = currentDisabled.filter((d) => normalizeDomain(d) !== currentDomain);
    } else {
      next = [...currentDisabled, currentDomain];
    }
    updateState({ disabledDomains: next });
  };

  useEffect(() => {
    let isMounted = true;

    chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }, (popupState) => {
      if (!isMounted) return;
      if (chrome.runtime.lastError) {
        console.warn('[Popup] Failed to load normalized popup state:', chrome.runtime.lastError.message);
      } else if (popupState && typeof popupState === 'object') {
        setState(completePopupState(popupState as Partial<PopupState>));
      }
      setIsLoaded(true);

      // WORKAROUND: Probe through offscreen only when hardware WebGPU capability is not
      // yet verified in cache. Popup reads cached success from chrome.storage.local (0ms)
      // to eliminate loading flash, avoiding zombie offscreen RPC stalls. Transient
      // offscreen failures or timeouts only set RAM state (never persist false). See devlog 015.
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(STORAGE_KEYS.WEBGPU_SUPPORTED, (data) => {
          if (!isMounted) return;
          if (data?.[STORAGE_KEYS.WEBGPU_SUPPORTED] === true) {
            setState(prev => ({ ...prev, webgpuSupported: true }));
            return;
          }

          let timedOut = false;
          const timer = setTimeout(() => {
            timedOut = true;
            if (isMounted) {
              console.warn('[Popup] WebGPU capability probe timed out after 3000ms. Defaulting to false in RAM.');
              setState(prev => ({ ...prev, webgpuSupported: false }));
            }
          }, 3000);

          chrome.runtime.sendMessage(
            { type: 'CHECK_WEBGPU_SUPPORT', target: 'background', source: 'popup', request: true },
            (response) => {
              if (timedOut || !isMounted) return;
              clearTimeout(timer);
              if (chrome.runtime.lastError || response?.status !== 'success') {
                console.warn('[Popup] WebGPU support check failed:', chrome.runtime.lastError?.message || response?.error);
                setState(prev => ({ ...prev, webgpuSupported: false }));
                return;
              }
              setState(prev => ({ ...prev, webgpuSupported: response.supported === true }));
            }
          );
        });
      }
    });

    // Listen to changes in chrome.storage.local to reactively reflect quota/state updates
    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local' && changes[STORAGE_KEYS.POPUP_STATE]?.newValue) {
        setState(completePopupState(changes[STORAGE_KEYS.POPUP_STATE].newValue as Partial<PopupState>));
      }
    };

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange);
    }

    return () => {
      isMounted = false;
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      }
    };
  }, []);

  // Apply dark mode to HTML and body tags
  useEffect(() => {
    if (state.isDark) {
      document.documentElement.classList.add('dark');
      document.body.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');
    }
  }, [state.isDark]);

  /**
   * Applies an optimistic popup update and serializes complete storage writes.
   *
   * @param updates - Popup fields to update, including partial nested WebGPU overrides.
   * @returns Nothing.
   */
  const updateState = (updates: Partial<PopupState>) => {
    setState(prev => {
      const newState = completePopupState({
        ...prev,
        ...updates,
        webgpuOverrides: {
          ...prev.webgpuOverrides,
          ...(updates.webgpuOverrides ?? {}),
        },
      });
      // WORKAROUND: Serial writes prevent two rapid toggle updates from persisting
      // independent snapshots and restoring stale GPU flags behind the live React UI.
      // Never persist webgpuSupported as false to chrome.storage.local to avoid permanent WASM fallback.
      const stateToPersist: PopupState = {
        ...newState,
        webgpuSupported: newState.webgpuSupported === true ? true : null,
      };
      storageWriteQueue.current = storageWriteQueue.current
        .catch(() => undefined)
        .then(async () => {
          await chrome.storage.local.set({ [STORAGE_KEYS.POPUP_STATE]: stateToPersist });
        })
        .catch((error) => {
          console.error('[Popup] Failed to persist popup state:', error);
        });
      return newState;
    });
  };

  if (!isLoaded) return null;

  return (
    <div className="w-full min-h-full flex flex-col bg-[var(--color-paper)] text-[var(--color-ink)] font-body relative">
      
      {/* Header */}
      <div className="flex justify-between items-center mb-2.5 p-3.5 pb-0">
        <h1 className="text-xl font-bold font-display tracking-tight text-[var(--color-editorial)] flex items-center gap-2">
          Kites
          {!state.isExtensionEnabled ? (
            <span className="text-xs font-normal text-[var(--color-dust)] px-2 py-0.5 border border-[var(--color-dust)] rounded-full">OFF</span>
          ) : isCurrentDomainDisabled ? (
            <span className="text-xs font-normal text-amber-500 px-2 py-0.5 border border-amber-500/40 rounded-full">PAUSED</span>
          ) : null}
        </h1>
        <div className="flex gap-1.5 items-center">
          <button 
            onClick={() => updateState({ isExtensionEnabled: !state.isExtensionEnabled })}
            className={`p-1.5 rounded transition-colors hover:bg-[var(--color-vellum)] cursor-pointer`}
            title={state.isExtensionEnabled ? "Disable Kites" : "Enable Kites"}
          >
            <Power size={18} className={state.isExtensionEnabled ? "text-[var(--color-editorial)]" : "text-[var(--color-dust)]"} />
          </button>
          <button 
            onClick={() => updateState({ isDark: !state.isDark })}
            className="p-1.5 rounded transition-colors hover:bg-[var(--color-vellum)] cursor-pointer text-[var(--color-ink)]"
            title={state.isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {state.isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <div className="w-px h-5 bg-[var(--color-dust)] opacity-30 mx-0.5" />
          <button 
            onClick={() => setActiveTab('home')}
            className={`p-1.5 rounded transition-colors cursor-pointer ${activeTab === 'home' ? 'bg-[var(--color-vellum)]' : 'hover:bg-[var(--color-vellum)]'}`}
            title="Home"
          >
            <Home size={18} className="text-[var(--color-ink)]" />
          </button>
          <button 
            onClick={() => setActiveTab('batch')}
            className={`p-1.5 rounded transition-colors cursor-pointer ${activeTab === 'batch' ? 'bg-[var(--color-vellum)]' : 'hover:bg-[var(--color-vellum)]'}`}
            title="Chapter Page Scanner & Batch Translate"
          >
            <Layers size={18} className="text-[var(--color-ink)]" />
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`p-1.5 rounded transition-colors cursor-pointer ${activeTab === 'settings' ? 'bg-[var(--color-vellum)]' : 'hover:bg-[var(--color-vellum)]'}`}
            title="Settings"
          >
            <Settings size={18} className="text-[var(--color-ink)]" />
          </button>
        </div>
      </div>

      {/* 1-Click Domain Status Pill */}
      {currentDomain && state.isExtensionEnabled && (
        <div className="mx-3.5 mb-2.5 px-2.5 py-1.5 rounded bg-[var(--color-vellum)] border border-[var(--color-dust)] border-opacity-30 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <Globe size={13} className={isCurrentDomainDisabled ? 'text-amber-500 shrink-0' : 'text-[var(--color-dust)] shrink-0'} />
            <span className="font-mono text-[11px] truncate text-[var(--color-ink)]" title={currentDomain}>
              {currentDomain}
            </span>
          </div>
          <button
            onClick={handleToggleCurrentDomain}
            className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors cursor-pointer shrink-0 ${
              isCurrentDomainDisabled
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-500 hover:bg-amber-500/20'
                : 'bg-[var(--color-paper)] border-[var(--color-dust)] border-opacity-40 text-[var(--color-dust)] hover:text-red-500 hover:border-red-400'
            }`}
            title={isCurrentDomainDisabled ? `Re-enable Kites on ${currentDomain}` : `Disable Kites on ${currentDomain}`}
          >
            {isCurrentDomainDisabled ? 'Disabled · Enable' : 'Disable on site'}
          </button>
        </div>
      )}

      {/* Main Content Area (Dims when disabled) */}
      <div className={`flex-1 flex flex-col transition-opacity duration-300 ${(!state.isExtensionEnabled || isCurrentDomainDisabled) ? 'opacity-40 pointer-events-none grayscale' : ''}`}>
        <div className="flex-1 flex flex-col px-3.5 pb-3.5">
          {activeTab === 'home' ? (
            <div className="flex flex-col gap-3">
              <EngineDropdown state={state} updateState={updateState} />

              <div className="flex flex-col gap-2 pt-2 border-t border-[var(--color-dust)] border-opacity-30">
                <button
                  onClick={async () => {
                    try {
                      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                      if (tab?.id) {
                        await chrome.tabs.sendMessage(tab.id, { type: 'START_AREA_SELECTION' });
                        window.close();
                      }
                    } catch (err) {
                      console.warn('[Popup] Failed to start area selection on active tab:', err);
                    }
                  }}
                  className="w-full py-2 bg-[var(--color-vellum)] text-[var(--color-ink)] border border-[var(--color-dust)] border-opacity-30 font-semibold rounded hover:border-[var(--color-editorial)] hover:text-[var(--color-editorial)] transition-colors flex items-center justify-center gap-2 cursor-pointer text-sm"
                  title="Drag a rectangle across any on-screen manga panel, canvas, or video to translate it"
                >
                  <Crop size={16} />
                  Crop & Translate Area
                </button>
              </div>
            </div>
          ) : activeTab === 'batch' ? (
            <BatchScanPanel />
          ) : (
            <SettingsView state={state} updateState={updateState} />
          )}
        </div>

        {/* Footer Action: ONLY Open Edit Studio lives through all panels */}
        <div className="px-3.5 pb-3.5 flex flex-col gap-2">
          <button 
            onClick={() => {
              chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
            }}
            className="w-full py-2.5 bg-[var(--color-ink)] text-[var(--color-paper)] font-bold rounded hover:bg-[var(--color-editorial)] transition-colors flex items-center justify-center gap-2 cursor-pointer"
            title="Open manga editing studio in a new tab"
          >
            Open Edit Studio <span className="opacity-70">↗</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const container = document.getElementById('root')!;
let root = (container as any)._reactRoot;
if (!root) {
  root = createRoot(container);
  (container as any)._reactRoot = root;
}

root.render(
  <StrictMode>
    <PopupApp />
  </StrictMode>
);
