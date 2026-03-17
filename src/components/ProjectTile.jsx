import React, { useState, useEffect, useRef } from 'react';
import { startProcess, stopProcess, runCommand, killCommand, onCommandStatus, getProjectScripts } from '../ipc';
import { useProjectPorts } from '../hooks/useProjectPorts';

const STATUS_RING = {
  running: 'border-emerald-500/40',
  stopped: 'border-slate-700',
  error: 'border-red-500/40',
};
const STATUS_DOT  = { running: 'bg-emerald-500', stopped: 'bg-slate-500', error: 'bg-red-500' };
const STATUS_TEXT = { running: 'text-emerald-400', stopped: 'text-slate-500', error: 'text-red-400' };
const STATUS_LABEL = { running: 'Running', stopped: 'Stopped', error: 'Error' };

// Scripts that are noisy / rarely useful as quick-launch buttons
const SKIP_SCRIPTS = new Set([
  'postinstall', 'preinstall', 'release', 'release:fast',
  'build:local', 'install:local', 'prepare', 'prepublish',
]);

// Priority order — scripts earlier in this list appear first
const PRIORITY_ORDER = [
  'dev', 'start', 'build', 'dev:frontend', 'dev:backend',
  'serve', 'preview', 'test', 'lint', 'format',
];

function sortScripts(names) {
  return [...names].sort((a, b) => {
    const ai = PRIORITY_ORDER.indexOf(a);
    const bi = PRIORITY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

export default function ProjectTile({ project, gitInfo, isSelected, onSelect, onStatusChange, onUpdateProject, onRemove }) {
  const status = project.status || 'stopped';
  const detectedPorts = useProjectPorts(project.id, status === 'running');
  const [scripts, setScripts] = useState(null);
  const [hidden, setHidden] = useState(() => new Set(project.hiddenScripts || []));
  const [runningScripts, setRunningScripts] = useState(new Set());
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [editingCmd, setEditingCmd] = useState(false);
  const [cmdValue, setCmdValue] = useState('');
  const addBtnRef = useRef(null);
  const addMenuRef = useRef(null);
  const [addMenuPos, setAddMenuPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    getProjectScripts(project.id).then(setScripts).catch(() => setScripts({}));
  }, [project.id]);

  useEffect(() => {
    setHidden(new Set(project.hiddenScripts || []));
  }, [project.hiddenScripts]);

  // Listen for command start/stop events from the backend
  useEffect(() => {
    const unsub = onCommandStatus(({ projectId, command, status }) => {
      if (projectId !== project.id) return;
      setRunningScripts((prev) => {
        const next = new Set(prev);
        if (status === 'running') next.add(command);
        else next.delete(command);
        return next;
      });
    });
    return unsub;
  }, [project.id]);

  // Close add-menu on outside click
  useEffect(() => {
    if (!addMenuOpen) return;
    function handler(e) {
      if (
        addMenuRef.current && !addMenuRef.current.contains(e.target) &&
        addBtnRef.current && !addBtnRef.current.contains(e.target)
      ) setAddMenuOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [addMenuOpen]);

  // Effective running state: main process OR a script command matching startCommand is running
  const startCmd = project.startCommand?.trim() || '';
  const effectivelyRunning = status === 'running' || runningScripts.has(startCmd);

  async function handleStart(e) {
    e.stopPropagation();
    onStatusChange(project.id, 'running');
    await startProcess(project.id);
  }

  async function handleStop(e) {
    e.stopPropagation();
    if (status === 'running') {
      onStatusChange(project.id, 'stopped');
      await stopProcess(project.id);
    } else {
      await killCommand(project.id, startCmd);
    }
  }

  async function handleRunScript(e, scriptName) {
    e.stopPropagation();
    onSelect(project);
    const cmd = `npm run ${scriptName}`;
    if (startCmd && startCmd === cmd) {
      onStatusChange(project.id, 'running');
      await startProcess(project.id);
    } else {
      await runCommand(project.id, cmd);
    }
  }

  async function handleKillScript(e, scriptName) {
    e.stopPropagation();
    const cmd = `npm run ${scriptName}`;
    if (status === 'running' && startCmd === cmd) {
      onStatusChange(project.id, 'stopped');
      await stopProcess(project.id);
    } else {
      await killCommand(project.id, cmd);
    }
  }

  async function hideScript(e, scriptName) {
    e.stopPropagation();
    const next = new Set(hidden);
    next.add(scriptName);
    setHidden(next);
    await onUpdateProject?.(project.id, { hiddenScripts: [...next] });
  }

  async function showScript(e, scriptName) {
    e.stopPropagation();
    const next = new Set(hidden);
    next.delete(scriptName);
    setHidden(next);
    await onUpdateProject?.(project.id, { hiddenScripts: [...next] });
    setAddMenuOpen(false);
  }

  function handleRemove(e) {
    e.stopPropagation();
    onRemove(project.id);
  }

  function isScriptRunning(scriptName) {
    const cmd = `npm run ${scriptName}`;
    return runningScripts.has(cmd) || (status === 'running' && project.startCommand?.trim() === cmd);
  }

  // Scripts visible after user-hide filter + skip filter, sorted by priority
  const visibleScripts = scripts
    ? sortScripts(Object.keys(scripts).filter((s) => !hidden.has(s)))
    : [];

  // Scripts the user has explicitly hidden (for the "+" restore menu)
  const hiddenScripts = scripts
    ? Object.keys(scripts).filter((s) => hidden.has(s))
    : [];

  const hasButtons = startCmd || visibleScripts.length > 0 || hiddenScripts.length > 0;

  return (
    <div
      onClick={() => onSelect(project)}
      style={{ WebkitAppRegion: 'no-drag', cursor: 'pointer' }}
      className={`
        flex flex-col gap-2 p-3.5 rounded-xl border select-none
        transition-all duration-150 group/tile
        ${isSelected
          ? 'bg-slate-700/70 border-violet-500/50 shadow-lg shadow-violet-900/20'
          : `bg-slate-800/80 ${STATUS_RING[status]} hover:border-slate-600 hover:bg-slate-700/50`}
      `}
    >
      {/* Name + status + remove */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={handleRemove}
            title="Remove from dashboard"
            className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-md text-slate-600 hover:text-white hover:bg-red-500 opacity-0 group-hover/tile:opacity-100 transition-all"
          >
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <h3 className="font-semibold text-slate-100 text-sm leading-tight truncate">{project.name}</h3>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]} ${status === 'running' ? 'animate-pulse' : ''}`} />
          <span className={`text-xs ${STATUS_TEXT[status]}`}>{STATUS_LABEL[status]}</span>
        </div>
      </div>

      {/* Path */}
      <p className="text-xs text-slate-600 font-mono truncate -mt-0.5">{project.path}</p>

      {/* Git branch */}
      <div className="flex items-center gap-2">
        {gitInfo?.branch ? (
          <div className="flex items-center gap-1.5 text-xs text-slate-400 min-w-0 overflow-hidden">
            <svg className="w-3 h-3 text-slate-500 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
            </svg>
            <span className="font-mono truncate">{gitInfo.branch}</span>
          </div>
        ) : (
          <div className="text-xs text-slate-700">no git</div>
        )}
      </div>

      {/* Separator */}
      {hasButtons && (
        <div className="border-t border-slate-700/50 -mx-0.5" />
      )}

      {/* Buttons area */}
      {hasButtons && (
        <div className="flex flex-col gap-1.5">
          {/* ── Start / Stop row (always its own line) ── */}
          {startCmd && (editingCmd ? (
            <form
              className="flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
              onSubmit={async (e) => {
                e.preventDefault();
                const v = cmdValue.trim();
                if (v) await onUpdateProject?.(project.id, { startCommand: v });
                setEditingCmd(false);
              }}
            >
              <input
                autoFocus
                value={cmdValue}
                onChange={(e) => setCmdValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setEditingCmd(false); }}
                onBlur={async () => {
                  const v = cmdValue.trim();
                  if (v) await onUpdateProject?.(project.id, { startCommand: v });
                  setEditingCmd(false);
                }}
                className="flex-1 min-w-0 px-2 py-1 bg-slate-700 border border-violet-500/60 rounded-lg text-xs font-mono text-slate-200 outline-none"
                placeholder="npm run dev"
              />
              <button type="submit" className="px-2 py-1 bg-violet-600/30 text-violet-300 text-xs rounded-lg border border-violet-600/40 flex-shrink-0">✓</button>
            </form>
          ) : (
            <div className="flex items-center gap-1 group/start">
              {!effectivelyRunning ? (
                <button
                  onClick={handleStart}
                  className="px-3 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 text-xs font-medium rounded-lg border border-emerald-600/30 transition-colors"
                  title={project.startCommand}
                >
                  ▶ Start
                </button>
              ) : (
                <button
                  onClick={handleStop}
                  className="px-3 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs font-medium rounded-lg border border-red-600/30 transition-colors"
                >
                  ■ Stop
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); setCmdValue(project.startCommand || ''); setEditingCmd(true); }}
                title={`Edit start command: ${project.startCommand}`}
                className="opacity-0 group-hover/start:opacity-100 px-1.5 py-1 text-slate-600 hover:text-slate-300 hover:bg-slate-700 text-xs rounded-lg transition-all"
              >
                ✎
              </button>
            </div>
          ))}

          {/* ── Script buttons row ── */}
          {(visibleScripts.length > 0 || hiddenScripts.length > 0) && (
            <>
              <div className="flex flex-wrap items-center gap-1">
                {visibleScripts.map((s) => (
                  <ScriptButton
                    key={s}
                    name={s}
                    command={`npm run ${s}`}
                    fullCommand={scripts?.[s]}
                    isRunning={isScriptRunning(s)}
                    onClick={(e) => handleRunScript(e, s)}
                    onStop={(e) => handleKillScript(e, s)}
                    onHide={(e) => hideScript(e, s)}
                  />
                ))}
              </div>

              {/* Restore user-hidden scripts */}
              {hiddenScripts.length > 0 && (
                <div className="flex items-center gap-1">
                  <div className="relative">
                    <button
                      ref={addBtnRef}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (addBtnRef.current) {
                          const r = addBtnRef.current.getBoundingClientRect();
                          setAddMenuPos({ top: r.bottom + 4, left: r.left });
                        }
                        setAddMenuOpen((v) => !v);
                      }}
                      title="Show hidden scripts"
                      className={`h-[22px] w-7 flex items-center justify-center rounded-md text-xs transition-colors border ${
                        addMenuOpen
                          ? 'bg-violet-600/30 border-violet-500/50 text-violet-300'
                          : 'bg-slate-700/60 border-slate-600/60 text-slate-400 hover:bg-slate-600 hover:text-slate-200'
                      }`}
                    >
                      +
                    </button>
                    {addMenuOpen && (
                      <div
                        ref={addMenuRef}
                        onClick={(e) => e.stopPropagation()}
                        style={{ position: 'fixed', top: addMenuPos.top, left: addMenuPos.left, zIndex: 9999, minWidth: 160 }}
                        className="bg-[#161b22] border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden"
                      >
                        <div className="px-3 py-1.5 text-[10px] font-medium text-slate-600 uppercase tracking-wider border-b border-slate-700/60">
                          Hidden scripts
                        </div>
                        {hiddenScripts.map((s) => (
                          <button
                            key={s}
                            onClick={(e) => showScript(e, s)}
                            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800/60 transition-colors text-left group"
                          >
                            <span className="flex-1 text-xs text-slate-400 group-hover:text-slate-200 font-mono">{s}</span>
                            <span className="text-[10px] text-slate-600 group-hover:text-violet-400">show</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Ports row — shown only when running and ports are detected */}
      {status === 'running' && detectedPorts.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
          <span className="text-[11px] text-slate-600 flex-shrink-0">Ports:</span>
          {detectedPorts.slice(0, 3).map((port) => (
            <button
              key={port}
              onClick={(e) => {
                e.stopPropagation();
                window.electronAPI?.shell?.openExternal(`http://localhost:${port}`);
              }}
              title={`Open http://localhost:${port}`}
              className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-700/50 hover:bg-sky-900/40 border border-slate-600/40 hover:border-sky-500/50 rounded text-[11px] font-mono text-slate-400 hover:text-sky-300 transition-colors"
            >
              <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" />
              </svg>
              :{port}
            </button>
          ))}
          {detectedPorts.length > 3 && (
            <span className="text-[10px] text-slate-600">+{detectedPorts.length - 3} more</span>
          )}
        </div>
      )}
    </div>
  );
}

