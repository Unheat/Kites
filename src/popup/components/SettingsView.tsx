import { useState } from 'react';

export default function SettingsView() {
  const [isAuto, setIsAuto] = useState(false);
  const [manualMode, setManualMode] = useState<'hover' | 'scrape'>('hover');
  const [concurrency, setConcurrency] = useState(3);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-[var(--color-dust)]">Preferences</h2>
      </div>

      {/* Translation Mode Toggle */}
      <div className="flex items-center justify-between p-3 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md">
        <div>
          <span className="font-medium block text-sm">Translation Mode</span>
          <span className="text-xs text-[var(--color-dust)]">{isAuto ? 'Auto-translates visible images' : 'Requires manual activation'}</span>
        </div>
        <button 
          onClick={() => setIsAuto(!isAuto)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none cursor-pointer ${
            isAuto ? 'bg-[var(--color-editorial)]' : 'bg-[var(--color-dust)]'
          }`}
        >
          <span className="sr-only">Toggle translation mode</span>
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-[var(--color-paper)] transition-transform ${
              isAuto ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Manual Selection Method (Disabled if Auto is true) */}
      <div className={`transition-opacity ${isAuto ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
        <span className="font-medium block text-sm mb-2">Manual Selection Method</span>
        <div className="flex p-1 bg-[var(--color-vellum)] border border-[var(--color-dust)] rounded-md">
          <button
            onClick={() => setManualMode('hover')}
            className={`flex-1 py-1.5 text-sm font-medium rounded-sm transition-colors cursor-pointer ${
              manualMode === 'hover' ? 'bg-[var(--color-paper)] text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-dust)] hover:text-[var(--color-ink)]'
            }`}
          >
            Hover
          </button>
          <button
            onClick={() => setManualMode('scrape')}
            className={`flex-1 py-1.5 text-sm font-medium rounded-sm transition-colors cursor-pointer ${
              manualMode === 'scrape' ? 'bg-[var(--color-paper)] text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-dust)] hover:text-[var(--color-ink)]'
            }`}
          >
            Scrape
          </button>
        </div>
        <p className="text-xs text-[var(--color-dust)] mt-2">
          {manualMode === 'hover' ? 'Button appears only when mouse hovers over an image.' : 'Persistent buttons injected above every image.'}
        </p>
      </div>

      {/* Concurrency Slider */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <span className="font-medium text-sm">Max Concurrent Translations</span>
          <span className="text-sm font-bold text-[var(--color-editorial)]">{concurrency}</span>
        </div>
        <input 
          type="range" 
          min="1" 
          max="10" 
          value={concurrency}
          onChange={(e) => setConcurrency(parseInt(e.target.value))}
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
