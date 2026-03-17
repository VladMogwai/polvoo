'use strict';

const { spawn } = require('child_process');
const { Notification } = require('electron');
const path = require('path');
const fs = require('fs');

const ptyManager = require('./pty');

// Fallback PATH for when the shell env hasn't been captured yet
const FULL_PATH = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  process.env.PATH || '',
].join(':');

const treeKill = require('tree-kill');

// Map of projectId -> { process, status }
const running = new Map();

// Map of `${projectId}:${command}` -> childProcess
const runningCommands = new Map();

function parseCommand(cmd) {
  const parts = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (const ch of cmd) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ' && current.length > 0) {
      parts.push(current);
      current = '';
    } else if (ch !== ' ') {
      current += ch;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

function loadEnv(envFilePath) {
  if (!envFilePath || !fs.existsSync(envFilePath)) return {};
  const content = fs.readFileSync(envFilePath, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function start(project, onData, onStatusChange) {
  if (running.has(project.id)) {
    stop(project.id);
  }

  const cmd = (project.startCommand || '').trim();
  if (!cmd) throw new Error('Empty start command');

  const envVars = loadEnv(project.envFile);

  // Use captured shell env (nvm, fnm, pyenv, etc.) with fallback to FULL_PATH
  const shellEnv = ptyManager.getCapturedEnv();
  const env = {
    ...shellEnv,
    ...process.env,
    PATH: shellEnv.PATH || FULL_PATH,
    ...envVars,
    FORCE_COLOR: '1',
  };

  // Use shell: true so inline env vars (PORT=3000 npm run dev), pipes, etc. work correctly
  const child = spawn(cmd, [], {
    shell: true,
    cwd: project.path,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  running.set(project.id, { process: child, status: 'running', pid: child.pid, command: project.startCommand, startedAt: Date.now() });
  onStatusChange('running');

  child.stdout.on('data', (data) => {
    onData('stdout', data.toString());
  });

  child.stderr.on('data', (data) => {
    onData('stderr', data.toString());
  });

  child.on('error', (err) => {
    onData('stderr', `\n[Process error]: ${err.message}\n`);
    running.set(project.id, { ...running.get(project.id), status: 'error' });
    onStatusChange('error');
  });

  child.on('close', (code, signal) => {
    const wasRunning = running.get(project.id);
    if (wasRunning) {
      const isCrash = code !== 0 && code !== null && signal !== 'SIGTERM' && signal !== 'SIGKILL';
      const status = code === 0 ? 'stopped' : (signal === 'SIGTERM' || signal === 'SIGKILL') ? 'stopped' : 'error';
      onData('stdout', `\n[Process exited with code ${code}${signal ? ` (${signal})` : ''}]\n`);
      running.set(project.id, { ...wasRunning, status, process: null });
      onStatusChange(status);
      if (isCrash) {
        try {
          new Notification({
            title: 'Process crashed',
            body: `${project.name}: "${project.startCommand}" exited with code ${code}`,
          }).show();
        } catch (_) {}
      }
    }
  });
}

function stop(projectId) {
  const entry = running.get(projectId);
  if (!entry || !entry.process) return;

  treeKill(entry.process.pid, 'SIGTERM', (err) => {
    if (err) {
      try { treeKill(entry.process.pid, 'SIGKILL'); } catch (_) {}
    }
  });
  running.set(projectId, { ...entry, status: 'stopped', process: null });
}

// Kill every running process and every running command, wait for all to die.
// Used on app quit to ensure no orphan processes are left behind.
function stopAll() {
  const promises = [];

  for (const [projectId, entry] of running) {
    if (!entry || !entry.process) continue;
    const pid = entry.process.pid;
    promises.push(
      new Promise((resolve) => {
        treeKill(pid, 'SIGKILL', () => resolve());
        // Safety timeout — resolve after 2s even if treeKill hangs
        setTimeout(resolve, 2000);
      })
    );
    running.set(projectId, { ...entry, status: 'stopped', process: null });
  }

  for (const [key, child] of runningCommands) {
    if (!child || !child.pid) continue;
    const pid = child.pid;
    promises.push(
      new Promise((resolve) => {
        treeKill(pid, 'SIGKILL', () => resolve());
        setTimeout(resolve, 2000);
      })
    );
    runningCommands.delete(key);
  }

  return Promise.all(promises);
}

function runCommand(project, command, onData, onCommandStatus) {
  if (!command || !command.trim()) return;

  // Use captured shell env (nvm, fnm, pyenv, etc.) with fallback to FULL_PATH
  const shellEnv = ptyManager.getCapturedEnv();
  const env = {
    ...shellEnv,
    ...process.env,
    PATH: shellEnv.PATH || FULL_PATH,
    FORCE_COLOR: '1',
  };

  const child = spawn(command, [], {
    shell: true,
    cwd: project.path,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const key = `${project.id}:${command}`;
  child._command = command;
  child._projectId = project.id;
  child._startedAt = Date.now();
  runningCommands.set(key, child);
  onCommandStatus?.('running', command);

  onData('stdout', `$ ${command}\n`);

  child.stdout.on('data', (data) => onData('stdout', data.toString()));
  child.stderr.on('data', (data) => onData('stderr', data.toString()));
  child.on('close', (code) => {
    runningCommands.delete(key);
    onCommandStatus?.('stopped', command);
    onData('stdout', `[Command exited with code ${code}]\n`);
  });
  child.on('error', (err) => {
    runningCommands.delete(key);
    onCommandStatus?.('stopped', command);
    onData('stderr', `[Error]: ${err.message}\n`);
  });
}

function killCommand(projectId, command) {
  const key = `${projectId}:${command}`;
  const child = runningCommands.get(key);
  if (!child) return;
  runningCommands.delete(key);
  treeKill(child.pid, 'SIGTERM', (err) => {
    if (err) { try { treeKill(child.pid, 'SIGKILL'); } catch (_) {} }
  });
}

function getStatus(projectId) {
  const entry = running.get(projectId);
  if (!entry) return 'stopped';
  return entry.status;
}

function isRunning(projectId) {
  const entry = running.get(projectId);
  return entry && entry.status === 'running';
}

async function getRunningPorts(projectId) {
  const entry = running.get(projectId);
  if (!entry || !entry.pid) return [];
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('lsof', ['-i', '-P', '-n', `-p${entry.pid}`]);
    const ports = [];
    for (const line of stdout.split('\n')) {
      const m = line.match(/:(\d+) \(LISTEN\)/);
      if (m) ports.push(parseInt(m[1]));
    }
    return [...new Set(ports)];
  } catch {
    return [];
  }
}

// Returns all currently running processes (main + commands) for the monitor UI
function getAllRunning() {
  const result = [];
  for (const [projectId, entry] of running) {
    if (entry && entry.process && entry.status === 'running') {
      result.push({
        type: 'main',
        projectId,
        pid: entry.pid,
        command: entry.command || '',
        startedAt: entry.startedAt || null,
      });
    }
  }
  for (const [, child] of runningCommands) {
    if (child && child.pid) {
      result.push({
        type: 'command',
        projectId: child._projectId || null,
        pid: child.pid,
        command: child._command || '',
        startedAt: child._startedAt || null,
      });
    }
  }
  return result;
}

// Returns CPU% and MEM% for a list of PIDs via `ps`
async function getProcessStats(pids) {
  if (!pids || pids.length === 0) return {};
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);
  try {
    const { stdout } = await execFileAsync('ps', [
      '-p', pids.join(','),
      '-o', 'pid=,%cpu=,%mem=',
    ]);
    const stats = {};
    for (const line of stdout.trim().split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const pid = parseInt(parts[0]);
        stats[pid] = { cpu: parseFloat(parts[1]), mem: parseFloat(parts[2]) };
      }
    }
    return stats;
  } catch {
    return {};
  }
}

// Returns the number of currently running main processes (not commands)
function getRunningCount() {
  let count = 0;
  for (const entry of running.values()) {
    if (entry && entry.process && entry.status === 'running') count++;
  }
  return count;
}

module.exports = { start, stop, stopAll, runCommand, killCommand, getStatus, isRunning, getRunningPorts, getRunningCount, getAllRunning, getProcessStats };