function ScriptButton({ name, command, fullCommand, isRunning, onClick, onStop, onHide }) {
  const [tooltipVisible, setTooltipVisible] = useState(false);

  return (
    <div
      className="group relative flex items-center"
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
    >
      {isRunning ? (
        <button
          onClick={onStop}
          className="flex items-center gap-1 px-2 py-1 bg-orange-600/20 hover:bg-orange-600/40 text-orange-400 text-xs rounded-lg border border-orange-600/30 transition-colors"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse flex-shrink-0" />
          {name}
          <span className="text-[10px] text-orange-500 ml-0.5">■</span>
        </button>
      ) : (
        <>
          <button
            onClick={onClick}
            className="pl-2 pr-5 py-1 bg-slate-700/80 hover:bg-slate-600/80 text-slate-300 text-xs rounded-lg transition-colors border border-slate-600/40 hover:border-slate-500/60"
          >
            {name}
          </button>
          <button
            onClick={onHide}
            title="Hide this script"
            className="absolute right-0.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-red-400 text-[10px] leading-none w-4 h-4 flex items-center justify-center"
          >
            ×
          </button>
        </>
      )}

      {tooltipVisible && fullCommand && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none"
          style={{ width: 200 }}
        >
          <div className="bg-[#161b22] border border-slate-700/60 rounded-lg px-2.5 py-2 shadow-xl">
            <div className="text-[10px] font-medium text-slate-500 mb-0.5 uppercase tracking-wider">Script</div>
            <div className="text-[10px] font-mono text-slate-400 break-all line-clamp-3">
              {fullCommand.length > 80 ? fullCommand.slice(0, 80) + '…' : fullCommand}
            </div>
          </div>
          <div className="w-2 h-2 bg-[#161b22] border-b border-r border-slate-700/60 rotate-45 mx-auto -mt-1" />
        </div>
      )}
    </div>
  );
}
