import React, { useState, useMemo } from 'react';
import { Search, Replace, X, Check } from 'lucide-react';
import { studioStore, useStudioStore } from '../state/studioStore';
import { studioUndoStack } from '../state/undoStack';

export interface FindReplaceModalProps {
  onClose: () => void;
}

export const FindReplaceModal: React.FC<FindReplaceModalProps> = ({ onClose }) => {
  const textObjects = useStudioStore((s) => s.textObjects);
  const [searchTerm, setSearchTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [replacedCount, setReplacedCount] = useState<number | null>(null);

  const matchingIndices = useMemo(() => {
    if (!searchTerm.trim()) return [];

    return textObjects
      .map((obj, index) => {
        let text = obj.text;
        let query = searchTerm;
        if (!matchCase) {
          text = text.toLowerCase();
          query = query.toLowerCase();
        }

        let isMatch = false;
        if (wholeWord) {
          const regex = new RegExp(`\\b${escapeRegExp(query)}\\b`, matchCase ? 'g' : 'gi');
          isMatch = regex.test(obj.text);
        } else {
          isMatch = text.includes(query);
        }

        return isMatch ? index : -1;
      })
      .filter((idx) => idx !== -1);
  }, [textObjects, searchTerm, matchCase, wholeWord]);

  const handleReplaceAll = () => {
    if (!searchTerm.trim() || matchingIndices.length === 0) return;

    const previousObjects = [...textObjects];
    const updatedObjects = textObjects.map((obj) => {
      let flags = 'g';
      if (!matchCase) flags += 'i';
      const pattern = wholeWord
        ? new RegExp(`\\b${escapeRegExp(searchTerm)}\\b`, flags)
        : new RegExp(escapeRegExp(searchTerm), flags);

      return {
        ...obj,
        text: obj.text.replace(pattern, replaceTerm),
      };
    });

    studioStore.setState({ textObjects: updatedObjects });
    studioUndoStack.push({
      id: `replace-all-${Date.now()}`,
      timestamp: Date.now(),
      description: `Replace "${searchTerm}" with "${replaceTerm}"`,
      textObjects: {
        before: previousObjects,
        after: updatedObjects,
      },
    });

    setReplacedCount(matchingIndices.length);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-xl border border-[#282d3f] bg-[#12141c] p-5 shadow-2xl text-slate-100">
        <div className="flex items-center justify-between pb-3 border-b border-[#282d3f]">
          <div className="flex items-center gap-2 font-medium text-sm text-slate-200">
            <Search className="w-4 h-4 text-indigo-400" />
            Find and Replace
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-[#1c1f2e] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Find Text</label>
            <div className="relative">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setReplacedCount(null);
                }}
                placeholder="Search dialogue..."
                className="w-full rounded-lg border border-[#282d3f] bg-[#090a0f] px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-hidden"
              />
              {searchTerm && (
                <span className="absolute right-3 top-2.5 text-xs text-slate-400">
                  {matchingIndices.length} {matchingIndices.length === 1 ? 'match' : 'matches'}
                </span>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Replace With</label>
            <input
              type="text"
              value={replaceTerm}
              onChange={(e) => {
                setReplaceTerm(e.target.value);
                setReplacedCount(null);
              }}
              placeholder="Replacement text..."
              className="w-full rounded-lg border border-[#282d3f] bg-[#090a0f] px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-hidden"
            />
          </div>

          <div className="flex items-center gap-4 pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={matchCase}
                onChange={(e) => setMatchCase(e.target.checked)}
                className="rounded border-[#282d3f] bg-[#090a0f] text-indigo-600 focus:ring-0"
              />
              Match case
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={wholeWord}
                onChange={(e) => setWholeWord(e.target.checked)}
                className="rounded border-[#282d3f] bg-[#090a0f] text-indigo-600 focus:ring-0"
              />
              Whole word
            </label>
          </div>

          {replacedCount !== null && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-xs text-emerald-400">
              <Check className="w-3.5 h-3.5 shrink-0" />
              Replaced {replacedCount} {replacedCount === 1 ? 'occurrence' : 'occurrences'}.
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 pt-3 border-t border-[#282d3f]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:bg-[#1c1f2e] transition"
          >
            Cancel
          </button>
          <button
            onClick={handleReplaceAll}
            disabled={!searchTerm.trim() || matchingIndices.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none transition shadow-sm"
          >
            <Replace className="w-3.5 h-3.5" />
            Replace All ({matchingIndices.length})
          </button>
        </div>
      </div>
    </div>
  );
};

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
