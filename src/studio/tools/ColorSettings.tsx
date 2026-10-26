import React from 'react';
import { Palette, CheckCircle2, CircleDashed, Loader2 } from 'lucide-react';
import { useStudioStore } from '../state/studioStore';
import { StudioEngineSelector } from './StudioEngineSelector';

export interface ColorSettingsProps {
  onColorize?: () => void;
  isColorizing?: boolean;
  isPageColorized?: boolean;
}

export const ColorSettings: React.FC<ColorSettingsProps> = ({
  onColorize,
  isColorizing = false,
  isPageColorized = false,
}) => {
  const selectedColorId = useStudioStore((s) => s.selectedColorEngineId);
  const downloadedIds = useStudioStore((s) => s.downloadedModelIds);
  const isModelReady = selectedColorId === 'none' || downloadedIds.includes(selectedColorId);

  return (
    <div className="space-y-4 text-xs text-slate-200">
      {/* Header */}
      <div className="pb-2 border-b border-[#282d3f]">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-[#f4446d]" />
          <h3 className="font-semibold text-sm text-slate-100">Manga Page Colorization</h3>
        </div>
        <p className="text-[11px] text-slate-400 mt-1">
          Deep learning neural network (SEResNeXt U-Net) adds rich colors to B&W manga pages while preserving 100% linework sharpness with CIELAB L* fusion.
        </p>
      </div>

      {/* Extensible Color Tier Selector */}
      <StudioEngineSelector category="color" />

      {/* Colorization Status Banner */}
      <div>
        <label className="block text-slate-400 font-medium mb-1.5">Artwork Color Status</label>
        {isPageColorized ? (
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="font-medium text-xs">Page is Colorized</span>
            </div>
            <span className="text-[10px] text-emerald-500/80">Ctrl+Z to undo</span>
          </div>
        ) : (
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#090a0f] border border-[#262a3b] text-slate-300">
            <div className="flex items-center gap-2">
              <CircleDashed className="w-4 h-4 text-slate-500 shrink-0" />
              <span className="font-medium text-xs">Black & White Scan</span>
            </div>
            <span className="text-[10px] text-slate-500">Uncolored</span>
          </div>
        )}
      </div>

      {/* Action Button */}
      <div className="pt-1">
        <button
          type="button"
          disabled={isColorizing || !isModelReady}
          onClick={onColorize}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-semibold text-xs tracking-wide transition cursor-pointer bg-[#f4446d] hover:bg-[#e0335c] text-white shadow-lg shadow-[#f4446d]/25 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isColorizing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Colorizing Page…</span>
            </>
          ) : isPageColorized ? (
            <>
              <Palette className="w-4 h-4" />
              <span>Re-colorize Page</span>
            </>
          ) : (
            <>
              <Palette className="w-4 h-4" />
              <span>Colorize Manga Page</span>
            </>
          )}
        </button>
      </div>

      {/* Architecture & Linework Guarantee */}
      <div className="p-3 rounded-lg bg-[#f4446d]/10 border border-[#f4446d]/30 text-[11px] text-[#f4446d] leading-relaxed">
        ⚡ <strong>Linework Preservation:</strong> Luminance fusion retains original scan sharpness and screentones while WebGPU applies neural colors locally.
      </div>

      {/* History Help */}
      <div className="p-2.5 rounded-lg bg-[#090a0f] border border-[#262a3b] text-[10px] text-slate-400 space-y-1">
        <p>• <strong>Ctrl+Z</strong> undoes colorization and restores black & white artwork.</p>
        <p>• <strong>Ctrl+Shift+Z</strong> restores the colorized plate instantly from cache.</p>
      </div>
    </div>
  );
};
