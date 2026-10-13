import React from 'react';
import { Palette, RotateCcw, X } from 'lucide-react';
import { studioStore, useStudioStore } from '../state/studioStore';
import type { EditorAppearanceSettings } from '../types';

export interface AppearanceSettingsModalProps {
  onClose: () => void;
}

const DEFAULT_APPEARANCE: EditorAppearanceSettings = {
  selectedBoxBorderColor: '#f4446d',
  unselectedBoxBorderColor: 'rgba(255, 255, 255, 0.35)',
  caretColor: '#f4446d',
  brushCursorColor: 'rgba(244, 68, 109, 0.85)',
};

export const AppearanceSettingsModal: React.FC<AppearanceSettingsModalProps> = ({ onClose }) => {
  const appearance = useStudioStore((s) => s.appearance);

  const updateSetting = (key: keyof EditorAppearanceSettings, value: string) => {
    studioStore.setState({
      appearance: {
        ...appearance,
        [key]: value,
      },
    });
  };

  const handleReset = () => {
    studioStore.setState({ appearance: DEFAULT_APPEARANCE });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-sm rounded-xl border border-[#282d3f] bg-[#12141c] p-5 shadow-2xl text-slate-100 flex flex-col">
        <div className="flex items-center justify-between pb-3 border-b border-[#282d3f]">
          <div className="flex items-center gap-2 font-medium text-sm text-slate-200">
            <Palette className="w-4 h-4 text-[#f4446d]" />
            Editor Appearance
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-[#1c1f2e] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3.5 text-xs">
          <div className="flex items-center justify-between p-2 rounded-lg bg-[#090a0f] border border-[#282d3f]">
            <span className="text-slate-300">Selected Box Border</span>
            <input
              type="color"
              value={appearance.selectedBoxBorderColor}
              onChange={(e) => updateSetting('selectedBoxBorderColor', e.target.value)}
              className="w-7 h-7 rounded border border-[#282d3f] bg-transparent cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between p-2 rounded-lg bg-[#090a0f] border border-[#282d3f]">
            <span className="text-slate-300">Unselected Box Border</span>
            <input
              type="color"
              value={appearance.unselectedBoxBorderColor.startsWith('#') ? appearance.unselectedBoxBorderColor : '#888888'}
              onChange={(e) => updateSetting('unselectedBoxBorderColor', e.target.value)}
              className="w-7 h-7 rounded border border-[#282d3f] bg-transparent cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between p-2 rounded-lg bg-[#090a0f] border border-[#282d3f]">
            <span className="text-slate-300">Text Caret Color</span>
            <input
              type="color"
              value={appearance.caretColor}
              onChange={(e) => updateSetting('caretColor', e.target.value)}
              className="w-7 h-7 rounded border border-[#282d3f] bg-transparent cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between p-2 rounded-lg bg-[#090a0f] border border-[#282d3f]">
            <span className="text-slate-300">Brush Cursor Footprint</span>
            <input
              type="color"
              value={appearance.brushCursorColor.startsWith('#') ? appearance.brushCursorColor : '#f4446d'}
              onChange={(e) => updateSetting('brushCursorColor', e.target.value)}
              className="w-7 h-7 rounded border border-[#282d3f] bg-transparent cursor-pointer"
            />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between pt-3 border-t border-[#282d3f]">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-[#1c1f2e] transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#f4446d] text-white hover:bg-[#e0355e] transition shadow-sm"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
