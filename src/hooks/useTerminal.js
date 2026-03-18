import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { createPty, ptyInput, ptyResize, destroyPty, onPtyOutput } from '../ipc';

const termConfig = {
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  fontSize: 13,
  lineHeight: 1.3,
  theme: {
    background: '#0d1117',
    foreground: '#e6edf3',
    cursor: '#58a6ff',
    selectionBackground: '#264f78',
    black: '#0d1117',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#f0f6fc',
  },
  cursorBlink: true,
  scrollback: 5000,
  allowTransparency: false,
  macOptionIsMeta: true,
  macOptionClickForcesSelection: true,
  rightClickSelectsWord: true,
};

/**
 * useTerminal(containerRef, projectId, type, active, options)
 *
 * options:
 *   onReady(api)   — called once the terminal + PTY are ready; api = { sendInput }
 *   claudeMode     — reserved for future use
 */
export function useTerminal(containerRef, projectId, type, active, options = {}) {
  const { onReady, onCommand, onScrollChange } = options;

  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const searchAddonRef = useRef(null);
  const sessionIdRef = useRef(null);
  const unsubRef = useRef(null);
  const initializedRef = useRef(false);
  const resizeObserverRef = useRef(null);
  const observerInitTimerRef = useRef(null);
  const onReadyRef = useRef(onReady);
  const onCommandRef = useRef(onCommand);
  const onScrollChangeRef = useRef(onScrollChange);

  // Keep refs fresh without triggering re-renders
  useEffect(() => {
    onReadyRef.current = onReady;
    onCommandRef.current = onCommand;
    onScrollChangeRef.current = onScrollChange;
  });

  // ── Fit with retry — waits until container has non-zero dimensions ──────────

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
        requestAnimationFrame(attempt);
      }
    };

    requestAnimationFrame(attempt);
  }, [containerRef]);

  // ── Keyboard handler ───────────────────────────────────────────────────────

  function makeKeyHandler(term) {
    return (event) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const modifier = isMac ? event.metaKey : event.ctrlKey;

      if (!modifier) return true;

      switch (event.key) {
        case 'c': {
          const selection = term.getSelection();
          if (selection) {
            navigator.clipboard.writeText(selection).catch(() => {});
            return false;
          }
          // No selection — send SIGINT
          if (sessionIdRef.current) {
            ptyInput(sessionIdRef.current, '\x03');
          }
          return false;
        }

        case 'k': {
          // Clear screen
          if (sessionIdRef.current) {
            ptyInput(sessionIdRef.current, 'clear\r');
          }
          return false;
        }

        default:
          return true;
      }
    };
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  const init = useCallback(async () => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    // Create xterm instance with full config
    const term = new Terminal(termConfig);

    // Load addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);

    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    // Attach custom key handler
    term.attachCustomKeyEventHandler(makeKeyHandler(term));

    // Fit xterm to actual container size BEFORE creating PTY so the PTY starts
    // with the correct dimensions — this eliminates the SIGWINCH that causes
    // a duplicate prompt on startup.
    await new Promise((resolve) => {
      const attempt = () => {
        const el = containerRef.current;
        if (!el) { resolve(); return; }
        if (el.offsetWidth > 0 && el.offsetHeight > 0) {
          try { fitAddon.fit(); } catch (_) {}
          resolve();
        } else {
          requestAnimationFrame(attempt);
        }
      };
      requestAnimationFrame(attempt);
    });

    const initCols = term.cols || 120;
    const initRows = term.rows || 30;

    // Create PTY with the exact terminal dimensions — no resize needed after start
    const result = await createPty(projectId, type, initCols, initRows);

    // Start ResizeObserver only after PTY is ready to handle resizes
    let resizeTimer = null;
    const observerInitTimer = observerInitTimerRef.current = setTimeout(() => {
      const observer = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => fitWhenReady(), 80);
      });
      if (containerRef.current) {
        observer.observe(containerRef.current);
      }
      resizeObserverRef.current = observer;
    }, 300);
    if (!result.success) {
      term.write('\r\n\x1b[31m[Failed to create terminal session]\x1b[0m\r\n');
      return;
    }

    sessionIdRef.current = result.sessionId;

    // Track whether the user has manually scrolled up so we don't
    // yank them back to the bottom while they're reading history.
    let userScrolledUp = false;
    let isWriting = false;
    term.onScroll(() => {
      // Ignore scroll events fired internally by xterm during data writes —
      // they can temporarily jump the viewport and falsely mark userScrolledUp.
      if (isWriting) return;
      const buf = term.buffer.active;
      const atBottom = buf.viewportY >= buf.length - term.rows;
      userScrolledUp = !atBottom;
      if (onScrollChangeRef.current) onScrollChangeRef.current(atBottom);
    });

    // Listen for PTY output
    unsubRef.current = onPtyOutput(({ sessionId, data }) => {
      if (sessionId === result.sessionId) {
        isWriting = true;
        term.write(data, () => {
          isWriting = false;
          if (!userScrolledUp) term.scrollToBottom();
        });
      }
    });

    // Send terminal input to PTY + track typed commands for history
    let cmdBuffer = '';
    term.onData((data) => {
      if (sessionIdRef.current) {
        ptyInput(sessionIdRef.current, data);
      }
      // Track user-typed commands so they appear in command palette history
      if (data === '\r') {
        // Enter pressed — save buffered command
        const cmd = cmdBuffer.trim();
        if (cmd && onCommandRef.current) onCommandRef.current(cmd);
        cmdBuffer = '';
      } else if (data === '\x7f') {
        // Backspace
        cmdBuffer = cmdBuffer.slice(0, -1);
      } else if (data === '\x03' || data === '\x15') {
        // Ctrl+C or Ctrl+U — clear line
        cmdBuffer = '';
      } else if (data.length === 1 && data >= ' ') {
        // Printable character
        cmdBuffer += data;
      }
    });

    // Handle resize
    term.onResize(({ cols, rows }) => {
      if (sessionIdRef.current) {
        ptyResize(sessionIdRef.current, cols, rows);
      }
    });

    // Notify parent that terminal is ready
    const sendInputFn = (text) => {
      if (sessionIdRef.current) {
        ptyInput(sessionIdRef.current, text);
      }
    };

    if (onReadyRef.current) {
      onReadyRef.current({ sendInput: sendInputFn });
    }
  }, [containerRef, projectId, type, fitWhenReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Activate / re-fit ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!active) return;

    if (!initializedRef.current) {
      init();
    } else {
      // Delay gives the browser time to finish layout after display:none → block,
      // which happens when switching tabs. requestAnimationFrame alone is not
      // enough because the frame can fire before the new layout is computed.
      const timer = setTimeout(() => {
        if (fitAddonRef.current) {
          try { fitAddonRef.current.fit(); } catch (_) {}
        }
        if (termRef.current) {
          try { termRef.current.scrollToBottom(); } catch (_) {}
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [active, init]);

  // ── Public API ────────────────────────────────────────────────────────────

  const dispose = useCallback(() => {
    if (observerInitTimerRef.current) {
      clearTimeout(observerInitTimerRef.current);
      observerInitTimerRef.current = null;
    }
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    if (unsubRef.current) unsubRef.current();
    if (sessionIdRef.current) destroyPty(sessionIdRef.current);
    if (termRef.current) termRef.current.dispose();
    termRef.current = null;
    fitAddonRef.current = null;
    searchAddonRef.current = null;
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

  const scrollToBottom = useCallback(() => {
    if (termRef.current) termRef.current.scrollToBottom();
  }, []);

  return { dispose, sendInput, fit, scrollToBottom, searchAddon: searchAddonRef.current };
}
