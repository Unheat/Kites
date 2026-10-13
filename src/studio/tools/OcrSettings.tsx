import React from 'react';
import { ScanText, Circle, Square } from 'lucide-react';
import { studioStore, useStudioStore } from '../state/studioStore';

export const OcrSettings: React.FC = () => {
  const ocr = useStudioStore((s) => s.ocrSettings);

  const update = (partial: Partial<typeof ocr>) => {
    studioStore.setState({
      ocrSettings: { ...ocr, ...partial },
    });
  };

  return (
    <div className="space-y-4 text-xs text-slate-200">
      <div className="pb-2 border-b border-[#282d3f]">
        <div className="flex items-center gap-2">
          <ScanText className="w-4 h-4 text-[#f4446d]" />
          <h3 className="font-semibold text-sm text-slate-100">Live AI Re-OCR Area</h3>
        </div>
        <p className="text-[11px] text-slate-400 mt-1">
          Brush or box over missed dialogue or SFX. Recognizes text via PaddleOCR v6, translates it, cleans background with LaMa, and spawns an editable text box.
        </p>
      </div>

      <div>
        <label className="block text-slate-400 font-medium mb-1.5">Brush Shape</label>
        <div className="flex gap-2">
          <button
            onClick={() => update({ shape: 'circle' })}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border transition ${
              ocr.shape === 'circle'
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
              ocr.shape === 'square'
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
          <span className="font-mono text-slate-200">{ocr.size}px</span>
        </div>
        <input
          type="range"
          min="10"
          max="300"
          value={ocr.size}
          onChange={(e) => update({ size: Number(e.target.value) })}
          className="w-full accent-[#f4446d]"
        />
      </div>

      <div className="p-3 rounded-lg bg-[#f4446d]/10 border border-[#f4446d]/30 text-[11px] text-[#f4446d] leading-relaxed">
        ⚡ <strong>Auto-Typeset Pop-up:</strong> The recognized translation is automatically fitted and centered directly over your selected bubble coordinates.
      </div>
    </div>
  );
};
