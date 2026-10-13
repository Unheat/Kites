import React from 'react';
import {
  MousePointer2,
  Eraser,
  Brush,
  Sparkles,
  ScanText,
  Type,
  Maximize2,
  Image as ImageIcon,
} from 'lucide-react';
import { studioStore, useStudioStore } from '../state/studioStore';
import type { StudioTool } from '../types';

interface ToolItem {
  id: StudioTool;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut: string;
}

const TOOLS: ToolItem[] = [
  { id: 'select', label: 'Select & Move', icon: MousePointer2, shortcut: 'V' },
  { id: 'erase', label: 'Restore / Erase Brush', icon: Eraser, shortcut: 'Ctrl+1' },
  { id: 'paint', label: 'Freehand Paint Brush', icon: Brush, shortcut: 'Ctrl+2' },
  { id: 'inpaint', label: 'Local AI Inpaint', icon: Sparkles, shortcut: 'Ctrl+3' },
  { id: 'ocr', label: 'Local AI Re-OCR Area', icon: ScanText, shortcut: 'Ctrl+4' },
  { id: 'text', label: 'Text & Typography', icon: Type, shortcut: 'Ctrl+5' },
  { id: 'warp', label: 'Warp & Quad Perspective', icon: Maximize2, shortcut: 'Ctrl+6' },
  { id: 'image', label: 'Stickers & Image Layers', icon: ImageIcon, shortcut: 'Ctrl+7' },
];

export const ToolRail: React.FC = () => {
  const activeTool = useStudioStore((s) => s.activeTool);

  const selectTool = (tool: StudioTool) => {
    studioStore.setState({ activeTool: tool });
  };

  return (
    <aside className="w-13 border-r border-[#282d3f] bg-[#12141c] flex flex-col items-center py-3 gap-1 shrink-0 z-20">
      {TOOLS.map((t) => {
        const Icon = t.icon;
        const isActive = activeTool === t.id;
        return (
          <button
            key={t.id}
            onClick={() => selectTool(t.id)}
            title={`${t.label} (${t.shortcut})`}
            className={`relative p-2.5 rounded-xl transition group ${
              isActive
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#1c1f2e]'
            }`}
          >
            <Icon className="w-4 h-4" />
            <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded bg-[#090a0f] border border-[#282d3f] text-[11px] font-medium text-slate-200 whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition z-50 shadow-xl">
              {t.label} <span className="text-slate-400 font-mono">({t.shortcut})</span>
            </div>
          </button>
        );
      })}
    </aside>
  );
};
