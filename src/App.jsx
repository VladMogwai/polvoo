import React, { useState } from 'react';
import ProjectGrid from './components/ProjectGrid';
import DetailPanel from './components/DetailPanel';
import AddProjectModal from './components/AddProjectModal';
import { useProjects } from './hooks/useProjects';

export default function App() {
  const { projects, gitInfo, loading, addProject, removeProject, updateProjectStatus } = useProjects();
  const [selectedProject, setSelectedProject] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);

  function handleSelectProject(project) {
    setSelectedProject(project);
  }

  function handleCloseDetail() {
    setSelectedProject(null);
  }

  async function handleRemoveProject(id) {
    await removeProject(id);
    if (selectedProject?.id === id) setSelectedProject(null);
  }

  // Keep selected project in sync with latest state
  const liveSelected = selectedProject
    ? projects.find((p) => p.id === selectedProject.id) || null
    : null;

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-900">
        <div className="flex items-center gap-3 text-slate-400">
          <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Loading projects…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex overflow-hidden bg-slate-900">
      {/* Left: project grid */}
      <div
        className="flex flex-col min-w-0 transition-all duration-200"
        style={{ flex: liveSelected ? '1 1 60%' : '1 1 100%' }}
      >
        <ProjectGrid
          projects={projects}
          gitInfo={gitInfo}
          selectedProject={liveSelected}
          onSelect={handleSelectProject}
          onStatusChange={updateProjectStatus}
          onAddProject={() => setShowAddModal(true)}
        />
      </div>

      {/* Right: detail panel */}
      {liveSelected && (
        <div
          className="flex-shrink-0 overflow-hidden border-l border-slate-700/50"
          style={{ width: '42%', minWidth: 380, maxWidth: 640 }}
        >
          <DetailPanel
            project={liveSelected}
            gitInfo={gitInfo[liveSelected.id]}
            onClose={handleCloseDetail}
            onRemove={handleRemoveProject}
          />
        </div>
      )}

      {/* Add project modal */}
      {showAddModal && (
        <AddProjectModal
          onAdd={addProject}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
