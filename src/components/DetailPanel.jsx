import React, { useState, useEffect, useRef, useCallback } from 'react';
import LogOutput from './LogOutput';
import Terminal from './Terminal';
import BranchSwitcher from './BranchSwitcher';
import TerminalMenu from './TerminalMenu';
import { useProcess } from '../hooks/useProcess';
import {
  startProcess,
  stopProcess,
  restartProcess,
  getInstalledEditors,
  openInEditor,
  checkClaude,
  openClaudeExternal,
  getGitInfo,
} from '../ipc';

const EDITOR_LABELS = {
  vscode: 'VS Code',
  cursor: 'Cursor',
  zed: 'Zed',
  webstorm: 'WebStorm',
};

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

export default function DetailPanel({ project, gitInfo, onClose, onRemove }) {
  const [activeTab, setActiveTab] = useState('Logs');
  const [installedEditors, setInstalledEditors] = useState([]);
  const [claudeAvailable, setClaudeAvailable] = useState(false);
  const [claudeTooltip, setClaudeTooltip] = useState(false);
  const [localGitInfo, setLocalGitInfo] = useState(gitInfo || {});
  const claudeTermRef = useRef(null);

  const { logs, clearLogs, run } = useProcess(project.id);
  const status = project.status || 'stopped';

  // Keep local git info in sync with prop updates
  useEffect(() => {
    setLocalGitInfo(gitInfo || {});
  }, [gitInfo]);

  useEffect(() => {
    getInstalledEditors().then(setInstalledEditors);
    checkClaude().then(setClaudeAvailable);
  }, []);

  // Reset to Logs tab whenever project changes
  useEffect(() => {
    setActiveTab('Logs');
  }, [project.id]);

  const handleClaudeTabReady = useCallback(({ sendInput }) => {
    claudeTermRef.current = sendInput;
    if (claudeAvailable) {
      setTimeout(() => sendInput('claude\n'), 400);
    }
  }, [claudeAvailable]);

  function handleTabChange(tab) {
    setActiveTab(tab);
  }

  function handleOpenClaudeTab() {
    if (!claudeAvailable) {
      setClaudeTooltip(true);
      setTimeout(() => setClaudeTooltip(false), 3500);
      return;
    }
    setActiveTab('Claude');
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
        {/* Process controls */}
        {status !== 'running' ? (
          <button
            onClick={() => startProcess(project.id)}
            className="px-3 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 text-xs font-medium rounded-lg border border-emerald-600/30 transition-colors"
          >
            ▶ Start
          </button>
        ) : (
          <button
            onClick={() => stopProcess(project.id)}
            className="px-3 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs font-medium rounded-lg border border-red-600/30 transition-colors"
          >
            ■ Stop
          </button>
        )}
        <button
          onClick={() => restartProcess(project.id)}
          className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium rounded-lg transition-colors"
        >
          ↺ Restart
        </button>

        {/* Editor buttons */}
        {installedEditors.map((editor) => (
          <button
            key={editor}
            onClick={() => openInEditor(editor, project.path)}
            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors"
          >
            {EDITOR_LABELS[editor]}
          </button>
        ))}

        {/* External terminal launcher */}
        <TerminalMenu projectPath={project.path} />

        {/* Claude Code */}
        <div className="relative flex items-center gap-1 ml-auto">
          <button
            onClick={handleOpenClaudeTab}
            className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${
              claudeAvailable
                ? 'bg-violet-600/20 hover:bg-violet-600/40 text-violet-400 border-violet-600/30'
                : 'bg-slate-700/50 text-slate-500 border-slate-600/30'
            }`}
          >
            Claude Code
          </button>
          <button
            onClick={() => openClaudeExternal(project.path)}
            title="Open in external terminal"
            className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-400 text-xs rounded-lg transition-colors"
          >
            ↗
          </button>
          {claudeTooltip && (
            <div className="absolute right-0 top-9 z-50 bg-slate-700 border border-slate-600 text-slate-200 text-xs rounded-lg px-3 py-2.5 shadow-2xl whitespace-nowrap">
              Not installed — run:
              <br />
              <span className="font-mono text-violet-400">npm i -g @anthropic-ai/claude-code</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-slate-700/60 px-4 flex-shrink-0">
        {['Logs', 'Terminal', 'Claude'].map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            className={`px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
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
          <LogOutput logs={logs} onCommand={(cmd) => run(cmd)} />
        </div>

        {/* Terminal — embedded xterm */}
        <div
          className={`h-full overflow-hidden ${activeTab === 'Terminal' ? 'block' : 'hidden'}`}
          style={{ minHeight: 0 }}
        >
          <Terminal
            key={project.id + '-terminal'}
            projectId={project.id}
            type="terminal"
            active={activeTab === 'Terminal'}
          />
        </div>

        {/* Claude */}
        <div
          className={`h-full overflow-hidden ${activeTab === 'Claude' ? 'flex flex-col' : 'hidden'}`}
          style={{ minHeight: 0 }}
        >
          {!claudeAvailable && (
            <div className="p-5 text-xs text-slate-400 space-y-2 border-b border-slate-700/60 flex-shrink-0">
              <p className="text-slate-300 font-medium">Claude Code is not installed.</p>
              <code className="block bg-slate-800 rounded-lg px-3 py-2 font-mono text-violet-400">
                npm install -g @anthropic-ai/claude-code
              </code>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-hidden">
            <Terminal
              key={project.id + '-claude'}
              projectId={project.id}
              type="claude"
              active={activeTab === 'Claude'}
              onReady={handleClaudeTabReady}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
