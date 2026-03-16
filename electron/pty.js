'use strict';

let pty;
try {
  pty = require('node-pty');
} catch (e) {
  console.error('node-pty not available:', e.message);
  pty = null;
}

// Sessions: sessionId -> { ptyProcess }
const sessions = new Map();

function create(sessionId, cwd, onData) {
  if (!pty) {
    console.error('node-pty not loaded');
    return;
  }

  if (sessions.has(sessionId)) {
    destroy(sessionId);
  }

  const shell = process.env.SHELL || '/bin/zsh';

  // Spawn as a LOGIN shell so the user's .zprofile / .bash_profile is sourced
  // This gives the full PATH (nvm, homebrew, etc.)
  const shellArgs = ['-l'];

  // Build env — start from a sensible base and add the user's env on top
  const env = {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    // Common PATH additions in case login shell still misses them
    PATH: [
      '/usr/local/bin',
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      process.env.PATH || '',
    ].join(':'),
    HOME: process.env.HOME,
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    SHELL: shell,
    // Carry over anything else the user has
    ...process.env,
    // Override these last so they're always correct
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  };

  try {
    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env,
    });

    ptyProcess.onData(onData);
    ptyProcess.onExit(() => sessions.delete(sessionId));

    sessions.set(sessionId, { ptyProcess });
  } catch (e) {
    console.error('Failed to create PTY session:', e.message);
  }
}

function write(sessionId, data) {
  const s = sessions.get(sessionId);
  if (s) {
    try { s.ptyProcess.write(data); } catch (e) {}
  }
}

function resize(sessionId, cols, rows) {
  const s = sessions.get(sessionId);
  if (s) {
    try { s.ptyProcess.resize(Math.max(cols, 10), Math.max(rows, 5)); } catch (e) {}
  }
}

function destroy(sessionId) {
  const s = sessions.get(sessionId);
  if (s) {
    try { s.ptyProcess.kill(); } catch (e) {}
    sessions.delete(sessionId);
  }
}

function destroyForProject(projectId) {
  for (const [id] of sessions) {
    if (id.startsWith(projectId + '-')) destroy(id);
  }
}

function destroyAll() {
  for (const [id] of sessions) destroy(id);
}

module.exports = { create, write, resize, destroy, destroyForProject, destroyAll };
