'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const SECRET_RE = /key|secret|token|password|pwd|auth|credential/i;

// A file is treated as an env file if its name starts with '.env' or ends with '.env'
function isEnvFile(name) {
  return name.startsWith('.env') || name.endsWith('.env');
}

// Directories to skip when recursively scanning
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '.cache',
  '__pycache__', '.turbo', '.svelte-kit', 'out', '.output',
  'coverage', '.nyc_output', 'vendor', '.venv', 'venv',
  'tmp', 'temp', 'logs', 'target', '.gradle',
]);

/**
 * Recursively scan a project for all .env* files (up to 4 levels deep).
 * Returns an array of { relativePath, absolutePath, variables, isReadable, isWritable }
 */
function scanEnvFiles(projectPath) {
  const results = [];

  function walk(dir, depth) {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(path.join(dir, entry.name), depth + 1);
        }
      } else if (entry.isFile() && isEnvFile(entry.name)) {
        const abs = path.join(dir, entry.name);
        const rel = path.relative(projectPath, abs);

        let isReadable = false, isWritable = false;
        try { fs.accessSync(abs, fs.constants.R_OK); isReadable = true; } catch {}
        try { fs.accessSync(abs, fs.constants.W_OK); isWritable = true; } catch {}

        let variables = [];
        if (isReadable) {
          try {
            const parsed = dotenv.parse(fs.readFileSync(abs));
            variables = Object.entries(parsed).map(([key, value]) => ({
              key, value, isSecret: SECRET_RE.test(key),
            }));
          } catch {}
        }

        results.push({ relativePath: rel, absolutePath: abs, variables, isReadable, isWritable });
      }
    }
  }

  walk(projectPath, 0);

  // Sort: shallower paths first, then alphabetically
  results.sort((a, b) => {
    const aDepth = (a.relativePath.match(/[/\\]/g) || []).length;
    const bDepth = (b.relativePath.match(/[/\\]/g) || []).length;
    if (aDepth !== bDepth) return aDepth - bDepth;
    return a.relativePath.localeCompare(b.relativePath);
  });

  return results;
}

/**
 * Save an array of { key, value } pairs to a specific env file.
 * Preserves comment lines (# ...) and blank lines between variable groups.
 * Existing keys are updated in-place; deleted keys are removed;
 * new keys are appended after the last non-blank line.
 */
function saveEnvFile(absolutePath, vars) {
  // Build map of key → value for incoming state
  const varMap = new Map();
  for (const v of vars) {
    if (v.key && v.key.trim()) varMap.set(v.key.trim(), v.value ?? '');
  }

  const handledKeys = new Set();
  const outputLines = [];

  // Process existing file line-by-line to preserve structure
  if (fs.existsSync(absolutePath)) {
    const rawLines = fs.readFileSync(absolutePath, 'utf8').split('\n');
    // Drop trailing empty entry produced by final \n
    if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop();

    for (const line of rawLines) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        // Blank lines and comments — preserve as-is
        outputLines.push(line);
        continue;
      }
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        const key = line.slice(0, eqIdx).trim();
        if (varMap.has(key)) {
          outputLines.push(`${key}=${varMap.get(key)}`);
          handledKeys.add(key);
        }
        // else: key was deleted by user — omit the line
      } else {
        // Unknown format (e.g. export KEY=...) — preserve
        outputLines.push(line);
      }
    }
  }

  // Append brand-new keys (not found in the existing file)
  for (const [key, value] of varMap) {
    if (!handledKeys.has(key)) outputLines.push(`${key}=${value}`);
  }

  // Write back — always end with a single newline
  const content = outputLines.join('\n');
  fs.writeFileSync(absolutePath, content ? content + '\n' : '', 'utf8');
}

/**
 * Create an empty env file (throws if it already exists).
 */
function createEnvFile(absolutePath) {
  if (fs.existsSync(absolutePath)) throw new Error('File already exists');
  const dir = path.dirname(absolutePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(absolutePath, '', 'utf8');
}

// ── Legacy API (kept for backward compat with existing env:load / env:save) ──

const ENV_DIRS = ['', 'env', 'envs', 'config', '.config', 'environments', 'configs'];

function collectEnvFiles(projectPath) {
  const found = [];
  for (const dir of ENV_DIRS) {
    const dirAbs = dir ? path.join(projectPath, dir) : projectPath;
    if (!fs.existsSync(dirAbs)) continue;
    let entries;
    try { entries = fs.readdirSync(dirAbs); } catch { continue; }
    for (const entry of entries) {
      if (!isEnvFile(entry)) continue;
      const abs = path.join(dirAbs, entry);
      try { if (!fs.statSync(abs).isFile()) continue; } catch { continue; }
      const label = dir ? `${dir}/${entry}` : entry;
      found.push({ absPath: abs, label });
    }
  }
  return found;
}

function loadEnv(projectPath, envFilePath) {
  const result = {};
  if (envFilePath) {
    const abs = path.isAbsolute(envFilePath) ? envFilePath : path.join(projectPath, envFilePath);
    if (fs.existsSync(abs)) {
      try {
        const parsed = dotenv.parse(fs.readFileSync(abs));
        for (const [k, v] of Object.entries(parsed)) {
          result[k] = { value: v, source: path.basename(abs), isSecret: SECRET_RE.test(k) };
        }
      } catch {}
    }
  }
  const envFiles = collectEnvFiles(projectPath);
  for (const { absPath, label } of envFiles) {
    try {
      const parsed = dotenv.parse(fs.readFileSync(absPath));
      for (const [k, v] of Object.entries(parsed)) {
        if (!result[k]) result[k] = { value: v, source: label, isSecret: SECRET_RE.test(k) };
      }
    } catch {}
  }
  return result;
}

module.exports = { loadEnv, scanEnvFiles, saveEnvFile, createEnvFile };
