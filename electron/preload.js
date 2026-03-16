'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Projects
  getProjects: () => ipcRenderer.invoke('projects:get-all'),
  addProject: (data) => ipcRenderer.invoke('projects:add', data),
  removeProject: (id) => ipcRenderer.invoke('projects:remove', id),
  updateProject: (id, updates) => ipcRenderer.invoke('projects:update', id, updates),

  // Process management
  startProcess: (id) => ipcRenderer.invoke('process:start', id),
  stopProcess: (id) => ipcRenderer.invoke('process:stop', id),
  restartProcess: (id) => ipcRenderer.invoke('process:restart', id),
  runCommand: (id, cmd) => ipcRenderer.invoke('process:run-command', id, cmd),
  getStatus: (id) => ipcRenderer.invoke('process:get-status', id),

  // Git
  getGitInfo: (projectPath) => ipcRenderer.invoke('git:get-info', projectPath),
  getBranches: (projectPath) => ipcRenderer.invoke('git:get-branches', projectPath),
  checkoutBranch: (projectPath, branch) => ipcRenderer.invoke('git:checkout', projectPath, branch),

  // Editors
  getInstalledEditors: () => ipcRenderer.invoke('editors:get-installed'),
  openInEditor: (editor, projectPath) => ipcRenderer.invoke('editors:open', editor, projectPath),

  // PTY
  createPty: (projectId, type) => ipcRenderer.invoke('pty:create', projectId, type),
  ptyInput: (sessionId, data) => ipcRenderer.send('pty:input', sessionId, data),
  ptyResize: (sessionId, cols, rows) => ipcRenderer.send('pty:resize', sessionId, cols, rows),
  destroyPty: (sessionId) => ipcRenderer.invoke('pty:destroy', sessionId),

  // Claude
  checkClaude: () => ipcRenderer.invoke('claude:check'),
  openClaudeExternal: (projectPath) => ipcRenderer.invoke('claude:open-external', projectPath),

  // Terminals
  getInstalledTerminals: () => ipcRenderer.invoke('terminals:get-installed'),
  openInTerminal: (terminalId, projectPath) => ipcRenderer.invoke('terminal:open', terminalId, projectPath),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (updates) => ipcRenderer.invoke('settings:set', updates),

  // Dialog
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),

  // Event listeners (renderer ← main)
  onLogOutput: (callback) => {
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on('log:output', handler);
    return () => ipcRenderer.removeListener('log:output', handler);
  },
  onPtyOutput: (callback) => {
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on('pty:output', handler);
    return () => ipcRenderer.removeListener('pty:output', handler);
  },
  onProcessStatusUpdate: (callback) => {
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on('process:status-update', handler);
    return () => ipcRenderer.removeListener('process:status-update', handler);
  },
  onGitUpdate: (callback) => {
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on('git:update', handler);
    return () => ipcRenderer.removeListener('git:update', handler);
  },
});
