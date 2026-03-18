import React, { useState, useEffect, useRef, useCallback } from 'react';
import CommitList from './CommitList';
import DiffViewer from './DiffViewer';
import GitStagingPanel from './GitStagingPanel';
import { gitGetFiles, gitGetDiff, gitGetChanges, gitDiscardFile, createBranch, getGitInfo } from '../../ipc';

const MIN_LEFT = 160;
const MAX_LEFT = 400;
const DEFAULT_LEFT = 260;

export default function GitHistoryTab({ project, active }) {
  const [tab, setTab] = useState('Changes');
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [currentBranch, setCurrentBranch] = useState(null);

  useEffect(() => {
    getGitInfo(project.path).then((info) => setCurrentBranch(info?.branch || null)).catch(() => {});
  }, [project.path]);
  const [selectedCommit, setSelectedCommit] = useState(null);
  const [commitFiles, setCommitFiles] = useState([]);
  const [commitDiff, setCommitDiff] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [workingDiff, setWorkingDiff] = useState('');
  const [workingFiles, setWorkingFiles] = useState([]);
  const [workingLoading, setWorkingLoading] = useState(false);
  const debounceRef = useRef(null);
  const scrollToFileRef = useRef(null);

  // ── Resizable left panel ───────────────────────────────────────────────────
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onDragMouseDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = leftWidth;
  }, [leftWidth]);

  useEffect(() => {
    function onMouseMove(e) {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      setLeftWidth(Math.min(MAX_LEFT, Math.max(MIN_LEFT, startWidth.current + delta)));
    }
    function onMouseUp() {
      dragging.current = false;
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // ── Commit diff loading ────────────────────────────────────────────────────

  const loadCommitDiff = useCallback(async (commit) => {
    if (!commit) { setCommitDiff(''); setCommitFiles([]); return; }
    setDiffLoading(true);
    try {
      const [files, diff] = await Promise.all([
        gitGetFiles(project.id, commit.hash),
        gitGetDiff(project.id, commit.hash),
      ]);
      setCommitFiles(files || []);
      setCommitDiff(diff || '');
    } catch {}
    setDiffLoading(false);
  }, [project.id]);

  const handleSelectCommit = useCallback((commit) => {
    setSelectedCommit(commit);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadCommitDiff(commit), 100);
  }, [loadCommitDiff]);

  // ── Working tree diff ──────────────────────────────────────────────────────

  const refreshWorkingDiff = useCallback(async () => {
    try {
      const result = await gitGetChanges(project.id);
      if (!result.isRepo) return;
      const combined = [result.staged, result.unstaged].filter(Boolean).join('\n');
      setWorkingDiff(combined);
      const files = [];
      const seen = new Set();
      let lastFile = null;
      for (const line of combined.split('\n')) {
        if (line.startsWith('diff --git ')) {
          const m = line.match(/^diff --git a\/(.*) b\/(.*)$/);
          const path = m ? m[2] : line;
          if (!seen.has(path)) {
            seen.add(path);
            lastFile = { type: 'M', path, added: 0, deleted: 0 };
            files.push(lastFile);
          } else {
            lastFile = null; // already counted — skip duplicate diff block
          }
        } else if (lastFile) {
          if (line.startsWith('+') && !line.startsWith('+++')) lastFile.added++;
          else if (line.startsWith('-') && !line.startsWith('---')) lastFile.deleted++;
        }
      }
      setWorkingFiles(files);
    } catch {}
  }, [project.id]);

  useEffect(() => {
    if (!active || tab !== 'Changes') return;
    setWorkingLoading(true);
    refreshWorkingDiff().finally(() => setWorkingLoading(false));
    const t = setInterval(refreshWorkingDiff, 4000);
    return () => clearInterval(t);
  }, [tab, project.id, active, refreshWorkingDiff]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const showChanges = tab === 'Changes';

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div
        className="flex flex-col border-r border-slate-700/50 flex-shrink-0 overflow-hidden"
        style={{ width: leftWidth, minWidth: MIN_LEFT, background: '#080f1a' }}
      >
        {/* Sub-tabs */}
        <div className="flex items-center flex-shrink-0 border-b border-slate-700/50">
          {['Changes', 'History'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                tab === t
                  ? 'text-violet-400 border-violet-500'
                  : 'text-slate-500 hover:text-slate-300 border-transparent'
              }`}
            >
              {t}
            </button>
          ))}
          {/* New branch button */}
          <button
            onClick={() => setShowNewBranch(true)}
            title="Create new branch"
            className="flex-shrink-0 px-2 py-2 text-slate-600 hover:text-violet-400 transition-colors border-b-2 border-transparent -mb-px"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        {tab === 'History' ? (
          <CommitList
            projectId={project.id}
            selectedHash={selectedCommit?.hash}
            onSelect={handleSelectCommit}
            active={active && tab === 'History'}
          />
        ) : (
          <GitStagingPanel
            projectId={project.id}
            projectPath={project.path}
            active={active && tab === 'Changes'}
            fileDiffStats={workingFiles}
            onDiffSelect={(path) => scrollToFileRef.current?.(path)}
          />
        )}
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={onDragMouseDown}
        className="w-1 flex-shrink-0 cursor-col-resize group relative flex items-center justify-center transition-colors hover:bg-violet-500/30"
        style={{ background: '#1e2a3a' }}
      >
        {/* Hit area */}
        <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        {/* Dots indicator */}
        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {[0,1,2].map(i => (
            <div key={i} className="w-1 h-1 rounded-full bg-violet-400" />
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 min-w-0 overflow-hidden flex flex-col" style={{ background: '#0d1117' }}>
        <DiffViewer
          commit={
            showChanges
              ? (workingDiff ? { hash: '', message: 'Working Tree', author: '', dateRel: '' } : null)
              : selectedCommit
          }
          files={showChanges ? workingFiles : commitFiles}
          diff={showChanges ? workingDiff : commitDiff}
          loading={showChanges ? workingLoading : diffLoading}
          isChanges={showChanges}
          onReady={(fn) => { scrollToFileRef.current = fn; }}
          onDiscardFile={showChanges ? async (filePath) => {
            await gitDiscardFile(project.id, filePath);
            await refreshWorkingDiff();
          } : undefined}
        />
      </div>

      {/* New Branch Modal */}
      {showNewBranch && (
        <NewBranchModal
          projectPath={project.path}
          currentBranch={currentBranch}
          onClose={() => setShowNewBranch(false)}
          onCreated={(branch) => {
            setCurrentBranch(branch);
            setShowNewBranch(false);
          }}
        />
      )}
    </div>
  );
}

function NewBranchModal({ projectPath, currentBranch, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [setUpstream, setSetUpstream] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleCreate() {
    const branchName = name.trim();
    if (!branchName || creating) return;
    setCreating(true);
    setError('');
    const result = await createBranch(projectPath, branchName, setUpstream);
    setCreating(false);
    if (result.success) {
      onCreated(branchName);
    } else {
      setError((result.error || 'Failed to create branch').trim());
    }
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#0d1626] border border-slate-700/60 rounded-xl shadow-2xl w-80 p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-100">New Branch</span>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-300 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Branch name */}
        <div className="space-y-1.5">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Branch name</label>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            placeholder="feature/my-branch"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700/60 rounded-lg text-xs font-mono text-slate-200 placeholder-slate-600 outline-none focus:border-violet-500/60 transition-colors"
          />
          {currentBranch && (
            <p className="text-[10px] text-slate-600">
              From: <span className="text-slate-400 font-mono">{currentBranch}</span>
            </p>
          )}
        </div>

        {/* Upstream toggle */}
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div
            onClick={() => setSetUpstream((v) => !v)}
            className={`w-9 h-5 rounded-full transition-colors flex-shrink-0 relative ${setUpstream ? 'bg-violet-600' : 'bg-slate-700'}`}
          >
            <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-transform ${setUpstream ? 'translate-x-5' : 'translate-x-1'}`} />
          </div>
          <div>
            <div className="text-xs text-slate-300">Push &amp; set upstream</div>
            <div className="text-[10px] text-slate-600 font-mono mt-0.5">
              git push -u origin {name || 'branch-name'}
            </div>
          </div>
        </label>

        {error && (
          <div className="text-[11px] text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2 font-mono break-all">
            {error}
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={!name.trim() || creating}
          className="w-full py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {creating ? (
            <>
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Creating…
            </>
          ) : 'Create Branch'}
        </button>
      </div>
    </div>
  );
}
