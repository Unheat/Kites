import React, { useEffect, useState } from 'react';
import { MoreVertical, Folder, Layers, Trash2, Edit2, Play, Download } from 'lucide-react';
import { db, type ProjectFolder, type TranslationJob } from '../../db';

/** Maximum number of thumbnail previews rendered inside the project card strip. */
const MAX_PREVIEW_THUMBNAILS = 4;

export interface ProjectCardProps {
  project: ProjectFolder;
  isSelected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onExport: () => void;
  tileSizeRem?: number;
}

/**
 * Formats elapsed epoch time into concise relative text (e.g. "2m ago", "3h ago", "yesterday").
 *
 * @param timestamp - Epoch timestamp in milliseconds.
 * @returns Human-readable relative time string.
 */
export function formatTimeAgo(timestamp: number): string {
  const elapsed = Date.now() - timestamp;
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  isSelected,
  onSelect,
  onOpen,
  onRename,
  onDelete,
  onExport,
  tileSizeRem = 7.5,
}) => {
  const [memberJobs, setMemberJobs] = useState<TranslationJob[]>([]);
  const [thumbUrls, setThumbUrls] = useState<string[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Load preview thumbnails for member jobs
  useEffect(() => {
    let isCancelled = false;
    const activeUrls: string[] = [];

    const loadPreviews = async () => {
      if (!project.id) return;
      const jobs = await db.translationJobs
        .where('folderId')
        .equals(project.id)
        .sortBy('projectOrder');

      if (isCancelled) return;
      setMemberJobs(jobs);

      const previewJobs = jobs.slice(0, MAX_PREVIEW_THUMBNAILS);
      const urls: string[] = [];

      for (const job of previewJobs) {
        if (isCancelled) break;
        if (!job.id) continue;
        const img = await db.images.where({ jobId: job.id }).first();
        if (isCancelled) break;
        if (img) {
          const blob = img.translatedImageBlob || img.rawImageBlob;
          if (blob) {
            const url = URL.createObjectURL(blob);
            urls.push(url);
            activeUrls.push(url);
          }
        }
      }

      if (!isCancelled) {
        setThumbUrls(urls);
      }
    };

    void loadPreviews();

    return () => {
      isCancelled = true;
      activeUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [project.id]);

  const pageCount = memberJobs.length;
  const lastActiveTime = project.updatedAt || project.timestamp;

  return (
    <div
      onClick={onSelect}
      onDoubleClick={onOpen}
      style={{ minHeight: `${tileSizeRem}rem` }}
      className={`group relative flex flex-col justify-between p-4 rounded-xl border transition-all cursor-pointer select-none ${
        isSelected
          ? 'bg-[#1a1f33] border-blue-500 shadow-lg shadow-blue-500/10'
          : 'bg-[#12141c] hover:bg-[#181c2b] border-[#282d3f] hover:border-slate-600'
      }`}
    >
      {/* Top Header Row */}
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="p-2 rounded-lg bg-blue-500/15 text-blue-400 shrink-0">
            <Folder className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm text-slate-100 truncate" title={project.title}>
              {project.title}
            </h3>
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
              <span>{pageCount} {pageCount === 1 ? 'page' : 'pages'}</span>
              <span>•</span>
              <span className="text-slate-500">{formatTimeAgo(lastActiveTime)}</span>
            </div>
          </div>
        </div>

        {/* 3-Dot Menu */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsMenuOpen((v) => !v);
            }}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-[#282d3f] transition"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {isMenuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-full mt-1 w-36 bg-[#181a26] border border-[#282d3f] rounded-lg shadow-xl z-50 py-1 text-xs text-slate-200"
            >
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  onOpen();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-600 hover:text-white transition"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Open Studio</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  onRename();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#282d3f] transition"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Rename</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  onExport();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#282d3f] transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export ZIP</span>
              </button>
              <div className="my-1 border-t border-[#282d3f]" />
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  onDelete();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Center Horizontal Preview Strip */}
      <div className="mt-3 min-w-0">
        {thumbUrls.length > 0 ? (
          <div className="flex items-center gap-2 overflow-hidden py-1">
            {thumbUrls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt=""
                className="w-14 h-18 object-cover rounded-md border border-[#282d3f] shrink-0 shadow-sm"
              />
            ))}
            {pageCount > MAX_PREVIEW_THUMBNAILS && (
              <div className="w-14 h-18 rounded-md bg-[#1c1f2e] border border-[#282d3f] flex items-center justify-center text-xs font-semibold text-slate-400 shrink-0">
                +{pageCount - MAX_PREVIEW_THUMBNAILS}
              </div>
            )}
          </div>
        ) : (
          <div className="h-18 rounded-lg border border-dashed border-[#282d3f] flex flex-col items-center justify-center text-xs text-slate-500 px-3 text-center">
            <Layers className="w-4 h-4 mb-1 text-slate-600" />
            <span>No images yet. Drop files or add from library.</span>
          </div>
        )}
      </div>
    </div>
  );
};
