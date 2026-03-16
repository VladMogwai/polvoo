import React, { useState, useEffect, useCallback } from 'react';
import {
  gitGetStagingStatus,
  gitStageFile, gitUnstageFile,
  gitStageAll, gitUnstageAll,
  gitCommit, gitPush, gitPull,
} from '../../ipc';

const STATUS_LABEL = { M: 'M', A: 'A', D: 'D', R: 'R', C: 'C', '?': '?' };
const STATUS_COLOR = {
  M: 'text-amber-400',
  A: 'text-emerald-400',
  D: 'text-red-400',
  R: 'text-sky-400',
  C: 'text-sky-400',
  '?': 'text-slate-500',
};

function FileRow({ file, onStage, onUnstage, loading }) {
  const statusChar = file.isUntracked ? '?' : (file.isStaged ? file.x : file.y);
  const colorClass = STATUS_COLOR[statusChar] || 'text-slate-400';
  const isAdding = loading === 'stage-' + file.path;
  const isRemoving = loading === 'unstage-' + file.path;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800/40 group transition-colors">
      {/* Stage toggle */}
      <button
        onClick={() => file.isStaged ? onUnstage(file.path) : onStage(file.path)}
        disabled={isAdding || isRemoving}
        className={`w-4 h-4 flex-shrink-0 rounded flex items-center justify-center border transition-colors ${
          file.isStaged
            ? 'bg-violet-600 border-violet-600 hover:bg-violet-700'
            : 'bg-transparent border-slate-600 hover:border-violet-500'
        }`}
      >
        {(isAdding || isRemoving) ? (
          <svg className="w-2.5 h-2.5 text-violet-300 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        ) : file.isStaged ? (
          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : null}
      </button>

      {/* Status badge */}
      <span className={`text-[10px] font-bold w-3 flex-shrink-0 ${colorClass}`}>
        {STATUS_LABEL[statusChar] || statusChar}
      </span>

      {/* File path */}
      <span className="text-xs text-slate-300 truncate font-mono flex-1 min-w-0" title={file.path}>
        {file.path}
      </span>
    </div>
  );
}

