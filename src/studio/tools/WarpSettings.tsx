import React from 'react';
import { Maximize2, RotateCcw } from 'lucide-react';
import { studioStore, useStudioStore } from '../state/studioStore';
import { studioUndoStack } from '../state/undoStack';
import { WarpMesh, type WarpPreset } from '../canvas/WarpMesh';
import type { TextObject } from '../types';

const WARP_PRESETS: { id: WarpPreset; label: string }[] = [
  { id: 'none', label: 'None (Flat)' },
  { id: 'arch', label: 'Arch (Curved)' },
  { id: 'bulge', label: 'Bulge (Expand)' },
  { id: 'wave', label: 'Wave (Sine)' },
  { id: 'twist', label: 'Twist (Diagonal)' },
  { id: 'squeeze', label: 'Squeeze (Hourglass)' },
];

export const WarpSettings: React.FC = () => {
  const textObjects = useStudioStore((s) => s.textObjects);
  const selectedTextId = useStudioStore((s) => s.selectedTextId);

  const selectedObj = textObjects.find((t) => t.id === selectedTextId);

  const update = (partial: Partial<TextObject>) => {
    if (!selectedObj) return;
    const prev = [...textObjects];
    const next = textObjects.map((t) => (t.id === selectedObj.id ? { ...t, ...partial } : t));
    studioStore.setState({ textObjects: next });
    studioUndoStack.push({
      id: `warp-update-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Update Warp Preset',
      textObjects: { before: prev, after: next },
    });
  };

  if (!selectedObj) {
    return (
      <div className="p-5 text-center text-xs text-slate-400">
        <p>No text bubble selected.</p>
        <p className="mt-1 text-[11px] text-slate-500">
          Select a text bubble to apply 4-point perspective warp or parametric distortion.
        </p>
      </div>
    );
  }

  const currentPreset = (selectedObj.warpPreset as WarpPreset) || 'none';
  const currentBend = selectedObj.warpBend ?? 0.5;

  const handlePresetSelect = (preset: WarpPreset) => {
    const quad = WarpMesh.generatePresetQuad(selectedObj.width, selectedObj.height, preset, currentBend);
    update({
      warpPreset: preset,
      warpBend: currentBend,
      quadPoints: quad,
    });
  };

  const handleBendChange = (bend: number) => {
    const quad = WarpMesh.generatePresetQuad(selectedObj.width, selectedObj.height, currentPreset, bend);
    update({
      warpBend: bend,
      quadPoints: quad,
    });
  };

  const handleResetQuad = () => {
    const defaultQuad: [any, any, any, any] = [
      { x: 0, y: 0 },
      { x: selectedObj.width, y: 0 },
      { x: selectedObj.width, y: selectedObj.height },
      { x: 0, y: selectedObj.height },
    ];
    update({
      warpPreset: 'none',
      warpBend: 0,
      quadPoints: defaultQuad,
    });
  };

  return (
    <div className="space-y-4 text-xs text-slate-200">
      <div className="pb-2 border-b border-[#282d3f]">
        <div className="flex items-center gap-2">
          <Maximize2 className="w-4 h-4 text-[#f4446d]" />
          <h3 className="font-semibold text-sm text-slate-100">Warp & Quad Perspective</h3>
        </div>
        <p className="text-[11px] text-slate-400 mt-1">
          Distort text boxes along angled speech balloons, tilted signs, or dynamic SFX sound waves.
        </p>
      </div>

      <div>
        <label className="block text-slate-400 font-medium mb-1.5">Warp Presets</label>
        <div className="grid grid-cols-2 gap-1.5">
          {WARP_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => handlePresetSelect(p.id)}
              className={`py-2 px-2.5 rounded-lg border text-left transition ${
                currentPreset === p.id
                  ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d] font-medium'
                  : 'border-[#282d3f] bg-[#090a0f] text-slate-400 hover:text-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {currentPreset !== 'none' && (
        <div>
          <div className="flex justify-between text-slate-400 mb-1">
            <span>Bend Intensity</span>
            <span className="font-mono text-slate-200">{Math.round(currentBend * 100)}%</span>
          </div>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.05"
            value={currentBend}
            onChange={(e) => handleBendChange(Number(e.target.value))}
            className="w-full accent-[#f4446d]"
          />
        </div>
      )}

      <div className="pt-2">
        <button
          onClick={handleResetQuad}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-[#282d3f] bg-[#1c1f2e] text-slate-300 hover:bg-[#282d3f] transition"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset Quad to Rectangle
        </button>
      </div>

      <div className="p-3 rounded-lg bg-[#f4446d]/10 border border-[#f4446d]/30 text-[11px] text-[#f4446d] leading-relaxed">
        💡 <strong>Interactive Handles:</strong> Drag any of the 4 corner handles on the canvas to freely distort text in 3D perspective space.
      </div>
    </div>
  );
};
