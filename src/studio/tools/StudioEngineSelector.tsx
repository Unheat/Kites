import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check, Download, Globe, Lock } from 'lucide-react';
import { studioStore, useStudioStore } from '../state/studioStore';
import { INPAINT_TIER_CATALOG } from '../../shared/inpaintTiers';

export interface EngineOption {
  id: string;
  name: string;
  tag: string;
  isModel?: boolean;
  sizeEstimate?: string;
}

export const INPAINT_ENGINE_OPTIONS: EngineOption[] = INPAINT_TIER_CATALOG as EngineOption[];

export const OCR_ENGINE_OPTIONS: EngineOption[] = [
  { id: 'v6-small', name: 'PaddleOCR v6 Small (Default)', tag: 'Recommended', isModel: true, sizeEstimate: '~4 MB' },
  { id: 'v6-medium', name: 'PaddleOCR v6 Medium', tag: 'Higher Accuracy', isModel: true, sizeEstimate: '~8 MB' },
  { id: 'v6-tiny', name: 'PaddleOCR v6 Tiny', tag: 'Ultra Fast', isModel: true, sizeEstimate: '~2 MB' },
  { id: 'v5-mobile', name: 'PaddleOCR v5 Mobile', tag: 'Legacy v5', isModel: true, sizeEstimate: '~4 MB' },
  { id: 'v5-server', name: 'PaddleOCR v5 Server', tag: 'Server Grade', isModel: true, sizeEstimate: '~20 MB' },
  { id: 'v5-en-mobile', name: 'PaddleOCR v5 English Mobile', tag: 'English Tuned', isModel: true, sizeEstimate: '~4 MB' },
  { id: 'v4-mobile', name: 'PaddleOCR v4 Mobile', tag: 'Legacy v4', isModel: true, sizeEstimate: '~4 MB' },
  { id: 'v4-server', name: 'PaddleOCR v4 Server', tag: 'v4 Server', isModel: true, sizeEstimate: '~20 MB' },
  { id: 'v3-mobile', name: 'PaddleOCR v3 Mobile', tag: 'Legacy v3', isModel: true, sizeEstimate: '~4 MB' },
  { id: 'v3-japanese-mobile', name: 'PaddleOCR v3 Japanese Mobile', tag: 'Japanese Tuned', isModel: true, sizeEstimate: '~4 MB' },
];

interface StudioEngineSelectorProps {
  category: 'inpaint' | 'ocr';
}

