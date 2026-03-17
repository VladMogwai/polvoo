import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getAllRunning, getProcessStats, stopProcess, killCommand, listPorts, killPort } from '../ipc';

function formatUptime(startedAt) {
  if (!startedAt) return '—';
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function StatBar({ value, max, color }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <div className="w-14 h-1.5 bg-slate-700 rounded-full overflow-hidden flex-shrink-0">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-mono text-slate-400 w-9 text-right flex-shrink-0">
        {value != null ? `${value.toFixed(1)}%` : '—'}
      </span>
    </div>
  );
}

// HTTP ports that are likely browser-accessible
function isHttpPort(port) {
  return port < 65535 && port > 1024;
}

export default function ProcessMonitor({ onClose }) {
  const [activeTab, setActiveTab] = useState('processes');
  const [processes, setProcesses] = useState([]);
  const [stats, setStats] = useState({});
  const [ports, setPorts] = useState([]);
  // killing: Set of pid/key being killed
  const [killing, setKilling] = useState(new Set());
  // confirmKill: key -> true (showing inline confirm)
  const [confirmKill, setConfirmKill] = useState({});
  const [search, setSearch] = useState('');
  const tickRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const [procs, portList] = await Promise.all([getAllRunning(), listPorts()]);
      setProcesses(procs);
      setPorts(portList || []);
      if (procs.length > 0) {
        const pids = procs.map((p) => p.pid).filter(Boolean);
        const s = await getProcessStats(pids);
        setStats(s);
      } else {
        setStats({});
      }
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    refresh();
    tickRef.current = setInterval(refresh, 2000);
    return () => clearInterval(tickRef.current);
  }, [refresh]);

  // ── Processes kill ──
  async function handleKill(proc) {
    const key = `proc-${proc.pid}`;
    setKilling((prev) => new Set(prev).add(key));
    setConfirmKill((prev) => { const n = { ...prev }; delete n[key]; return n; });
    try {
      if (proc.type === 'main') await stopProcess(proc.projectId);
      else await killCommand(proc.projectId, proc.command);
      await refresh();
    } finally {
      setKilling((prev) => { const n = new Set(prev); n.delete(key); return n; });
    }
  }

  // ── Port kill — kills all ports in the array (project siblings included) ──
  async function handleKillPorts(portEntry) {
    // confirmKill[key] = array of port numbers to kill together
    const key = `port-${portEntry.port}`;
    const portsToKill = confirmKill[key] || [portEntry.port];
    const killKeys = portsToKill.map((p) => `port-${p}`);
    setKilling((prev) => { const n = new Set(prev); killKeys.forEach((k) => n.add(k)); return n; });
    setConfirmKill((prev) => { const n = { ...prev }; delete n[key]; return n; });
    try {
      await Promise.all(portsToKill.map((p) => killPort(p)));
      await refresh();
    } finally {
      setKilling((prev) => { const n = new Set(prev); killKeys.forEach((k) => n.delete(k)); return n; });
    }
  }

  // Build the confirm entry: for project ports, collect all sibling ports
  function requestConfirm(portEntry) {
    const key = `port-${portEntry.port}`;
    let portsToKill = [portEntry.port];
    if (portEntry.projectName) {
      portsToKill = ports
        .filter((p) => p.projectName === portEntry.projectName)
        .map((p) => p.port)
        .sort((a, b) => a - b);
    }
    setConfirmKill((prev) => ({ ...prev, [key]: portsToKill }));
  }

  function cancelConfirm(key) {
    setConfirmKill((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  // ── Filtered ports ──
  const filteredPorts = ports.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return String(p.port).includes(q) || p.cmd.toLowerCase().includes(q);
  });

  const filteredProcs = processes.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (p.projectName || '').toLowerCase().includes(q) ||
           (p.command || '').toLowerCase().includes(q);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div
        className="bg-[#0d1626] border border-slate-700/60 rounded-xl shadow-2xl flex flex-col"
        style={{ width: 700, maxHeight: '82vh', minHeight: 320 }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-700/60 flex-shrink-0">
          <div className="w-5 h-5 rounded-md bg-violet-600/30 border border-violet-600/40 flex items-center justify-center flex-shrink-0">
            <svg className="w-3 h-3 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-slate-100">Process Monitor</span>
          {processes.length > 0 && (
            <span className="px-2 py-0.5 bg-emerald-500/20 border border-emerald-500/30 rounded-full text-[10px] text-emerald-400 font-medium">
              {processes.length} running
            </span>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 text-[10px] text-slate-600">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            live
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs + search */}
        <div className="flex items-center gap-1 px-5 border-b border-slate-800 flex-shrink-0">
          {[['processes', 'Processes', processes.length], ['ports', 'Ports', ports.length]].map(([id, label, count]) => (
            <button
              key={id}
              onClick={() => { setActiveTab(id); setSearch(''); setConfirmKill({}); }}
              className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                activeTab === id ? 'border-violet-500 text-violet-400' : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              {label}
              {count > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 bg-slate-700 rounded text-slate-400 text-[10px]">{count}</span>
              )}
            </button>
          ))}
          <div className="flex-1" />
          {/* Search */}
          <div className="relative flex items-center py-1.5">
            <svg className="absolute left-2 w-3 h-3 text-slate-600 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={activeTab === 'ports' ? 'Port or command…' : 'Project or command…'}
              className="pl-7 pr-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 placeholder-slate-600 outline-none focus:border-violet-500/60 w-44 transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 text-slate-600 hover:text-slate-400 text-xs">✕</button>
            )}
          </div>
        </div>

        {/* Column headers — Processes tab only */}
        {activeTab === 'processes' && filteredProcs.length > 0 && (
          <div className="flex items-center gap-3 px-5 py-2 border-b border-slate-800 flex-shrink-0">
            <div className="w-2 flex-shrink-0" />
            <div className="flex-1 min-w-0 text-[10px] text-slate-600 uppercase tracking-wider font-medium">Project / Command</div>
            <div className="w-10 text-[10px] text-slate-600 uppercase tracking-wider font-medium text-right">PID</div>
            <div className="w-28 text-[10px] text-slate-600 uppercase tracking-wider font-medium">CPU</div>
            <div className="w-28 text-[10px] text-slate-600 uppercase tracking-wider font-medium">MEM</div>
            <div className="w-16 text-[10px] text-slate-600 uppercase tracking-wider font-medium">Uptime</div>
            <div className="w-20" />
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── PORTS TAB ── */}
          {activeTab === 'ports' && (
            filteredPorts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 py-12 text-center">
                <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center">
                  <svg className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-slate-400 text-sm font-medium">
                    {search ? 'No ports match your search' : 'No listening ports found'}
                  </p>
                  <p className="text-slate-600 text-xs mt-0.5">
                    {search ? `No results for "${search}"` : 'No TCP services are currently accepting connections'}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 px-5 py-2 border-b border-slate-800">
                  <div className="w-24 text-[10px] text-slate-600 uppercase tracking-wider font-medium">Port</div>
                  <div className="flex-1 text-[10px] text-slate-600 uppercase tracking-wider font-medium">Process</div>
                  <div className="w-14 text-[10px] text-slate-600 uppercase tracking-wider font-medium text-right">PID</div>
                  <div className="w-32" />
                </div>
                {/* Project-pinned ports first, then others */}
                {[...filteredPorts].sort((a, b) => {
                  const aHasProject = !!a.projectName;
                  const bHasProject = !!b.projectName;
                  if (aHasProject && !bHasProject) return -1;
                  if (!aHasProject && bHasProject) return 1;
                  return a.port - b.port;
                }).map((p) => {
                  const key = `port-${p.port}`;
                  const isKilling = killing.has(key);
                  const isConfirming = !!confirmKill[key];
                  const isProjectPort = !!p.projectName;
                  return (
                    <div
                      key={key}
                      className={`flex items-center gap-3 px-5 py-2.5 border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors group relative ${
                        isProjectPort ? 'bg-violet-950/20' : ''
                      }`}
                    >
                      {/* Left accent for project ports */}
                      {isProjectPort && (
                        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-violet-500/60 rounded-r" />
                      )}

                      {/* Port number */}
                      <div className="w-24 flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isProjectPort ? 'bg-violet-400' : 'bg-emerald-500/70'}`} />
                        <span className={`text-sm font-mono font-semibold ${isProjectPort ? 'text-violet-300' : 'text-slate-300'}`}>
                          :{p.port}
                        </span>
                      </div>

                      {/* Process name + project label */}
                      <div className="flex-1 min-w-0">
                        {isProjectPort && (
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-[10px] font-medium text-violet-400 truncate">{p.projectName}</span>
                          </div>
                        )}
                        {p.cmd ? (
                          <span className="text-xs font-mono text-slate-500 truncate block">{p.cmd}</span>
                        ) : null}
                      </div>

                      {/* PID — only if available */}
                      <div className="w-14 text-right">
                        {p.pid ? (
                          <span className="text-[11px] font-mono text-slate-600">{p.pid}</span>
                        ) : null}
                      </div>

                      {/* Actions */}
                      <div className="w-32 flex items-center justify-end gap-1">
                        {isConfirming ? (
                          <>
                            <span className="text-[10px] text-red-400 font-medium mr-1 truncate max-w-[80px]" title={
                              (() => {
                                const portsToKill = confirmKill[key] || [p.port];
                                return p.projectName && portsToKill.length > 1
                                  ? `Kill ${portsToKill.map((x) => ':' + x).join(', ')} (${p.projectName})?`
                                  : `Kill :${p.port}?`;
                              })()
                            }>
                              {(() => {
                                const portsToKill = confirmKill[key] || [p.port];
                                if (p.projectName && portsToKill.length > 1) {
                                  return `Kill ${portsToKill.map((x) => ':' + x).join(' + ')}?`;
                                }
                                return `Kill :${p.port}?`;
                              })()}
                            </span>
                            <button
                              onClick={() => cancelConfirm(key)}
                              className="px-1.5 py-0.5 text-[10px] text-slate-500 hover:text-slate-300 rounded transition-colors flex-shrink-0"
                            >
                              ✕
                            </button>
                            <button
                              onClick={() => handleKillPorts(p)}
                              disabled={isKilling}
                              className="px-2 py-0.5 text-[10px] font-medium rounded border bg-red-600/30 hover:bg-red-600/50 text-red-400 border-red-600/40 transition-colors disabled:opacity-50 flex-shrink-0"
                            >
                              {isKilling ? '…' : (confirmKill[key]?.length > 1 ? 'Kill All' : 'Kill')}
                            </button>
                          </>
                        ) : (
                          <>
                            {isHttpPort(p.port) && (
                              <button
                                onClick={() => window.electronAPI?.shell?.openExternal(`http://localhost:${p.port}`)}
                                title={`Open localhost:${p.port} in browser`}
                                className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded-md text-slate-600 hover:text-sky-400 hover:bg-slate-700 transition-all"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </button>
                            )}
                            <button
                              onClick={() => requestConfirm(p)}
                              className="px-2 py-1 text-[11px] font-medium rounded-lg border transition-all bg-red-600/20 hover:bg-red-600/40 text-red-400 border-red-600/30"
                            >
                              Kill
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )
          )}

          {/* ── PROCESSES TAB ── */}
          {activeTab === 'processes' && (
            filteredProcs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 py-12 text-center">
                <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center">
                  <svg className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z" />
                  </svg>
                </div>
                <div>
                  <p className="text-slate-400 text-sm font-medium">
                    {search ? 'No processes match your search' : 'No running processes'}
                  </p>
                  <p className="text-slate-600 text-xs mt-0.5">
                    {search ? `No results for "${search}"` : 'Start a project to see processes here'}
                  </p>
                </div>
              </div>
            ) : (
              filteredProcs.map((proc) => {
                const procStats = stats[proc.pid];
                const key = `proc-${proc.pid}`;
                const isKilling = killing.has(key);
                const isMain = proc.type === 'main';
                return (
                  <div
                    key={`${proc.projectId}-${proc.pid}`}
                    className="flex items-center gap-3 px-5 py-3 border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors group"
                  >
                    <div className="w-2 flex-shrink-0">
                      <div className={`w-1.5 h-1.5 rounded-full ${isMain ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-slate-200 truncate">{proc.projectName}</span>
                        {!isMain && (
                          <span className="px-1 py-0.5 bg-amber-500/15 border border-amber-500/25 rounded text-[9px] text-amber-400 flex-shrink-0">cmd</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono truncate mt-0.5">{proc.command || '—'}</div>
                    </div>
                    <div className="w-10 text-right">
                      <span className="text-[11px] font-mono text-slate-500">{proc.pid}</span>
                    </div>
                    <div className="w-28">
                      <StatBar value={procStats?.cpu} max={100} color="bg-violet-500" />
                    </div>
                    <div className="w-28">
                      <StatBar value={procStats?.mem} max={100} color="bg-sky-500" />
                    </div>
                    <div className="w-16">
                      <span className="text-[11px] font-mono text-slate-500">{formatUptime(proc.startedAt)}</span>
                    </div>
                    <div className="w-20 flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleKill(proc)}
                        disabled={isKilling}
                        className="px-2 py-1 text-[11px] font-medium rounded-lg border transition-colors opacity-0 group-hover:opacity-100 bg-red-600/20 hover:bg-red-600/40 text-red-400 border-red-600/30 disabled:opacity-40"
                      >
                        {isKilling ? '…' : 'Kill'}
                      </button>
                    </div>
                  </div>
                );
              })
            )
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-slate-800 flex-shrink-0 flex items-center gap-4 text-[10px] text-slate-600">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            main process
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            script / command
          </div>
          {activeTab === 'ports' && ports.length > 0 && (
            <span className="ml-auto">{ports.length} listening port{ports.length !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
    </div>
  );
}
