'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const processManager = require('./processes');
const ptyManager = require('./pty');
const gitManager = require('./git');
const editorManager = require('./editors');

const isDev = !app.isPackaged;

let mainWindow = null;
let projectsFilePath = null;
let projects = [];
let gitPollTimer = null;

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

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  projectsFilePath = getProjectsFilePath();
  loadProjects();
  createWindow();
  startGitPolling();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (gitPollTimer) clearInterval(gitPollTimer);
  for (const p of projects) {
    if (processManager.isRunning(p.id)) processManager.stop(p.id);
  }
  ptyManager.destroyAll();
});

// ─── IPC: Projects ────────────────────────────────────────────────────────────

ipcMain.handle('projects:get-all', () => {
  return projects.map((p) => ({
    ...p,
    status: processManager.getStatus(p.id),
  }));
});

ipcMain.handle('projects:add', (_, projectData) => {
  const project = {
    id: Date.now().toString(),
    name: projectData.name,
    path: projectData.path,
    startCommand: projectData.startCommand,
    envFile: projectData.envFile || null,
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
    processManager.runCommand(project, command, (type, data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('log:output', { projectId, type, data });
      }
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('process:get-status', (_, projectId) => {
  return processManager.getStatus(projectId);
});

// ─── IPC: Git ─────────────────────────────────────────────────────────────────

ipcMain.handle('git:get-info', async (_, projectPath) => {
  try {
    return await gitManager.getInfo(projectPath);
  } catch {
    return { branch: null, lastCommit: null, isRepo: false };
  }
});

// ─── IPC: Editors ─────────────────────────────────────────────────────────────

ipcMain.handle('editors:get-installed', async () => {
  return await editorManager.getInstalled();
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

ipcMain.handle('pty:create', (_, projectId, type) => {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return { success: false, error: 'Project not found' };

  const sessionId = `${projectId}-${type}`;
  ptyManager.create(sessionId, project.path, (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:output', { sessionId, data });
    }
  });

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

// ─── IPC: Dialog ──────────────────────────────────────────────────────────────

ipcMain.handle('dialog:open-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Project Folder',
  });
  return result.canceled ? null : result.filePaths[0];
});
