import React, { useEffect, useState } from 'react';
import { MoreVertical, Folder, Layers, Trash2, Edit2, Play, Download } from 'lucide-react';
import { db, type ProjectFolder, type TranslationJob } from '../../db';
import { getTranslatedPageThumbnailUrl } from '../canvas/thumbnailRenderer';

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

  // Compute scaled preview image dimensions based on slider rem setting
  const thumbW = Math.round(tileSizeRem * 9.5); // 48px to 135px
  const thumbH = Math.round(thumbW * 1.42);      // proportional 3:4 portrait aspect

  // Load composited translated preview thumbnails for member jobs
  useEffect(() => {
    let isCancelled = false;

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
        const thumbUrl = await getTranslatedPageThumbnailUrl(job.id, 400);
        if (thumbUrl) urls.push(thumbUrl);
      }

      if (!isCancelled) {
        setThumbUrls(urls);
      }
    };

    void loadPreviews();

    return () => {
      isCancelled = true;
    };
  }, [project.id]);

  const pageCount = memberJobs.length;
  const lastActiveTime = project.updatedAt || project.timestamp;

  return (
    <div
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={`group relative flex flex-col justify-between p-4 rounded-xl border transition-all cursor-pointer select-none ${
        isSelected
          ? 'bg-[#18121a] border-[#f4446d] shadow-lg shadow-[rgba(244,68,109,0.18)] ring-1 ring-[#f4446d]/40'
          : 'bg-[#12141c] hover:bg-[#161924] border-[#262a3b] hover:border-slate-500'
      }`}
    >
      {/* Top Header Row */}
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="p-2 rounded-lg bg-[#f4446d]/15 text-[#f4446d] shrink-0">
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
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-[#262a3b] transition cursor-pointer"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {isMenuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-full mt-1 w-36 bg-[#161924] border border-[#262a3b] rounded-lg shadow-xl z-50 py-1 text-xs text-slate-200"
            >
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  onOpen();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#f4446d] hover:text-white transition cursor-pointer"
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
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#262a3b] transition cursor-pointer"
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
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#262a3b] transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export ZIP</span>
              </button>
              <div className="my-1 border-t border-[#262a3b]" />
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  onDelete();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Center Dynamic Scalable Preview Strip */}
      <div className="mt-3 min-w-0" style={{ minHeight: `${thumbH}px` }}>
        {thumbUrls.length > 0 ? (
          <div className="flex items-center gap-2 overflow-hidden py-1" style={{ height: `${thumbH + 8}px` }}>
            {thumbUrls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt=""
                style={{ width: `${thumbW}px`, height: `${thumbH}px` }}
                className="object-cover rounded-md border border-[#262a3b] shrink-0 shadow-sm transition-all duration-150"
              />
            ))}
            {pageCount > MAX_PREVIEW_THUMBNAILS && (
              <div
                style={{ width: `${thumbW}px`, height: `${thumbH}px` }}
                className="rounded-md bg-[#181a26] border border-[#262a3b] flex items-center justify-center text-xs font-semibold text-slate-400 shrink-0"
              >
                +{pageCount - MAX_PREVIEW_THUMBNAILS}
              </div>
            )}
          </div>
        ) : (
          <div
            style={{ height: `${thumbH}px` }}
            className="rounded-lg border border-dashed border-[#262a3b] flex flex-col items-center justify-center text-xs text-slate-500 px-3 text-center transition-all duration-150"
          >
            <Layers className="w-5 h-5 mb-1.5 text-slate-600 opacity-60" />
            <span className="leading-snug">No images yet. Drop files or add from library.</span>
          </div>
        )}
      </div>
    </div>
  );
};
