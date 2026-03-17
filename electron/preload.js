'use strict';

const { contextBridge, ipcRenderer, shell, webUtils } = require('electron');
const pkg = require('../package.json');

contextBridge.exposeInMainWorld('electronAPI', {
  // Projects
  getProjects: () => ipcRenderer.invoke('projects:get-all'),
  addProject: (data) => ipcRenderer.invoke('projects:add', data),
  removeProject: (id) => ipcRenderer.invoke('projects:remove', id),
  updateProject: (id, updates) => ipcRenderer.invoke('projects:update', id, updates),
  reorderProjects: (orderedIds) => ipcRenderer.invoke('projects:reorder', orderedIds),

  // Process management
  startProcess: (id) => ipcRenderer.invoke('process:start', id),
  stopProcess: (id) => ipcRenderer.invoke('process:stop', id),
  restartProcess: (id) => ipcRenderer.invoke('process:restart', id),
  runCommand: (id, cmd) => ipcRenderer.invoke('process:run-command', id, cmd),
  killCommand: (id, cmd) => ipcRenderer.invoke('process:kill-command', id, cmd),
  getStatus: (id) => ipcRenderer.invoke('process:get-status', id),
  getAllRunning: () => ipcRenderer.invoke('process:get-all-running'),
  getProcessStats: (pids) => ipcRenderer.invoke('process:get-stats', pids),
  updatePort: (projectId, port) => ipcRenderer.invoke('ports:update', projectId, port),
  getRunningPorts: (projectId) => ipcRenderer.invoke('ports:running', projectId),
  getLogBuffer: (projectId) => ipcRenderer.invoke('logs:get-buffer', projectId),
  listPorts: () => ipcRenderer.invoke('ports:list'),
  killPid: (pid) => ipcRenderer.invoke('ports:kill-pid', pid),
  killPort: (port) => ipcRenderer.invoke('ports:kill-port', port),

  // Git
  getGitInfo: (projectPath) => ipcRenderer.invoke('git:get-info', projectPath),
  getBranches: (projectPath) => ipcRenderer.invoke('git:get-branches', projectPath),
  checkoutBranch: (projectPath, branch) => ipcRenderer.invoke('git:checkout', projectPath, branch),
  createBranch: (projectPath, branchName, setUpstream) => ipcRenderer.invoke('git:create-branch', projectPath, branchName, setUpstream),

  // Editors
  getInstalledEditors: () => ipcRenderer.invoke('editors:get-installed'),
  getRunningEditors: (projectPath) => ipcRenderer.invoke('editors:get-running', projectPath),
  openInEditor: (editor, projectPath) => ipcRenderer.invoke('editors:open', editor, projectPath),

  // PTY
  createPty: (projectId, type, cols, rows) => ipcRenderer.invoke('pty:create', projectId, type, cols, rows),
  ptyInput: (sessionId, data) => ipcRenderer.send('pty:input', sessionId, data),
  ptyResize: (sessionId, cols, rows) => ipcRenderer.send('pty:resize', sessionId, cols, rows),
  destroyPty: (sessionId) => ipcRenderer.invoke('pty:destroy', sessionId),

  // Claude
  checkClaude: () => ipcRenderer.invoke('claude:check'),
  openClaudeExternal: (projectPath) => ipcRenderer.invoke('claude:open-external', projectPath),

  // Terminals
  getInstalledTerminals: () => ipcRenderer.invoke('terminals:get-installed'),
  openInTerminal: (terminalId, projectPath) => ipcRenderer.invoke('terminal:open', terminalId, projectPath),
  addCustomTerminal: (terminal) => ipcRenderer.invoke('terminals:add-custom', terminal),
  removeCustomTerminal: (id) => ipcRenderer.invoke('terminals:remove-custom', id),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (updates) => ipcRenderer.invoke('settings:set', updates),

  // Settings panel
  getPermissions: () => ipcRenderer.invoke('settings:get-permissions'),
  requestPermission: (name) => ipcRenderer.invoke('settings:request-permission', name),
  openSystemPrefs: (url) => ipcRenderer.invoke('settings:open-system-prefs', url),
  getGeneralSettings: () => ipcRenderer.invoke('settings:get-general'),
  setLaunchAtLogin: (val) => ipcRenderer.invoke('settings:set-launch-at-login', val),
  clearAllData: () => ipcRenderer.invoke('settings:clear-data'),

  // Dev rebuild
  rebuildInstall: () => ipcRenderer.invoke('dev:rebuild-install'),

  // Dock badge
  setBadgeCount: (count) => ipcRenderer.invoke('app:set-badge-count', count),

  // Dialog
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),
  pickAppDialog: () => ipcRenderer.invoke('dialog:pick-app'),

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
  onCommandStatus: (callback) => {
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on('process:command-status', handler);
    return () => ipcRenderer.removeListener('process:command-status', handler);
  },
  onGitUpdate: (callback) => {
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on('git:update', handler);
    return () => ipcRenderer.removeListener('git:update', handler);
  },
  onPortsUpdated: (callback) => {
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on('ports:updated', handler);
    return () => ipcRenderer.removeListener('ports:updated', handler);
  },
  onXcodeCltMissing: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('system:xcode-clt-missing', handler);
    return () => ipcRenderer.removeListener('system:xcode-clt-missing', handler);
  },

  getProjectScripts: (id) => ipcRenderer.invoke('projects:get-scripts', id),

  // Git history
  gitGetLog: (projectId, limit, skip) => ipcRenderer.invoke('git:getLog', projectId, limit, skip),
  gitGetFiles: (projectId, hash) => ipcRenderer.invoke('git:getFiles', projectId, hash),
  gitGetDiff: (projectId, hash) => ipcRenderer.invoke('git:getDiff', projectId, hash),
  gitGetChanges: (projectId) => ipcRenderer.invoke('git:getChanges', projectId),
  gitGetStagingStatus: (projectId) => ipcRenderer.invoke('git:getStagingStatus', projectId),
  gitStageFile: (projectId, filePath) => ipcRenderer.invoke('git:stageFile', projectId, filePath),
  gitUnstageFile: (projectId, filePath) => ipcRenderer.invoke('git:unstageFile', projectId, filePath),
  gitStageAll: (projectId) => ipcRenderer.invoke('git:stageAll', projectId),
  gitUnstageAll: (projectId) => ipcRenderer.invoke('git:unstageAll', projectId),
  gitCommit: (projectId, summary, description) => ipcRenderer.invoke('git:commit', projectId, summary, description),
  gitPush: (projectId) => ipcRenderer.invoke('git:push', projectId),
  gitPull: (projectId, fromBranch) => ipcRenderer.invoke('git:pull', projectId, fromBranch),

  // Command history
  historyGet: (projectId) => ipcRenderer.invoke('history:get', projectId),
  historyAdd: (projectId, command) => ipcRenderer.invoke('history:add', projectId, command),
  historyDelete: (projectId, command) => ipcRenderer.invoke('history:delete', projectId, command),
  historyClear: (projectId) => ipcRenderer.invoke('history:clear', projectId),

  // Environment vars
  envLoad: (projectId) => ipcRenderer.invoke('env:load', projectId),
  envSave: (projectId, vars) => ipcRenderer.invoke('env:save', projectId, vars),
  envWatch: (projectId) => ipcRenderer.invoke('env:watch', projectId),
  envUnwatch: (projectId) => ipcRenderer.invoke('env:unwatch', projectId),
  envScan: (projectId) => ipcRenderer.invoke('env:scan', projectId),
  envSaveFile: (projectId, absolutePath, vars) => ipcRenderer.invoke('env:save-file', projectId, absolutePath, vars),
  envCreateFile: (projectId, relativePath) => ipcRenderer.invoke('env:create-file', projectId, relativePath),
  onEnvUpdated: (callback) => {
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on('env:updated', handler);
    return () => ipcRenderer.removeListener('env:updated', handler);
  },

  // Docker
  checkDockerAvailable: () => ipcRenderer.invoke('docker:check'),
  getDockerContainers: () => ipcRenderer.invoke('docker:list-containers'),
  getProjectContainers: (projectPath) => ipcRenderer.invoke('docker:project-containers', projectPath),
  dockerHasCompose: (projectPath) => ipcRenderer.invoke('docker:has-compose', projectPath),
  dockerStart: (id) => ipcRenderer.invoke('docker:start', id),
  dockerStop: (id) => ipcRenderer.invoke('docker:stop', id),
  dockerRestart: (id) => ipcRenderer.invoke('docker:restart', id),
  getContainerLogs: (id) => ipcRenderer.invoke('docker:logs', id),
  onDockerUpdate: (callback) => {
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on('docker:update', handler);
    return () => ipcRenderer.removeListener('docker:update', handler);
  },

  // App info
  appVersion: pkg.version,

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdaterStatus: (callback) => {
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },

  // Pinned commands
  pinsAdd: (projectId, command) => ipcRenderer.invoke('pins:add', projectId, command),
  pinsRemove: (projectId, command) => ipcRenderer.invoke('pins:remove', projectId, command),
  pinsReorder: (projectId, commands) => ipcRenderer.invoke('pins:reorder', projectId, commands),

  // Shell utilities
  shell: {
    openExternal: (url) => shell.openExternal(url),
  },

  // File path resolution (Electron 32+ replacement for File.path)
  getPathForFile: (file) => webUtils.getPathForFile(file),
});
