import React from 'react';
import {
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  CaseUpper,
} from 'lucide-react';
import { studioStore, useStudioStore } from '../state/studioStore';
import { studioUndoStack } from '../state/undoStack';
import type { TextObject } from '../types';

export const TypographySettings: React.FC = () => {
  const textObjects = useStudioStore((s) => s.textObjects);
  const selectedTextId = useStudioStore((s) => s.selectedTextId);
  const globalEditMode = useStudioStore((s) => s.globalEditMode);

  const selectedObj = textObjects.find((t) => t.id === selectedTextId);

  const updateSelected = (partial: Partial<TextObject>) => {
    const prev = [...textObjects];
    let next: TextObject[];

    if (globalEditMode) {
      next = textObjects.map((obj) => ({ ...obj, ...partial }));
    } else if (selectedObj) {
      next = textObjects.map((obj) => (obj.id === selectedObj.id ? { ...obj, ...partial } : obj));
    } else {
      return;
    }

    studioStore.setState({ textObjects: next });
    studioUndoStack.push({
      id: `text-edit-${Date.now()}`,
      timestamp: Date.now(),
      description: 'Update Typography',
      textObjects: { before: prev, after: next },
    });
  };

  if (!selectedObj && !globalEditMode) {
    return (
      <div className="p-5 text-center text-xs text-slate-400">
        <p>No text bubble selected.</p>
        <p className="mt-1 text-[11px] text-slate-500">
          Click any text box on the canvas or enable <strong>Global Edit Mode</strong> below.
        </p>
        <button
          onClick={() => studioStore.setState({ globalEditMode: true })}
          className="mt-3 px-3 py-1.5 rounded-lg border border-[#282d3f] bg-[#1c1f2e] text-red-400 hover:bg-[#282d3f] transition"
        >
          Enable Global Edit Mode
        </button>
      </div>
    );
  }

  const obj = selectedObj || textObjects[0] || ({} as Partial<TextObject>);

  return (
    <div className="space-y-4 text-xs text-slate-200">
      <div className="flex items-center justify-between pb-2 border-b border-[#282d3f]">
        <h3 className="font-semibold text-sm text-slate-100">Typography</h3>
        <label className="flex items-center gap-1.5 text-[11px] text-red-400 font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={globalEditMode}
            onChange={(e) => studioStore.setState({ globalEditMode: e.target.checked })}
            className="rounded border-[#282d3f] bg-[#090a0f] text-red-600 focus:ring-0"
          />
          All Bubbles
        </label>
      </div>

      {/* Font Family */}
      <div>
        <label className="block text-slate-400 font-medium mb-1">Font Family</label>
        <select
          value={obj.fontFamily || 'WildWords'}
          onChange={(e) => updateSelected({ fontFamily: e.target.value })}
          className="w-full rounded-lg border border-[#282d3f] bg-[#090a0f] px-2.5 py-1.5 text-xs text-slate-200 focus:outline-hidden"
        >
          <option value="WildWords, CCWildWords, sans-serif">CC Wild Words (Comic)</option>
          <option value="Kalam, cursive">Kalam (Manga Dialogue)</option>
          <option value="Figtree, sans-serif">Figtree (Modern Clean)</option>
          <option value="Comic Sans MS, cursive">Comic Sans (Classic)</option>
          <option value="Impact, sans-serif">Impact (Action SFX)</option>
          <option value="sans-serif">System Sans-Serif</option>
        </select>
      </div>

      {/* Font Size & Spacing */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="flex justify-between text-slate-400 mb-1">
            <span>Size</span>
            <span className="font-mono text-slate-200">{obj.fontSize || 16}px</span>
          </div>
          <input
            type="range"
            min="8"
            max="120"
            value={obj.fontSize || 16}
            onChange={(e) => updateSelected({ fontSize: Number(e.target.value) })}
            className="w-full accent-red-500"
          />
        </div>
        <div>
          <div className="flex justify-between text-slate-400 mb-1">
            <span>Line Space</span>
            <span className="font-mono text-slate-200">{(obj.lineSpacing || 1.2).toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min="0.8"
            max="2.5"
            step="0.1"
            value={obj.lineSpacing || 1.2}
            onChange={(e) => updateSelected({ lineSpacing: Number(e.target.value) })}
            className="w-full accent-red-500"
          />
        </div>
      </div>

      {/* Formatting & Alignment */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => updateSelected({ bold: !obj.bold })}
          className={`p-2 rounded-lg border transition ${
            obj.bold
              ? 'border-red-500 bg-red-950/40 text-red-400'
              : 'border-[#282d3f] bg-[#090a0f] text-slate-400'
          }`}
          title="Bold"
        >
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => updateSelected({ italic: !obj.italic })}
          className={`p-2 rounded-lg border transition ${
            obj.italic
              ? 'border-red-500 bg-red-950/40 text-red-400'
              : 'border-[#282d3f] bg-[#090a0f] text-slate-400'
          }`}
          title="Italic"
        >
          <Italic className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => updateSelected({ uppercase: !obj.uppercase, lowercase: false })}
          className={`p-2 rounded-lg border transition ${
            obj.uppercase
              ? 'border-red-500 bg-red-950/40 text-red-400'
              : 'border-[#282d3f] bg-[#090a0f] text-slate-400'
          }`}
          title="Uppercase"
        >
          <CaseUpper className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => updateSelected({ align: 'left' })}
          className={`p-2 rounded-lg border transition ${
            obj.align === 'left'
              ? 'border-red-500 bg-red-950/40 text-red-400'
              : 'border-[#282d3f] bg-[#090a0f] text-slate-400'
          }`}
          title="Align Left"
        >
          <AlignLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => updateSelected({ align: 'center' })}
          className={`p-2 rounded-lg border transition ${
            obj.align === 'center' || !obj.align
              ? 'border-red-500 bg-red-950/40 text-red-400'
              : 'border-[#282d3f] bg-[#090a0f] text-slate-400'
          }`}
          title="Align Center"
        >
          <AlignCenter className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => updateSelected({ align: 'right' })}
          className={`p-2 rounded-lg border transition ${
            obj.align === 'right'
              ? 'border-red-500 bg-red-950/40 text-red-400'
              : 'border-[#282d3f] bg-[#090a0f] text-slate-400'
          }`}
          title="Align Right"
        >
          <AlignRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* CJK Vertical Layout Toggle */}
      <div className="flex items-center justify-between p-2 rounded-lg bg-[#090a0f] border border-[#282d3f]">
        <div>
          <span className="font-medium text-slate-200">CJK Vertical Layout</span>
          <p className="text-[11px] text-slate-500">Top-to-bottom right-to-left columns</p>
        </div>
        <input
          type="checkbox"
          checked={obj.isVertical || false}
          onChange={(e) => updateSelected({ isVertical: e.target.checked })}
          className="rounded border-[#282d3f] bg-[#12141c] text-red-600 focus:ring-0"
        />
      </div>

      {/* Text Color & Gradient */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-slate-400 font-medium">Text Fill Color</label>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={obj.isGradient || false}
              onChange={(e) => updateSelected({ isGradient: e.target.checked })}
              className="rounded border-[#282d3f] bg-[#090a0f] text-red-600 focus:ring-0"
            />
            Linear Gradient
          </label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={obj.color || '#000000'}
            onChange={(e) => updateSelected({ color: e.target.value })}
            className="w-7 h-7 rounded border border-[#282d3f] bg-transparent cursor-pointer"
          />
          {obj.isGradient && (
            <input
              type="color"
              value={obj.color2 || '#ef4444'}
              onChange={(e) => updateSelected({ color2: e.target.value })}
              className="w-7 h-7 rounded border border-[#282d3f] bg-transparent cursor-pointer"
            />
          )}
          <input
            type="text"
            value={obj.color || '#000000'}
            onChange={(e) => updateSelected({ color: e.target.value })}
            className="flex-1 rounded-lg border border-[#282d3f] bg-[#090a0f] px-2 py-1 font-mono text-slate-200"
          />
        </div>
      </div>

      {/* Stroke Outline & Drop Shadow Angle Dial */}
      <div className="space-y-2 pt-2 border-t border-[#282d3f]">
        <div className="flex justify-between text-slate-400">
          <span className="font-medium">Outline Stroke</span>
          <span className="font-mono text-slate-200">{obj.strokeWidth || 0}px</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={obj.strokeColor || '#ffffff'}
            onChange={(e) => updateSelected({ strokeColor: e.target.value })}
            className="w-7 h-7 rounded border border-[#282d3f] bg-transparent cursor-pointer"
          />
          <input
            type="range"
            min="0"
            max="20"
            value={obj.strokeWidth || 0}
            onChange={(e) => updateSelected({ strokeWidth: Number(e.target.value) })}
            className="flex-1 accent-red-500"
          />
        </div>

        {/* Shadow distance & angle */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div>
            <div className="flex justify-between text-slate-400 mb-1">
              <span>Shadow Offset</span>
              <span className="font-mono text-slate-200">{obj.shadowDistance || 0}px</span>
            </div>
            <input
              type="range"
              min="0"
              max="25"
              value={obj.shadowDistance || 0}
              onChange={(e) => updateSelected({ shadowDistance: Number(e.target.value) })}
              className="w-full accent-red-500"
            />
          </div>
          <div>
            <div className="flex justify-between text-slate-400 mb-1">
              <span>Shadow Angle</span>
              <span className="font-mono text-slate-200">{obj.shadowAngle || 45}°</span>
            </div>
            <input
              type="range"
              min="0"
              max="360"
              value={obj.shadowAngle || 45}
              onChange={(e) => updateSelected({ shadowAngle: Number(e.target.value) })}
              className="w-full accent-red-500"
            />
          </div>
        </div>
      </div>

      {/* Bubble Background Fill Box */}
      <div className="space-y-2 pt-2 border-t border-[#282d3f]">
        <label className="block text-slate-400 font-medium">Bubble Background Box</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={obj.backgroundFill && obj.backgroundFill !== 'transparent' ? obj.backgroundFill : '#ffffff'}
            onChange={(e) => updateSelected({ backgroundFill: e.target.value })}
            className="w-7 h-7 rounded border border-[#282d3f] bg-transparent cursor-pointer"
          />
          <button
            onClick={() => updateSelected({ backgroundFill: 'transparent' })}
            className="px-2.5 py-1 rounded-md border border-[#282d3f] bg-[#090a0f] text-slate-400 hover:text-white"
          >
            Clear Fill
          </button>
        </div>
        {obj.backgroundFill && obj.backgroundFill !== 'transparent' && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <div className="flex justify-between text-slate-400 mb-1">
                <span>Padding</span>
                <span className="font-mono text-slate-200">{obj.backgroundPadding || 4}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="30"
                value={obj.backgroundPadding || 4}
                onChange={(e) => updateSelected({ backgroundPadding: Number(e.target.value) })}
                className="w-full accent-red-500"
              />
            </div>
            <div>
              <div className="flex justify-between text-slate-400 mb-1">
                <span>Corner Radius</span>
                <span className="font-mono text-slate-200">{obj.backgroundBorderRadius || 0}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="50"
                value={obj.backgroundBorderRadius || 0}
                onChange={(e) => updateSelected({ backgroundBorderRadius: Number(e.target.value) })}
                className="w-full accent-red-500"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
