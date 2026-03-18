import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useTerminal } from '../../hooks/useTerminal';
import PinnedCommands from './PinnedCommands';
import CommandPalette from './CommandPalette';
import TerminalToolbar from './TerminalToolbar';
import HistoryDropdown from './HistoryDropdown';
import StickyHeader from './StickyHeader';
import {
  historyGet, historyAdd, historyDelete,
  pinsAdd, pinsRemove,
  getProjects, updateProject,
} from '../../ipc';
import '@xterm/xterm/css/xterm.css';

const KNOWN_COMMANDS = new Set([
  'cd', 'ls', 'll', 'la', 'pwd', 'mkdir', 'rm', 'cp', 'mv', 'touch', 'cat',
  'echo', 'grep', 'find', 'awk', 'sed', 'sort', 'head', 'tail', 'wc', 'diff',
  'chmod', 'chown', 'sudo', 'su', 'env', 'export', 'source', 'which', 'type',
  'ps', 'kill', 'killall', 'top', 'htop', 'open', 'clear', 'history', 'exit',
  'man', 'less', 'more', 'printf', 'read', 'set', 'unset', 'exec', 'eval',
  'alias', 'unalias', 'test', 'true', 'false', 'return', 'logout',
  'git', 'npm', 'npx', 'yarn', 'pnpm', 'node', 'ts-node', 'tsc',
  'python', 'python3', 'pip', 'pip3', 'ruby', 'gem', 'bundle', 'rails',
  'make', 'cmake', 'cargo', 'rustc', 'go', 'java', 'javac', 'mvn', 'gradle',
  'docker', 'docker-compose', 'kubectl', 'helm', 'terraform', 'ansible',
  'brew', 'apt', 'apt-get', 'yum', 'dnf', 'pacman', 'snap',
  'curl', 'wget', 'ssh', 'scp', 'rsync', 'tar', 'zip', 'unzip', 'gzip',
  'heroku', 'vercel', 'netlify', 'firebase', 'aws', 'gcloud', 'az',
  'code', 'vim', 'nvim', 'nano', 'code', 'subl',
  'sh', 'bash', 'zsh', 'fish', 'xargs', 'tee', 'watch', 'nohup',
  'ping', 'curl', 'dig', 'nslookup', 'netstat', 'lsof', 'ifconfig', 'ip',
]);

