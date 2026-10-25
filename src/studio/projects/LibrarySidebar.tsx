import React, { useEffect, useState } from 'react';
import {
  HardDrive,
  FolderOpen,
  Download,
  Edit2,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  FolderPlus,
} from 'lucide-react';
import {
  getStorageQuota,
  requestPersistentStorage,
  type StorageQuotaInfo,
  HIGH_STORAGE_WARNING_THRESHOLD_PERCENT,
} from '../state/projectStore';
import type { ProjectFolder } from '../../db';

export interface LibrarySidebarProps {
  totalProjects: number;
  totalImages: number;
  selectedProject: ProjectFolder | null;
  onOpenSelected: () => void;
  onExportSelected: () => void;
  onRenameSelected: () => void;
  onDeleteSelected: () => void;
  onCreateNewProject: () => void;
}

export const LibrarySidebar: React.FC<LibrarySidebarProps> = ({
  totalProjects,
  totalImages,
  selectedProject,
  onOpenSelected,
  onExportSelected,
  onRenameSelected,
  onDeleteSelected,
  onCreateNewProject,
}) => {
  const [quota, setQuota] = useState<StorageQuotaInfo | null>(null);
  const [isPersisted, setIsPersisted] = useState(false);

  useEffect(() => {
    void getStorageQuota().then((q) => {
      setQuota(q);
      setIsPersisted(q.persisted);
    });
  }, []);

  const handleRequestPersistence = async () => {
    const granted = await requestPersistentStorage();
    setIsPersisted(granted);
    if (granted) {
      const fresh = await getStorageQuota();
      setQuota(fresh);
    }
  };

  const isSelected = selectedProject !== null;

  return (
    <aside className="w-72 bg-[#12141c] border-r border-[#282d3f] flex flex-col justify-between p-4 shrink-0 select-none">
      {/* Top Section: Library Stats & Storage */}
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[0.65rem] uppercase font-bold tracking-wider text-slate-400">Library</span>
            <button
              type="button"
              onClick={onCreateNewProject}
              className="flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300 transition"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>New</span>
            </button>
          </div>
          <div className="mt-2 flex items-baseline gap-3 text-slate-200">
            <span className="text-xl font-bold">{totalProjects}</span>
            <span className="text-xs text-slate-400">{totalProjects === 1 ? 'project' : 'projects'}</span>
            <span className="text-slate-600">•</span>
            <span className="text-xl font-bold">{totalImages}</span>
            <span className="text-xs text-slate-400">{totalImages === 1 ? 'page' : 'pages'}</span>
          </div>
        </div>

        {/* Storage Quota Card */}
        <div className="flex flex-col gap-2 p-3 rounded-xl bg-[#181a26] border border-[#282d3f]">
          <div className="flex items-center justify-between text-xs font-medium text-slate-300">
            <div className="flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-slate-400" />
              <span>Storage</span>
            </div>
            {isPersisted ? (
              <span className="flex items-center gap-1 text-[0.65rem] text-emerald-400 font-semibold" title="Protected against browser eviction">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Protected</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={handleRequestPersistence}
                className="text-[0.65rem] text-blue-400 hover:text-blue-300 underline font-semibold"
                title="Lock browser from auto-clearing storage"
              >
                Protect
              </button>
            )}
          </div>

          {/* Progress bar */}
          <div className="w-full h-1.5 bg-[#282d3f] rounded-full overflow-hidden mt-1">
            <div
              className={`h-full rounded-full transition-all ${
                quota && quota.usagePercent > HIGH_STORAGE_WARNING_THRESHOLD_PERCENT
                  ? 'bg-amber-500'
                  : 'bg-blue-500'
              }`}
              style={{ width: `${quota ? Math.max(2, quota.usagePercent) : 2}%` }}
            />
          </div>

          <div className="text-[0.7rem] text-slate-400 tabular-nums">
            {quota
              ? `${quota.usedMB} MB of ${quota.quotaMB >= 1000 ? `${(quota.quotaMB / 1000).toFixed(0)} GB` : `${quota.quotaMB} MB`} used`
              : 'Calculating quota...'}
          </div>

          {/* Backup Advisory */}
          <div className="mt-1 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[0.7rem] text-amber-200/90 leading-tight flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <span>Manga projects are saved in this browser. Download ZIP or CBZ backups to keep permanent copies.</span>
          </div>
        </div>
      </div>

      {/* Bottom Section: Actions on Selected Project */}
      <div className="flex flex-col gap-2 pt-4 border-t border-[#282d3f]">
        <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
          <span className="uppercase text-[0.65rem] tracking-wider font-bold">Actions</span>
          <span className="text-[0.65rem] truncate text-slate-500">
            {isSelected ? selectedProject.title : 'Select a project'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-1">
          <button
            type="button"
            disabled={!isSelected}
            onClick={onOpenSelected}
            className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:pointer-events-none text-white transition shadow-sm"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Open</span>
          </button>

          <button
            type="button"
            disabled={!isSelected}
            onClick={onExportSelected}
            className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-lg bg-[#1c1f2e] hover:bg-[#282d3f] disabled:opacity-40 disabled:pointer-events-none text-slate-200 transition border border-[#282d3f]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>

          <button
            type="button"
            disabled={!isSelected}
            onClick={onRenameSelected}
            className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-lg bg-[#1c1f2e] hover:bg-[#282d3f] disabled:opacity-40 disabled:pointer-events-none text-slate-200 transition border border-[#282d3f]"
          >
            <Edit2 className="w-3.5 h-3.5" />
            <span>Rename</span>
          </button>

          <button
            type="button"
            disabled={!isSelected}
            onClick={onDeleteSelected}
            className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold rounded-lg bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 disabled:pointer-events-none text-red-400 transition border border-red-500/20"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
