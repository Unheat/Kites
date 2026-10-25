import React, { useState } from 'react';
import { Search, ArrowUpDown, FolderPlus, Plus, ZoomIn, ZoomOut } from 'lucide-react';
import type { ProjectFolder } from '../../db';
import { ProjectCard } from './ProjectCard';

/** Minimum thumbnail size slider setting in rem units. */
const MIN_TILE_SIZE_REM = 5.0;

/** Maximum thumbnail size slider setting in rem units. */
const MAX_TILE_SIZE_REM = 14.0;

/** Default tile size slider setting in rem units. */
const DEFAULT_TILE_SIZE_REM = 8.0;

export type ProjectSortKey = 'modified' | 'created' | 'name';

export interface ProjectsGridProps {
  projects: ProjectFolder[];
  selectedProjectId: number | null;
  onSelectProject: (projectId: number) => void;
  onOpenProject: (projectId: number) => void;
  onRenameProject: (projectId: number) => void;
  onDeleteProject: (projectId: number) => void;
  onExportProject: (projectId: number) => void;
  onCreateProject: () => void;
}

export const ProjectsGrid: React.FC<ProjectsGridProps> = ({
  projects,
  selectedProjectId,
  onSelectProject,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
  onExportProject,
  onCreateProject,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<ProjectSortKey>('modified');
  const [sortAsc, setSortAsc] = useState(false);
  const [tileSizeRem, setTileSizeRem] = useState(DEFAULT_TILE_SIZE_REM);

  // Filter projects by search query
  const filteredProjects = projects.filter((p) =>
    searchQuery.trim() === '' ? true : p.title.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  // Sort projects
  const sortedProjects = [...filteredProjects].sort((a, b) => {
    let diff = 0;
    if (sortKey === 'name') {
      diff = a.title.localeCompare(b.title);
    } else if (sortKey === 'created') {
      diff = a.timestamp - b.timestamp;
    } else {
      // modified
      diff = (a.updatedAt || a.timestamp) - (b.updatedAt || b.timestamp);
    }
    return sortAsc ? diff : -diff;
  });

  return (
    <main className="flex-1 flex flex-col bg-[#090a0f] min-w-0 overflow-hidden select-none">
      {/* Top Header Bar */}
      <div className="h-14 px-6 border-b border-[#282d3f] bg-[#12141c]/50 flex items-center justify-between gap-4 shrink-0">
        {/* Left: Breadcrumbs & Counter */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="px-2.5 py-1 rounded-md bg-blue-500/15 text-blue-400 font-bold text-xs uppercase tracking-wider">
            Projects
          </span>
          <span className="text-xs text-slate-500 font-medium">
            ({sortedProjects.length} {sortedProjects.length === 1 ? 'project' : 'projects'})
          </span>
        </div>

        {/* Right: Search & Sort controls */}
        <div className="flex items-center gap-3">
          {/* Search Bar */}
          <div className="relative w-48 sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects..."
              className="w-full h-8 pl-8 pr-3 text-xs rounded-lg bg-[#181a26] border border-[#282d3f] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          {/* Sort Menu */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as ProjectSortKey)}
              className="h-8 px-2 rounded-lg bg-[#181a26] border border-[#282d3f] text-slate-300 text-xs focus:outline-none focus:border-blue-500 transition cursor-pointer"
            >
              <option value="modified">Date modified</option>
              <option value="created">Date created</option>
              <option value="name">Name</option>
            </select>
            <button
              type="button"
              onClick={() => setSortAsc((v) => !v)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#181a26] border border-transparent hover:border-[#282d3f] transition"
              title={sortAsc ? 'Ascending' : 'Descending'}
            >
              <span className="text-[0.65rem] font-bold">{sortAsc ? 'ASC' : 'DESC'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid View */}
      <div className="flex-1 overflow-y-auto p-6">
        {sortedProjects.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sortedProjects.map((project) => {
              const isSelected = project.id !== undefined && project.id === selectedProjectId;
              return (
                <ProjectCard
                  key={project.id}
                  project={project}
                  isSelected={isSelected}
                  tileSizeRem={tileSizeRem}
                  onSelect={() => project.id && onSelectProject(project.id)}
                  onOpen={() => project.id && onOpenProject(project.id)}
                  onRename={() => project.id && onRenameProject(project.id)}
                  onDelete={() => project.id && onDeleteProject(project.id)}
                  onExport={() => project.id && onExportProject(project.id)}
                />
              );
            })}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-3xl bg-[#12141c] border border-[#282d3f] flex items-center justify-center text-slate-600 mb-4">
              <FolderPlus className="w-8 h-8" />
            </div>
            <h3 className="text-base font-semibold text-slate-200">No manga projects found</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm leading-relaxed">
              {searchQuery ? 'No projects match your search query.' : 'Create your first project or group translated pages together.'}
            </p>
            <button
              type="button"
              onClick={onCreateProject}
              className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition"
            >
              <Plus className="w-4 h-4" />
              <span>Create Project</span>
            </button>
          </div>
        )}
      </div>

      {/* Bottom Floating Bar: Zoom Slider & New Project */}
      <div className="h-14 px-6 border-t border-[#282d3f] bg-[#12141c]/60 flex items-center justify-between shrink-0">
        {/* Left: Tile Scale Slider */}
        <div className="flex items-center gap-2">
          <ZoomOut className="w-3.5 h-3.5 text-slate-500" />
          <input
            type="range"
            min={MIN_TILE_SIZE_REM}
            max={MAX_TILE_SIZE_REM}
            step={0.5}
            value={tileSizeRem}
            onChange={(e) => setTileSizeRem(parseFloat(e.target.value))}
            className="w-28 sm:w-40 h-1.5 bg-[#282d3f] rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <ZoomIn className="w-3.5 h-3.5 text-slate-500" />
        </div>

        {/* Right: + New Project Button */}
        <button
          type="button"
          onClick={onCreateProject}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition"
        >
          <Plus className="w-4 h-4" />
          <span>New project</span>
        </button>
      </div>
    </main>
  );
};