export const StudioEngineSelector: React.FC<StudioEngineSelectorProps> = ({ category }) => {
  const syncWithGlobal = useStudioStore((s) => s.syncWithGlobal);
  const selectedInpaint = useStudioStore((s) => s.selectedInpaintEngineId);
  const selectedOcr = useStudioStore((s) => s.selectedOcrEngineId);
  const downloadedIds = useStudioStore((s) => s.downloadedModelIds);
  const downloads = useStudioStore((s) => s.modelDownloads);

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const options = category === 'inpaint' ? INPAINT_ENGINE_OPTIONS : OCR_ENGINE_OPTIONS;
  const currentEngineId = category === 'inpaint' ? selectedInpaint : selectedOcr;
  const activeOption = options.find((o) => o.id === currentEngineId) || options[0];

  // Hydrate initial download statuses from background
  useEffect(() => {
    studioStore.hydrateFromStorage();

    const modelIds = options.filter((o) => o.isModel).map((o) => o.id);
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        {
          type: 'GET_MODEL_STATUSES',
          target: 'background',
          source: 'studio',
          request: true,
          payload: { modelIds },
        },
        (res) => {
          if (res?.status === 'success' && res.statuses) {
            const readyIds = Object.entries(res.statuses)
              .filter(([_, ready]) => ready)
              .map(([id]) => id);

            studioStore.setState((prev) => ({
              downloadedModelIds: Array.from(new Set([...prev.downloadedModelIds, ...readyIds])),
              modelDownloads: { ...prev.modelDownloads, ...(res.downloads || {}) },
            }));
          }
        }
      );
    }

    const handleMessage = (msg: any) => {
      if (msg?.type === 'MODEL_DOWNLOAD_PROGRESS' && msg.payload) {
        const { modelId, progress, status } = msg.payload;
        studioStore.setState((prev) => ({
          modelDownloads: {
            ...prev.modelDownloads,
            [modelId]: { progress, status },
          },
          downloadedModelIds:
            progress >= 1 || status === 'ready'
              ? Array.from(new Set([...prev.downloadedModelIds, modelId]))
              : prev.downloadedModelIds,
        }));
      }
    };

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(handleMessage);
      return () => chrome.runtime.onMessage.removeListener(handleMessage);
    }
  }, [options]);

  // Dismiss on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const triggerDownload = (e: React.MouseEvent, modelId: string) => {
    e.stopPropagation();
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'START_MODEL_DOWNLOAD',
        target: 'background',
        source: 'studio',
        request: true,
        payload: { modelId, category },
      });
      studioStore.setState((prev) => ({
        modelDownloads: {
          ...prev.modelDownloads,
          [modelId]: { progress: 0.05, status: 'Downloading...' },
        },
      }));
    }
  };

  const selectEngine = (engineId: string) => {
    studioStore.setEngineSelection(category, engineId);
    setIsOpen(false);
  };

  return (
    <div className="space-y-2 select-none" ref={dropdownRef}>
      {/* Header with Global Sync Switch */}
      <div className="flex items-center justify-between text-[11px]">
        <label className="text-slate-400 font-medium">
          {category === 'inpaint' ? 'Inpaint Model Tier' : 'OCR Recognition Tier'}
        </label>
        <button
          type="button"
          onClick={() => studioStore.setState({ syncWithGlobal: !syncWithGlobal })}
          title={
            syncWithGlobal
              ? 'Global Sync ON: Changing engine updates extension popup & all web translations'
              : 'Local Mode: Changing engine only affects this Studio editing session'
          }
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition cursor-pointer ${
            syncWithGlobal
              ? 'bg-[#f4446d]/15 text-[#f4446d] border border-[#f4446d]/40'
              : 'bg-[#181a24] text-slate-400 border border-[#282d3f] hover:text-slate-200'
          }`}
        >
          {syncWithGlobal ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
          <span>{syncWithGlobal ? 'Global Sync' : 'Local Only'}</span>
        </button>
      </div>

      {/* Main Select Button */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#090a0f] border border-[#282d3f] hover:border-[#3b4259] text-xs text-slate-200 transition cursor-pointer text-left"
        >
          <div className="flex flex-col min-w-0 flex-1 pr-2">
            <span className="font-medium text-slate-100 text-xs truncate" title={activeOption.name}>
              {activeOption.name}
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1c2030] text-slate-400 border border-[#2c334d]">
                {activeOption.tag}
              </span>
            </div>
          </div>
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Dropdown Menu */}
        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl bg-[#12141c] border border-[#282d3f] shadow-2xl p-1.5 space-y-1.5 max-h-72 overflow-y-auto">
            {options.map((opt) => {
              const isSelected = opt.id === currentEngineId;
              const isDownloaded = !opt.isModel || downloadedIds.includes(opt.id);
              const downloadInfo = downloads[opt.id];
              const isDownloading = downloadInfo && downloadInfo.progress > 0 && downloadInfo.progress < 1;

              return (
                <div
                  key={opt.id}
                  onClick={() => {
                    if (isDownloaded) {
                      selectEngine(opt.id);
                    }
                  }}
                  className={`p-2 rounded-lg transition flex flex-col gap-1.5 ${
                    isSelected
                      ? 'bg-[#f4446d]/15 border border-[#f4446d]/40 text-slate-100'
                      : isDownloaded
                      ? 'hover:bg-[#1a1d29] text-slate-300 cursor-pointer'
                      : 'bg-[#0e1017] opacity-85 text-slate-400'
                  }`}
                >
                  {/* Row 1: Check icon + Model Name */}
                  <div className="flex items-center gap-2 min-w-0 w-full">
                    {isSelected ? (
                      <Check className="w-3.5 h-3.5 text-[#f4446d] shrink-0" />
                    ) : (
                      <div className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span className="font-medium text-xs text-slate-100 truncate flex-1" title={opt.name}>
                      {opt.name}
                    </span>
                  </div>

                  {/* Row 2: Tag on left, Download / Status on right */}
                  <div className="flex items-center justify-between gap-2 pl-5.5 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#161822] text-slate-400 border border-[#262a3a] whitespace-nowrap">
                        {opt.tag}
                      </span>
                    </div>

                    <div className="flex items-center shrink-0">
                      {!isDownloaded && opt.isModel ? (
                        <button
                          type="button"
                          disabled={Boolean(isDownloading)}
                          onClick={(e) => triggerDownload(e, opt.id)}
                          className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#f4446d] hover:bg-[#e0335c] text-white text-[10px] font-medium shadow transition cursor-pointer disabled:opacity-50"
                        >
                          <Download className="w-2.5 h-2.5" />
                          <span>{isDownloading ? 'Downloading...' : opt.sizeEstimate || 'Get'}</span>
                        </button>
                      ) : opt.isModel ? (
                        <span className="text-[10px] text-emerald-400 font-mono font-medium">Ready</span>
                      ) : null}
                    </div>
                  </div>

                  {/* Live Download Progress Bar */}
                  {isDownloading && (
                    <div className="mt-0.5 pl-5.5 space-y-0.5">
                      <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                        <span>{downloadInfo.status || 'Downloading weights...'}</span>
                        <span>{Math.round(downloadInfo.progress * 100)}%</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-[#1e2333] overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[#f4446d] to-[#ff6b8b] transition-all duration-200"
                          style={{ width: `${Math.round(downloadInfo.progress * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
