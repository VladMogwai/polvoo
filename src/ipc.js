// Thin wrappers around window.electronAPI for use in React components/hooks

export const api = window.electronAPI;

export const getProjects = () => api.getProjects();
export const addProject = (data) => api.addProject(data);
export const removeProject = (id) => api.removeProject(id);
export const updateProject = (id, updates) => api.updateProject(id, updates);

export const startProcess = (id) => api.startProcess(id);
export const stopProcess = (id) => api.stopProcess(id);
export const restartProcess = (id) => api.restartProcess(id);
export const runCommand = (id, cmd) => api.runCommand(id, cmd);

export const getGitInfo = (path) => api.getGitInfo(path);
export const getBranches = (path) => api.getBranches(path);
export const checkoutBranch = (path, branch) => api.checkoutBranch(path, branch);

export const getInstalledEditors = () => api.getInstalledEditors();
export const openInEditor = (editor, path) => api.openInEditor(editor, path);

export const createPty = (projectId, type) => api.createPty(projectId, type);
export const ptyInput = (sessionId, data) => api.ptyInput(sessionId, data);
export const ptyResize = (sessionId, cols, rows) => api.ptyResize(sessionId, cols, rows);
export const destroyPty = (sessionId) => api.destroyPty(sessionId);

export const checkClaude = () => api.checkClaude();
export const openClaudeExternal = (path) => api.openClaudeExternal(path);
export const openFolderDialog = () => api.openFolderDialog();

export const getInstalledTerminals = () => api.getInstalledTerminals();
export const openInTerminal = (terminalId, path) => api.openInTerminal(terminalId, path);
export const getSettings = () => api.getSettings();
export const setSettings = (updates) => api.setSettings(updates);

// Event listener helpers — each returns an unsubscribe function
export const onLogOutput = (cb) => api.onLogOutput(cb);
export const onPtyOutput = (cb) => api.onPtyOutput(cb);
export const onProcessStatusUpdate = (cb) => api.onProcessStatusUpdate(cb);
export const onGitUpdate = (cb) => api.onGitUpdate(cb);
