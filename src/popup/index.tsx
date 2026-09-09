import { StrictMode, useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css'; 

import EngineDropdown from './components/EngineDropdown';
import SettingsView from './components/SettingsView';

import { Settings, Home, Power, Crop } from 'lucide-react';

import type { PopupState } from '../shared/types';
import { DEFAULT_POPUP_STATE } from '../shared/types';

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
  const [activeTab, setActiveTab] = useState<'home' | 'settings'>('home');
  const [isLoaded, setIsLoaded] = useState(false);
  const [state, setState] = useState<PopupState>(DEFAULT_POPUP_STATE);
  const storageWriteQueue = useRef<Promise<void>>(Promise.resolve());

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

      // WORKAROUND: Probe through offscreen after hydration. Popup WebGPU capability can
      // differ from the inference document, and the stale persisted result must not win
      // this race or LaMa will silently run on WASM. See devlog 015.
      chrome.runtime.sendMessage({ type: 'CHECK_WEBGPU_SUPPORT', target: 'background', source: 'popup', request: true }, (response) => {
        if (!isMounted) return;
        if (chrome.runtime.lastError || response?.status !== 'success') {
          console.warn('[Popup] WebGPU support check failed:', chrome.runtime.lastError?.message || response?.error);
          return;
        }
        setState(prev => ({ ...prev, webgpuSupported: response.supported === true }));
      });
    });

    // Listen to changes in chrome.storage.local to reactively reflect quota/state updates
    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local' && changes.popupState?.newValue) {
        setState(completePopupState(changes.popupState.newValue as Partial<PopupState>));
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

  // Apply dark mode to HTML tag
  useEffect(() => {
    if (state.isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
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
      storageWriteQueue.current = storageWriteQueue.current
        .catch(() => undefined)
        .then(async () => {
          await chrome.storage.local.set({ popupState: newState });
        })
        .catch((error) => {
          console.error('[Popup] Failed to persist popup state:', error);
        });
      return newState;
    });
  };

  if (!isLoaded) return null;

  return (
    <div className="flex flex-col bg-[var(--color-paper)] text-[var(--color-ink)] font-body relative" style={{ width: '320px' }}>
      
      {/* Header */}
      <div className="flex justify-between items-center mb-2.5 p-3.5 pb-0">
        <h1 className="text-xl font-bold font-display tracking-tight text-[var(--color-editorial)] flex items-center gap-2">
          Kites
          {!state.isExtensionEnabled && <span className="text-xs font-normal text-[var(--color-dust)] px-2 py-0.5 border border-[var(--color-dust)] rounded-full">OFF</span>}
        </h1>
        <div className="flex gap-2 items-center">
          <button 
            onClick={() => updateState({ isExtensionEnabled: !state.isExtensionEnabled })}
            className={`p-1.5 rounded transition-colors hover:bg-[var(--color-vellum)] cursor-pointer`}
            title={state.isExtensionEnabled ? "Disable Kites" : "Enable Kites"}
          >
            <Power size={18} className={state.isExtensionEnabled ? "text-[var(--color-editorial)]" : "text-[var(--color-dust)]"} />
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
            onClick={() => setActiveTab('settings')}
            className={`p-1.5 rounded transition-colors cursor-pointer ${activeTab === 'settings' ? 'bg-[var(--color-vellum)]' : 'hover:bg-[var(--color-vellum)]'}`}
            title="Settings"
          >
            <Settings size={18} className="text-[var(--color-ink)]" />
          </button>
        </div>
      </div>

      {/* Main Content Area (Dims when disabled) */}
      <div className={`flex-1 flex flex-col transition-opacity duration-300 ${!state.isExtensionEnabled ? 'opacity-40 pointer-events-none grayscale' : ''}`}>
        <div className="flex-1 flex flex-col px-3.5 pb-3.5">
          {activeTab === 'home' ? (
            <EngineDropdown state={state} updateState={updateState} />
          ) : (
            <SettingsView state={state} updateState={updateState} />
          )}
        </div>

        {/* Footer Action */}
        <div className="px-3.5 pb-3.5 flex flex-col gap-2">
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

          <button 
            onClick={() => {
              chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
            }}
            className="w-full py-2.5 bg-[var(--color-ink)] text-[var(--color-paper)] font-bold rounded hover:bg-[var(--color-editorial)] transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            Open Dashboard <span className="opacity-70">↗</span>
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
