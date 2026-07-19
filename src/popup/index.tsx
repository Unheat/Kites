import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css'; 

import EngineDropdown from './components/EngineDropdown';
import SettingsView from './components/SettingsView';

import { Settings, Home, Power } from 'lucide-react';

export interface CustomApiConfig {
  id: string;
  provider: 'openai' | 'openai-compatible' | 'gemini' | 'claude';
  modelName: string;
  apiKey: string;
  baseUrl?: string; // Optional for openAI-compatible
}

export interface PopupState {
  isExtensionEnabled: boolean;
  isAuto: boolean;
  manualMode: 'hover' | 'persistent';
  concurrency: number;
  isDark: boolean;
  activeEngineId: string;
  activeInpaintId: string;
  fallbackChain: string[];
  customApis: CustomApiConfig[];
  webgpuSupported: boolean | null;
  webgpuMaster: boolean;
  webgpuOverrides: {
    llm: boolean;
    inpaint: boolean;
    ocr: boolean;
  };
}

function PopupApp() {
  const [activeTab, setActiveTab] = useState<'home' | 'settings'>('home');
  const [isLoaded, setIsLoaded] = useState(false);
  const [state, setState] = useState<PopupState>({
    isExtensionEnabled: true,
    isAuto: true,
    manualMode: 'hover',
    concurrency: 3,
    isDark: true,
    activeEngineId: 'nllb-200',
    activeInpaintId: 'lama-manga',
    fallbackChain: [],
    customApis: [],
    webgpuSupported: null,
    webgpuMaster: false,
    webgpuOverrides: { llm: true, inpaint: true, ocr: true }
  });

  useEffect(() => {
    // Also trigger hardware check on mount to ensure we have it if it's missing from storage
    import('../offscreen/utils/hardware').then(({ checkWebGPUAvailability }) => {
      checkWebGPUAvailability().then(supported => {
        setState(prev => ({ ...prev, webgpuSupported: supported }));
      });
    }).catch(err => {
      console.warn("Failed to load hardware util in popup", err);
    });
    chrome.storage.local.get(['popupState'], (result) => {
      if (result.popupState && typeof result.popupState === 'object') {
        setState(prev => ({ ...prev, ...(result.popupState as Partial<PopupState>) }));
      }
      setIsLoaded(true);
    });
  }, []);

  // Apply dark mode to HTML tag
  useEffect(() => {
    if (state.isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [state.isDark]);

  const updateState = (updates: Partial<PopupState>) => {
    setState(prev => {
      const newState = { ...prev, ...updates };
      chrome.storage.local.set({ popupState: newState });
      return newState;
    });
  };

  if (!isLoaded) return null;

  return (
    <div className="flex flex-col bg-[var(--color-paper)] text-[var(--color-ink)] font-body relative" style={{ width: '320px', minHeight: '350px' }}>
      
      {/* Header */}
      <div className="flex justify-between items-center mb-4 p-4 pb-0">
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
      <div className={`flex-1 flex flex-col transition-all duration-300 ${!state.isExtensionEnabled ? 'opacity-40 pointer-events-none grayscale' : ''}`}>
        <div className="flex-1 flex flex-col p-4 pt-0">
          {activeTab === 'home' ? (
            <EngineDropdown state={state} updateState={updateState} />
          ) : (
            <SettingsView state={state} updateState={updateState} />
          )}
        </div>

        {/* Footer Action */}
        <div className="p-4 pt-0">
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

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <PopupApp />
  </StrictMode>
);