function isShellCommand(cmd) {
  const trimmed = cmd.trim();
  if (!trimmed || trimmed.length < 2) return false;

  // Starts with path prefix
  if (/^[./~]/.test(trimmed)) return true;

  // Contains typical shell characters
  if (/[-=|&><$`!;]/.test(trimmed)) return true;

  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  if (KNOWN_COMMANDS.has(firstWord)) return true;

  // Single word with no spaces — likely a binary name
  if (!/\s/.test(trimmed) && /^[a-zA-Z0-9_-]+$/.test(trimmed)) return true;

  // Reject: multiple plain words with no command-like characters (natural language)
  return false;
}

export default function BlockTerminal({ projectId, project: projectProp, type, active }) {
  const containerRef = useRef(null);
  const historyBtnRef = useRef(null);

  const [pins, setPins] = useState([]);
  const [history, setHistory] = useState([]);
  const [lastCmd, setLastCmd] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyAnchorRef, setHistoryAnchorRef] = useState(null);

  // Scroll state
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Drag and drop
  const [isDragging, setIsDragging] = useState(false);

  // Context menu
  const [menu, setMenu] = useState({ visible: false, x: 0, y: 0 });
  const menuRef = useRef(null);

  // Terminal hook — onCommand saves directly-typed commands to history
  const { dispose, sendInput, fit, scrollToBottom } = useTerminal(containerRef, projectId, type, active, {
    onScrollChange: (atBottom) => setIsAtBottom(atBottom),
    onCommand: async (cmd) => {
      try {
        if (!isShellCommand(cmd)) return;
        await historyAdd(projectId, cmd);
        const h = await historyGet(projectId);
        setHistory(h || []);
      } catch {}
    },
  });

  // ── Load initial data ──────────────────────────────────────────────────────

  useEffect(() => {
    historyGet(projectId).then((h) => setHistory(h || [])).catch(() => {});
  }, [projectId]);

  // Load pins from project config
  useEffect(() => {
    const proj = projectProp;
    if (proj?.pinnedCommands) {
      setPins(proj.pinnedCommands);
    } else {
      // Fetch from main if not passed as prop
      getProjects().then((projects) => {
        const p = projects?.find((p) => p.id === projectId);
        if (p?.pinnedCommands) setPins(p.pinnedCommands);
      }).catch(() => {});
    }
  }, [projectId, projectProp]);

  // Dispose on unmount
  useEffect(() => {
    return () => dispose();
  }, [dispose]);

  // ── Cmd+K handler ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!active) return;

    function handleKeyDown(e) {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const modifier = isMac ? e.metaKey : e.ctrlKey;
      if (modifier && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active]);

  // ── Context menu ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!menu.visible) return;
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenu((m) => ({ ...m, visible: false }));
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menu.visible]);

  // ── Send command helper ────────────────────────────────────────────────────

  const runCommand = useCallback(async (cmd) => {
    if (!cmd) return;
    sendInput(cmd + '\r');
    setLastCmd(cmd);

    // Persist to history
    try {
      if (isShellCommand(cmd)) {
        await historyAdd(projectId, cmd);
        const h = await historyGet(projectId);
        setHistory(h || []);
      }
    } catch {}
  }, [sendInput, projectId]);

  // ── Pin management ────────────────────────────────────────────────────────

  const handlePin = useCallback(async (cmd) => {
    try {
      await pinsAdd(projectId, cmd);
      const projects = await getProjects();
      const p = projects?.find((p) => p.id === projectId);
      if (p?.pinnedCommands) setPins(p.pinnedCommands);
    } catch {}
  }, [projectId]);

  const handleUnpin = useCallback(async (cmd) => {
    try {
      await pinsRemove(projectId, cmd);
      const projects = await getProjects();
      const p = projects?.find((p) => p.id === projectId);
      setPins(p?.pinnedCommands || []);
    } catch {}
  }, [projectId]);

  const handleHistoryDelete = useCallback(async (cmd) => {
    try {
      await historyDelete(projectId, cmd);
      const h = await historyGet(projectId);
      setHistory(h || []);
    } catch {}
  }, [projectId]);

  // ── Toolbar handlers ──────────────────────────────────────────────────────

  function handleToggleHistory(anchorRefArg) {
    setHistoryAnchorRef(anchorRefArg || null);
    setHistoryOpen((v) => !v);
  }

  // ── Context menu ──────────────────────────────────────────────────────────

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    setMenu({ visible: true, x: e.clientX, y: e.clientY });
  }, []);

  const handleMenuPaste = useCallback(() => {
    navigator.clipboard.readText().then((text) => {
      if (text) sendInput(text);
    }).catch(() => {});
    setMenu((m) => ({ ...m, visible: false }));
  }, [sendInput]);

  const handleMenuCopy = useCallback(() => {
    const sel = window.getSelection();
    if (sel?.toString()) navigator.clipboard.writeText(sel.toString()).catch(() => {});
    setMenu((m) => ({ ...m, visible: false }));
  }, []);

  const handleMenuClear = useCallback(() => {
    sendInput('clear\r');
    setMenu((m) => ({ ...m, visible: false }));
  }, [sendInput]);

  // ── Drag and drop handlers ────────────────────────────────────────────────

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    console.log('DROP FILES:', files);
    if (!files.length) return;
    const paths = files.map((f) => {
      // Electron 32+ requires webUtils.getPathForFile(); File.path is deprecated and returns ""
      const p = window.electronAPI?.getPathForFile?.(f) || f.path || f.name;
      console.log('FILE:', f.name, 'PATH:', p);
      // POSIX single-quote escaping: handles spaces, $, `, ;, | and other special chars
      return p ? `'${p.replace(/'/g, "'\\''")}'` : null;
    }).filter(Boolean).join(' ');
    console.log('PATHS TO INSERT:', paths);
    if (!paths) return;
    sendInput(paths);
  }, [sendInput]);

  const hasDomSelection = Boolean(window.getSelection()?.toString());

  return (
    <div className="flex flex-col h-full bg-[#0d1117] overflow-hidden">
      {/* Toolbar */}
      <TerminalToolbar
        onOpenPalette={() => setPaletteOpen(true)}
        onToggleHistory={handleToggleHistory}
        historyOpen={historyOpen}
        historyCount={history.length}
      />

      {/* Pinned commands */}
      <PinnedCommands
        pins={pins}
        onRun={runCommand}
        onUnpin={handleUnpin}
      />

      {/* Sticky last-command header */}
      <StickyHeader command={lastCmd} onRerun={runCommand} />

      {/* Terminal area */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div
          ref={containerRef}
          onContextMenu={handleContextMenu}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            flex: 1,
            minHeight: 0,
            background: '#0d1117',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {isDragging && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(139, 92, 246, 0.15)',
              border: '2px dashed #8b5cf6', borderRadius: '8px',
              pointerEvents: 'none',
            }}>
              <span style={{ color: '#8b5cf6', fontSize: '14px' }}>
                Drop to insert path
              </span>
            </div>
          )}
          {!isAtBottom && (
            <button
              onClick={scrollToBottom}
              style={{
                position: 'absolute',
                bottom: 12,
                right: 20,
                zIndex: 20,
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: '#21262d',
                border: '1px solid #30363d',
                color: '#8b949e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#30363d'; e.currentTarget.style.color = '#e6edf3'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#21262d'; e.currentTarget.style.color = '#8b949e'; }}
              title="Scroll to bottom"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>

      </div>

      {/* Command Palette overlay */}
      {paletteOpen && (
        <CommandPalette
          history={history}
          pins={pins}
          onSelect={runCommand}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {/* History dropdown */}
      {historyOpen && (
        <HistoryDropdown
          anchorRef={historyAnchorRef}
          history={history}
          pins={pins}
          onRun={runCommand}
          onPin={handlePin}
          onDelete={handleHistoryDelete}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {/* Context menu */}
      {menu.visible && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: menu.y,
            left: menu.x,
            zIndex: 9999,
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 6,
            padding: '4px 0',
            minWidth: 140,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            userSelect: 'none',
          }}
        >
          {hasDomSelection && (
            <ContextMenuItem label="Copy" onClick={handleMenuCopy} />
          )}
          <ContextMenuItem label="Paste" onClick={handleMenuPaste} />
          <div style={{ borderTop: '1px solid #30363d', margin: '4px 0' }} />
          <ContextMenuItem label="Clear" onClick={handleMenuClear} />
        </div>
      )}
    </div>
  );
}

function ContextMenuItem({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        padding: '6px 14px',
        background: 'transparent',
        border: 'none',
        color: '#e6edf3',
        fontSize: 12,
        textAlign: 'left',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#21262d')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {label}
    </button>
  );
}
