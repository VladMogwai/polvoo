import React from 'react';
import ProjectTile from './ProjectTile';

export default function ProjectGrid({
  projects,
  gitInfo,
  selectedProject,
  onSelect,
  onStatusChange,
  onAddProject,
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="titlebar-spacer flex items-end px-6 pb-3">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-100">Dev Dashboard</h1>
              <p className="text-xs text-slate-500">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <button
            onClick={onAddProject}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Project
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center">
              <svg className="w-8 h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
              </svg>
            </div>
            <div>
              <p className="text-slate-400 font-medium text-sm">No projects yet</p>
              <p className="text-slate-600 text-xs mt-1">Click "Add Project" to get started</p>
            </div>
            <button
              onClick={onAddProject}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Add your first project
            </button>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {projects.map((project) => (
              <ProjectTile
                key={project.id}
                project={project}
                gitInfo={gitInfo[project.id]}
                isSelected={selectedProject?.id === project.id}
                onSelect={onSelect}
                onStatusChange={onStatusChange}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
