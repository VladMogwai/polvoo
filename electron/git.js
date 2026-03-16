'use strict';

const { exec, execFile } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// When Electron launches it can have a stripped PATH — add all common locations
const GIT_ENV = {
  ...process.env,
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
};

async function run(cmd, cwd) {
  const { stdout } = await execAsync(cmd, {
    cwd,
    env: GIT_ENV,
    timeout: 5000,
  });
  return stdout.trim();
}

async function getInfo(projectPath) {
  // 1. Confirm it's inside a git repo
  try {
    await run('git rev-parse --git-dir', projectPath);
  } catch {
    return { branch: null, lastCommit: null, isRepo: false };
  }

  // 2. Get branch — symbolic-ref is what git uses internally (same as GitHub Desktop)
  let branch = null;
  try {
    branch = await run('git symbolic-ref --short HEAD', projectPath);
  } catch {
    // Detached HEAD → show short commit hash instead
    try {
      branch = await run('git rev-parse --short HEAD', projectPath);
    } catch {
      branch = null;
    }
  }

  // 3. Get last commit
  let lastCommit = null;
  try {
    // %x00 as separator to handle messages with | in them
    const raw = await run('git log -1 --format=%H%x00%s%x00%an%x00%ar', projectPath);
    const [hash, message, author, date] = raw.split('\x00');
    lastCommit = {
      hash: hash ? hash.slice(0, 7) : '',
      message: message || '',
      author: author || '',
      date: date || '',
    };
  } catch {
    // non-fatal
  }

  return { branch, lastCommit, isRepo: true };
}

async function getBranches(projectPath) {
  // Confirm it's inside a git repo first
  try {
    await run('git rev-parse --git-dir', projectPath);
  } catch {
    return { current: null, branches: [] };
  }

  // Get current branch
  let current = null;
  try {
    current = await run('git symbolic-ref --short HEAD', projectPath);
  } catch {
    try {
      current = await run('git rev-parse --short HEAD', projectPath);
    } catch {
      current = null;
    }
  }

  // Get all local branches sorted by most recent commit date
  // Format: refname:short|committerdate:relative
  let branches = [];
  try {
    const raw = await run(
      'git for-each-ref --sort=-committerdate --format=%(refname:short)|%(committerdate:relative) refs/heads/',
      projectPath
    );
    if (raw) {
      branches = raw.split('\n').filter(Boolean).map((line) => {
        const pipeIdx = line.indexOf('|');
        const name = pipeIdx >= 0 ? line.slice(0, pipeIdx) : line;
        const date = pipeIdx >= 0 ? line.slice(pipeIdx + 1) : '';
        return {
          name,
          date,
          isCurrent: name === current,
        };
      });
    }
  } catch {
    // non-fatal — return empty list
  }

  return { current, branches };
}

async function checkoutBranch(projectPath, branchName) {
  // Use execFile to avoid shell injection — branchName is passed as a literal arg
  try {
    await execFileAsync('git', ['checkout', branchName], {
      cwd: projectPath,
      env: GIT_ENV,
      timeout: 10000,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

module.exports = { getInfo, getBranches, checkoutBranch };
