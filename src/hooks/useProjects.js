import { useState, useEffect, useCallback } from 'react';
import {
  getProjects,
  addProject as ipcAddProject,
  removeProject as ipcRemoveProject,
  onProcessStatusUpdate,
  onGitUpdate,
} from '../ipc';

export function useProjects() {
  const [projects, setProjects] = useState([]);
  const [gitInfo, setGitInfo] = useState({}); // projectId -> { branch, lastCommit }
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const list = await getProjects();
    setProjects(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();

    const unsubStatus = onProcessStatusUpdate(({ projectId, status }) => {
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, status } : p))
      );
    });

    const unsubGit = onGitUpdate(({ projectId, branch, lastCommit, isRepo }) => {
      setGitInfo((prev) => ({
        ...prev,
        [projectId]: { branch, lastCommit, isRepo },
      }));
    });

    return () => {
      unsubStatus();
      unsubGit();
    };
  }, [refresh]);

  const addProject = useCallback(async (data) => {
    const project = await ipcAddProject(data);
    setProjects((prev) => [...prev, project]);
    return project;
  }, []);

  const removeProject = useCallback(async (id) => {
    await ipcRemoveProject(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const updateProjectStatus = useCallback((projectId, status) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, status } : p))
    );
  }, []);

  return {
    projects,
    gitInfo,
    loading,
    addProject,
    removeProject,
    updateProjectStatus,
    refresh,
  };
}
