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
  const resizeObserverRef = useRef(null);

  // Fit with retry — waits until container has non-zero dimensions
  const fitWhenReady = useCallback(() => {
    if (!fitAddonRef.current || !containerRef.current) return;

    const attempt = () => {
      const el = containerRef.current;
      if (!el) return;
      const { offsetWidth, offsetHeight } = el;
      if (offsetWidth > 0 && offsetHeight > 0) {
        try {
          fitAddonRef.current && fitAddonRef.current.fit();
        } catch (_) {}
      } else {
        // Container not laid out yet — try again next frame
        requestAnimationFrame(attempt);
      }
    };

    requestAnimationFrame(attempt);
  }, [containerRef]);

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

    // Fit once container has real dimensions
    fitWhenReady();

    // Watch for container size changes and re-fit
    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current && containerRef.current) {
        const { offsetWidth, offsetHeight } = containerRef.current;
        if (offsetWidth > 0 && offsetHeight > 0) {
          try {
            fitAddonRef.current.fit();
          } catch (_) {}
        }
      }
    });
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    resizeObserverRef.current = observer;

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
  }, [containerRef, projectId, type, fitWhenReady]);

  // Initialize when first activated; re-fit on subsequent activations
  useEffect(() => {
    if (!active) return;

    if (!initializedRef.current) {
      init();
    } else {
      // Terminal already exists — just re-fit since the tab became visible
      fitWhenReady();
    }
  }, [active, init, fitWhenReady]);

  const dispose = useCallback(() => {
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
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
    fitWhenReady();
  }, [fitWhenReady]);

  return { dispose, sendInput, fit };
}
