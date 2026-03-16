'use strict';

let pty;
try {
  pty = require('node-pty');
} catch (e) {
  console.error('node-pty not available:', e.message);
  pty = null;
}

// Map of sessionId -> pty process
const sessions = new Map();

function create(sessionId, cwd, onData) {
  if (!pty) {
    console.error('node-pty not loaded, cannot create PTY');
    return;
  }

  if (sessions.has(sessionId)) {
    destroy(sessionId);
  }

  const shell = process.env.SHELL || '/bin/zsh';
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  };

  try {
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env,
    });

    ptyProcess.onData((data) => {
      onData(data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      sessions.delete(sessionId);
    });

    sessions.set(sessionId, { ptyProcess, onData });
  } catch (e) {
    console.error('Failed to create PTY session:', e.message);
  }
}

function write(sessionId, data) {
  const session = sessions.get(sessionId);
  if (session) {
    try {
      session.ptyProcess.write(data);
    } catch (e) {
      console.error('PTY write error:', e.message);
    }
  }
}

function resize(sessionId, cols, rows) {
  const session = sessions.get(sessionId);
  if (session) {
    try {
      session.ptyProcess.resize(cols, rows);
    } catch (e) {
      // ignore resize errors
    }
  }
}

function destroy(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    try {
      session.ptyProcess.kill();
    } catch (e) {
      // ignore
    }
    sessions.delete(sessionId);
  }
}

function destroyForProject(projectId) {
  for (const [sessionId] of sessions) {
    if (sessionId.startsWith(projectId + '-')) {
      destroy(sessionId);
    }
  }
}

function destroyAll() {
  for (const [sessionId] of sessions) {
    destroy(sessionId);
  }
}

module.exports = { create, write, resize, destroy, destroyForProject, destroyAll };
