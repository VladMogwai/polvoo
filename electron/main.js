'use strict';

const { app, BrowserWindow, ipcMain, dialog, systemPreferences, shell } = require('electron');
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');

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

// ─── Single instance lock ─────────────────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running — quit immediately.
  app.quit();
} else {
  // Focus the existing window if the user tries to open a second instance.
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

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

  // Forward port-detection events from process stdout to the renderer
  processManager.portEvents.on('ports-updated', ({ projectId, ports }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ports:updated', { projectId, ports });
    }
  });

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

// ─── IPC: Log buffer ──────────────────────────────────────────────────────────

// Returns buffered log chunks for a project so panels that mounted after the
// process started (or crashed) can replay what happened.
ipcMain.handle('logs:get-buffer', (_, projectId) => {
  return processManager.getLogBuffer(projectId);
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

// Returns ports detected from the project's own stdout/stderr — no lsof.
// Accurate because only text the project actually printed is matched.
ipcMain.handle('ports:running', (_, projectId) => {
  const ports = processManager.getProjectDetectedPorts(projectId);
  return { success: true, ports: ports.sort((a, b) => a - b) };
});

// Shared env with extended PATH for child_process calls
const CHILD_ENV = {
  ...process.env,
  PATH: ['/usr/local/bin', '/opt/homebrew/bin', '/opt/homebrew/sbin',
         '/usr/bin', '/bin', '/usr/sbin', '/sbin', process.env.PATH || ''].join(':'),
};

function parseLsofOutput(stdout) {
  const lines = (stdout || '').trim().split('\n').slice(1);
  const seen = new Set();
  const result = [];
  for (const line of lines) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 9) continue;
    const cmd = cols[0];
    const pid = parseInt(cols[1], 10);
    if (!pid) continue;
    // The address:port column looks like "*:3001" or "127.0.0.1:3001".
    // lsof appends "(LISTEN)" or "(ESTABLISHED)" as a separate token, so
    // we cannot rely on the last column — scan right-to-left for the first
    // column that ends with :<digits>.
    let name = '';
    for (let i = cols.length - 1; i >= 8; i--) {
      if (/:(\d+)$/.test(cols[i])) { name = cols[i]; break; }
    }
    if (!name) continue;
    const portMatch = name.match(/:(\d+)$/);
    if (!portMatch) continue;
    const port = parseInt(portMatch[1], 10);
    const key = `${pid}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ port, pid, cmd });
  }
  return result.sort((a, b) => a.port - b.port);
}

function parseNetstatOutput(stdout) {
  const lines = (stdout || '').trim().split('\n');
  const seen = new Set();
  const result = [];
  for (const line of lines) {
    if (!line.includes('LISTEN')) continue;
    const portMatch = line.match(/[.*\d]+\.(\d+)\s+[.*\d]+\.\*\s+LISTEN/);
    if (!portMatch) continue;
    const port = parseInt(portMatch[1], 10);
    const pidMatch = line.match(/LISTEN\s+(\d+)/);
    const pid = pidMatch ? parseInt(pidMatch[1], 10) : 0;
    const key = `${pid}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ port, pid: pid || null, cmd: '' });
  }
  return result.sort((a, b) => a.port - b.port);
}

// Enrich a parsed port list with project metadata.
// Priority: (1) mainPort match, (2) port detected from process stdout.
function enrichWithProjects(portList) {
  const detected = processManager.getDetectedPorts(); // [{projectId, port}]
  return portList.map((entry) => {
    const mainMatch = projects.find((p) => p.mainPort && Number(p.mainPort) === entry.port);
    if (mainMatch) return { ...entry, projectId: mainMatch.id, projectName: mainMatch.name };
    const det = detected.find((d) => d.port === entry.port);
    if (det) {
      const proj = projects.find((p) => p.id === det.projectId);
      if (proj) return { ...entry, projectId: proj.id, projectName: proj.name };
    }
    return entry;
  });
}

