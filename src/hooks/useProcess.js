import { useState, useEffect, useRef, useCallback } from 'react';
import { runCommand, killCommand, onLogOutput, onCommandStatus, getLogBuffer } from '../ipc';

const MAX_LOG_LINES = 5000;

export function useProcess(projectId) {
  const [logs, setLogs] = useState([]);
  const [runningCmd, setRunningCmd] = useState(null);
  const logsRef = useRef([]);

  useEffect(() => {
    if (!projectId) return;

    logsRef.current = [];
    setLogs([]);

    // Collect live events that arrive while the buffer fetch is in-flight,
    // so nothing is lost and nothing is duplicated.
    let pendingLive = [];
    let bufferReady = false;
    let cancelled = false;

    const unsubLog = onLogOutput(({ projectId: pid, type, data }) => {
      if (pid !== projectId) return;
      const entries = data.split('\n').map((line) => ({ type, text: line }));
      if (!bufferReady) {
        // Buffer fetch not done yet — queue these entries
        pendingLive.push(...entries);
      } else {
        logsRef.current = [...logsRef.current, ...entries].slice(-MAX_LOG_LINES);
        setLogs([...logsRef.current]);
      }
    });

    const unsubStatus = onCommandStatus(({ projectId: pid, command, status }) => {
      if (pid !== projectId) return;
      setRunningCmd(status === 'running' ? command : null);
    });

    // Fetch buffered output from the main process (captures everything that
    // happened before this hook mounted, including crash output).
    getLogBuffer(projectId)
      .then((buffer) => {
        if (cancelled) return;
        const bufEntries = [];
        if (buffer && buffer.length > 0) {
          for (const { type, data } of buffer) {
            data.split('\n').forEach((line) => bufEntries.push({ type, text: line }));
          }
        }
        // Merge: history from buffer + any live events queued during the fetch.
        // The buffer holds everything from process start up to mount time;
        // pendingLive holds everything that arrived after subscription but
        // before the async fetch resolved — the two are non-overlapping.
        bufferReady = true;
        logsRef.current = [...bufEntries, ...pendingLive].slice(-MAX_LOG_LINES);
        pendingLive = [];
        setLogs([...logsRef.current]);
      })
      .catch(() => {
        if (cancelled) return;
        bufferReady = true;
        logsRef.current = [...pendingLive].slice(-MAX_LOG_LINES);
        pendingLive = [];
        setLogs([...logsRef.current]);
      });

    return () => {
      cancelled = true;
      bufferReady = true; // stop queuing; any in-flight .then() will bail out
      unsubLog();
      unsubStatus();
    };
  }, [projectId]);

  const clearLogs = useCallback(() => {
    logsRef.current = [];
    setLogs([]);
  }, []);

  const run = useCallback((cmd) => runCommand(projectId, cmd), [projectId]);

  const killCmd = useCallback((cmd) => {
    const target = cmd || runningCmd;
    if (target) killCommand(projectId, target);
  }, [projectId, runningCmd]);

  return { logs, clearLogs, run, killCmd, runningCmd };
}
