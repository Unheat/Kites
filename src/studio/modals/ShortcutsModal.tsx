import React from 'react';
import { Keyboard, X } from 'lucide-react';

export interface ShortcutsModalProps {
  onClose: () => void;
}

const SHORTCUT_GROUPS = [
  {
    title: 'Tools',
    items: [
      { key: 'T / V', desc: 'Text & Typography Tool' },
      { key: 'Ctrl + 1', desc: 'Erase / Restore Brush' },
      { key: 'Ctrl + 2', desc: 'Paint Brush (Color / Blur / Pattern)' },
      { key: 'Ctrl + 3', desc: 'Local AI Inpaint Brush' },
      { key: 'Ctrl + 4', desc: 'Local AI Re-OCR Area' },
      { key: 'Ctrl + 5', desc: 'Warp & Quad Perspective' },
      { key: 'Ctrl + 6', desc: 'Sticker Image Layers' },
    ],
  },
  {
    title: 'Canvas Viewport',
    items: [
      { key: 'Mouse Wheel', desc: 'Vertical document scroll' },
      { key: 'Shift + Wheel', desc: 'Horizontal document scroll' },
      { key: 'Ctrl / Cmd + Wheel', desc: 'Cursor-centered zoom' },
      { key: 'Space + Drag', desc: 'Pan canvas workspace' },
    ],
  },
  {
    title: 'Editing & Clipboard',
    items: [
      { key: 'Ctrl + Z', desc: 'Undo last stroke or text edit' },
      { key: 'Ctrl + Shift + Z', desc: 'Redo previously undone action' },
      { key: 'Delete / Backspace', desc: 'Remove selected text box or sticker' },
      { key: 'Ctrl + D', desc: 'Duplicate selected text box' },
      { key: 'Ctrl + B', desc: 'Toggle history drawer' },
    ],
  },
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-xl border border-[#282d3f] bg-[#12141c] p-5 shadow-2xl text-slate-100 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between pb-3 border-b border-[#282d3f]">
          <div className="flex items-center gap-2 font-medium text-sm text-slate-200">
            <Keyboard className="w-4 h-4 text-[#f4446d]" />
            Keyboard Shortcuts
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-[#1c1f2e] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4 overflow-y-auto pr-1">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                {group.title}
              </h4>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between p-2 rounded-lg bg-[#090a0f] border border-[#282d3f]/60 text-xs"
                  >
                    <span className="text-slate-300">{item.desc}</span>
                    <kbd className="px-2 py-0.5 rounded-md bg-[#1c1f2e] border border-[#363c54] font-mono text-[11px] text-[#f4446d] font-medium">
                      {item.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end pt-3 border-t border-[#282d3f]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1c1f2e] border border-[#282d3f] text-slate-200 hover:bg-[#282d3f] transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
