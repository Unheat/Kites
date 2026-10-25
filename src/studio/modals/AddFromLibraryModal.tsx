import React, { useEffect, useState } from 'react';
import { X, Search, Check, Layers, Image as ImageIcon, Plus } from 'lucide-react';
import { db, type TranslationJob } from '../../db';
import { addJobsToProject } from '../state/projectStore';
import { getTranslatedPageThumbnailUrl } from '../canvas/thumbnailRenderer';

export interface AddFromLibraryModalProps {
  isOpen: boolean;
  projectId: number | null;
  onClose: () => void;
  onJobsAdded?: () => void;
}

interface JobWithThumb {
  job: TranslationJob;
  thumbUrl: string | null;
}

export const AddFromLibraryModal: React.FC<AddFromLibraryModalProps> = ({
  isOpen,
  projectId,
  onClose,
  onJobsAdded,
}) => {
  const [items, setItems] = useState<JobWithThumb[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let isCancelled = false;

    const loadJobs = async () => {
      const allJobs = await db.translationJobs.orderBy('timestamp').reverse().toArray();
      if (isCancelled) return;

      const results: JobWithThumb[] = [];
      for (const job of allJobs) {
        if (isCancelled) break;
        if (!job.id) continue;
        const thumbUrl = await getTranslatedPageThumbnailUrl(job.id, 450);
        results.push({ job, thumbUrl });
      }

      if (!isCancelled) {
        setItems(results);
        setSelectedIds(new Set());
      }
    };

    void loadJobs();

    return () => {
      isCancelled = true;
    };
  }, [isOpen]);

  if (!isOpen || !projectId) return null;

  // Filter items
  const filtered = items.filter(({ job }) => {
    if (showUnassignedOnly && job.folderId && job.folderId !== projectId) return false;
    if (job.folderId === projectId) return false; // Already in this project

    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase().trim();
    const urlMatch = job.srcUrl ? job.srcUrl.toLowerCase().includes(query) : false;
    const idMatch = String(job.id).includes(query);
    return urlMatch || idMatch;
  });

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(({ job }) => job.id!).filter(Boolean)));
    }
  };

  const handleConfirmAdd = async () => {
    if (selectedIds.size === 0) return;
    setIsSubmitting(true);
    try {
      await addJobsToProject(projectId, Array.from(selectedIds));
      if (onJobsAdded) onJobsAdded();
      onClose();
    } catch (err) {
      console.error('[AddFromLibrary] Failed adding jobs:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 select-none">
      <div className="w-full max-w-2xl max-h-[85vh] rounded-2xl bg-[#12141c] border border-[#262a3b] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="h-14 px-5 border-b border-[#262a3b] bg-[#141724] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#f4446d]" />
            <h3 className="text-sm font-semibold text-slate-100">Add Pages from Library</h3>
            <span className="text-xs text-slate-500 font-medium">({filtered.length} available)</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1c1f2e] transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filter bar */}
        <div className="p-3 border-b border-[#262a3b] bg-[#181a26]/70 flex items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by URL, site, or job ID..."
              className="w-full h-8 pl-8 pr-3 text-xs rounded-lg bg-[#090a0f] border border-[#262a3b] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-[#f4446d]"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowUnassignedOnly((v) => !v)}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition cursor-pointer ${
                showUnassignedOnly
                  ? 'bg-[#f4446d]/15 border-[#f4446d]/50 text-[#f4446d]'
                  : 'bg-[#090a0f] border-[#262a3b] text-slate-400 hover:text-white'
              }`}
            >
              Unassigned Only
            </button>

            <button
              type="button"
              onClick={handleSelectAll}
              className="px-2.5 py-1 text-xs font-medium rounded-lg bg-[#090a0f] hover:bg-[#1c1f2e] border border-[#262a3b] text-slate-300 transition cursor-pointer"
            >
              {selectedIds.size === filtered.length && filtered.length > 0 ? 'Deselect All' : 'Select All'}
            </button>
          </div>
        </div>

        {/* Items Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {filtered.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {filtered.map(({ job, thumbUrl }) => {
                const isSelected = job.id !== undefined && selectedIds.has(job.id);
                return (
                  <div
                    key={job.id}
                    onClick={() => job.id && toggleSelect(job.id)}
                    className={`group relative flex flex-col rounded-xl overflow-hidden border cursor-pointer transition select-none ${
                      isSelected
                        ? 'border-[#f4446d] bg-[#f4446d]/10 ring-2 ring-[#f4446d]/30'
                        : 'border-[#262a3b] bg-[#161924] hover:border-slate-500'
                    }`}
                  >
                    {/* Thumbnail Image */}
                    <div className="w-full aspect-[3/4] bg-[#090a0f] relative flex items-center justify-center overflow-hidden">
                      {thumbUrl ? (
                        <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon className="w-6 h-6 text-slate-600" />
                      )}

                      {/* Selection Checkmark */}
                      <div
                        className={`absolute top-2 right-2 w-5 h-5 rounded-md flex items-center justify-center transition ${
                          isSelected
                            ? 'bg-[#f4446d] text-white shadow-md'
                            : 'bg-black/50 text-transparent border border-white/30 group-hover:border-white'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    </div>

                    {/* Metadata Footer */}
                    <div className="p-2 text-[0.7rem] text-slate-400 flex items-center justify-between bg-[#12141c]">
                      <span className="truncate max-w-[80px]">#{job.id}</span>
                      <span className="text-[0.65rem] text-slate-500">
                        {new Date(job.timestamp).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-48 flex flex-col items-center justify-center text-center text-xs text-slate-500">
              <Layers className="w-8 h-8 mb-2 opacity-40 text-slate-600" />
              <span>No available pages in library matching filters.</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="h-14 px-5 border-t border-[#262a3b] bg-[#141724] flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-400">
            {selectedIds.size} {selectedIds.size === 1 ? 'page' : 'pages'} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-white rounded-lg transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0 || isSubmitting}
              onClick={handleConfirmAdd}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#f4446d] hover:bg-[#e0335c] disabled:opacity-40 disabled:pointer-events-none text-white shadow-md shadow-[rgba(244,68,109,0.25)] transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add to Project</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
