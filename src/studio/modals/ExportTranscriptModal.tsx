import React, { useState, useMemo } from 'react';
import { FileText, Copy, Download, Check, X } from 'lucide-react';
import { useStudioStore } from '../state/studioStore';

export interface ExportTranscriptModalProps {
  onClose: () => void;
}

export type ExportFormat = 'combined' | 'translated_only' | 'original_only' | 'separate';

export const ExportTranscriptModal: React.FC<ExportTranscriptModalProps> = ({ onClose }) => {
  const textObjects = useStudioStore((s) => s.textObjects);
  const [format, setFormat] = useState<ExportFormat>('combined');
  const [includeIndices, setIncludeIndices] = useState(true);
  const [extraSpacing, setExtraSpacing] = useState(true);
  const [copied, setCopied] = useState(false);

  const transcript = useMemo(() => {
    if (textObjects.length === 0) return 'No text bubbles detected in this image.';

    const separator = extraSpacing ? '\n\n' : '\n';

    if (format === 'combined') {
      return textObjects
        .map((obj, i) => {
          const header = includeIndices ? `[Bubble ${i + 1}]\n` : '';
          const orig = obj.originalText ? `Original: ${obj.originalText}\n` : '';
          const trans = `Translated: ${obj.text}`;
          return `${header}${orig}${trans}`;
        })
        .join(separator);
    }

    if (format === 'translated_only') {
      return textObjects
        .map((obj, i) => {
          const header = includeIndices ? `[#${i + 1}] ` : '';
          return `${header}${obj.text}`;
        })
        .join(separator);
    }

    if (format === 'original_only') {
      return textObjects
        .map((obj, i) => {
          const header = includeIndices ? `[#${i + 1}] ` : '';
          return `${header}${obj.originalText || obj.text}`;
        })
        .join(separator);
    }

    if (format === 'separate') {
      const origList = textObjects
        .map((obj, i) => `[#${i + 1}] ${obj.originalText || '(none)'}`)
        .join('\n');
      const transList = textObjects
        .map((obj, i) => `[#${i + 1}] ${obj.text}`)
        .join('\n');
      return `=== ORIGINAL DIALOGUE ===\n${origList}\n\n=== TRANSLATED DIALOGUE ===\n${transList}`;
    }

    return '';
  }, [textObjects, format, includeIndices, extraSpacing]);

  const handleCopy = () => {
    navigator.clipboard.writeText(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `manga_transcript_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-xl border border-[#282d3f] bg-[#12141c] p-5 shadow-2xl text-slate-100 flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between pb-3 border-b border-[#282d3f]">
          <div className="flex items-center gap-2 font-medium text-sm text-slate-200">
            <FileText className="w-4 h-4 text-[#f4446d]" />
            Export Dialogue Transcript
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-[#1c1f2e] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <button
            onClick={() => setFormat('combined')}
            className={`p-2 rounded-lg border text-left transition ${
              format === 'combined'
                ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d] font-medium'
                : 'border-[#282d3f] bg-[#090a0f] text-slate-400 hover:border-slate-700'
            }`}
          >
            Combined (Both)
          </button>
          <button
            onClick={() => setFormat('translated_only')}
            className={`p-2 rounded-lg border text-left transition ${
              format === 'translated_only'
                ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d] font-medium'
                : 'border-[#282d3f] bg-[#090a0f] text-slate-400 hover:border-slate-700'
            }`}
          >
            Translated Only
          </button>
          <button
            onClick={() => setFormat('original_only')}
            className={`p-2 rounded-lg border text-left transition ${
              format === 'original_only'
                ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d] font-medium'
                : 'border-[#282d3f] bg-[#090a0f] text-slate-400 hover:border-slate-700'
            }`}
          >
            Original Only
          </button>
          <button
            onClick={() => setFormat('separate')}
            className={`p-2 rounded-lg border text-left transition ${
              format === 'separate'
                ? 'border-[#f4446d] bg-[#f4446d]/15 text-[#f4446d] font-medium'
                : 'border-[#282d3f] bg-[#090a0f] text-slate-400 hover:border-slate-700'
            }`}
          >
            Separate Sections
          </button>
        </div>

        <div className="flex items-center gap-4 mt-3">
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={includeIndices}
              onChange={(e) => setIncludeIndices(e.target.checked)}
              className="rounded border-[#282d3f] bg-[#090a0f] text-[#f4446d] focus:ring-0"
            />
            Include bubble numbers
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={extraSpacing}
              onChange={(e) => setExtraSpacing(e.target.checked)}
              className="rounded border-[#282d3f] bg-[#090a0f] text-[#f4446d] focus:ring-0"
            />
            Extra paragraph spacing
          </label>
        </div>

        <div className="mt-3 flex-1 min-h-[160px]">
          <textarea
            readOnly
            value={transcript}
            className="w-full h-full min-h-[160px] max-h-[300px] rounded-lg border border-[#282d3f] bg-[#090a0f] p-3 text-xs font-mono text-slate-200 resize-none focus:outline-hidden"
          />
        </div>

        <div className="mt-4 flex items-center justify-between pt-3 border-t border-[#282d3f]">
          <span className="text-xs text-slate-500">
            {textObjects.length} {textObjects.length === 1 ? 'bubble' : 'bubbles'} total
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[#282d3f] bg-[#1c1f2e] text-slate-200 hover:bg-[#282d3f] transition"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#f4446d] text-white hover:bg-[#e0355e] transition shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              Download .txt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
