'use strict';

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const DOCKER = 'docker';

function run(args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      DOCKER,
      args,
      { timeout: 15000, maxBuffer: 10 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr || '';
          return reject(err);
        }
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      }
    );
  });
}

async function checkAvailable() {
  try {
    // `docker ps` validates both CLI presence and daemon connectivity
    await run(['ps', '-q'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function parseState(status) {
  if (!status) return 'unknown';
  const s = status.toLowerCase();
  if (s.startsWith('up')) return 'running';
  if (s.startsWith('restarting')) return 'restarting';
  if (s.startsWith('paused')) return 'paused';
  if (s.startsWith('created')) return 'created';
  if (s.startsWith('exited') || s.startsWith('dead')) return 'exited';
  return 'unknown';
}

function formatContainer(raw) {
  return {
    id: raw.ID || '',
    name: (raw.Names || raw.Name || '').replace(/^\//, ''),
    image: raw.Image || '',
    status: raw.Status || '',
    state: raw.State || parseState(raw.Status),
    ports: raw.Ports || '',
    labels: raw.Labels || '',
    createdAt: raw.CreatedAt || '',
  };
}

async function listContainers() {
  try {
    const { stdout } = await run(['ps', '-a', '--format', '{{json .}}']);
    const containers = [];
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        containers.push(formatContainer(JSON.parse(trimmed)));
      } catch {}
    }
    return containers;
  } catch {
    return [];
  }
}

function hasComposeFile(projectPath) {
  for (const name of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    try {
      if (fs.existsSync(path.join(projectPath, name))) return true;
    } catch {}
  }
  return false;
}

function matchesProject(container, projectPath) {
  const folderName = path.basename(projectPath).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!folderName) return false;
  const name = container.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const labels = container.labels || '';
  const composeMatch = labels.match(/com\.docker\.compose\.project=([^,\n]+)/);
  const cp = composeMatch ? composeMatch[1].toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return name.includes(folderName) || cp === folderName || (cp && folderName && cp.includes(folderName));
}

async function getProjectContainers(projectPath) {
  const all = await listContainers();
  return all.filter((c) => matchesProject(c, projectPath));
}

async function startContainer(id) {
  await run(['start', id], { timeout: 20000 });
  return true;
}

async function stopContainer(id) {
  await run(['stop', id], { timeout: 30000 });
  return true;
}

async function restartContainer(id) {
  await run(['restart', id], { timeout: 30000 });
  return true;
}

async function getLogs(id) {
  return new Promise((resolve) => {
    execFile(
      DOCKER,
      ['logs', '--tail', '200', id],
      { timeout: 15000, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout, stderr) => {
        // Docker writes most output to stderr — always use both
        const combined = [stdout || '', stderr || ''].join('').trim();
        if (combined) return resolve(combined);
        if (err) return resolve(`Error: ${err.message}`);
        resolve('(no output)');
      }
    );
  });
}

module.exports = {
  checkAvailable,
  listContainers,
  hasComposeFile,
  matchesProject,
  getProjectContainers,
  startContainer,
  stopContainer,
  restartContainer,
  getLogs,
};
