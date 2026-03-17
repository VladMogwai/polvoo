'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');

const execAsync = promisify(exec);

const processManager = require('./processes');
const ptyManager = require('./pty');
const gitManager = require('./git');
const dockerManager = require('./docker');
const updater = require('./updater');
const editorManager = require('./editors');
const terminalManager = require('./terminals');
const settings = require('./settings');
const historyManager = require('./history');
const envLoader = require('./envLoader');

const isDev = !app.isPackaged;

let mainWindow = null;
let projectsFilePath = null;
let projects = [];
let gitPollTimer = null;
let dockerPollTimer = null;
let dockerAvailable = false;

// ─── Persistence ─────────────────────────────────────────────────────────────

function getProjectsFilePath() {
  return path.join(app.getPath('userData'), 'projects.json');
}

function loadProjects() {
  try {
    if (fs.existsSync(projectsFilePath)) {
      const raw = fs.readFileSync(projectsFilePath, 'utf8');
      projects = JSON.parse(raw);
    }
  } catch (err) {
    console.error('Failed to load projects:', err);
    projects = [];
  }
}

function saveProjects() {
  try {
    fs.writeFileSync(projectsFilePath, JSON.stringify(projects, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save projects:', err);
  }
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f172a',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // On macOS the red close button only hides the window by default.
  // We intercept it and trigger a full app quit (which fires before-quit
  // where the kill-processes dialog lives).
  mainWindow.on('close', (event) => {
    event.preventDefault();
    app.quit();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Git polling ──────────────────────────────────────────────────────────────

async function pollGit() {
  for (const project of projects) {
    try {
      const info = await gitManager.getInfo(project.path);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('git:update', { projectId: project.id, ...info });
      }
    } catch (_) {}
  }
}

function startGitPolling() {
  pollGit();
  gitPollTimer = setInterval(pollGit, 5000);
}

// ─── Docker polling ───────────────────────────────────────────────────────────

async function pollDocker() {
  if (!dockerAvailable) return;
  try {
    const containers = await dockerManager.listContainers();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('docker:update', { containers });
    }
  } catch {}
}

function startDockerPolling() {
  pollDocker();
  dockerPollTimer = setInterval(pollDocker, 5000);
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  projectsFilePath = getProjectsFilePath();
  loadProjects();
  settings.load();
  createWindow();
  startGitPolling();

  // Initialize auto-updater (after window is ready)
  updater.init(mainWindow, isDev);

  // Start Docker polling if Docker is available
  dockerManager.checkAvailable().then((available) => {
    dockerAvailable = available;
    if (available) startDockerPolling();
  });

  // Check Xcode CLT asynchronously after window is created
  setTimeout(async () => {
    try {
      await execAsync('xcode-select -p', { timeout: 3000 });
    } catch {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('system:xcode-clt-missing');
      }
    }
  }, 2000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  event.preventDefault();

  const runningCount = processManager.getRunningCount();
  const s = settings.get();

  let shouldKill = false;

  if (runningCount > 0) {
    if (s.killOnQuit === true) {
      shouldKill = true;
    } else if (s.killOnQuit === false) {
      shouldKill = false;
    } else {
      // Ask the user
      const label = runningCount === 1
        ? '1 running process'
        : `${runningCount} running processes`;

      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: 'Quit Dev Dashboard',
        message: `You have ${label} started from this app.`,
        detail: 'Do you want to stop them before quitting?',
        buttons: ['Stop Processes & Quit', 'Quit Without Stopping', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        checkboxLabel: "Don't ask again",
        checkboxChecked: false,
      });

      if (result.response === 2) {
        // Cancel — don't quit
        return;
      }
      shouldKill = result.response === 0;
      if (result.checkboxChecked) {
        settings.set({ killOnQuit: shouldKill });
      }
    }
  }

  if (gitPollTimer) clearInterval(gitPollTimer);
  if (dockerPollTimer) clearInterval(dockerPollTimer);
  updater.destroy();
  ptyManager.destroyAll();

  if (shouldKill) {
    await processManager.stopAll().catch(() => {});
  }
  app.exit(0);
});

// ─── IPC: Projects ────────────────────────────────────────────────────────────

ipcMain.handle('projects:get-all', () => {
  return projects.map((p) => ({
    ...p,
    status: processManager.getStatus(p.id),
  }));
});

ipcMain.handle('projects:add', (_, projectData) => {
  // Auto-detect startCommand from package.json if not provided
  let startCommand = projectData.startCommand || '';
  if (!startCommand) {
    try {
      const pkgPath = path.join(projectData.path, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const scripts = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts || {};
        const priority = ['dev', 'start', 'serve', 'develop'];
        const found = priority.find((s) => scripts[s]);
        startCommand = found ? `npm run ${found}` : Object.keys(scripts)[0] ? `npm run ${Object.keys(scripts)[0]}` : '';
      }
    } catch {}
  }
  const project = {
    id: Date.now().toString(),
    name: projectData.name,
    path: projectData.path,
    startCommand,
    envFile: projectData.envFile || null,
    hiddenScripts: [],
  };
  projects.push(project);
  saveProjects();
  return { ...project, status: 'stopped' };
});

ipcMain.handle('projects:remove', (_, projectId) => {
  if (processManager.isRunning(projectId)) processManager.stop(projectId);
  ptyManager.destroyForProject(projectId);
  projects = projects.filter((p) => p.id !== projectId);
  saveProjects();
  return true;
});

ipcMain.handle('projects:update', (_, projectId, updates) => {
  const idx = projects.findIndex((p) => p.id === projectId);
  if (idx !== -1) {
    projects[idx] = { ...projects[idx], ...updates };
    saveProjects();
    return projects[idx];
  }
  return null;
});

ipcMain.handle('projects:reorder', (_, orderedIds) => {
  const map = new Map(projects.map((p) => [p.id, p]));
  const reordered = orderedIds.map((id) => map.get(id)).filter(Boolean);
  // append any projects not in the orderedIds list (safety)
  const reorderedSet = new Set(orderedIds);
  for (const p of projects) {
    if (!reorderedSet.has(p.id)) reordered.push(p);
  }
  projects = reordered;
  saveProjects();
  return true;
});

ipcMain.handle('projects:get-scripts', (_, projectId) => {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return {};
  try {
    const pkgPath = path.join(project.path, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return pkg.scripts || {};
    }
  } catch {}
  return {};
});

// ─── IPC: Process management ──────────────────────────────────────────────────

ipcMain.handle('process:start', (_, projectId) => {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return { success: false, error: 'Project not found' };

  try {
    processManager.start(
      project,
      (type, data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('log:output', { projectId, type, data });
        }
      },
      (status) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('process:status-update', { projectId, status });
        }
      }
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('process:stop', (_, projectId) => {
  try {
    processManager.stop(projectId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('process:restart', (_, projectId) => {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return { success: false, error: 'Project not found' };

  processManager.stop(projectId);

  setTimeout(() => {
    processManager.start(
      project,
      (type, data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('log:output', { projectId, type, data });
        }
      },
      (status) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('process:status-update', { projectId, status });
        }
      }
    );
  }, 800);

  return { success: true };
});

ipcMain.handle('process:run-command', (_, projectId, command) => {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return { success: false, error: 'Project not found' };

  try {
    processManager.runCommand(
      project,
      command,
      (type, data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('log:output', { projectId, type, data });
        }
      },
      (status, cmd) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('process:command-status', { projectId, command: cmd, status });
        }
      }
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('process:kill-command', (_, projectId, command) => {
  try {
    processManager.killCommand(projectId, command);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ports:update', (_, projectId, newPort) => {
  const portsUtil = require('./ports');
  const project = projects.find((p) => p.id === projectId);
  if (!project) return { success: false, error: 'Not found' };
  const newCmd = portsUtil.setPort(project.startCommand, newPort);
  project.startCommand = newCmd;
  saveProjects();
  return { success: true, startCommand: newCmd };
});

ipcMain.handle('ports:running', async (_, projectId) => {
  try {
    const ports = await processManager.getRunningPorts(projectId);
    return { success: true, ports };
  } catch {
    return { success: true, ports: [] };
  }
});

ipcMain.handle('process:get-status', (_, projectId) => {
  return processManager.getStatus(projectId);
});

ipcMain.handle('process:get-all-running', () => {
  const raw = processManager.getAllRunning();
  // Merge in project name/path for display
  return raw.map((entry) => {
    const project = projects.find((p) => p.id === entry.projectId);
    return {
      ...entry,
      projectName: project?.name || entry.projectId || 'Unknown',
      projectPath: project?.path || '',
    };
  });
});

ipcMain.handle('process:get-stats', async (_, pids) => {
  return processManager.getProcessStats(pids);
});

// ─── IPC: Git ─────────────────────────────────────────────────────────────────

ipcMain.handle('git:get-info', async (_, projectPath) => {
  try {
    return await gitManager.getInfo(projectPath);
  } catch {
    return { branch: null, lastCommit: null, isRepo: false };
  }
});

ipcMain.handle('git:get-branches', async (_, projectPath) => {
  try {
    return await gitManager.getBranches(projectPath);
  } catch {
    return { current: null, branches: [] };
  }
});

ipcMain.handle('git:checkout', async (_, projectPath, branchName) => {
  try {
    return await gitManager.checkoutBranch(projectPath, branchName);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('git:create-branch', async (_, projectPath, branchName, setUpstream) => {
  try {
    return await gitManager.createBranch(projectPath, branchName, setUpstream);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('git:getLog', async (_, projectId, limit = 100, skip = 0) => {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return { commits: [], isRepo: false };
  try { return await gitManager.getCommitLog(project.path, limit, skip); } catch { return { commits: [], isRepo: false }; }
});

ipcMain.handle('git:getFiles', async (_, projectId, hash) => {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return [];
  try { return await gitManager.getCommitFiles(project.path, hash); } catch { return []; }
});

ipcMain.handle('git:getDiff', async (_, projectId, hash) => {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return '';
  try { return await gitManager.getCommitDiff(project.path, hash); } catch { return ''; }
});

ipcMain.handle('git:getChanges', async (_, projectId) => {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return { isRepo: false, unstaged: '', staged: '' };
  try { return await gitManager.getWorkingTreeDiff(project.path); } catch { return { isRepo: false, unstaged: '', staged: '' }; }
});

ipcMain.handle('git:getStagingStatus', async (_, projectId) => {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return { isRepo: false, files: [], branch: null };
  try { return await gitManager.getStagingStatus(project.path); } catch { return { isRepo: false, files: [], branch: null }; }
});

ipcMain.handle('git:stageFile', async (_, projectId, filePath) => {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return { success: false };
  return gitManager.stageFile(project.path, filePath);
});

ipcMain.handle('git:unstageFile', async (_, projectId, filePath) => {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return { success: false };
  return gitManager.unstageFile(project.path, filePath);
});

ipcMain.handle('git:stageAll', async (_, projectId) => {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return { success: false };
  return gitManager.stageAll(project.path);
});

ipcMain.handle('git:unstageAll', async (_, projectId) => {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return { success: false };
  return gitManager.unstageAll(project.path);
});

ipcMain.handle('git:commit', async (_, projectId, summary, description) => {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return { success: false };
  return gitManager.commitChanges(project.path, summary, description);
});

ipcMain.handle('git:push', async (_, projectId) => {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return { success: false };
  return gitManager.pushChanges(project.path);
});

ipcMain.handle('git:pull', async (_, projectId, fromBranch) => {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return { success: false };
  return gitManager.pullChanges(project.path, fromBranch || null);
});

// ─── IPC: Command history ─────────────────────────────────────────────────────

ipcMain.handle('history:get', (_, projectId) => {
  return historyManager.load(app.getPath('userData'), projectId);
});

ipcMain.handle('history:add', (_, projectId, command) => {
  historyManager.add(app.getPath('userData'), projectId, command);
  return true;
});

ipcMain.handle('history:delete', (_, projectId, command) => {
  historyManager.deleteCmd(app.getPath('userData'), projectId, command);
  return true;
});

ipcMain.handle('history:clear', (_, projectId) => {
  historyManager.clear(app.getPath('userData'), projectId);
  return true;
});

// ─── IPC: Environment variables ───────────────────────────────────────────────

const envWatchers = new Map();

ipcMain.handle('env:load', (_, projectId) => {
  const project = projects.find(p => p.id === projectId);
  if (!project) return {};
  try {
    return envLoader.loadEnv(project.path, project.envFile);
  } catch {
    return {};
  }
});

ipcMain.handle('env:watch', (_, projectId) => {
  if (envWatchers.has(projectId)) return;
  const project = projects.find(p => p.id === projectId);
  if (!project) return;
  try {
    const watcher = fs.watch(project.path, { persistent: false }, () => {
      try {
        const vars = envLoader.loadEnv(project.path, project.envFile);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('env:updated', { projectId, vars });
        }
      } catch {}
    });
    envWatchers.set(projectId, watcher);
  } catch {}
});

ipcMain.handle('env:unwatch', (_, projectId) => {
  const w = envWatchers.get(projectId);
  if (w) { try { w.close(); } catch {} envWatchers.delete(projectId); }
});

ipcMain.handle('env:save', (_, projectId, vars) => {
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, error: 'Project not found' };
  let filePath;
  if (project.envFile) {
    filePath = path.isAbsolute(project.envFile)
      ? project.envFile
      : path.join(project.path, project.envFile);
  } else {
    filePath = path.join(project.path, '.env');
  }
  try {
    const content = vars.map(({ key, value }) => `${key}=${value}`).join('\n') + '\n';
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('env:scan', (_, projectId) => {
  const project = projects.find(p => p.id === projectId);
  if (!project) return [];
  try {
    return envLoader.scanEnvFiles(project.path);
  } catch (err) {
    console.error('[env:scan] scan failed for', project.path, err);
    return [];
  }
});

ipcMain.handle('env:save-file', (_, projectId, absolutePath, vars) => {
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, error: 'Project not found' };
  if (!absolutePath.startsWith(project.path)) {
    return { success: false, error: 'Path outside project directory' };
  }
  try {
    envLoader.saveEnvFile(absolutePath, vars);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('env:create-file', (_, projectId, relativePath) => {
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, error: 'Project not found' };
  try {
    const abs = path.join(project.path, relativePath);
    envLoader.createEnvFile(abs);
    return { success: true, absolutePath: abs };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Pinned commands ─────────────────────────────────────────────────────

ipcMain.handle('pins:add', (_, projectId, command) => {
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx === -1) return false;
  const pins = [...(projects[idx].pinnedCommands || [])];
  if (!pins.includes(command) && pins.length < 8) pins.push(command);
  projects[idx] = { ...projects[idx], pinnedCommands: pins };
  saveProjects();
  return true;
});

ipcMain.handle('pins:remove', (_, projectId, command) => {
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx === -1) return false;
  projects[idx] = { ...projects[idx], pinnedCommands: (projects[idx].pinnedCommands || []).filter(c => c !== command) };
  saveProjects();
  return true;
});

ipcMain.handle('pins:reorder', (_, projectId, commands) => {
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx === -1) return false;
  projects[idx] = { ...projects[idx], pinnedCommands: commands };
  saveProjects();
  return true;
});

// ─── IPC: Editors ─────────────────────────────────────────────────────────────

ipcMain.handle('editors:get-installed', async () => {
  return await editorManager.getInstalled();
});

ipcMain.handle('editors:get-running', async (_, projectPath) => {
  return await editorManager.getRunning(projectPath);
});

ipcMain.handle('editors:open', async (_, editor, projectPath) => {
  try {
    await editorManager.open(editor, projectPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: PTY ─────────────────────────────────────────────────────────────────

ipcMain.handle('pty:create', (_, projectId, type, cols, rows) => {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return { success: false, error: 'Project not found' };

  const sessionId = `${projectId}-${type}`;
  ptyManager.create(sessionId, project.path, (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:output', { sessionId, data });
    }
  }, cols, rows);

  return { success: true, sessionId };
});

ipcMain.on('pty:input', (_, sessionId, data) => {
  ptyManager.write(sessionId, data);
});

ipcMain.on('pty:resize', (_, sessionId, cols, rows) => {
  ptyManager.resize(sessionId, cols, rows);
});

ipcMain.handle('pty:destroy', (_, sessionId) => {
  ptyManager.destroy(sessionId);
  return true;
});

// ─── IPC: Claude ──────────────────────────────────────────────────────────────

ipcMain.handle('claude:check', async () => {
  return await editorManager.checkClaude();
});

ipcMain.handle('claude:open-external', async (_, projectPath) => {
  try {
    await editorManager.openClaudeExternal(projectPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Terminals ───────────────────────────────────────────────────────────

ipcMain.handle('terminals:get-installed', async () => {
  return terminalManager.getInstalled();
});

ipcMain.handle('terminal:open', async (_, terminalId, projectPath) => {
  try {
    await terminalManager.openInTerminal(terminalId, projectPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Settings ────────────────────────────────────────────────────────────

ipcMain.handle('settings:get', () => {
  return settings.get();
});

ipcMain.handle('settings:set', (_, updates) => {
  return settings.set(updates);
});

ipcMain.handle('terminals:add-custom', (_, terminal) => {
  return settings.addCustomTerminal(terminal);
});

ipcMain.handle('terminals:remove-custom', (_, id) => {
  return settings.removeCustomTerminal(id);
});

// ─── IPC: Docker ──────────────────────────────────────────────────────────────

ipcMain.handle('docker:check', async () => {
  const available = await dockerManager.checkAvailable();
  dockerAvailable = available;
  if (available && !dockerPollTimer) startDockerPolling();
  return available;
});

ipcMain.handle('docker:list-containers', () => {
  return dockerManager.listContainers();
});

ipcMain.handle('docker:project-containers', (_, projectPath) => {
  return dockerManager.getProjectContainers(projectPath);
});

ipcMain.handle('docker:has-compose', (_, projectPath) => {
  return dockerManager.hasComposeFile(projectPath);
});

ipcMain.handle('docker:start', async (_, id) => {
  try {
    await dockerManager.startContainer(id);
    pollDocker();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.stderr || err.message };
  }
});

ipcMain.handle('docker:stop', async (_, id) => {
  try {
    await dockerManager.stopContainer(id);
    pollDocker();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.stderr || err.message };
  }
});

ipcMain.handle('docker:restart', async (_, id) => {
  try {
    await dockerManager.restartContainer(id);
    pollDocker();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.stderr || err.message };
  }
});

ipcMain.handle('docker:logs', (_, id) => {
  return dockerManager.getLogs(id);
});

// ─── IPC: Dock badge ──────────────────────────────────────────────────────────

ipcMain.handle('app:set-badge-count', (_, count) => {
  app.setBadgeCount(count || 0);
});

// ─── IPC: Dev rebuild & install ───────────────────────────────────────────────

ipcMain.handle('dev:rebuild-install', () => {
  const { spawn } = require('child_process');
  const scriptPath = path.join(__dirname, '..', 'dev-install.sh');
  const child = spawn('bash', [scriptPath], {
    cwd: path.join(__dirname, '..'),
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return { success: true };
});

// ─── IPC: Dialog ──────────────────────────────────────────────────────────────

ipcMain.handle('dialog:open-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Project Folder',
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:pick-app', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select Terminal App',
    defaultPath: '/Applications',
    filters: [{ name: 'Applications', extensions: ['app'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});
