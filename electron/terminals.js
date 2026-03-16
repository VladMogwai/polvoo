'use strict';

const { execSync, exec, execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const settings = require('./settings');

const execAsync = promisify(exec);

const FULL_ENV = {
  ...process.env,
  PATH: [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/bin',
    '/bin',
    process.env.PATH || '',
  ].join(':'),
};

// Built-in known terminals
const KNOWN_TERMINALS = [
  { id: 'warp',      name: 'Warp',      appPath: '/Applications/Warp.app' },
  { id: 'iterm2',    name: 'iTerm2',    appPath: '/Applications/iTerm.app' },
  { id: 'ghostty',   name: 'Ghostty',   appPath: '/Applications/Ghostty.app' },
  { id: 'wezterm',   name: 'WezTerm',   appPath: '/Applications/WezTerm.app', cli: 'wezterm' },
  { id: 'alacritty', name: 'Alacritty', appPath: '/Applications/Alacritty.app' },
  { id: 'hyper',     name: 'Hyper',     appPath: '/Applications/Hyper.app' },
  { id: 'kitty',     name: 'kitty',     appPath: '/Applications/kitty.app', cli: 'kitty' },
  { id: 'terminal',  name: 'Terminal',  appPath: '/System/Applications/Utilities/Terminal.app' },
];

function checkApp(p) { return fs.existsSync(p); }
function checkCli(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'ignore', timeout: 2000, env: FULL_ENV }); return true; }
  catch { return false; }
}

function getInstalled() {
  const autoDetected = KNOWN_TERMINALS
    .filter((t) => (t.appPath && checkApp(t.appPath)) || (t.cli && checkCli(t.cli)))
    .map(({ id, name }) => ({ id, name, isCustom: false }));

  const custom = (settings.get().customTerminals || []).map((t) => ({
    id: t.id,
    name: t.name,
    appPath: t.appPath,
    extraPath: t.extraPath || '',
    isCustom: true,
  }));

  return [...autoDetected, ...custom];
}

async function openInTerminal(terminalId, projectPath) {
  const escaped = projectPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  // Check custom terminals first
  const custom = (settings.get().customTerminals || []).find((t) => t.id === terminalId);
  if (custom) {
    // Build env with any extra PATH the user specified
    const extraPath = custom.extraPath ? custom.extraPath.split(':').filter(Boolean) : [];
    const envWithExtra = {
      ...FULL_ENV,
      PATH: [...extraPath, FULL_ENV.PATH].join(':'),
    };

    if (custom.openCommand) {
      // User-provided command template: {path} is replaced
      const cmd = custom.openCommand.replace(/{path}/g, escaped);
      await execAsync(cmd, { env: envWithExtra });
    } else if (custom.appPath) {
      await execAsync(`open -a "${custom.appPath.replace(/"/g, '\\"')}" "${escaped}"`, { env: envWithExtra });
    } else {
      throw new Error(`Custom terminal "${custom.name}" has no appPath or openCommand`);
    }
    return;
  }

  // Built-in terminals
  const env = FULL_ENV;
  switch (terminalId) {
    case 'warp':
      await execAsync(`open -a Warp "${escaped}"`, { env });
      break;

    case 'iterm2': {
      const script = `tell application "iTerm2"
  activate
  tell current window
    create tab with default profile
    tell current session
      write text "cd \\"${escaped}\\""
    end tell
  end tell
end tell`;
      await execAsync(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`, { env }).catch(async () => {
        await execAsync(`open -a iTerm "${escaped}"`, { env });
      });
      break;
    }

    case 'ghostty':
      await execAsync(`open -a Ghostty "${escaped}"`, { env });
      break;

    case 'wezterm':
      await execAsync(`wezterm start --cwd "${escaped}"`, { env }).catch(async () => {
        await execAsync(`open -a WezTerm "${escaped}"`, { env });
      });
      break;

    case 'alacritty':
      await execAsync(`open -a Alacritty "${escaped}"`, { env });
      break;

    case 'hyper':
      await execAsync(`open -a Hyper "${escaped}"`, { env });
      break;

    case 'kitty':
      await execAsync(`kitty --directory "${escaped}"`, { env }).catch(async () => {
        await execAsync(`open -a kitty "${escaped}"`, { env });
      });
      break;

    case 'terminal':
    default: {
      const script2 = `tell app "Terminal" to do script "cd \\"${escaped}\\""`;
      await execAsync(`osascript -e '${script2.replace(/'/g, "'\\''")}'`, { env });
      break;
    }
  }
}

module.exports = { getInstalled, openInTerminal };
