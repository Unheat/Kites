import React, { useCallback, useEffect, useState } from 'react';
import { db, type ProjectFolder } from '../../db';
import { createProject, deleteProject, renameProject } from '../state/projectStore';
import { exportProjectBundle, type BatchExportFormat } from '../export/batchExport';
import { LibrarySidebar } from './LibrarySidebar';
import { ProjectsGrid } from './ProjectsGrid';
import { ProjectDetailsPane } from './ProjectDetailsPane';

export interface ProjectsDashboardProps {
  onOpenProject: (projectId: number) => void;
  onOpenAddFromLibrary: (projectId: number) => void;
  onBackToEditor?: () => void;
}

export const ProjectsDashboard: React.FC<ProjectsDashboardProps> = ({
  onOpenProject,
  onOpenAddFromLibrary,
  onBackToEditor,
}) => {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [renameTarget, setRenameTarget] = useState<ProjectFolder | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ProjectFolder | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgressText, setExportProgressText] = useState('');

  const [projects, setProjects] = useState<ProjectFolder[]>([]);
  const [totalImages, setTotalImages] = useState(0);

  const refreshProjects = useCallback(async () => {
    try {
      const allProjects = await db.projectFolders.toArray();
      const count = await db.translationJobs.count();
      setProjects(allProjects);
      setTotalImages(count);
    } catch (err) {
      console.warn('[ProjectsDashboard] Failed loading projects:', err);
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

  const handleCreateProject = async () => {
    const newId = await createProject();
    await refreshProjects();
    setSelectedProjectId(newId);
  };

  const handleStartRename = (projectId: number) => {
    const proj = projects.find((p) => p.id === projectId);
    if (!proj) return;
    setRenameTarget(proj);
    setRenameValue(proj.title);
  };

  const handleConfirmRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !renameTarget.id || !renameValue.trim()) return;
    await renameProject(renameTarget.id, renameValue);
    await refreshProjects();
    setRenameTarget(null);
  };

  const handleStartDelete = (projectId: number) => {
    const proj = projects.find((p) => p.id === projectId);
    if (proj) setDeleteTarget(proj);
  };

  const handleConfirmDelete = async (cascade: boolean) => {
    if (!deleteTarget || !deleteTarget.id) return;
    await deleteProject(deleteTarget.id, cascade);
    await refreshProjects();
    if (selectedProjectId === deleteTarget.id) {
      setSelectedProjectId(null);
    }
    setDeleteTarget(null);
  };

  const handleBatchExport = async (format: BatchExportFormat) => {
    if (!selectedProjectId) return;
    setIsExporting(true);
    setExportProgressText('Preparing export bundle...');
    try {
      await exportProjectBundle(selectedProjectId, format, (_cur, _tot, status) => {
        setExportProgressText(status);
      });
    } catch (err) {
      console.error('[Dashboard] Export failed:', err);
      alert(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
      setExportProgressText('');
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#090a0f] text-slate-100 flex">
      {/* Left Library Sidebar */}
      <LibrarySidebar
        totalProjects={projects.length}
        totalImages={totalImages}
        selectedProject={selectedProject}
        onOpenSelected={() => selectedProjectId && onOpenProject(selectedProjectId)}
        onExportSelected={() => handleBatchExport('images')}
        onRenameSelected={() => selectedProjectId && handleStartRename(selectedProjectId)}
        onDeleteSelected={() => selectedProjectId && handleStartDelete(selectedProjectId)}
        onCreateNewProject={handleCreateProject}
        onBackToEditor={onBackToEditor}
      />

      {/* Center Projects Grid */}
      <ProjectsGrid
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={(id) => setSelectedProjectId(id)}
        onOpenProject={onOpenProject}
        onRenameProject={handleStartRename}
        onDeleteProject={handleStartDelete}
        onExportProject={(id) => {
          setSelectedProjectId(id);
          handleBatchExport('images');
        }}
        onCreateProject={handleCreateProject}
      />

      {/* Right Details Sidebar */}
      <ProjectDetailsPane
        project={selectedProject}
        onOpenStudio={() => selectedProjectId && onOpenProject(selectedProjectId)}
        onAddFromLibrary={() => selectedProjectId && onOpenAddFromLibrary(selectedProjectId)}
        onBatchExport={handleBatchExport}
      />

      {/* Rename Modal */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 select-none">
          <form
            onSubmit={handleConfirmRename}
            className="w-full max-w-sm rounded-xl bg-[#161924] border border-[#262a3b] p-5 shadow-2xl flex flex-col gap-4"
          >
            <h3 className="text-sm font-semibold text-slate-100">Rename Project</h3>
            <input
              type="text"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-[#090a0f] border border-[#262a3b] text-xs text-slate-100 focus:outline-none focus:border-[#f4446d]"
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white rounded-lg transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-semibold bg-[#f4446d] hover:bg-[#e0335c] text-white rounded-lg shadow-md shadow-[rgba(244,68,109,0.25)] transition cursor-pointer"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 select-none">
          <div className="w-full max-w-sm rounded-xl bg-[#161924] border border-[#262a3b] p-5 shadow-2xl flex flex-col gap-4">
            <h3 className="text-sm font-semibold text-red-400">Delete Project</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Are you sure you want to delete <strong className="text-slate-200">“{deleteTarget.title}”</strong>?
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={() => handleConfirmDelete(false)}
                className="w-full py-2 px-3 text-xs font-semibold rounded-lg bg-[#262a3b] hover:bg-[#343b52] text-slate-200 transition cursor-pointer"
              >
                Unlink Pages (Keep in Library)
              </button>
              <button
                type="button"
                onClick={() => handleConfirmDelete(true)}
                className="w-full py-2 px-3 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white transition cursor-pointer"
              >
                Delete Project and All Its Images
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="w-full py-1.5 px-3 text-xs text-slate-400 hover:text-white transition cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export In-Flight Overlay */}
      {isExporting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 select-none">
          <div className="w-full max-w-xs rounded-xl bg-[#161924] border border-[#262a3b] p-6 shadow-2xl flex flex-col items-center gap-3 text-center">
            <div className="w-8 h-8 rounded-full border-2 border-[#f4446d] border-t-transparent animate-spin" />
            <h4 className="text-sm font-semibold text-slate-100">Exporting Manga Archive</h4>
            <p className="text-xs text-slate-400">{exportProgressText || 'Packaging files...'}</p>
          </div>
        </div>
      )}
    </div>
  );
};
