import React, { useState, useEffect, useRef, useCallback } from 'react';
import LogOutput from './LogOutput';
import Terminal from './Terminal';
import { useProcess } from '../hooks/useProcess';
import {
  startProcess,
  stopProcess,
  restartProcess,
  getInstalledEditors,
  openInEditor,
  checkClaude,
  openClaudeExternal,
} from '../ipc';

const EDITOR_LABELS = {
  vscode: { label: 'VS Code', icon: '⎇' },
  cursor: { label: 'Cursor', icon: '✦' },
  zed: { label: 'Zed', icon: '⚡' },
  webstorm: { label: 'WebStorm', icon: '⊕' },
};

const TABS = ['Logs', 'Terminal', 'Claude'];

export default function DetailPanel({ project, gitInfo, onClose, onRemove }) {
  const [activeTab, setActiveTab] = useState('Logs');
  const [installedEditors, setInstalledEditors] = useState([]);
  const [claudeAvailable, setClaudeAvailable] = useState(false);
  const [claudeTooltip, setClaudeTooltip] = useState(false);
  const terminalReadyRef = useRef({});

  const { logs, clearLogs, run } = useProcess(project.id);

  useEffect(() => {
    getInstalledEditors().then(setInstalledEditors);
    checkClaude().then(setClaudeAvailable);
  }, []);

  const status = project.status || 'stopped';
  const git = gitInfo || {};

  // When Claude tab activates, run claude if available
  const handleTerminalReady = useCallback((type, { sendInput }) => {
    terminalReadyRef.current[type] = sendInput;
    if (type === 'claude' && claudeAvailable) {
      setTimeout(() => sendInput('claude\n'), 400);
    }
  }, [claudeAvailable]);

  function handleTabChange(tab) {
    setActiveTab(tab);
    if (tab === 'Claude' && terminalReadyRef.current['claude'] && claudeAvailable) {
      // Only auto-run once; if terminal is already init, do nothing extra
    }
  }

  async function handleStart() { await startProcess(project.id); }
  async function handleStop() { await stopProcess(project.id); }
  async function handleRestart() { await restartProcess(project.id); }

  function handleOpenEditor(editor) {
    openInEditor(editor, project.path);
  }

  function handleOpenClaude() {
    if (!claudeAvailable) {
      setClaudeTooltip(true);
      setTimeout(() => setClaudeTooltip(false), 3000);
      return;
    }
    setActiveTab('Claude');
  }

  function handleOpenClaudeExternal() {
    openClaudeExternal(project.path);
  }

  const tabKey = (tab) => tab.toLowerCase();

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-700/50">
      {/* Header — titlebar area */}
      <div className="titlebar-spacer flex items-end px-5 pb-3 border-b border-slate-700/50">
        <div className="flex items-center justify-between w-full">
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-slate-100 text-sm truncate">{project.name}</h2>
            <p className="text-xs text-slate-500 font-mono truncate mt-0.5">{project.path}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-3 w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700 transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Git info + actions */}
      <div className="px-5 py-3 border-b border-slate-700/50 space-y-3">
        {/* Git row */}
        <div className="flex items-start gap-4 text-xs">
          <div className="min-w-0">
            <span className="text-slate-500">Branch</span>
            <div className="text-slate-200 font-mono mt-0.5">{git.branch || '—'}</div>
          </div>
          {git.lastCommit && (
            <div className="min-w-0 flex-1">
              <span className="text-slate-500">Last commit</span>
              <div className="text-slate-300 mt-0.5 truncate" title={git.lastCommit.message}>
                <span className="text-violet-400 font-mono">{git.lastCommit.hash}</span>{' '}
                {git.lastCommit.message}
              </div>
            </div>
          )}
        </div>

        {/* Process controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {status !== 'running' ? (
            <button
              onClick={handleStart}
              className="px-3 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 text-xs font-medium rounded-lg border border-emerald-600/30 transition-colors"
            >
              Start
            </button>
          ) : (
            <button
              onClick={handleStop}
              className="px-3 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs font-medium rounded-lg border border-red-600/30 transition-colors"
            >
              Stop
            </button>
          )}
          <button
            onClick={handleRestart}
            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium rounded-lg transition-colors"
          >
            Restart
          </button>

          {/* Editor buttons */}
          {installedEditors.map((editor) => (
            <button
              key={editor}
              onClick={() => handleOpenEditor(editor)}
              className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors"
            >
              {EDITOR_LABELS[editor]?.label || editor}
            </button>
          ))}

          {/* Claude Code button */}
          <div className="relative ml-auto flex items-center gap-1.5">
            <button
              onClick={handleOpenClaude}
              className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${
                claudeAvailable
                  ? 'bg-violet-600/20 hover:bg-violet-600/40 text-violet-400 border-violet-600/30'
                  : 'bg-slate-700/50 text-slate-500 border-slate-600/30 cursor-default'
              }`}
            >
              Claude Code
            </button>
            <button
              onClick={handleOpenClaudeExternal}
              title="Open Claude in external terminal"
              className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-400 text-xs rounded-lg transition-colors"
            >
              ↗
            </button>
            {claudeTooltip && (
              <div className="absolute right-0 top-8 z-50 bg-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap border border-slate-600">
                Claude Code not installed — run:<br />
                <span className="font-mono text-violet-400">npm install -g @anthropic-ai/claude-code</span>
              </div>
            )}
          </div>
        </div>

        {/* Remove project */}
        <div className="flex justify-end">
          <button
            onClick={() => onRemove(project.id)}
            className="text-xs text-slate-600 hover:text-red-400 transition-colors"
          >
            Remove project
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-700/50 px-5">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {tab}
          </button>
        ))}
        {activeTab === 'Logs' && (
          <button
            onClick={clearLogs}
            className="ml-auto self-center text-xs text-slate-600 hover:text-slate-400 transition-colors py-2"
          >
            Clear
          </button>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {/* Logs tab */}
        <div className={`h-full ${activeTab === 'Logs' ? 'flex flex-col' : 'hidden'}`}>
          <LogOutput
            logs={logs}
            onCommand={(cmd) => run(cmd)}
          />
        </div>

        {/* Terminal tab */}
        <div className={`h-full ${activeTab === 'Terminal' ? 'block' : 'hidden'}`}>
          <Terminal
            projectId={project.id}
            type="terminal"
            active={activeTab === 'Terminal'}
            onReady={(api) => handleTerminalReady('terminal', api)}
          />
        </div>

        {/* Claude tab */}
        <div className={`h-full ${activeTab === 'Claude' ? 'block' : 'hidden'}`}>
          {!claudeAvailable && activeTab === 'Claude' && (
            <div className="p-5 text-xs text-slate-400 space-y-2">
              <p className="text-slate-300 font-medium">Claude Code is not installed.</p>
              <p>Install it by running:</p>
              <code className="block bg-slate-800 rounded-lg px-3 py-2 font-mono text-violet-400">
                npm install -g @anthropic-ai/claude-code
              </code>
              <p className="text-slate-500 mt-2">Then restart Dev Dashboard.</p>
            </div>
          )}
          <Terminal
            projectId={project.id}
            type="claude"
            active={activeTab === 'Claude'}
            onReady={(api) => handleTerminalReady('claude', api)}
          />
        </div>
      </div>
    </div>
  );
}
