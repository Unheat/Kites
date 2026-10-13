import React from 'react';
import { ScanText, Circle, Square } from 'lucide-react';
import { studioStore, useStudioStore } from '../state/studioStore';
import { StudioEngineSelector } from './StudioEngineSelector';

export const OcrSettings: React.FC = () => {
  const ocr = useStudioStore((s) => s.ocrSettings);

  /** Updates session-local OCR steps and brush settings without changing extension defaults.
   * @param partial - Fields changed by the user.
   * @returns Nothing.
   */
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
          Brush over dialogue or SFX to read the original image, even where the editor background is already cleaned. Choose which steps run after recognition.
        </p>
      </div>

      {/* Selectable OCR Recognition Tier */}
      <StudioEngineSelector category="ocr" />

      {/* 3-Way Scan Source Selector */}
      <div>
        <label className="block text-slate-400 font-medium mb-1.5">OCR Scan Source</label>
        <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-[#090a0f] border border-[#282d3f]">
          <button
            type="button"
            onClick={() => update({ scanSource: 'original' })}
            className={`py-1 px-1 rounded text-center text-[10px] font-medium transition cursor-pointer ${
              ocr.scanSource === 'original'
                ? 'bg-[#f4446d] text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Scan original raw artwork (untranslated Japanese/foreign text)"
          >
            Original
          </button>
          <button
            type="button"
            onClick={() => update({ scanSource: 'background' })}
            className={`py-1 px-1 rounded text-center text-[10px] font-medium transition cursor-pointer ${
              ocr.scanSource === 'background'
                ? 'bg-[#f4446d] text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Scan inpainted/cleaned background canvas"
          >
            Inpainted BG
          </button>
          <button
            type="button"
            onClick={() => update({ scanSource: 'composition' })}
            className={`py-1 px-1 rounded text-center text-[10px] font-medium transition cursor-pointer ${
              ocr.scanSource === 'composition'
                ? 'bg-[#f4446d] text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Scan translated composite image (background + rendered text)"
          >
            Translated
          </button>
        </div>
        <p className="text-[10px] text-slate-500 mt-1">
          {ocr.scanSource === 'original'
            ? 'Scans untouched original artwork to detect original dialogue/SFX.'
            : ocr.scanSource === 'background'
            ? 'Scans cleaned background canvas (may have text already erased).'
            : 'Scans the composite page including translated text overlay.'}
        </p>
      </div>

      <fieldset className="space-y-2 rounded-lg border border-[#282d3f] p-3">
        <legend className="px-1 text-slate-400 font-medium">After recognition</legend>
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span>Translate recognized text</span>
          <input type="checkbox" checked={ocr.translate}
            onChange={(event) => update({ translate: event.target.checked })}
            className="accent-[#f4446d]" />
        </label>
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span>Clean background</span>
          <input type="checkbox" checked={ocr.inpaint}
            onChange={(event) => update({ inpaint: event.target.checked })}
            className="accent-[#f4446d]" />
        </label>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          {!ocr.translate && !ocr.inpaint
            ? 'OCR only: adds editable source text. No translation request or background changes.'
            : `${ocr.translate ? 'Adds translated text' : 'Adds source text'}${ocr.inpaint ? ' and cleans detected lettering using the selected inpaint tier.' : '. The background stays unchanged.'}`}
        </p>
        <p className="text-[10px] text-slate-500">These steps apply only in Studio, independently of Global Sync.</p>
      </fieldset>

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
        Recognized text is added as editable boxes over its detected position. With translation off, the boxes contain the original source text.
      </div>
    </div>
  );
};
