import React from 'react';
import { Sparkles, Circle, Square } from 'lucide-react';
import { studioStore, useStudioStore } from '../state/studioStore';

export const InpaintSettings: React.FC = () => {
  const inpaint = useStudioStore((s) => s.inpaintSettings);

  const update = (partial: Partial<typeof inpaint>) => {
    studioStore.setState({
      inpaintSettings: { ...inpaint, ...partial },
    });
  };

  return (
    <div className="space-y-4 p-4 text-xs text-slate-200">
      <div className="pb-2 border-b border-[#282d3f]">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-400" />
          <h3 className="font-semibold text-sm text-slate-100">Live AI Inpaint Brush</h3>
        </div>
        <p className="text-[11px] text-slate-400 mt-1">
          Brush over bubbles or artifacts. On pointer release, crops tight 1:1 patch and runs local WebGPU LaMa inpainting with zero cloud cost.
        </p>
      </div>

      <div>
        <label className="block text-slate-400 font-medium mb-1.5">Brush Shape</label>
        <div className="flex gap-2">
          <button
            onClick={() => update({ shape: 'circle' })}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border transition ${
              inpaint.shape === 'circle'
                ? 'border-indigo-500 bg-indigo-950/30 text-indigo-300 font-medium'
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
                ? 'border-indigo-500 bg-indigo-950/30 text-indigo-300 font-medium'
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
          className="w-full accent-indigo-500"
        />
      </div>

      <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-900/40 text-[11px] text-indigo-300 leading-relaxed">
        ⚡ <strong>Privacy Guaranteed:</strong> Inpainting executes 100% inside your browser using WebGPU/WASM. No image crops leave your machine.
      </div>
    </div>
  );
};
