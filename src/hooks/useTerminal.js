import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { createPty, ptyInput, ptyResize, destroyPty, onPtyOutput } from '../ipc';

export function useTerminal(containerRef, projectId, type, active) {
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const sessionIdRef = useRef(null);
  const unsubRef = useRef(null);
  const initializedRef = useRef(false);

  const init = useCallback(async () => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    // Create xterm instance
    const term = new Terminal({
      theme: {
        background: '#0b1120',
        foreground: '#e2e8f0',
        cursor: '#94a3b8',
        selectionBackground: '#334155',
        black: '#1e293b',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e2e8f0',
        brightBlack: '#475569',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc',
      },
      fontFamily: 'JetBrains Mono, Fira Code, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      allowTransparency: false,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Fit after a tick
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch (_) {}
    });

    // Create PTY session
    const result = await createPty(projectId, type);
    if (!result.success) {
      term.write('\r\n\x1b[31m[Failed to create terminal session]\x1b[0m\r\n');
      return;
    }

    sessionIdRef.current = result.sessionId;

    // Listen for PTY output
    unsubRef.current = onPtyOutput(({ sessionId, data }) => {
      if (sessionId === result.sessionId) {
        term.write(data);
      }
    });

    // Send terminal input to PTY
    term.onData((data) => {
      if (sessionIdRef.current) {
        ptyInput(sessionIdRef.current, data);
      }
    });

    // Handle resize
    term.onResize(({ cols, rows }) => {
      if (sessionIdRef.current) {
        ptyResize(sessionIdRef.current, cols, rows);
      }
    });
  }, [containerRef, projectId, type]);

  useEffect(() => {
    if (active) {
      init();
    }
    return () => {};
  }, [active, init]);

  // Resize when container size changes
  useEffect(() => {
    if (!active || !fitAddonRef.current) return;

    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        try { fitAddonRef.current.fit(); } catch (_) {}
      }
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [active, containerRef]);

  const dispose = useCallback(() => {
    if (unsubRef.current) unsubRef.current();
    if (sessionIdRef.current) destroyPty(sessionIdRef.current);
    if (termRef.current) termRef.current.dispose();
    termRef.current = null;
    fitAddonRef.current = null;
    sessionIdRef.current = null;
    initializedRef.current = false;
  }, []);

  const sendInput = useCallback((text) => {
    if (sessionIdRef.current) {
      ptyInput(sessionIdRef.current, text);
    }
  }, []);

  const fit = useCallback(() => {
    if (fitAddonRef.current) {
      try { fitAddonRef.current.fit(); } catch (_) {}
    }
  }, []);

  return { dispose, sendInput, fit };
}
