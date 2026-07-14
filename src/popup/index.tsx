import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css'; // Uses the user's Light Table tokens

// Components (to be implemented)
import EngineDropdown from './components/EngineDropdown';
import SettingsView from './components/SettingsView';

import { Settings, Home } from 'lucide-react';

function PopupApp() {
  const [activeTab, setActiveTab] = useState<'home' | 'settings'>('home');

  return (
    <div className="w-[320px] min-h-[400px] p-4 flex flex-col bg-[var(--color-paper)] text-[var(--color-ink)] border border-[var(--color-dust)] rounded-lg shadow-xl font-body relative overflow-hidden">
      
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-xl font-bold font-display tracking-tight text-[var(--color-editorial)]">Kites</h1>
        <div className="flex gap-2">
          <button 
            onClick={() => setActiveTab('home')}
            className={`p-1.5 rounded transition-colors ${activeTab === 'home' ? 'bg-[var(--color-vellum)]' : 'hover:bg-[var(--color-vellum)]'}`}
            title="Home"
          >
            <Home size={18} className="text-[var(--color-ink)]" />
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`p-1.5 rounded transition-colors ${activeTab === 'settings' ? 'bg-[var(--color-vellum)]' : 'hover:bg-[var(--color-vellum)]'}`}
            title="Settings"
          >
            <Settings size={18} className="text-[var(--color-ink)]" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {activeTab === 'home' ? (
          <EngineDropdown />
        ) : (
          <SettingsView />
        )}
      </div>

      {/* Footer Action */}
      <div className="mt-6 pt-4 border-t border-[var(--color-dust)]">
        <button 
          onClick={() => {
            // Open dashboard logic (placeholder for now)
            chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
          }}
          className="w-full py-2.5 bg-[var(--color-ink)] text-[var(--color-paper)] font-bold rounded hover:bg-[var(--color-editorial)] transition-colors flex items-center justify-center gap-2 cursor-pointer"
        >
          Open Dashboard <span className="opacity-70">↗</span>
        </button>
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
