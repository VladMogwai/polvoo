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

export default function BlockTerminal({ projectId, project: projectProp, type, active }) {
  const containerRef = useRef(null);
  const historyBtnRef = useRef(null);

  const [pins, setPins] = useState([]);
  const [history, setHistory] = useState([]);
  const [lastCmd, setLastCmd] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyAnchorRef, setHistoryAnchorRef] = useState(null);

  // Drag and drop
  const [isDragging, setIsDragging] = useState(false);

  // Context menu
  const [menu, setMenu] = useState({ visible: false, x: 0, y: 0 });
  const menuRef = useRef(null);

  // Terminal hook — onCommand saves directly-typed commands to history
  const { dispose, sendInput, fit } = useTerminal(containerRef, projectId, type, active, {
    onCommand: async (cmd) => {
      try {
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
      await historyAdd(projectId, cmd);
      const h = await historyGet(projectId);
      setHistory(h || []);
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
      return p && p.includes(' ') ? `"${p}"` : p;
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
