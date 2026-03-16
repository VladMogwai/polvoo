import React, { useRef, useEffect } from 'react';
import { useTerminal } from '../hooks/useTerminal';
import '@xterm/xterm/css/xterm.css';

export default function Terminal({ projectId, type, active, onReady }) {
  const containerRef = useRef(null);
  const { dispose, sendInput, fit } = useTerminal(containerRef, projectId, type, active);

  useEffect(() => {
    if (active) {
      // Give DOM a tick before fitting
      const t = setTimeout(() => fit(), 100);
      return () => clearTimeout(t);
    }
  }, [active, fit]);

  useEffect(() => {
    return () => dispose();
  }, [dispose]);

  useEffect(() => {
    if (active && onReady) onReady({ sendInput });
  }, [active, onReady, sendInput]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', background: '#0b1120' }}
    />
  );
}
