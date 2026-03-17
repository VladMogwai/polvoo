'use strict';

const { ipcMain, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

let _win = null;
let _timer = null;

function emit(payload) {
  if (_win && !_win.isDestroyed()) {
    _win.webContents.send('updater:status', payload);
  }
}

function checkForUpdates() {
  try {
    autoUpdater.checkForUpdates();
  } catch (err) {
    console.error('[updater] check failed:', err.message);
  }
}

function init(win, isDev) {
  _win = win;

  // Suppress verbose logging
  autoUpdater.logger = null;
  autoUpdater.allowPrerelease = false;
  // Let user decide when to download — don't start automatically
  autoUpdater.autoDownload = false;
  // Install silently when the app is closed next time (after user triggers install)
  autoUpdater.autoInstallOnAppQuit = true;

  // In dev mode, use dev-app-update.yml in project root for testing
  if (isDev) {
    autoUpdater.forceDevUpdateConfig = true;
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  autoUpdater.on('checking-for-update', () => {
    emit({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    emit({ state: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    emit({ state: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    emit({ state: 'downloading', percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    emit({ state: 'downloaded', version: info.version });
    try {
      new Notification({
        title: 'Update ready to install',
        body: `Dev Dashboard ${info.version} is downloaded. Open the app to restart and install.`,
      }).show();
    } catch {}
  });

  autoUpdater.on('error', (err) => {
    // Fail silently — just log, don't surface error to user
    console.error('[updater] error:', err.message);
  });

  // ── IPC handlers ──────────────────────────────────────────────────────────

  ipcMain.handle('updater:check', () => checkForUpdates());

  ipcMain.handle('updater:download', () => {
    try {
      autoUpdater.downloadUpdate();
    } catch (err) {
      console.error('[updater] download failed:', err.message);
    }
  });

  ipcMain.handle('updater:install', () => {
    // false = don't silent, true = force app relaunch
    autoUpdater.quitAndInstall(false, true);
  });

  // ── Initial check + periodic polling ─────────────────────────────────────

  // Delay first check so app finishes loading
  setTimeout(() => checkForUpdates(), 3000);

  _timer = setInterval(() => checkForUpdates(), CHECK_INTERVAL_MS);
}

function destroy() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = { init, destroy };
