import { useState, useEffect, useRef, useCallback } from 'react';
import { startProcess, stopProcess, restartProcess, runCommand, onLogOutput } from '../ipc';

const MAX_LOG_LINES = 5000;

export function useProcess(projectId) {
  const [logs, setLogs] = useState([]);
  const logsRef = useRef([]);

  useEffect(() => {
    if (!projectId) return;

    const unsub = onLogOutput(({ projectId: pid, type, data }) => {
      if (pid !== projectId) return;

      const lines = data.split('\n');
      const newEntries = lines.map((line) => ({ type, text: line }));

      logsRef.current = [...logsRef.current, ...newEntries].slice(-MAX_LOG_LINES);
      setLogs([...logsRef.current]);
    });

    return unsub;
  }, [projectId]);

  const clearLogs = useCallback(() => {
    logsRef.current = [];
    setLogs([]);
  }, []);

  const start = useCallback(() => startProcess(projectId), [projectId]);
  const stop = useCallback(() => stopProcess(projectId), [projectId]);
  const restart = useCallback(() => restartProcess(projectId), [projectId]);
  const run = useCallback((cmd) => runCommand(projectId, cmd), [projectId]);

  return { logs, clearLogs, start, stop, restart, run };
}
