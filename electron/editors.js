'use strict';

const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');

const execAsync = promisify(exec);

const FULL_ENV = {
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

function checkCli(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore', timeout: 3000, env: FULL_ENV });
    return true;
  } catch {
    return false;
  }
}

function checkApp(appPath) {
  return fs.existsSync(appPath);
}

async function getInstalled() {
  const editors = [];

  if (checkCli('code')) editors.push('vscode');
  if (checkCli('cursor')) editors.push('cursor');
  if (checkCli('zed')) editors.push('zed');
  if (checkApp('/Applications/WebStorm.app')) editors.push('webstorm');

  return editors;
}

async function open(editor, projectPath) {
  const escaped = projectPath.replace(/"/g, '\\"');

  switch (editor) {
    case 'vscode':
      await execAsync(`code "${escaped}"`, { env: FULL_ENV });
      break;
    case 'cursor':
      await execAsync(`cursor "${escaped}"`, { env: FULL_ENV });
      break;
    case 'zed':
      await execAsync(`zed "${escaped}"`, { env: FULL_ENV });
      break;
    case 'webstorm':
      await execAsync(`open -a WebStorm "${escaped}"`, { env: FULL_ENV });
      break;
    default:
      throw new Error(`Unknown editor: ${editor}`);
  }
}

async function checkClaude() {
  // 1. Try which claude with full PATH via execSync
  if (checkCli('claude')) return true;

  // 2. Check well-known absolute paths
  const knownPaths = [
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    `${os.homedir()}/.npm-global/bin/claude`,
    `${os.homedir()}/.local/bin/claude`,
  ];
  for (const p of knownPaths) {
    if (fs.existsSync(p)) return true;
  }

  // 3. Try resolving via npm global root
  try {
    const { stdout } = await execAsync('npm root -g 2>/dev/null', { env: FULL_ENV, timeout: 4000 });
    const npmRoot = stdout.trim();
    if (npmRoot) {
      const npmBin = `${npmRoot}/../bin/claude`;
      const resolved = require('path').resolve(npmBin);
      if (fs.existsSync(resolved)) return true;
    }
  } catch {
    // non-fatal
  }

  return false;
}

async function openClaudeExternal(projectPath) {
  const escaped = projectPath.replace(/"/g, '\\"');
  const claudeAvailable = await checkClaude();
  const cmd = claudeAvailable ? `cd "${escaped}" && claude` : `cd "${escaped}"`;

  // Detect preferred terminal: Warp > iTerm2 > Terminal.app
  if (checkApp('/Applications/Warp.app')) {
    const script = `
      tell application "Warp"
        activate
      end tell
      delay 0.5
      tell application "System Events"
        tell process "Warp"
          keystroke "t" using command down
        end tell
      end tell
      delay 0.3
      tell application "System Events"
        tell process "Warp"
          keystroke "${cmd.replace(/"/g, '\\"').replace(/\n/g, '')}"
          key code 36
        end tell
      end tell
    `;
    await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { env: FULL_ENV }).catch(() => {
      execAsync('open -a Warp', { env: FULL_ENV });
    });
    return;
  }

  if (checkApp('/Applications/iTerm.app')) {
    const script = `
tell application "iTerm2"
  activate
  tell current window
    create tab with default profile
    tell current session
      write text "${cmd.replace(/"/g, '\\"')}"
    end tell
  end tell
end tell`;
    await execAsync(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`, { env: FULL_ENV });
    return;
  }

  // Terminal.app fallback
  const script = `tell app "Terminal" to do script "${cmd.replace(/"/g, '\\"')}"`;
  await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { env: FULL_ENV });
}

module.exports = { getInstalled, open, checkClaude, openClaudeExternal };
