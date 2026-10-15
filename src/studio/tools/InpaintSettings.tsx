import React from 'react';
import { Sparkles, Circle, Square } from 'lucide-react';
import { studioStore, useStudioStore } from '../state/studioStore';
import { StudioEngineSelector } from './StudioEngineSelector';

export const InpaintSettings: React.FC = () => {
  const inpaint = useStudioStore((s) => s.inpaintSettings);

  const update = (partial: Partial<typeof inpaint>) => {
    studioStore.setState({
      inpaintSettings: { ...inpaint, ...partial },
    });
  };

  return (
    <div className="space-y-4 text-xs text-slate-200">
      <div className="pb-2 border-b border-[#282d3f]">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#f4446d]" />
          <h3 className="font-semibold text-sm text-slate-100">Live AI Inpaint Brush</h3>
        </div>
        <p className="text-[11px] text-slate-400 mt-1">
          Brush over bubbles or artifacts. On pointer release, crops tight 1:1 patch and runs local inpainting with zero cloud cost.
        </p>
      </div>

      {/* Selectable Inpaint Model Tier */}
      <StudioEngineSelector category="inpaint" />

      {/* 2-Way Inpaint Source Selector */}
      <div>
        <label className="block text-slate-400 font-medium mb-1.5">Inpaint Source</label>
        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-[#090a0f] border border-[#282d3f]">
          <button
            type="button"
            onClick={() => update({ source: 'background' })}
            className={`py-1.5 px-2 rounded-md font-medium text-center text-xs transition cursor-pointer ${
              inpaint.source === 'background'
                ? 'bg-[#f4446d] text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#1c1f2e]/50'
            }`}
            title="Inpaint current working background canvas to remove residual artifacts (Default)"
          >
            Inpainted BG
          </button>
          <button
            type="button"
            onClick={() => update({ source: 'original' })}
            className={`py-1.5 px-2 rounded-md font-medium text-center text-xs transition cursor-pointer ${
              inpaint.source === 'original'
                ? 'bg-[#f4446d] text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#1c1f2e]/50'
            }`}
            title="Inpaint untouched original artwork to cleanly erase original dialogue/SFX"
          >
            Original Artwork
          </button>
        </div>
        <p className="text-[10px] text-slate-500 mt-1">
          {inpaint.source === 'background'
            ? 'Crops current background canvas to retouch speech bubbles and artifacts.'
            : 'Crops untouched original artwork to cleanly erase original dialogue/SFX.'}
        </p>
      </div>

      <div>
        <label className="block text-slate-400 font-medium mb-1.5">Brush Shape</label>
        <div className="flex gap-2">
          <button
            onClick={() => update({ shape: 'circle' })}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border transition ${
              inpaint.shape === 'circle'
                ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d] font-medium'
                : 'border-[#282d3f] bg-[#090a0f] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Circle className="w-3.5 h-3.5" />
            Circle
          </button>
          <button
            onClick={() => update({ shape: 'square' })}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border transition ${
              inpaint.shape === 'square'
                ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d] font-medium'
                : 'border-[#282d3f] bg-[#090a0f] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Square className="w-3.5 h-3.5" />
            Square
          </button>
        </div>
      </div>

      <div>
        <div className="flex justify-between text-slate-400 mb-1">
          <span>Brush Size</span>
          <span className="font-mono text-slate-200">{inpaint.size}px</span>
        </div>
        <input
          type="range"
          min="10"
          max="300"
          value={inpaint.size}
          onChange={(e) => update({ size: Number(e.target.value) })}
          className="w-full accent-[#f4446d]"
        />
      </div>

      <div className="p-3 rounded-lg bg-[#f4446d]/10 border border-[#f4446d]/30 text-[11px] text-[#f4446d] leading-relaxed">
        ⚡ <strong>Privacy Guaranteed:</strong> Inpainting executes 100% inside your browser using WebGPU/WASM. No image crops leave your machine.
      </div>
    </div>
  );
};
