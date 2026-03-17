// Thin wrappers around window.electronAPI for use in React components/hooks

export const api = window.electronAPI;

export const getProjects = () => api.getProjects();
export const addProject = (data) => api.addProject(data);
export const removeProject = (id) => api.removeProject(id);
export const updateProject = (id, updates) => api.updateProject(id, updates);
export const reorderProjects = (orderedIds) => api.reorderProjects(orderedIds);

export const startProcess = (id) => api.startProcess(id);
export const stopProcess = (id) => api.stopProcess(id);
export const restartProcess = (id) => api.restartProcess(id);
export const runCommand = (id, cmd) => api.runCommand(id, cmd);
export const getAllRunning = () => api.getAllRunning();
export const getProcessStats = (pids) => api.getProcessStats(pids);
export const killCommand = (id, cmd) => api.killCommand(id, cmd);
export const updatePort = (id, port) => api.updatePort(id, port);
export const getRunningPorts = (id) => api.getRunningPorts(id);
export const getLogBuffer = (id) => api.getLogBuffer(id);
export const listPorts = () => api.listPorts();
export const killPid = (pid) => api.killPid(pid);
export const killPort = (port) => api.killPort(port);

export const getGitInfo = (path) => api.getGitInfo(path);
export const getBranches = (path) => api.getBranches(path);
export const checkoutBranch = (path, branch) => api.checkoutBranch(path, branch);
export const createBranch = (path, branchName, setUpstream) => api.createBranch(path, branchName, setUpstream);

export const getInstalledEditors = () => api.getInstalledEditors();
export const getRunningEditors = (projectPath) => api.getRunningEditors(projectPath);
export const openInEditor = (editor, path) => api.openInEditor(editor, path);

export const createPty = (projectId, type, cols, rows) => api.createPty(projectId, type, cols, rows);
export const ptyInput = (sessionId, data) => api.ptyInput(sessionId, data);
export const ptyResize = (sessionId, cols, rows) => api.ptyResize(sessionId, cols, rows);
export const destroyPty = (sessionId) => api.destroyPty(sessionId);

export const checkClaude = () => api.checkClaude();
export const openClaudeExternal = (path) => api.openClaudeExternal(path);
export const openFolderDialog = () => api.openFolderDialog();
export const rebuildInstall = () => api.rebuildInstall();
export const setBadgeCount = (count) => api.setBadgeCount(count);

export const getInstalledTerminals = () => api.getInstalledTerminals();
export const openInTerminal = (terminalId, path) => api.openInTerminal(terminalId, path);
export const addCustomTerminal = (t) => api.addCustomTerminal(t);
export const removeCustomTerminal = (id) => api.removeCustomTerminal(id);
export const getSettings = () => api.getSettings();
export const setSettings = (updates) => api.setSettings(updates);

// Settings panel
export const getPermissions = () => api.getPermissions();
export const requestPermission = (name) => api.requestPermission(name);
export const openSystemPrefs = (url) => api.openSystemPrefs(url);
export const getGeneralSettings = () => api.getGeneralSettings();
export const setLaunchAtLogin = (val) => api.setLaunchAtLogin(val);
export const clearAllData = () => api.clearAllData();
export const pickAppDialog = () => api.pickAppDialog();

// Event listener helpers — each returns an unsubscribe function
export const onLogOutput = (cb) => api.onLogOutput(cb);
export const onPtyOutput = (cb) => api.onPtyOutput(cb);
export const onProcessStatusUpdate = (cb) => api.onProcessStatusUpdate(cb);
export const onCommandStatus = (cb) => api.onCommandStatus(cb);
export const onGitUpdate = (cb) => api.onGitUpdate(cb);
export const onPortsUpdated = (cb) => api.onPortsUpdated(cb);

export const getProjectScripts = (id) => api.getProjectScripts(id);

export const gitGetLog = (projectId, limit, skip) => api.gitGetLog(projectId, limit, skip);
export const gitGetFiles = (projectId, hash) => api.gitGetFiles(projectId, hash);
export const gitGetDiff = (projectId, hash) => api.gitGetDiff(projectId, hash);
export const gitGetChanges = (projectId) => api.gitGetChanges(projectId);
export const gitGetStagingStatus = (projectId) => api.gitGetStagingStatus(projectId);
export const gitStageFile = (projectId, filePath) => api.gitStageFile(projectId, filePath);
export const gitUnstageFile = (projectId, filePath) => api.gitUnstageFile(projectId, filePath);
export const gitStageAll = (projectId) => api.gitStageAll(projectId);
export const gitUnstageAll = (projectId) => api.gitUnstageAll(projectId);
export const gitCommit = (projectId, summary, description) => api.gitCommit(projectId, summary, description);
export const gitPush = (projectId) => api.gitPush(projectId);
export const gitPull = (projectId, fromBranch) => api.gitPull(projectId, fromBranch);

export const historyGet = (id) => api.historyGet(id);
export const historyAdd = (id, cmd) => api.historyAdd(id, cmd);
export const historyDelete = (id, cmd) => api.historyDelete(id, cmd);
export const historyClear = (id) => api.historyClear(id);

export const envLoad = (id) => api.envLoad(id);
export const envSave = (id, vars) => api.envSave(id, vars);
export const envWatch = (id) => api.envWatch(id);
export const envUnwatch = (id) => api.envUnwatch(id);
export const envScan = (id) => api.envScan(id);
export const envSaveFile = (id, absPath, vars) => api.envSaveFile(id, absPath, vars);
export const envCreateFile = (id, relPath) => api.envCreateFile(id, relPath);
export const onEnvUpdated = (cb) => api.onEnvUpdated(cb);

export const pinsAdd = (id, cmd) => api.pinsAdd(id, cmd);
export const pinsRemove = (id, cmd) => api.pinsRemove(id, cmd);
export const pinsReorder = (id, cmds) => api.pinsReorder(id, cmds);

export const checkDockerAvailable = () => api.checkDockerAvailable();
export const getDockerContainers = () => api.getDockerContainers();
export const getProjectContainers = (projectPath) => api.getProjectContainers(projectPath);
export const dockerHasCompose = (projectPath) => api.dockerHasCompose(projectPath);
export const dockerStart = (id) => api.dockerStart(id);
export const dockerStop = (id) => api.dockerStop(id);
export const dockerRestart = (id) => api.dockerRestart(id);
export const getContainerLogs = (id) => api.getContainerLogs(id);
export const onDockerUpdate = (cb) => api.onDockerUpdate(cb);

export const getAppVersion = () => api.appVersion;
export const checkForUpdates = () => api.checkForUpdates();
export const downloadUpdate = () => api.downloadUpdate();
export const installUpdate = () => api.installUpdate();
export const onUpdaterStatus = (cb) => api.onUpdaterStatus(cb);
