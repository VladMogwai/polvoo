import React, { useState, useRef, useEffect, useCallback } from 'react';
import BlockTerminal from './BlockTerminal';

/* ─── Tab data helpers ──────────────────────────────────────────────────── */

let _counter = 0;
function makeTab() {
  _counter++;
  return { id: `tab-${Date.now()}-${_counter}`, title: `Terminal ${_counter}`, closed: false, closedAt: null };
}

/* ─── Sub-components ────────────────────────────────────────────────────── */

function Tab({ tab, isActive, onClick, onClose, onRename }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(tab.title);
  const inputRef = useRef(null);

  function startEdit(e) {
    e.stopPropagation();
    setValue(tab.title);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitEdit() {
    const trimmed = value.trim();
    onRename(trimmed || tab.title);
    setEditing(false);
  }

  return (
    <div
      onClick={onClick}
      onDoubleClick={startEdit}
      className={`group relative flex items-center gap-1.5 px-3 flex-shrink-0 border-r border-[#21262d] cursor-pointer select-none transition-colors ${
        isActive
          ? 'bg-[#0d1117] text-slate-200'
          : 'bg-[#010409] text-slate-500 hover:text-slate-300 hover:bg-[#0d1117]/50'
      }`}
      style={{ height: 36, minWidth: 100, maxWidth: 170 }}
    >
      {isActive && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-violet-500" />
      )}
      <svg className="w-3 h-3 flex-shrink-0 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3" />
      </svg>

      {editing ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
            if (e.key === 'Escape') { setEditing(false); }
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-slate-700 border border-violet-500/60 rounded px-1 text-xs text-slate-200 outline-none font-mono"
          style={{ height: 20 }}
        />
      ) : (
        <span className="flex-1 truncate text-xs" title="Double-click to rename">{tab.title}</span>
      )}

      <span
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className={`flex-shrink-0 w-4 h-4 flex items-center justify-center rounded text-slate-500 hover:text-slate-200 hover:bg-slate-700 transition-all text-sm leading-none ${
          isActive ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
        }`}
        title="Close tab"
      >
        ×
      </span>
    </div>
  );
}

function RecentMenu({ anchorRef, tabs, onReopen, onClose }) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  // Position relative to anchor button using fixed coords
  useEffect(() => {
    if (anchorRef?.current) {
      const r = anchorRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 2, right: window.innerWidth - r.right });
    }
  }, [anchorRef]);

  useEffect(() => {
    function handler(e) {
      if (
        menuRef.current && !menuRef.current.contains(e.target) &&
        anchorRef?.current && !anchorRef.current.contains(e.target)
      ) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  return (
    <div
      ref={menuRef}
      style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 9999, minWidth: 190 }}
      className="bg-[#161b22] border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden"
    >
      <div className="px-3 py-1.5 text-[10px] font-medium text-slate-600 uppercase tracking-wider border-b border-slate-700/60">
        Recently closed
      </div>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onReopen(tab.id)}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-800/60 transition-colors text-left group"
        >
          <svg className="w-3 h-3 text-slate-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3" />
          </svg>
          <span className="flex-1 text-xs text-slate-400 group-hover:text-slate-200 truncate">{tab.title}</span>
          <span className="text-[10px] text-violet-600 group-hover:text-violet-400">reopen</span>
        </button>
      ))}
    </div>
  );
}

/* ─── Main component ────────────────────────────────────────────────────── */

export default function MultiTerminal({ projectId, project, type, active }) {
  const [tabs, setTabs] = useState(() => [makeTab()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [recentMenuOpen, setRecentMenuOpen] = useState(false);
  const recentBtnRef = useRef(null);

  const openTabs = tabs.filter((t) => !t.closed);
  const closedTabs = [...tabs.filter((t) => t.closed)].reverse();

  const effectiveActiveId =
    openTabs.find((t) => t.id === activeTabId)?.id ??
    openTabs[openTabs.length - 1]?.id ??
    null;

  const addTab = useCallback(() => {
    const tab = makeTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const closeTab = useCallback(
    (tabId) => {
      const stillOpen = openTabs.filter((t) => t.id !== tabId);
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, closed: true, closedAt: new Date() } : t))
      );
      if (activeTabId === tabId && stillOpen.length > 0) {
        setActiveTabId(stillOpen[stillOpen.length - 1].id);
      }
    },
    [activeTabId, openTabs]
  );

  const reopenTab = useCallback((tabId) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, closed: false, closedAt: null } : t))
    );
    setActiveTabId(tabId);
    setRecentMenuOpen(false);
  }, []);

  const renameTab = useCallback((tabId, newTitle) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, title: newTitle } : t))
    );
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#0d1117] overflow-hidden">

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div
        className="flex items-end flex-shrink-0 bg-[#010409] border-b border-[#21262d]"
        style={{ minHeight: 36 }}
      >
        {/* Scrollable tabs area */}
        <div className="flex items-end overflow-x-auto flex-1" style={{ minHeight: 36 }}>
          {openTabs.map((tab) => (
            <Tab
              key={tab.id}
              tab={tab}
              isActive={tab.id === effectiveActiveId}
              onClick={() => setActiveTabId(tab.id)}
              onRename={(title) => renameTab(tab.id, title)}
              onClose={() => closeTab(tab.id)}
            />
          ))}
          <button
            onClick={addTab}
            title="New terminal tab"
            className="h-9 px-3 text-slate-600 hover:text-slate-300 hover:bg-slate-800/40 transition-colors flex-shrink-0 text-base leading-none"
          >
            +
          </button>
        </div>

        {/* Recently closed — outside overflow container so dropdown isn't clipped */}
        {closedTabs.length > 0 && (
          <div className="flex-shrink-0 border-l border-[#21262d]">
            <button
              ref={recentBtnRef}
              onClick={() => setRecentMenuOpen((v) => !v)}
              className={`h-9 px-3 text-xs flex items-center gap-1 transition-colors ${
                recentMenuOpen ? 'text-violet-300' : 'text-slate-600 hover:text-slate-300'
              }`}
              title="Recently closed tabs"
            >
              <span>Recently closed</span>
              <svg
                className={`w-3 h-3 transition-transform ${recentMenuOpen ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {recentMenuOpen && (
              <RecentMenu
                anchorRef={recentBtnRef}
                tabs={closedTabs}
                onReopen={reopenTab}
                onClose={() => setRecentMenuOpen(false)}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Terminal panels (all mounted, show/hide via CSS) ──────────── */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {tabs.map((tab) => {
          const isVisible = !tab.closed && tab.id === effectiveActiveId;
          return (
            <div
              key={tab.id}
              className="absolute inset-0"
              style={{ display: isVisible ? 'flex' : 'none', flexDirection: 'column' }}
            >
              <BlockTerminal
                projectId={projectId}
                project={project}
                type={`${type}-${tab.id}`}
                active={active && isVisible}
              />
            </div>
          );
        })}

        {openTabs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <span className="text-xs text-slate-600">No open terminals</span>
            <button
              onClick={addTab}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors"
            >
              + New Terminal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
