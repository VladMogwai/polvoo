'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const treeKill = require('tree-kill');

// Map of projectId -> { process, status }
const running = new Map();

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

  const parts = parseCommand(project.startCommand);
  if (parts.length === 0) throw new Error('Empty start command');

  const cmd = parts[0];
  const args = parts.slice(1);
  const envVars = loadEnv(project.envFile);

  const env = {
    ...process.env,
    ...envVars,
    FORCE_COLOR: '1',
  };

  const child = spawn(cmd, args, {
    cwd: project.path,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  running.set(project.id, { process: child, status: 'running', pid: child.pid });
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
      const status = code === 0 ? 'stopped' : (signal === 'SIGTERM' || signal === 'SIGKILL') ? 'stopped' : 'error';
      onData('stdout', `\n[Process exited with code ${code}${signal ? ` (${signal})` : ''}]\n`);
      running.set(project.id, { ...wasRunning, status, process: null });
      onStatusChange(status);
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

function runCommand(project, command, onData) {
  const parts = parseCommand(command);
  if (parts.length === 0) return;

  const cmd = parts[0];
  const args = parts.slice(1);

  const child = spawn(cmd, args, {
    cwd: project.path,
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  onData('stdout', `$ ${command}\n`);

  child.stdout.on('data', (data) => onData('stdout', data.toString()));
  child.stderr.on('data', (data) => onData('stderr', data.toString()));
  child.on('close', (code) => {
    onData('stdout', `[Command exited with code ${code}]\n`);
  });
  child.on('error', (err) => {
    onData('stderr', `[Error]: ${err.message}\n`);
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

module.exports = { start, stop, runCommand, getStatus, isRunning };
