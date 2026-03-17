import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  checkDockerAvailable,
  getDockerContainers,
  dockerHasCompose,
  dockerStart,
  dockerStop,
  dockerRestart,
  getContainerLogs,
  onDockerUpdate,
} from '../ipc';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function matchesProject(container, projectPath) {
  const folderName = projectPath.split('/').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!folderName) return false;
  const name = container.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const labels = container.labels || '';
  const m = labels.match(/com\.docker\.compose\.project=([^,\n]+)/);
  const cp = m ? m[1].toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return name.includes(folderName) || cp === folderName || (cp && cp.includes(folderName));
}

function formatPorts(ports) {
  if (!ports) return '';
  return ports
    .split(',')
    .map((p) => p.trim().replace(/^(0\.0\.0\.0|::):/, ''))
    .filter(Boolean)
    .slice(0, 3)
    .join('  ');
}

const STATE_DOT = {
  running: 'bg-emerald-500',
  restarting: 'bg-yellow-400 animate-pulse',
  paused: 'bg-yellow-600',
  created: 'bg-slate-500',
  exited: 'bg-slate-600',
  unknown: 'bg-slate-700',
};

const STATE_LABEL = {
  running: 'text-emerald-400',
  restarting: 'text-yellow-400',
  paused: 'text-yellow-500',
  created: 'text-slate-400',
  exited: 'text-slate-500',
  unknown: 'text-slate-600',
};

// ─── ContainerRow ─────────────────────────────────────────────────────────────