// For ports that are still unmatched after enrichWithProjects, walk each port's
// PID up the OS process tree to see if any ancestor is a tracked project PID.
// Uses a single `ps` call to build the full pid→ppid map — no per-port syscalls.
async function matchByPidTree(portList) {
  const unmatched = portList.filter((e) => !e.projectName && e.pid);
  if (unmatched.length === 0) return portList;

  const allRunning = processManager.getAllRunning(); // [{projectId, pid, ...}]
  if (allRunning.length === 0) return portList;

  // Build pid→ppid map for the whole system in one shot
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);
  let pidTree = new Map(); // pid -> ppid
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid='], { env: CHILD_ENV });
    for (const line of stdout.trim().split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const pid = parseInt(parts[0], 10);
        const ppid = parseInt(parts[1], 10);
        if (pid) pidTree.set(pid, ppid);
      }
    }
  } catch {
    return portList;
  }

  // Map of tracked PIDs → project info (covers both main processes and commands)
  const trackedPids = new Map(); // pid -> { projectId, projectName }
  for (const proc of allRunning) {
    if (!proc.pid) continue;
    const proj = projects.find((p) => p.id === proc.projectId);
    if (proj) trackedPids.set(proc.pid, { projectId: proj.id, projectName: proj.name });
  }

  // Walk ancestry: returns project info if any ancestor is a tracked PID
  function findAncestorProject(pid) {
    let cur = pid;
    const visited = new Set();
    while (cur > 1 && !visited.has(cur)) {
      visited.add(cur);
      if (trackedPids.has(cur)) return trackedPids.get(cur);
      cur = pidTree.get(cur);
      if (!cur) break;
    }
    return null;
  }

  return portList.map((entry) => {
    if (entry.projectName || !entry.pid) return entry;
    const match = findAncestorProject(entry.pid);
    if (match) return { ...entry, projectId: match.projectId, projectName: match.projectName };
    return entry;
  });
}

// List all TCP ports currently in LISTEN state with their PID + command
ipcMain.handle('ports:list', async () => {
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);
  const opts = { maxBuffer: 1024 * 1024 * 5, env: CHILD_ENV };

  // Try lsof — primary method on macOS
  // lsof exits 1 on partial permission errors but still writes valid stdout
  let lsofOut = '';
  try {
    ({ stdout: lsofOut } = await execFileAsync('/usr/sbin/lsof', ['-i', '-P', '-n', '-sTCP:LISTEN'], opts));
  } catch (err) {
    lsofOut = err.stdout || '';
  }
  let portList = parseLsofOutput(lsofOut);

  if (portList.length === 0) {
    // Fallback: lsof without -sTCP:LISTEN (older macOS compat)
    let lsofOut2 = '';
    try {
      ({ stdout: lsofOut2 } = await execFileAsync('/usr/sbin/lsof', ['-i', '-P', '-n'], opts));
    } catch (err2) {
      lsofOut2 = err2.stdout || '';
    }
    portList = parseLsofOutput(lsofOut2);
  }

  if (portList.length === 0) {
    // Final fallback: netstat
    let nsOut = '';
    try {
      ({ stdout: nsOut } = await execFileAsync('/usr/sbin/netstat', ['-anv', '-p', 'tcp'], opts));
    } catch (err3) {
      nsOut = err3.stdout || '';
    }
    portList = parseNetstatOutput(nsOut);
  }

  // Merge ports detected from process stdout that lsof/netstat may have missed.
  // This catches child processes (e.g. Vite spawned by the app) reliably.
  const knownPorts = new Set(portList.map((p) => p.port));
  for (const { projectId, port } of processManager.getDetectedPorts()) {
    if (knownPorts.has(port)) continue;
    const proj = projects.find((p) => p.id === projectId);
    if (!proj) continue;
    portList.push({ port, pid: null, cmd: '', projectId: proj.id, projectName: proj.name });
    knownPorts.add(port);
  }

  const enriched = enrichWithProjects(portList);
  const resolved = await matchByPidTree(enriched);
  return resolved.sort((a, b) => a.port - b.port);
});

