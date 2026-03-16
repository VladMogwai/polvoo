'use strict';

const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);

function checkCli(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore', timeout: 3000 });
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
      await execAsync(`code "${escaped}"`);
      break;
    case 'cursor':
      await execAsync(`cursor "${escaped}"`);
      break;
    case 'zed':
      await execAsync(`zed "${escaped}"`);
      break;
    case 'webstorm':
      await execAsync(`open -a WebStorm "${escaped}"`);
      break;
    default:
      throw new Error(`Unknown editor: ${editor}`);
  }
}

async function checkClaude() {
  return checkCli('claude');
}

async function openClaudeExternal(projectPath) {
  const escaped = projectPath.replace(/"/g, '\\"');
  const claudeAvailable = await checkClaude();
  const cmd = claudeAvailable ? `cd "${escaped}" && claude` : `cd "${escaped}"`;

  // Detect preferred terminal: Warp > iTerm2 > Terminal.app
  if (checkApp('/Applications/Warp.app')) {
    // Warp supports opening via URL scheme but not running a command directly,
    // so we use AppleScript to open Warp and cd
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
    await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`).catch(() => {
      // Fallback: just open Warp
      execAsync('open -a Warp');
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
    await execAsync(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`);
    return;
  }

  // Terminal.app fallback
  const script = `tell app "Terminal" to do script "${cmd.replace(/"/g, '\\"')}"`;
  await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
}

module.exports = { getInstalled, open, checkClaude, openClaudeExternal };
