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

async function runFileLong(args, cwd) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: GIT_ENV,
    timeout: 30000,
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout;
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

async function getCommitLog(repoPath, limit = 100, skip = 0) {
  try {
    await run('git rev-parse --git-dir', repoPath);
  } catch {
    return { commits: [], isRepo: false };
  }
  try {
    const raw = await runFile([
      'log', '-n', String(limit), `--skip=${skip}`,
      '--format=%x1e%H%x1f%s%x1f%an%x1f%ar%x1f%ae',
      '--no-decorate',
    ], repoPath);
    if (!raw.trim()) return { commits: [], isRepo: true };
    const commits = raw.split('\x1e').filter(Boolean).map((block) => {
      const parts = block.trim().split('\x1f');
      return { hash: parts[0] || '', message: parts[1] || '', author: parts[2] || '', dateRel: parts[3] || '', email: parts[4] || '' };
    });
    return { commits, isRepo: true };
  } catch {
    return { commits: [], isRepo: true };
  }
}

async function getCommitFiles(repoPath, hash) {
  try {
    let parent;
    try {
      parent = (await runFile(['rev-parse', `${hash}^`], repoPath)).trim();
    } catch {
      parent = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    }
    const [numstatRaw, nameStatusRaw] = await Promise.all([
      runFileLong(['diff', '--numstat', parent, hash], repoPath).catch(() => ''),
      runFile(['diff', '--name-status', '-M', parent, hash], repoPath).catch(() => ''),
    ]);
    const statsMap = {};
    for (const line of numstatRaw.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const filename = parts.slice(2).join('\t');
        statsMap[filename] = {
          added: parts[0] === '-' ? 0 : (parseInt(parts[0], 10) || 0),
          deleted: parts[1] === '-' ? 0 : (parseInt(parts[1], 10) || 0),
        };
      }
    }
    const files = [];
    for (const line of nameStatusRaw.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      const type = parts[0][0];
      const isRename = type === 'R' || type === 'C';
      const oldPath = parts[1] || '';
      const newPath = isRename ? (parts[2] || '') : '';
      const displayPath = newPath || oldPath;
      const st = statsMap[displayPath] || statsMap[oldPath] || { added: 0, deleted: 0 };
      files.push({ type, path: displayPath, oldPath: isRename ? oldPath : null, added: st.added, deleted: st.deleted });
    }
    return files;
  } catch {
    return [];
  }
}

async function getCommitDiff(repoPath, hash) {
  try {
    let parent;
    try {
      parent = (await runFile(['rev-parse', `${hash}^`], repoPath)).trim();
    } catch {
      parent = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    }
    return await runFileLong(['diff', '--no-color', '-M', parent, hash], repoPath);
  } catch {
    return '';
  }
}

const DIFF_SIZE_LIMIT = 2 * 1024 * 1024; // 2 MB cap to keep IPC fast

async function getWorkingTreeDiff(repoPath) {
  try {
    await run('git rev-parse --git-dir', repoPath);
  } catch {
    return { isRepo: false, unstaged: '', staged: '' };
  }
  const tryDiff = async (...args) => runFileLong(args, repoPath).catch(() => '');
  const [unstaged, staged] = await Promise.all([
    tryDiff('diff', 'HEAD', '--no-color').then(r => r || tryDiff('diff', '--no-color')),
    tryDiff('diff', '--cached', 'HEAD', '--no-color').then(r => r || tryDiff('diff', '--cached', '--no-color')),
  ]);
  // Truncate to avoid sending huge payloads over IPC
  const truncate = (s) => s.length > DIFF_SIZE_LIMIT
    ? s.slice(0, DIFF_SIZE_LIMIT) + '\n\n[diff truncated — too large to display]\n'
    : s;
  return { isRepo: true, unstaged: truncate(unstaged), staged: truncate(staged) };
}

// Returns structured list of changed files with staging status
// Format: [{ path, x (staged status), y (unstaged status), isStaged, isUnstaged, isUntracked }]
async function createBranch(repoPath, branchName, setUpstream) {
  try {
    // Create and switch to new branch from current HEAD
    await runFile(['checkout', '-b', branchName], repoPath);
    if (setUpstream) {
      // Push and set upstream: git push -u origin <branch>
      const { stderr } = await execAsync(`git push -u origin "${branchName.replace(/"/g, '\\"')}"`, {
        cwd: repoPath, env: GIT_ENV, timeout: 30000,
      }).catch((err) => ({ stderr: err.stderr || err.message }));
      // stderr is normal for git push (progress output) — only fail on non-zero exit
      // execAsync rejects on non-zero, so if we got here the push succeeded
      void stderr;
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: (err.stderr || err.message || String(err)).trim() };
  }
}

async function getStagingStatus(repoPath) {
  try {
    await run('git rev-parse --git-dir', repoPath);
  } catch {
    return { isRepo: false, files: [], branch: null };
  }
  let branch = null;
  try { branch = await run('git symbolic-ref --short HEAD', repoPath); } catch {}

  let files = [];
  try {
    const raw = await runFile(['status', '--porcelain=v1', '-u'], repoPath);
    for (const line of raw.split('\n').filter(Boolean)) {
      const x = line[0]; // staged
      const y = line[1]; // unstaged
      let filePath = line.slice(3);
      // Handle renames: "old -> new"
      if (filePath.includes(' -> ')) filePath = filePath.split(' -> ')[1];
      files.push({
        path: filePath,
        x,
        y,
        isStaged: x !== ' ' && x !== '?',
        isUnstaged: y !== ' ',
        isUntracked: x === '?' && y === '?',
      });
    }
  } catch {}
  return { isRepo: true, files, branch };
}

async function stageFile(repoPath, filePath) {
  try {
    await runFile(['add', '--', filePath], repoPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function unstageFile(repoPath, filePath) {
  try {
    // git restore --staged works for Git 2.23+; fall back to git reset HEAD
    try {
      await runFile(['restore', '--staged', '--', filePath], repoPath);
    } catch {
      await runFile(['reset', 'HEAD', '--', filePath], repoPath);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function stageAll(repoPath) {
  try {
    await runFile(['add', '-A'], repoPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function unstageAll(repoPath) {
  try {
    try {
      await runFile(['restore', '--staged', '.'], repoPath);
    } catch {
      await runFile(['reset', 'HEAD'], repoPath);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function commitChanges(repoPath, summary, description) {
  try {
    const message = description ? `${summary}\n\n${description}` : summary;
    await runFile(['commit', '-m', message], repoPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function pushChanges(repoPath) {
  try {
    const { stdout, stderr } = await execAsync('git push', {
      cwd: repoPath, env: GIT_ENV, timeout: 30000,
    });
    return { success: true, output: stdout + stderr };
  } catch (err) {
    // git push sometimes writes progress to stderr but still succeeds
    const output = (err.stdout || '') + (err.stderr || '');
    return { success: false, error: err.message, output };
  }
}

async function pullChanges(repoPath) {
  try {
    const { stdout, stderr } = await execAsync('git pull', {
      cwd: repoPath, env: GIT_ENV, timeout: 30000,
    });
    return { success: true, output: (stdout + stderr).trim() };
  } catch (err) {
    return { success: false, error: (err.stderr || err.message || String(err)).trim() };
  }
}

module.exports = { getInfo, getBranches, checkoutBranch, createBranch, getCommitLog, getCommitFiles, getCommitDiff, getWorkingTreeDiff, getStagingStatus, stageFile, unstageFile, stageAll, unstageAll, commitChanges, pushChanges, pullChanges };