// Kill process on a specific port (no PID needed)
ipcMain.handle('ports:kill-port', async (_, port) => {
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);
  const opts = { env: CHILD_ENV };
  try {
    // If this port belongs to a managed project, stop it via processManager
    // so that manualStop is set BEFORE the kill signal — prevents "Error" status.
    const affectedProject =
      projects.find((p) => p.mainPort && Number(p.mainPort) === port) ||
      (() => {
        const det = processManager.getDetectedPorts().find((d) => d.port === port);
        return det ? projects.find((p) => p.id === det.projectId) : null;
      })();
    if (affectedProject && processManager.isRunning(affectedProject.id)) {
      processManager.stop(affectedProject.id);
      return { success: true };
    }

    // Unmanaged process — use lsof + raw treeKill
    let pidOut = '';
    try {
      ({ stdout: pidOut } = await execFileAsync('/usr/sbin/lsof', ['-ti', `:${port}`], opts));
    } catch (err) {
      pidOut = err.stdout || '';
    }
    const pids = pidOut.trim().split('\n').map((s) => parseInt(s.trim(), 10)).filter(Boolean);
    if (pids.length === 0) return { success: false, error: 'No process found on port ' + port };

    const treeKill = require('tree-kill');
    await Promise.all(pids.map((pid) => new Promise((resolve) => {
      treeKill(pid, 'SIGKILL', () => resolve());
    })));

    return { success: true, killedPids: pids };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Kill a process by PID (SIGTERM, then SIGKILL if needed)
ipcMain.handle('ports:kill-pid', async (_, pid) => {
  try {
    // If this PID belongs to a managed project, stop via processManager
    // so manualStop is set before the kill signal.
    const allRunning = processManager.getAllRunning();
    const managed = allRunning.find((e) => e.pid === pid);
    if (managed && managed.projectId) {
      const proj = projects.find((p) => p.id === managed.projectId);
      if (proj && processManager.isRunning(managed.projectId)) {
        processManager.stop(managed.projectId);
        return { success: true };
      }
    }

    // Unmanaged PID — raw kill
    const treeKill = require('tree-kill');
    await new Promise((resolve) => {
      treeKill(pid, 'SIGTERM', (err) => {
        if (err) {
          try { treeKill(pid, 'SIGKILL'); } catch (_) {}
        }
        resolve();
      });
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
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

// ─── IPC: Settings panel ──────────────────────────────────────────────────────

function normalizePermStatus(s) {
  if (s === 'granted' || s === 'authorized') return 'granted';
  if (s === 'denied' || s === 'restricted') return 'denied';
  return 'not-determined';
}

ipcMain.handle('settings:get-permissions', async () => {
  const perms = {};

  // Notifications
  try {
    const s = systemPreferences.getAuthorizationStatus('notifications');
    perms.notifications = normalizePermStatus(s);
  } catch { perms.notifications = 'not-determined'; }

  // Accessibility
  try {
    perms.accessibility = systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied';
  } catch { perms.accessibility = 'not-determined'; }

  // Full Disk Access
  try {
    const s = systemPreferences.getAuthorizationStatus('fullDiskAccess');
    perms.fullDiskAccess = normalizePermStatus(s);
  } catch {
    // Fallback: probe the TCC database — readable only with FDA
    try {
      const tcc = path.join(os.homedir(), 'Library', 'Application Support', 'com.apple.TCC', 'TCC.db');
      fs.accessSync(tcc, fs.constants.R_OK);
      perms.fullDiskAccess = 'granted';
    } catch (err) {
      perms.fullDiskAccess = (err.code === 'EACCES' || err.code === 'EPERM') ? 'denied' : 'not-determined';
    }
  }

  // Camera
  try {
    perms.camera = systemPreferences.getMediaAccessStatus('camera');
  } catch { perms.camera = 'not-determined'; }

  // Microphone
  try {
    perms.microphone = systemPreferences.getMediaAccessStatus('microphone');
  } catch { perms.microphone = 'not-determined'; }

  // Screen Recording
  try {
    perms.screen = systemPreferences.getMediaAccessStatus('screen');
  } catch { perms.screen = 'not-determined'; }

  return perms;
});

ipcMain.handle('settings:request-permission', async (_, name) => {
  try {
    if (name === 'camera' || name === 'microphone') {
      const granted = await systemPreferences.askForMediaAccess(name);
      return { success: true, granted };
    }
    return { success: false, error: 'Cannot request this permission programmatically' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('settings:open-system-prefs', async (_, url) => {
  try {
    await shell.openExternal(url || 'x-apple.systempreferences:');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('settings:get-general', () => {
  try {
    const version = app.getVersion();
    const { openAtLogin } = app.getLoginItemSettings();
    return { version, launchAtLogin: openAtLogin };
  } catch {
    return { version: '', launchAtLogin: false };
  }
});

ipcMain.handle('settings:set-launch-at-login', (_, value) => {
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(value) });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('settings:clear-data', async () => {
  try {
    await processManager.stopAll().catch(() => {});
    projects = [];
    saveProjects();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
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
