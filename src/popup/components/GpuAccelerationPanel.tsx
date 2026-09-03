import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import type { PopupState } from '../../shared/types';
import { ModelRegistry } from '../services/ModelRegistry';
import type { Engine } from './EngineSelectionPanel';

interface GpuAccelerationPanelProps {
  state: PopupState;
  updateState: (updates: Partial<PopupState>) => void;
}

const INPAINT_VRAM_MAP: Record<string, string> = {
  none: 'None • 0 MB',
  simple: 'Simple Fill • 0 MB',
  telea: 'Telea Diffusion • 0 MB',
  aotgan: 'AOT-GAN • ~50 MB',
  'lama-base': 'LaMa Base • ~200 MB',
  'lama-manga': 'LaMa Manga • ~200 MB',
};

export default function GpuAccelerationPanel({ state, updateState }: GpuAccelerationPanelProps) {
  const [showWebGpuConfig, setShowWebGpuConfig] = useState(false);
  const [engines, setEngines] = useState<Engine[]>([]);

  useEffect(() => {
    ModelRegistry.getAvailableEngines().then(setEngines);
  }, []);

  const activeEngine = engines.find(e => e.id === state.activeEngineId);
  const translationVramText = activeEngine 
    ? `${activeEngine.name} • ${activeEngine.vramEstimate || '0 MB'}` 
    : 'Google Translate • 0 MB';
  const inpaintVramText = INPAINT_VRAM_MAP[state.activeInpaintId] || 'Inpaint Engine • ~50 MB';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 mb-1 relative">
        <span className="font-medium text-sm">GPU Acceleration</span>
        <div className="peer w-4 h-4 rounded-full border border-[var(--color-dust)] flex items-center justify-center text-[10px] text-[var(--color-dust)] cursor-help hover:bg-[var(--color-dust)] hover:text-[var(--color-paper)] transition-colors">?</div>
        
        <div className="absolute left-0 top-full pt-1.5 w-[260px] max-w-[85vw] z-50 opacity-0 pointer-events-none peer-hover:opacity-100 transition-opacity">
          <div className="p-2.5 bg-[var(--color-ink)] text-[var(--color-paper)] text-xs rounded-md shadow-xl">
            Run models locally on your graphics card for maximum speed. Turn off specific pipelines below if memory is limited.
          </div>
        </div>
      </div>

      <div className="relative">
        {/* Master Switch Box */}
        <div 
          onClick={() => {
            if (state.webgpuSupported === true && state.webgpuMaster) {
              setShowWebGpuConfig(!showWebGpuConfig);
            }
          }}
          className={`w-full flex items-center justify-between p-2.5 bg-[var(--color-paper)] border-2 transition-colors ${
            state.webgpuSupported === true && state.webgpuMaster 
              ? 'border-[var(--color-dust)] cursor-pointer hover:border-[var(--color-editorial)]' 
              : 'border-[var(--color-dust)] border-opacity-50'
          } rounded-lg shadow-sm`}
        >
          <div className="flex items-center gap-2">
            <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium flex items-center justify-center ${
              state.webgpuSupported === true ? 'bg-green-500/10 text-green-500 border border-green-500/30' : 
              state.webgpuSupported === false ? 'bg-red-500/10 text-red-500 border border-red-500/30' : 
              'bg-gray-500/10 text-gray-400 border border-gray-500/30'
            }`}>
              {state.webgpuSupported === true ? 'Supported✓' : 
               state.webgpuSupported === false ? 'Unsupported✗' :
               '...'}
            </span>
            
            {state.webgpuSupported !== null && (
              <button 
                onClick={async (e) => {
                  e.stopPropagation();
                  const { checkWebGPUAvailability } = await import('../../offscreen/utils/hardware');
                  updateState({ webgpuSupported: null });
                  const supported = await checkWebGPUAvailability();
                  updateState({ webgpuSupported: supported });
                }}
                className="px-2 py-0.5 border border-[var(--color-dust)] hover:border-[var(--color-ink)] text-[10px] text-[var(--color-dust)] hover:text-[var(--color-ink)] font-medium rounded transition-colors cursor-pointer"
              >
                Re-check
              </button>
            )}
          </div>

          <div className="flex items-center gap-4">
            {state.webgpuSupported === true && state.webgpuMaster && (
              <ChevronDown size={18} className={`text-[var(--color-ink)] transition-transform duration-200 ${showWebGpuConfig ? 'rotate-180' : ''}`} />
            )}
            
            <div onClick={(e) => e.stopPropagation()}>
              <button 
                onClick={() => {
                  if (state.webgpuSupported === true) {
                    const nextMaster = !state.webgpuMaster;
                    updateState({ webgpuMaster: nextMaster });
                    setShowWebGpuConfig(nextMaster);
                  }
                }}
                disabled={state.webgpuSupported !== true}
                className="kites-switch kites-switch-md"
                data-state={state.webgpuMaster && state.webgpuSupported === true ? 'checked' : 'unchecked'}
                data-disabled={state.webgpuSupported !== true ? 'true' : 'false'}
              >
                <span className="sr-only">Toggle WebGPU Master</span>
                <span className="kites-switch-thumb" />
              </button>
            </div>
          </div>
        </div>

        {/* Granular Child Toggles */}
        {showWebGpuConfig && state.webgpuSupported === true && state.webgpuMaster && (
          <div className="mt-2 bg-[var(--color-vellum)] border border-[var(--color-dust)] border-opacity-40 rounded-lg overflow-hidden flex flex-col p-1.5 gap-1 shadow-inner animate-in fade-in duration-200">
            
            <div className="flex items-center justify-between p-2.5 rounded-md hover:bg-[var(--color-paper)] transition-colors">
              <div className="flex flex-col text-left">
                <span className="font-medium text-sm text-[var(--color-ink)]">Translation</span>
                <span className="text-[10px] text-[var(--color-dust)] font-medium truncate max-w-[180px]">
                  {translationVramText}
                </span>
              </div>
              <button 
                onClick={() => updateState({ webgpuOverrides: { ...state.webgpuOverrides, llm: !(state.webgpuOverrides?.llm !== false) }})}
                className="kites-switch kites-switch-sm"
                data-state={state.webgpuOverrides?.llm !== false ? 'checked' : 'unchecked'}
              >
                <span className="kites-switch-thumb" />
              </button>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-md hover:bg-[var(--color-paper)] transition-colors">
              <div className="flex flex-col text-left">
                <span className="font-medium text-sm text-[var(--color-ink)]">Image Cleaning</span>
                <span className="text-[10px] text-[var(--color-dust)] font-medium truncate max-w-[180px]">
                  {inpaintVramText}
                </span>
              </div>
              <button 
                onClick={() => updateState({ webgpuOverrides: { ...state.webgpuOverrides, inpaint: !(state.webgpuOverrides?.inpaint !== false) }})}
                className="kites-switch kites-switch-sm"
                data-state={state.webgpuOverrides?.inpaint !== false ? 'checked' : 'unchecked'}
              >
                <span className="kites-switch-thumb" />
              </button>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-md hover:bg-[var(--color-paper)] transition-colors">
              <div className="flex flex-col text-left">
                <span className="font-medium text-sm text-[var(--color-ink)]">Text Detection</span>
                <span className="text-[10px] text-[var(--color-dust)] font-medium truncate max-w-[180px]">
                  PaddleOCR • ~30 MB
                </span>
              </div>
              <button 
                onClick={() => updateState({ webgpuOverrides: { ...state.webgpuOverrides, ocr: !(state.webgpuOverrides?.ocr !== false) }})}
                className="kites-switch kites-switch-sm"
                data-state={state.webgpuOverrides?.ocr !== false ? 'checked' : 'unchecked'}
              >
                <span className="kites-switch-thumb" />
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
