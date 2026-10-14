import React, { useState } from 'react';
import { Type, Upload, X, Check } from 'lucide-react';

export interface FontManagerModalProps {
  onClose: () => void;
}

export interface CustomFontEntry {
  name: string;
  family: string;
  fileName: string;
}

export const FontManagerModal: React.FC<FontManagerModalProps> = ({ onClose }) => {
  const [fonts, setFonts] = useState<CustomFontEntry[]>([
    { name: 'CC Wild Words', family: 'WildWords', fileName: 'bundled' },
    { name: 'Kalam Manga', family: 'Kalam', fileName: 'bundled' },
    { name: 'Figtree Dialogue', family: 'Figtree', fileName: 'bundled' },
  ]);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const fontName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
      const fontFace = new FontFace(fontName, buffer);
      await fontFace.load();
      document.fonts.add(fontFace);

      setFonts((prev) => [
        ...prev,
        {
          name: fontName,
          family: fontName,
          fileName: file.name,
        },
      ]);
      setUploadStatus(`Installed font "${fontName}" successfully!`);
      setTimeout(() => setUploadStatus(null), 3000);
    } catch (err: any) {
      setUploadStatus(`Failed to load font: ${err?.message || String(err)}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-xl border border-[#282d3f] bg-[#12141c] p-5 shadow-2xl text-slate-100 flex flex-col">
        <div className="flex items-center justify-between pb-3 border-b border-[#282d3f]">
          <div className="flex items-center gap-2 font-medium text-sm text-slate-200">
            <Type className="w-4 h-4 text-[#f4446d]" />
            Font Manager & Custom Fonts
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-[#1c1f2e] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4">
          <label className="flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed border-[#282d3f] bg-[#090a0f] hover:border-[#f4446d]/60 hover:bg-[#12141c] cursor-pointer transition">
            <Upload className="w-6 h-6 text-[#f4446d] mb-1" />
            <span className="text-xs font-medium text-slate-200">Upload Font (.ttf, .otf, .woff2)</span>
            <span className="text-[11px] text-slate-500 mt-0.5">Loads directly into canvas typography engine</span>
            <input
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>

        {uploadStatus && (
          <div className="mt-3 p-2 rounded-lg bg-[#f4446d]/15 border border-[#f4446d]/30 text-xs text-[#f4446d] flex items-center gap-2">
            <Check className="w-3.5 h-3.5 shrink-0" />
            {uploadStatus}
          </div>
        )}

        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Active Comic Fonts ({fonts.length})
          </h4>
          <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
            {fonts.map((f) => (
              <div
                key={f.name}
                className="flex items-center justify-between p-2.5 rounded-lg bg-[#090a0f] border border-[#282d3f]/60 text-xs"
              >
                <div>
                  <div className="font-medium text-slate-200" style={{ fontFamily: f.family }}>
                    {f.name}
                  </div>
                  <div className="text-[11px] text-slate-500">{f.fileName}</div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] bg-[#1c1f2e] text-slate-400">
                  {f.family}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex justify-end pt-3 border-t border-[#282d3f]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1c1f2e] border border-[#282d3f] text-slate-200 hover:bg-[#282d3f] transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
