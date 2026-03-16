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

// execFile-based helper — avoids any shell interpretation of arguments
async function runFile(args, cwd) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: GIT_ENV,
    timeout: 8000,
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

  // Step 1: get branch names via `git branch` — simple, no format tricks
  let branches = [];
  try {
    const namesRaw = await runFile(
      ['branch', '--sort=-committerdate'],
      projectPath
    );
    const names = namesRaw
      .split('\n')
      .map((l) => l.replace(/^\*\s*/, '').trim())
      .filter(Boolean);

    // Step 2: get relative dates for all branches in one call using for-each-ref
    // Use a tab separator — safe because git branch names cannot contain tabs
    let dateMap = {};
    try {
      const dateRaw = await runFile(
        ['for-each-ref', '--sort=-committerdate',
          '--format=%(refname:short)\t%(committerdate:relative)',
          'refs/heads/'],
        projectPath
      );
      for (const line of dateRaw.split('\n').filter(Boolean)) {
        const tab = line.indexOf('\t');
        if (tab >= 0) dateMap[line.slice(0, tab)] = line.slice(tab + 1).trim();
      }
    } catch { /* dates are optional */ }

    branches = names.map((name) => ({
      name,
      date: dateMap[name] || '',
      isCurrent: name === current,
    }));
  } catch (err) {
    console.error('getBranches error:', err.message);
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
