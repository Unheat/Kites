import React from 'react';
import { Pipette, Image as ImageIcon } from 'lucide-react';
import { studioStore, useStudioStore } from '../state/studioStore';
import type { PaintSourceMode } from '../types';

export const PaintSettings: React.FC = () => {
  const paint = useStudioStore((s) => s.paintSettings);

  const update = (partial: Partial<typeof paint>) => {
    studioStore.setState({
      paintSettings: { ...paint, ...partial },
    });
  };

  const handleEyeDropper = async () => {
    if ('EyeDropper' in window) {
      try {
        const eyeDropper = new (window as any).EyeDropper();
        const result = await eyeDropper.open();
        if (result?.sRGBHex) {
          update({ color: result.sRGBHex });
        }
      } catch {
        // User canceled eye dropper
      }
    }
  };

  const handlePatternUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      update({ patternUrl: url });
    }
  };

  return (
    <div className="space-y-4 p-4 text-xs text-slate-200">
      <div className="pb-2 border-b border-[#282d3f]">
        <h3 className="font-semibold text-sm text-slate-100">Freehand Paint Brush</h3>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Paint solid color, screentone patterns, Gaussian blur, or punch transparency.
        </p>
      </div>

      {/* Paint Mode */}
      <div>
        <label className="block text-slate-400 font-medium mb-1.5">Paint Mode</label>
        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-[#090a0f] border border-[#282d3f]">
          {(['color', 'pattern', 'blur', 'transparency'] as PaintSourceMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => update({ mode })}
              className={`py-1.5 px-2 rounded-md font-medium capitalize transition ${
                paint.mode === mode
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Color Mode Options */}
      {paint.mode === 'color' && (
        <div>
          <label className="block text-slate-400 font-medium mb-1.5">Stroke Color</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={paint.color}
              onChange={(e) => update({ color: e.target.value })}
              className="w-8 h-8 rounded border border-[#282d3f] bg-transparent cursor-pointer"
            />
            <input
              type="text"
              value={paint.color}
              onChange={(e) => update({ color: e.target.value })}
              className="flex-1 rounded-lg border border-[#282d3f] bg-[#090a0f] px-2.5 py-1.5 font-mono text-slate-200"
            />
            {'EyeDropper' in window && (
              <button
                onClick={handleEyeDropper}
                title="Eyedropper Color Picker"
                className="p-2 rounded-lg border border-[#282d3f] bg-[#1c1f2e] text-slate-300 hover:text-white"
              >
                <Pipette className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Pattern Mode Options */}
      {paint.mode === 'pattern' && (
        <div className="space-y-3">
          <label className="block text-slate-400 font-medium mb-1.5">Pattern Image</label>
          <label className="flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-[#282d3f] bg-[#090a0f] cursor-pointer hover:border-indigo-500 transition">
            <ImageIcon className="w-4 h-4 text-indigo-400" />
            <span className="text-slate-300">{paint.patternUrl ? 'Change Pattern' : 'Upload Pattern Image'}</span>
            <input type="file" accept="image/*" onChange={handlePatternUpload} className="hidden" />
          </label>
          {paint.patternUrl && (
            <div>
              <div className="flex justify-between text-slate-400 mb-1">
                <span>Pattern Scale</span>
                <span className="font-mono text-slate-200">{paint.patternScale.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="3.0"
                step="0.1"
                value={paint.patternScale}
                onChange={(e) => update({ patternScale: Number(e.target.value) })}
                className="w-full accent-indigo-500"
              />
            </div>
          )}
        </div>
      )}

      {/* Blur Mode Options */}
      {paint.mode === 'blur' && (
        <div>
          <div className="flex justify-between text-slate-400 mb-1">
            <span>Blur Strength</span>
            <span className="font-mono text-slate-200">{paint.blurRadius}px</span>
          </div>
          <input
            type="range"
            min="1"
            max="30"
            value={paint.blurRadius}
            onChange={(e) => update({ blurRadius: Number(e.target.value) })}
            className="w-full accent-indigo-500"
          />
        </div>
      )}

      {/* Brush Size */}
      <div>
        <div className="flex justify-between text-slate-400 mb-1">
          <span>Brush Size</span>
          <span className="font-mono text-slate-200">{paint.size}px</span>
        </div>
        <input
          type="range"
          min="5"
          max="300"
          value={paint.size}
          onChange={(e) => update({ size: Number(e.target.value) })}
          className="w-full accent-indigo-500"
        />
      </div>

      {/* Brush Feather */}
      <div>
        <div className="flex justify-between text-slate-400 mb-1">
          <span>Feather Edge</span>
          <span className="font-mono text-slate-200">{paint.feather}px</span>
        </div>
        <input
          type="range"
          min="0"
          max="80"
          value={paint.feather}
          onChange={(e) => update({ feather: Number(e.target.value) })}
          className="w-full accent-indigo-500"
        />
      </div>
    </div>
  );
};
