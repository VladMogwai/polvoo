import React, { useState, useEffect, useCallback } from 'react';
import { useProjectPorts } from '../hooks/useProjectPorts';
import LogOutput from './LogOutput';
import Terminal from './Terminal';
import BranchSwitcher from './BranchSwitcher';
import TerminalMenu from './TerminalMenu';
import GitHistoryTab from './git/GitHistoryTab';
import DockerPanel from './DockerPanel';
import EnvViewer from './terminal/EnvViewer';
import { useProcess } from '../hooks/useProcess';
import {
  getInstalledEditors,
  openInEditor,
  getGitInfo,
} from '../ipc';


function Tooltip({ label, sub, children }) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && label && (
        <div className="absolute top-full left-0 mt-1.5 z-50 pointer-events-none" style={{ minWidth: 160, maxWidth: 300 }}>
          <div className="w-2 h-2 bg-[#161b22] border-t border-l border-slate-700/60 rotate-45 ml-3 mb-[-5px] relative z-10" />
          <div className="bg-[#161b22] border border-slate-700/60 rounded-lg px-3 py-2 shadow-xl">
            <div className="text-xs font-mono text-violet-300 break-all">{label}</div>
            {sub && <div className="text-[10px] text-slate-600 mt-1 break-all">{sub}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_COLORS = {
  running: 'bg-emerald-500',
  stopped: 'bg-slate-500',
  error: 'bg-red-500',
};
const STATUS_TEXT = {
  running: 'text-emerald-400',
  stopped: 'text-slate-400',
  error: 'text-red-400',
};
const STATUS_LABELS = { running: 'Running', stopped: 'Stopped', error: 'Error' };

export default function DetailPanel({ project, gitInfo, onClose, onRemove, onUpdateProject, errorCount = 0, onLogsViewed, onLogsHidden, isActive = true }) {
  const [activeTab, setActiveTab] = useState('Terminal');
  const [installedEditors, setInstalledEditors] = useState([]);
  const [editorDropdownOpen, setEditorDropdownOpen] = useState(false);
  const [localGitInfo, setLocalGitInfo] = useState(gitInfo || {});

  const { logs, clearLogs, run, killCmd, runningCmd } = useProcess(project.id);
  const status = project.status || 'stopped';
  const detectedPorts = useProjectPorts(project.id, status === 'running');

  // Keep local git info in sync with prop updates
  useEffect(() => {
    setLocalGitInfo(gitInfo || {});
  }, [gitInfo]);

  useEffect(() => {
    getInstalledEditors().then(setInstalledEditors);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!editorDropdownOpen) return;
    const handler = () => setEditorDropdownOpen(false);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editorDropdownOpen]);

  // Track whether errors are being viewed — fires when this panel becomes active/inactive
  // or when the user switches tabs within it
  useEffect(() => {
    if (isActive && activeTab === 'Logs') {
      onLogsViewed?.(project.id);
    } else {
      onLogsHidden?.(project.id);
    }
  }, [isActive, activeTab, project.id]);

  function handleTabChange(tab) {
    setActiveTab(tab);
  }

  // Refresh git info after a branch checkout
  const handleBranchChange = useCallback(async () => {
    try {
      const info = await getGitInfo(project.path);
      setLocalGitInfo(info);
    } catch {
      // non-fatal
    }
  }, [project.path]);

  const git = localGitInfo;

  return (
    <div className="flex flex-col h-full bg-[#0d1626]">

      {/* ── Header (titlebar area) ─────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4 border-b border-slate-700/60"
        style={{ height: 52, minHeight: 52, WebkitAppRegion: 'drag' }}
      >
        {/* Name + path */}
        <div className="flex-1 min-w-0 select-none">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLORS[status]} ${status === 'running' ? 'animate-pulse' : ''}`}
            />
            <span className="font-semibold text-slate-100 text-sm truncate">{project.name}</span>
            <span className={`text-xs font-medium flex-shrink-0 ${STATUS_TEXT[status]}`}>
              {STATUS_LABELS[status]}
            </span>
          </div>
          <p className="text-xs text-slate-500 font-mono truncate mt-0.5 pl-4">{project.path}</p>
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          style={{ WebkitAppRegion: 'no-drag' }}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-700 transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* ── Git info ──────────────────────────────────────────── */}
      <div className="px-4 py-2.5 border-b border-slate-700/60 flex items-center gap-4 text-xs">
        {/* Branch switcher (or plain text if not a repo) */}
        {git.isRepo !== false && git.branch ? (
          <BranchSwitcher
            projectPath={project.path}
            currentBranch={git.branch}
            onBranchChange={handleBranchChange}
          />
        ) : (
          <div className="flex items-center gap-1.5 text-slate-400">
            <svg className="w-3 h-3 text-slate-500" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
            </svg>
            <span className="font-mono text-slate-500">—</span>
          </div>
        )}

        {git.lastCommit && (
          <div className="flex items-center gap-1.5 min-w-0 text-slate-500">
            <span className="font-mono text-violet-400 flex-shrink-0">{git.lastCommit.hash}</span>
            <span className="truncate">{git.lastCommit.message}</span>
          </div>
        )}

      </div>

      {/* ── Controls ─────────────────────────────────────────── */}
      <div className="px-4 py-2.5 border-b border-slate-700/60 flex flex-wrap items-center gap-2">
        {/* Editor open button / dropdown */}
        {installedEditors.length === 1 && (
          <button
            onClick={() => openInEditor(installedEditors[0].id, project.path)}
            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg transition-all border bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border-slate-700"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            {installedEditors[0].name}
          </button>
        )}
        {installedEditors.length > 1 && (
          <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
            <button
              onClick={() => setEditorDropdownOpen((o) => !o)}
              className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg transition-all border bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border-slate-700"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              Open in...
              <svg className="w-3 h-3 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {editorDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-[#161b22] border border-slate-700/60 rounded-lg shadow-xl overflow-hidden" style={{ minWidth: 140 }}>
                {installedEditors.map((editor) => (
                  <button
                    key={editor.id}
                    onClick={() => { openInEditor(editor.id, project.path); setEditorDropdownOpen(false); }}
                    className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700/60 hover:text-slate-100 transition-colors"
                  >
                    {editor.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* External terminal launcher */}
        <TerminalMenu projectPath={project.path} />

        {/* Auto-detected localhost URLs */}
        {detectedPorts.map((port) => (
          <button
            key={port}
            onClick={() => window.electronAPI?.shell?.openExternal(`http://localhost:${port}`)}
            title={`Open http://localhost:${port}`}
            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg transition-colors border bg-sky-900/20 hover:bg-sky-900/40 text-sky-300 border-sky-700/30 hover:border-sky-500/50"
          >
            <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" />
            </svg>
            :{port}
          </button>
        ))}
      </div>

      {/* ── Tabs ─────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-slate-700/60 px-4 flex-shrink-0">
        {['Logs', 'Terminal', 'Git', 'Env', 'Docker'].map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            className={`relative px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {tab}
            {tab === 'Logs' && logs.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-slate-700 rounded text-slate-400 text-[10px]">
                {logs.length > 999 ? '999+' : logs.length}
              </span>
            )}
            {tab === 'Logs' && errorCount > 0 && activeTab !== 'Logs' && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-red-600/80 rounded text-white text-[10px] font-semibold">
                {errorCount > 99 ? '99+' : errorCount}
              </span>
            )}
          </button>
        ))}
        {activeTab === 'Logs' && logs.length > 0 && (
          <button
            onClick={clearLogs}
            className="ml-auto text-xs text-slate-600 hover:text-slate-400 transition-colors py-2"
          >
            Clear
          </button>
        )}
        {/* Remove project */}
        <button
          onClick={() => onRemove(project.id)}
          className={`${activeTab === 'Logs' && logs.length > 0 ? 'ml-3' : 'ml-auto'} text-xs text-slate-700 hover:text-red-400 transition-colors py-2`}
        >
          Remove
        </button>
      </div>

      {/* ── Tab content ──────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">

        {/* Logs */}
        <div className={`h-full ${activeTab === 'Logs' ? 'flex flex-col' : 'hidden'}`}>
          <LogOutput
            logs={logs}
            projectStatus={status}
            onCommand={(cmd) => run(cmd)}
            runningCmd={runningCmd}
            onKill={killCmd}
          />
        </div>

        {/* Terminal — embedded xterm */}
        <div
          className={`h-full overflow-hidden ${activeTab === 'Terminal' ? 'block' : 'hidden'}`}
          style={{ minHeight: 0 }}
        >
          <Terminal
            projectId={project.id}
            project={project}
            type="terminal"
            active={activeTab === 'Terminal'}
          />
        </div>

        {/* Git History tab */}
        <div className={`h-full ${activeTab === 'Git' ? 'flex flex-col' : 'hidden'}`}>
          <GitHistoryTab
            project={project}
            active={activeTab === 'Git'}
          />
        </div>

        {/* Env tab */}
        <div className={`h-full ${activeTab === 'Env' ? 'flex flex-col' : 'hidden'}`}>
          <EnvViewer projectId={project.id} onClose={() => handleTabChange('Logs')} />
        </div>

        {/* Docker tab */}
        <div className={`h-full ${activeTab === 'Docker' ? 'flex flex-col' : 'hidden'}`}>
          <DockerPanel project={project} />
        </div>
      </div>
    </div>
  );
}
