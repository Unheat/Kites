import React, { useEffect, useState } from 'react';
import {
  Layers,
  ChevronLeft,
  ChevronRight,
  Plus,
  Download,
  FileText,
  FileCode,
  Image as ImageIcon,
  CheckCircle2,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { db, type TranslationJob } from '../../db';
import { exportProjectBundle, type BatchExportFormat } from '../export/batchExport';
import { getTranslatedPageThumbnailUrl } from '../canvas/thumbnailRenderer';

export interface PageRailProps {
  projectId: number;
  activeJobId?: number;
  onSelectPage: (jobId: number) => void;
  onOpenAddFromLibrary: () => void;
}

interface PageItem {
  job: TranslationJob;
  thumbUrl: string | null;
}

export const PageRail: React.FC<PageRailProps> = ({
  projectId,
  activeJobId,
  onSelectPage,
  onOpenAddFromLibrary,
}) => {
  const [pages, setPages] = useState<PageItem[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    const loadPages = async () => {
      const jobs = await db.translationJobs
        .where('folderId')
        .equals(projectId)
        .sortBy('projectOrder');

      if (isCancelled) return;

      const items: PageItem[] = [];
      for (const job of jobs) {
        if (isCancelled) break;
        let thumbUrl: string | null = null;
        if (job.id) {
          thumbUrl = await getTranslatedPageThumbnailUrl(job.id, 350);
        }
        items.push({ job, thumbUrl });
      }

      if (!isCancelled) {
        setPages(items);
      }
    };

    void loadPages();

    return () => {
      isCancelled = true;
    };
  }, [projectId]);

  const handleExport = async (format: BatchExportFormat) => {
    setExportMenuOpen(false);
    setIsExporting(true);
    try {
      await exportProjectBundle(projectId, format);
    } catch (err) {
      console.error('[PageRail] Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  if (isCollapsed) {
    return (
      <div className="h-full flex flex-col items-center justify-between py-2 px-1 bg-[#12141c] border border-[#262a3b] rounded-xl shadow-2xl shrink-0 z-30 select-none">
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1c1f2e] transition cursor-pointer"
          title="Expand Pages Rail"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <div className="[writing-mode:vertical-rl] rotate-180 text-xs font-semibold text-slate-400 tracking-wider">
          {pages.length} Pages
        </div>
        <div />
      </div>
    );
  }

  return (
    <aside className="w-48 h-full bg-[#12141c] border border-[#262a3b] rounded-xl shadow-2xl flex flex-col justify-between overflow-hidden shrink-0 z-30 select-none">
      {/* Top Header */}
      <div className="h-9 px-3 border-b border-[#262a3b] bg-[#141724] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
          <Layers className="w-3.5 h-3.5 text-[#f4446d]" />
          <span>Pages ({pages.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onOpenAddFromLibrary}
            className="p-1 rounded-md text-[#f4446d] hover:text-white hover:bg-[#f4446d] transition cursor-pointer"
            title="Add pages from library"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsCollapsed(true)}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-[#1c1f2e] transition cursor-pointer"
            title="Collapse rail"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Pages List */}
      <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-2">
        {pages.map(({ job, thumbUrl }, index) => {
          const isActive = job.id === activeJobId;
          const isDone = job.status === 'completed';
          const isError = job.status === 'error';

          return (
            <div
              key={job.id}
              onClick={() => job.id && onSelectPage(job.id)}
              className={`group relative flex items-center gap-2 p-1.5 rounded-lg border cursor-pointer transition ${
                isActive
                  ? 'bg-[#f4446d]/15 border-[#f4446d] ring-1 ring-[#f4446d]/30 shadow-sm'
                  : 'bg-[#161924] border-[#262a3b] hover:border-slate-500'
              }`}
            >
              {/* Thumbnail */}
              <div className="w-10 h-14 rounded bg-[#090a0f] border border-[#262a3b] overflow-hidden shrink-0 flex items-center justify-center">
                {thumbUrl ? (
                  <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon className="w-4 h-4 text-slate-600" />
                )}
              </div>

              {/* Page Number & Status */}
              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
                  <span className="truncate">{job.pageName || `P.${index + 1}`}</span>
                  {isDone ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : isError ? (
                    <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  )}
                </div>
                <span className="text-[0.65rem] text-slate-500 truncate mt-0.5">#{job.id}</span>
              </div>
            </div>
          );
        })}

        {pages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 text-xs text-slate-500">
            <Layers className="w-6 h-6 mb-1 opacity-40 text-slate-600" />
            <span>No pages in this project.</span>
            <button
              type="button"
              onClick={onOpenAddFromLibrary}
              className="mt-2 text-xs text-[#f4446d] hover:underline font-semibold cursor-pointer"
            >
              + Add pages
            </button>
          </div>
        )}
      </div>

      {/* Bottom Export Bar */}
      <div className="p-2 border-t border-[#262a3b] bg-[#141724] relative shrink-0">
        <button
          type="button"
          disabled={pages.length === 0 || isExporting}
          onClick={() => setExportMenuOpen((v) => !v)}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 text-xs font-semibold rounded-lg bg-[#181a26] hover:bg-[#202436] disabled:opacity-40 text-slate-200 transition border border-[#262a3b] cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-slate-400" />
          <span>{isExporting ? 'Exporting...' : 'Export All'}</span>
        </button>

        {exportMenuOpen && (
          <div className="absolute bottom-full left-2 right-2 mb-1 bg-[#161924] border border-[#262a3b] rounded-lg shadow-xl z-50 py-1 text-xs text-slate-200">
            <button
              type="button"
              onClick={() => handleExport('images')}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#262a3b] transition text-left cursor-pointer"
            >
              <Download className="w-3 h-3 text-[#f4446d]" />
              <span>Standard ZIP</span>
            </button>
            <button
              type="button"
              onClick={() => handleExport('cbz')}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#262a3b] transition text-left cursor-pointer"
            >
              <FileText className="w-3 h-3 text-emerald-400" />
              <span>Comic CBZ</span>
            </button>
            <button
              type="button"
              onClick={() => handleExport('psd')}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#262a3b] transition text-left cursor-pointer"
            >
              <FileCode className="w-3 h-3 text-purple-400" />
              <span>Layered PSD</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};
