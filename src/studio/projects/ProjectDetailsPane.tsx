import React, { useEffect, useState } from 'react';
import {
  Layers,
  FolderOpen,
  PlusCircle,
  Download,
  Calendar,
  Clock,
  Sparkles,
  FileCode,
  FileText,
  ChevronDown,
} from 'lucide-react';
import { db, type ProjectFolder } from '../../db';
import { getProjectStats, type ProjectStats } from '../state/projectStore';
import { getTranslatedPageThumbnailUrl } from '../canvas/thumbnailRenderer';
import type { BatchExportFormat } from '../export/batchExport';

export interface ProjectDetailsPaneProps {
  project: ProjectFolder | null;
  onOpenStudio: () => void;
  onAddFromLibrary: () => void;
  onBatchExport: (format: BatchExportFormat) => void;
}

export const ProjectDetailsPane: React.FC<ProjectDetailsPaneProps> = ({
  project,
  onOpenStudio,
  onAddFromLibrary,
  onBatchExport,
}) => {
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    const loadDetails = async () => {
      if (!project || !project.id) {
        setStats(null);
        setCoverUrl(null);
        return;
      }

      const pStats = await getProjectStats(project.id);
      if (isCancelled) return;
      setStats(pStats);

      // Load cover thumbnail
      const coverTargetId = project.coverJobId;
      let targetJob = coverTargetId ? await db.translationJobs.get(coverTargetId) : null;
      if (!targetJob) {
        targetJob = await db.translationJobs
          .where('folderId')
          .equals(project.id)
          .first();
      }

      if (targetJob && targetJob.id) {
        const thumbUrl = await getTranslatedPageThumbnailUrl(targetJob.id, 600);
        if (!isCancelled) {
          setCoverUrl(thumbUrl);
        }
      }
    };

    void loadDetails();

    return () => {
      isCancelled = true;
    };
  }, [project]);

  if (!project) {
    return (
      <aside className="w-80 bg-[#12141c] border-l border-[#262a3b] flex flex-col items-center justify-center p-6 text-center select-none shrink-0">
        <div className="w-12 h-12 rounded-2xl bg-[#161924] border border-[#262a3b] flex items-center justify-center text-slate-500 mb-3 shadow-inner">
          <Layers className="w-6 h-6 text-[#f4446d]/40" />
        </div>
        <h4 className="text-sm font-semibold text-slate-300">No project selected</h4>
        <p className="text-xs text-slate-500 mt-1 max-w-[200px] leading-relaxed">
          Select a project to inspect its translation progress, chapters, and export packages.
        </p>
      </aside>
    );
  }

  const createdDate = new Date(project.timestamp).toLocaleDateString(undefined, { dateStyle: 'medium' });
  const updatedDate = new Date(project.updatedAt || project.timestamp).toLocaleDateString(undefined, { dateStyle: 'medium' });
  const totalPages = stats?.pageCount || 0;
  const translated = stats?.translatedCount || 0;
  const progressPercent = totalPages > 0 ? Math.round((translated / totalPages) * 100) : 0;
  const sizeMB = stats ? (stats.totalBytes / (1024 * 1024)).toFixed(1) : '0';

  return (
    <aside className="w-80 bg-[#12141c] border-l border-[#262a3b] flex flex-col justify-between p-4 overflow-y-auto select-none shrink-0">
      <div className="flex flex-col gap-5">
        {/* Section Header */}
        <div className="flex items-center justify-between">
          <span className="text-[0.65rem] uppercase font-bold tracking-wider text-slate-400">Details</span>
        </div>

        {/* Cover Banner */}
        <div className="relative w-full h-44 rounded-xl overflow-hidden bg-[#161924] border border-[#262a3b] flex items-center justify-center shadow-inner">
          {coverUrl ? (
            <img src={coverUrl} alt="Cover" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center text-slate-500 text-xs gap-1">
              <Layers className="w-8 h-8 opacity-40 text-slate-600" />
              <span>No cover page</span>
            </div>
          )}
        </div>

        {/* Title & Metadata */}
        <div>
          <h2 className="text-base font-bold text-slate-100 truncate" title={project.title}>
            {project.title}
          </h2>
          <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
            <span>{totalPages} {totalPages === 1 ? 'page' : 'pages'}</span>
            <span>•</span>
            <span>{sizeMB} MB</span>
          </div>
        </div>

        {/* Translation Progress Section */}
        <div className="flex flex-col gap-2 p-3 rounded-xl bg-[#161924] border border-[#262a3b]">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span>Progress</span>
            <span className="text-[#f4446d] tabular-nums font-bold">{progressPercent}%</span>
          </div>

          <div className="w-full h-2 bg-[#262a3b] rounded-full overflow-hidden flex">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progressPercent}%` }} />
            {stats && stats.errorCount > 0 && (
              <div
                className="h-full bg-red-500 transition-all"
                style={{ width: `${Math.round((stats.errorCount / totalPages) * 100)}%` }}
              />
            )}
          </div>

          <div className="flex items-center justify-between text-[0.7rem] text-slate-400 pt-1">
            <span className="flex items-center gap-1 text-emerald-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {translated} Translated
            </span>
            <span className="flex items-center gap-1 text-slate-500">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
              {stats?.pendingCount || 0} Pending
            </span>
          </div>
        </div>

        {/* Translation Stats Chips */}
        <div className="flex flex-col gap-2.5 text-xs text-slate-400">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#f4446d]" />
              <span>Dialogue Bubbles</span>
            </span>
            <span className="font-semibold text-slate-200 tabular-nums">{stats?.totalTextBlocks || 0}</span>
          </div>

          {stats && stats.languages.length > 0 && (
            <div className="flex items-center justify-between">
              <span>Target Languages</span>
              <div className="flex gap-1">
                {stats.languages.map((lang) => (
                  <span
                    key={lang}
                    className="px-1.5 py-0.5 rounded text-[0.65rem] font-bold uppercase bg-[#f4446d]/15 text-[#f4446d] border border-[#f4446d]/30"
                  >
                    {lang}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-1 border-t border-[#262a3b]/60 text-[0.7rem]">
            <span className="flex items-center gap-1 text-slate-500">
              <Calendar className="w-3 h-3" /> Created
            </span>
            <span className="text-slate-400">{createdDate}</span>
          </div>

          <div className="flex items-center justify-between text-[0.7rem]">
            <span className="flex items-center gap-1 text-slate-500">
              <Clock className="w-3 h-3" /> Modified
            </span>
            <span className="text-slate-400">{updatedDate}</span>
          </div>
        </div>
      </div>

      {/* Bottom CTA Action Buttons */}
      <div className="flex flex-col gap-2 pt-4 border-t border-[#262a3b]">
        <button
          type="button"
          onClick={onOpenStudio}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-[#f4446d] hover:bg-[#e0335c] text-white text-xs font-semibold shadow-md shadow-[rgba(244,68,109,0.25)] transition cursor-pointer"
        >
          <FolderOpen className="w-4 h-4" />
          <span>Open in Studio</span>
        </button>

        <button
          type="button"
          onClick={onAddFromLibrary}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-[#161924] hover:bg-[#202436] border border-[#262a3b] text-slate-200 text-xs font-semibold transition cursor-pointer"
        >
          <PlusCircle className="w-3.5 h-3.5 text-[#f4446d]" />
          <span>Add Pages from Library</span>
        </button>

        {/* Export Options Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsExportMenuOpen((v) => !v)}
            className="w-full flex items-center justify-between py-2 px-3 rounded-lg bg-[#161924] hover:bg-[#202436] border border-[#262a3b] text-slate-300 text-xs font-medium transition cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Download className="w-3.5 h-3.5 text-slate-400" />
              <span>Export Package</span>
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {isExportMenuOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-1 bg-[#161924] border border-[#262a3b] rounded-lg shadow-xl z-50 py-1 text-xs text-slate-200">
              <button
                type="button"
                onClick={() => {
                  setIsExportMenuOpen(false);
                  onBatchExport('images');
                }}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#262a3b] transition text-left cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#f4446d]" />
                <div>
                  <div className="font-semibold">Standard ZIP</div>
                  <div className="text-[0.65rem] text-slate-400">Numbered image scans</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsExportMenuOpen(false);
                  onBatchExport('cbz');
                }}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#262a3b] transition text-left cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-emerald-400" />
                <div>
                  <div className="font-semibold">Comic Book CBZ</div>
                  <div className="text-[0.65rem] text-slate-400">For comic reader apps</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsExportMenuOpen(false);
                  onBatchExport('psd');
                }}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#262a3b] transition text-left cursor-pointer"
              >
                <FileCode className="w-3.5 h-3.5 text-purple-400" />
                <div>
                  <div className="font-semibold">Layered Photoshop PSD</div>
                  <div className="text-[0.65rem] text-slate-400">Clean art + editable text</div>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
