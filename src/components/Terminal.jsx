import React, { useRef, useEffect } from 'react';
import { useTerminal } from '../hooks/useTerminal';
import '@xterm/xterm/css/xterm.css';

export default function Terminal({ projectId, type, active, onReady }) {
  const containerRef = useRef(null);
  const { dispose, sendInput, fit } = useTerminal(containerRef, projectId, type, active);

  // Re-fit whenever the tab becomes active
  useEffect(() => {
    if (active) {
      fit();
    }
  }, [active, fit]);

  // Notify parent when ready
  useEffect(() => {
    if (active && onReady) onReady({ sendInput });
  }, [active, onReady, sendInput]);

  // Dispose on unmount
  useEffect(() => {
    return () => dispose();
  }, [dispose]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        background: '#0b1120',
        overflow: 'hidden',
      }}
    />
  );
}
