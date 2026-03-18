'use strict';

const { spawn } = require('child_process');
const { Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

const ptyManager = require('./pty');
const { detectSSHAgentSocket, resolveOpRefs } = require('./onepassword');

const _opAgentSock = detectSSHAgentSocket();

// Emits 'ports-updated' when a project's detected port set changes
const portEvents = new EventEmitter();

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

// Map of projectId -> { process, status }
const running = new Map();

// Map of `${projectId}:${command}` -> childProcess
const runningCommands = new Map();

// Ports detected from process stdout/stderr, keyed by projectId
// Map<projectId, Set<port>>
const detectedPorts = new Map();

// Per-project log buffer — survives process exit so late-mounting panels can
// replay what happened. Cleared at the start of each new run.
// Map<projectId, Array<{type:'stdout'|'stderr', data:string}>>
const logBuffers = new Map();
const LOG_BUFFER_MAX_CHUNKS = 500;

function bufferLog(projectId, type, data) {
  let buf = logBuffers.get(projectId);
  if (!buf) { buf = []; logBuffers.set(projectId, buf); }
  buf.push({ type, data });
  if (buf.length > LOG_BUFFER_MAX_CHUNKS) buf.shift();
}

function getLogBuffer(projectId) {
  return logBuffers.get(projectId) || [];
}

// Strict per-line port detection — only patterns that unambiguously reference
// a localhost/listening port (not counters, file sizes, timing values, etc.)
const PORT_PATTERNS = [
  // host:port patterns — unambiguous
  /localhost:(\d{4,5})/,
  /127\.0\.0\.1:(\d{4,5})/,
  /0\.0\.0\.0:(\d{4,5})/,
  /\[::\]:(\d{4,5})/,
  // URL-based patterns from dev servers (Vite "Local:", webpack "running at")
  /Local:\s+https?:\/\/[^:]+:(\d{4,5})/i,
  /running at\s+https?:\/\/[^:]+:(\d{4,5})/i,
  // "listening on 3000" / "listening on :3000"
  /\blistening\s+on[:\s]+(\d{4,5})\b/i,
  // "on port 3000" / "at port 3000" — requires explicit on/at preposition
  /\b(?:on|at)\s+port[:\s]+(\d{4,5})\b/i,
  // "port 3000" or "port: 3000" only when it ends the line (no trailing words)
  /\bport[:\s]+(\d{4,5})\s*$/i,
  // "started on 3000" / "started on :3000"
  /\bstarted\s+on[:\s]+(\d{4,5})\b/i,
];

function detectPortFromLine(line) {
  for (const pattern of PORT_PATTERNS) {
    const m = line.match(pattern);
    if (m) {
      const port = parseInt(m[1], 10);
      if (port > 1024 && port < 65535) return port;
    }
  }
  return null;
}

function trackPorts(projectId, text) {
  const lines = text.split('\n');
  let changed = false;
  if (!detectedPorts.has(projectId)) detectedPorts.set(projectId, new Set());
  const set = detectedPorts.get(projectId);
  for (const line of lines) {
    const port = detectPortFromLine(line.trim());
    if (port && !set.has(port)) {
      set.add(port);
      changed = true;
    }
  }
  if (changed) {
    portEvents.emit('ports-updated', { projectId, ports: [...set] });
  }
}

// Returns flat array of { projectId, port } for ProcessMonitor / ports:list
function getDetectedPorts() {
  const result = [];
  for (const [projectId, ports] of detectedPorts) {
    for (const port of ports) result.push({ projectId, port });
  }
  return result;
}

// Returns port array for a single project
function getProjectDetectedPorts(projectId) {
  return [...(detectedPorts.get(projectId) || [])];
}

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

async function start(project, onData, onStatusChange) {
  if (running.has(project.id)) {
    stop(project.id);
  }

  // Fresh run — clear the log buffer so this session starts clean
  logBuffers.set(project.id, []);

  const cmd = (project.startCommand || '').trim();
  if (!cmd) throw new Error('Empty start command');

  // Resolve op:// references from 1Password before spawning
  const rawEnvVars = loadEnv(project.envFile);
  const envVars = await resolveOpRefs(rawEnvVars);

  // Use captured shell env (nvm, fnm, pyenv, etc.) with fallback to FULL_PATH
  const shellEnv = ptyManager.getCapturedEnv();
  const env = {
    ...shellEnv,
    ...process.env,
    PATH: shellEnv.PATH || FULL_PATH,
    ...envVars,
    FORCE_COLOR: '1',
    // If 1Password SSH agent is running, make it available to the process
    ...(_opAgentSock ? { SSH_AUTH_SOCK: _opAgentSock } : {}),
  };

  // Use shell: true so inline env vars (PORT=3000 npm run dev), pipes, etc. work correctly.
  // detached: true puts the child in its own process group so process.kill(-pid) reliably
  // kills the entire subtree (shell + all grandchildren) on stop.
  const child = spawn(cmd, [], {
    shell: true,
    cwd: project.path,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });

  running.set(project.id, { process: child, status: 'running', pid: child.pid, command: project.startCommand, startedAt: Date.now() });
  onStatusChange('running');

  child.stdout.on('data', (data) => {
    const text = data.toString();
    trackPorts(project.id, text);
    bufferLog(project.id, 'stdout', text);
    onData('stdout', text);
  });

  child.stderr.on('data', (data) => {
    const text = data.toString();
    trackPorts(project.id, text);
    bufferLog(project.id, 'stderr', text);
    onData('stderr', text);
  });

  child.on('error', (err) => {
    onData('stderr', `\n[Process error]: ${err.message}\n`);
    running.set(project.id, { ...running.get(project.id), status: 'error' });
    onStatusChange('error');
  });

  child.on('close', (code, signal) => {
    const wasRunning = running.get(project.id);
    // Guard: ignore stale close events from a previous run (e.g. after restart).
    // If the current entry belongs to a different child (different PID), skip.
    if (wasRunning && wasRunning.pid === child.pid) {
      const wasManuallyStopped = Boolean(wasRunning.manualStop);
      // SIGTERM/SIGKILL = manual stop; code 0 = clean exit; code 1 = concurrently
      // normal exit (one child stopped); only code > 1 is a real crash.
      const isSignalStop = signal === 'SIGTERM' || signal === 'SIGKILL';
      const isCrash = !wasManuallyStopped && !isSignalStop && code !== null && code > 1;
      const status = (wasManuallyStopped || isSignalStop || code === 0 || code === 1) ? 'stopped' : 'error';
      const exitMsg = `\n[Process exited with code ${code}${signal ? ` (${signal})` : ''}]\n`;
      bufferLog(project.id, 'stdout', exitMsg);
      onData('stdout', exitMsg);
      running.set(project.id, { ...wasRunning, manualStop: false, status, process: null });
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
  detectedPorts.delete(projectId);
  portEvents.emit('ports-updated', { projectId, ports: [] });
  if (!entry || !entry.process) return;

  // Mark as intentionally stopped so the 'close' handler doesn't mis-classify
  // a non-zero exit code (common when killing a shell process) as a crash.
  running.set(projectId, { ...entry, manualStop: true, status: 'stopped', process: null });

  const pid = entry.process.pid;
  // Kill the entire process group (negative PID). This covers the shell spawned by
  // shell:true plus all its descendants, including processes that create their own
  // sub-shells (concurrently, npm scripts, etc.).
  try { process.kill(-pid, 'SIGTERM'); } catch (_) {}
  // Force-kill anything still alive after 3 seconds
  setTimeout(() => {
    try { process.kill(-pid, 'SIGKILL'); } catch (_) {}
  }, 3000);
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
        try { process.kill(-pid, 'SIGKILL'); } catch (_) {}
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
        try { process.kill(-pid, 'SIGKILL'); } catch (_) {}
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
    env: {
      ...env,
      ...(_opAgentSock ? { SSH_AUTH_SOCK: _opAgentSock } : {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });

  const key = `${project.id}:${command}`;
  child._command = command;
  child._projectId = project.id;
  child._startedAt = Date.now();
  runningCommands.set(key, child);
  onCommandStatus?.('running', command);

  onData('stdout', `$ ${command}\n`);

  child.stdout.on('data', (data) => {
    const text = data.toString();
    trackPorts(project.id, text);
    onData('stdout', text);
  });
  child.stderr.on('data', (data) => {
    const text = data.toString();
    trackPorts(project.id, text);
    onData('stderr', text);
  });
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
  try { process.kill(-child.pid, 'SIGTERM'); } catch (_) {}
  setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {}
  }, 3000);
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

// Returns all PIDs tracked for a project (main process + any running commands)
function getProjectPids(projectId) {
  const pids = [];
  const entry = running.get(projectId);
  if (entry && entry.pid) pids.push(entry.pid);
  for (const [, child] of runningCommands) {
    if (child && child.pid && child._projectId === projectId) pids.push(child.pid);
  }
  return pids;
}

// Returns the number of currently running main processes (not commands)
function getRunningCount() {
  let count = 0;
  for (const entry of running.values()) {
    if (entry && entry.process && entry.status === 'running') count++;
  }
  return count;
}

module.exports = { start, stop, stopAll, runCommand, killCommand, getStatus, isRunning, getRunningPorts, getRunningCount, getAllRunning, getProcessStats, getDetectedPorts, getProjectDetectedPorts, getProjectPids, portEvents, getLogBuffer };