export default function GitStagingPanel({ projectId, active = true, onDiffSelect }) {
  const [status, setStatus] = useState({ isRepo: true, files: [], branch: null });
  const [loading, setLoading] = useState(null); // tracks which file op is in progress
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const refresh = useCallback(async () => {
    try {
      const s = await gitGetStagingStatus(projectId);
      setStatus(s);
    } catch {}
  }, [projectId]);

  useEffect(() => {
    if (!active) return;
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh, active]);

  async function handleStage(filePath) {
    setLoading('stage-' + filePath);
    await gitStageFile(projectId, filePath);
    await refresh();
    setLoading(null);
  }

  async function handleUnstage(filePath) {
    setLoading('unstage-' + filePath);
    await gitUnstageFile(projectId, filePath);
    await refresh();
    setLoading(null);
  }

  async function handleStageAll() {
    setLoading('all');
    await gitStageAll(projectId);
    await refresh();
    setLoading(null);
  }

  async function handleUnstageAll() {
    setLoading('unstage-all');
    await gitUnstageAll(projectId);
    await refresh();
    setLoading(null);
  }

  async function handleCommit() {
    if (!summary.trim()) return;
    setCommitting(true);
    setError('');
    setSuccessMsg('');
    const result = await gitCommit(projectId, summary.trim(), description.trim());
    if (result.success) {
      setSummary('');
      setDescription('');
      setSuccessMsg('Committed successfully');
      setTimeout(() => setSuccessMsg(''), 3000);
    } else {
      setError(result.error || 'Commit failed');
    }
    await refresh();
    setCommitting(false);
  }

  async function handlePush() {
    setPushing(true);
    setError('');
    setSuccessMsg('');
    const result = await gitPush(projectId);
    if (result.success) {
      setSuccessMsg('Pushed successfully');
      setTimeout(() => setSuccessMsg(''), 3000);
    } else {
      setError(result.error || 'Push failed');
    }
    setPushing(false);
  }

  async function handlePull() {
    setPulling(true);
    setError('');
    setSuccessMsg('');
    const result = await gitPull(projectId);
    if (result.success) {
      setSuccessMsg(result.output || 'Already up to date');
      setTimeout(() => setSuccessMsg(''), 4000);
      await refresh();
    } else {
      setError(result.error || 'Pull failed');
    }
    setPulling(false);
  }

  const stagedFiles = status.files.filter((f) => f.isStaged);
  const unstagedFiles = status.files.filter((f) => !f.isStaged);
  const hasStagedFiles = stagedFiles.length > 0;
  const hasAnyFiles = status.files.length > 0;

  if (!status.isRepo) {
    return (
      <div className="flex items-center justify-center h-full text-slate-600 text-xs">
        Not a git repository
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header actions */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 flex-shrink-0">
        <span className="text-[10px] text-slate-600 uppercase tracking-wider font-medium flex-1">
          {status.files.length > 0
            ? `${status.files.length} changed file${status.files.length !== 1 ? 's' : ''}`
            : 'No changes'}
        </span>
        {hasAnyFiles && (
          <>
            <button
              onClick={handleStageAll}
              disabled={loading === 'all'}
              title="Stage all (git add -A)"
              className="px-2 py-0.5 text-[10px] rounded border border-violet-600/40 text-violet-400 hover:bg-violet-600/20 transition-colors disabled:opacity-40"
            >
              + Stage All
            </button>
            {hasStagedFiles && (
              <button
                onClick={handleUnstageAll}
                disabled={loading === 'unstage-all'}
                title="Unstage all"
                className="px-2 py-0.5 text-[10px] rounded border border-slate-600/60 text-slate-500 hover:bg-slate-700 transition-colors disabled:opacity-40"
              >
                − Unstage All
              </button>
            )}
          </>
        )}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {status.files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-8">
            <svg className="w-8 h-8 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-slate-600 text-xs">Working tree clean</p>
          </div>
        ) : (
          <>
            {/* Staged section */}
            {stagedFiles.length > 0 && (
              <>
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-slate-600 font-medium bg-slate-900/50 border-b border-slate-800/60">
                  Staged ({stagedFiles.length})
                </div>
                {stagedFiles.map((f) => (
                  <FileRow
                    key={f.path + '-staged'}
                    file={f}
                    onStage={handleStage}
                    onUnstage={handleUnstage}
                    loading={loading}
                  />
                ))}
              </>
            )}

            {/* Unstaged / untracked section */}
            {unstagedFiles.length > 0 && (
              <>
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-slate-600 font-medium bg-slate-900/50 border-b border-slate-800/60 border-t border-slate-800/40">
                  Unstaged ({unstagedFiles.length})
                </div>
                {unstagedFiles.map((f) => (
                  <FileRow
                    key={f.path + '-unstaged'}
                    file={f}
                    onStage={handleStage}
                    onUnstage={handleUnstage}
                    loading={loading}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Commit form */}
      <div className="flex-shrink-0 border-t border-slate-800 p-3 space-y-2">
        {error && (
          <div className="text-[11px] text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2 font-mono break-all">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="text-[11px] text-emerald-400 bg-emerald-900/20 border border-emerald-800/40 rounded-lg px-3 py-2">
            {successMsg}
          </div>
        )}

        <input
          value={summary}
          onChange={(e) => { setSummary(e.target.value); setError(''); }}
          placeholder="Summary (required)"
          className="w-full px-3 py-2 bg-slate-800/80 border border-slate-700/60 rounded-lg text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-violet-500/60 transition-colors"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          rows={3}
          className="w-full px-3 py-2 bg-slate-800/80 border border-slate-700/60 rounded-lg text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-violet-500/60 transition-colors resize-none"
        />

        <button
          onClick={handleCommit}
          disabled={!summary.trim() || !hasStagedFiles || committing}
          className="w-full py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-violet-600 hover:bg-violet-500 text-white"
        >
          {committing ? 'Committing…' : (
            <>Commit to <span className="font-bold">{status.branch || 'branch'}</span></>
          )}
        </button>

        <div className="flex gap-2">
          <button
            onClick={handlePull}
            disabled={pulling || pushing}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600"
          >
            {pulling ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Pulling…
              </span>
            ) : '↓ Pull'}
          </button>
          <button
            onClick={handlePush}
            disabled={pushing || pulling}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600"
          >
            {pushing ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Pushing…
              </span>
            ) : '↑ Push'}
          </button>
        </div>
      </div>
    </div>
  );
}