function ContainerRow({ container, onAction, onViewLogs }) {
  const { id, name, image, state, status, ports } = container;
  const isRunning = state === 'running';
  const isRestarting = state === 'restarting';
  const isPending = onAction.pending.has(id);
  const formattedPorts = formatPorts(ports);

  async function act(fn) {
    onAction.mark(id);
    try { await fn(id); } catch {}
    onAction.unmark(id);
  }

  return (
    <div className="group px-3 py-2.5 border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors">
      {/* Row 1: status dot + name + state label + action buttons */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${STATE_DOT[state] || STATE_DOT.unknown}`}
        />
        <span className="flex-1 min-w-0 text-xs font-mono text-slate-200 truncate" title={name}>
          {name}
        </span>
        <span className={`flex-shrink-0 text-[10px] font-medium ${STATE_LABEL[state] || STATE_LABEL.unknown}`}>
          {state}
        </span>
      </div>

      {/* Row 2: image + ports */}
      <div className="flex items-center gap-2 mt-0.5 pl-3.5 min-w-0">
        <span className="text-[10px] text-slate-600 font-mono truncate flex-shrink-0" style={{ maxWidth: 180 }}>
          {image}
        </span>
        {formattedPorts && (
          <>
            <span className="text-[10px] text-slate-700">·</span>
            <span className="text-[10px] text-slate-600 font-mono truncate">{formattedPorts}</span>
          </>
        )}
      </div>

      {/* Row 3: buttons */}
      <div className="flex items-center gap-1 mt-2 pl-3.5">
        {isPending ? (
          <span className="flex items-center gap-1 text-[10px] text-slate-600">
            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            working…
          </span>
        ) : (
          <>
            {!isRunning && !isRestarting && (
              <button
                onClick={() => act(dockerStart)}
                className="px-2 py-0.5 text-[10px] bg-emerald-600/15 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-600/25 rounded transition-colors"
              >
                ▶ Start
              </button>
            )}
            {(isRunning || isRestarting) && (
              <button
                onClick={() => act(dockerStop)}
                className="px-2 py-0.5 text-[10px] bg-red-600/15 hover:bg-red-600/30 text-red-400 border border-red-600/25 rounded transition-colors"
              >
                ■ Stop
              </button>
            )}
            <button
              onClick={() => act(dockerRestart)}
              className="px-2 py-0.5 text-[10px] bg-slate-700/60 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 rounded transition-colors"
            >
              ↺ Restart
            </button>
            <button
              onClick={() => onViewLogs(id, name)}
              className="px-2 py-0.5 text-[10px] bg-slate-700/60 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 rounded transition-colors"
            >
              Logs
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── LogsView ─────────────────────────────────────────────────────────────────

function LogsView({ containerId, containerName, onBack }) {
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getContainerLogs(containerId);
      setLogs(result || '(no output)');
    } catch {
      setLogs('Failed to fetch logs.');
    } finally {
      setLoading(false);
    }
  }, [containerId]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!loading) bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [logs, loading]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/60 flex-shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back
        </button>
        <span className="text-[10px] text-slate-500">·</span>
        <span className="text-xs font-mono text-slate-400 truncate flex-1">{containerName}</span>
        <button
          onClick={fetchLogs}
          title="Refresh logs"
          className="flex-shrink-0 text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
        >
          ↺ Refresh
        </button>
      </div>

      {/* Log content */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="text-xs text-slate-600 text-center py-4">Loading…</div>
        ) : (
          <pre className="text-[10px] font-mono text-slate-400 whitespace-pre-wrap break-all leading-relaxed">
            {logs}
          </pre>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ─── DockerPanel ──────────────────────────────────────────────────────────────

export default function DockerPanel({ project }) {
  const [available, setAvailable] = useState(null); // null=checking
  const [containers, setContainers] = useState([]);
  const [hasCompose, setHasCompose] = useState(false);
  const [loading, setLoading] = useState(true);
  const [logsFor, setLogsFor] = useState(null); // { id, name }
  const [pending, setPending] = useState(new Set());

  const markPending = useCallback((id) => {
    setPending((prev) => new Set([...prev, id]));
  }, []);

  const unmarkPending = useCallback((id) => {
    setPending((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const action = { pending, mark: markPending, unmark: unmarkPending };

  // Initial availability check + container load
  useEffect(() => {
    setAvailable(null);
    setLoading(true);
    setLogsFor(null);

    checkDockerAvailable().then(async (avail) => {
      setAvailable(avail);
      if (!avail) { setLoading(false); return; }
      const [ctrs, compose] = await Promise.all([
        getDockerContainers().catch(() => []),
        dockerHasCompose(project.path).catch(() => false),
      ]);
      setContainers(ctrs.filter((c) => matchesProject(c, project.path)));
      setHasCompose(compose);
      setLoading(false);
    });
  }, [project.id, project.path]);

  // Live updates from polling
  useEffect(() => {
    const unsub = onDockerUpdate(({ containers: all }) => {
      setContainers(all.filter((c) => matchesProject(c, project.path)));
    });
    return unsub;
  }, [project.path]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (logsFor) {
    return (
      <LogsView
        containerId={logsFor.id}
        containerName={logsFor.name}
        onBack={() => setLogsFor(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/60 flex-shrink-0">
        {/* Docker icon */}
        <svg className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.186.186 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.185.186v1.887c0 .102.082.185.184.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288z"/>
        </svg>
        <span className="text-xs font-medium text-slate-400 flex-1">Docker</span>
        {hasCompose && available && (
          <span className="text-[10px] px-1.5 py-0.5 bg-blue-600/15 text-blue-400 border border-blue-600/20 rounded font-medium">
            Compose
          </span>
        )}
        {available && !loading && (
          <span className="text-[10px] text-slate-600">
            {containers.length} container{containers.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {available === null || loading ? (
          <div className="flex items-center justify-center p-6 text-xs text-slate-600">
            <svg className="w-3.5 h-3.5 animate-spin mr-2" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {available === null ? 'Checking Docker…' : 'Loading containers…'}
          </div>
        ) : !available ? (
          <div className="flex flex-col items-center justify-center p-6 gap-2 text-center">
            <svg className="w-8 h-8 text-slate-700" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.186.186 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.185.186v1.887c0 .102.082.185.184.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288z"/>
            </svg>
            <p className="text-xs text-slate-600">Docker not available</p>
            <p className="text-[10px] text-slate-700">Make sure Docker Desktop is running</p>
          </div>
        ) : containers.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 gap-1 text-center">
            <p className="text-xs text-slate-600">No containers found</p>
            <p className="text-[10px] text-slate-700">
              {hasCompose
                ? 'Run docker compose up to start containers'
                : 'No containers matched this project'}
            </p>
          </div>
        ) : (
          <div>
            {containers.map((c) => (
              <ContainerRow
                key={c.id}
                container={c}
                onAction={action}
                onViewLogs={(id, name) => setLogsFor({ id, name })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
