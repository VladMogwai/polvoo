import { useState, useEffect } from 'react';
import { getRunningPorts, onPortsUpdated } from '../ipc';

// Returns port numbers detected from the project's process output.
// Initial value is fetched via IPC; updates arrive as push events
// (no polling — zero flicker, immediate updates).
export function useProjectPorts(projectId, isRunning) {
  const [ports, setPorts] = useState([]);

  useEffect(() => {
    if (!isRunning) {
      setPorts([]);
      return;
    }

    // Fetch current value immediately
    getRunningPorts(projectId)
      .then((res) => { if (res?.ports) setPorts(res.ports); })
      .catch(() => {});

    // Listen for push updates
    const unsub = onPortsUpdated(({ projectId: id, ports: next }) => {
      if (id === projectId) setPorts(next);
    });

    return () => {
      unsub();
      setPorts([]);
    };
  }, [projectId, isRunning]);

  return ports;
}
