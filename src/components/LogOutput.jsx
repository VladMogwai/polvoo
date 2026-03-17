import React, { useEffect, useRef } from 'react';

const ANSI_RE = /\x1B\[[0-9;]*[a-zA-Z]/g;
function stripAnsi(str) {
  return str.replace(ANSI_RE, '');
}

export default function LogOutput({ logs, projectStatus, onCommand, runningCmd, onKill }) {
  const bottomRef = useRef(null);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const [cmd, setCmd] = React.useState('');
  const [autoScroll, setAutoScroll] = React.useState(true);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'instant' });
    }
  }, [logs, autoScroll]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = cmd.trim();
    if (!trimmed) return;
    if (onCommand) {
      onCommand(trimmed);
      setCmd('');
    }
  }

  function handleKeyDown(e) {
    // Ctrl+C — kill running command
    if (e.ctrlKey && e.key === 'c') {
      if (runningCmd && onKill) {
        e.preventDefault();
        onKill();
      }
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed bg-[#0b1120]"
      >
        {logs.length === 0 && (
          <span className={projectStatus === 'error' ? 'text-red-500/70' : 'text-slate-500'}>
            {projectStatus === 'error'
              ? 'Process exited with an error — no output was captured.'
              : 'No output yet. Start the process to see logs.'}
          </span>
        )}
        {logs.map((entry, i) => {
          const text = stripAnsi(entry.text);
          if (!text) return <br key={i} />;
          return (
            <div
              key={i}
              className={entry.type === 'stderr' ? 'text-red-400' : 'text-slate-200'}
            >
              {text}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Command input */}
      {onCommand && (
        <form onSubmit={handleSubmit} className="flex items-center border-t border-slate-700 bg-[#0b1120]">
          <span className="px-3 text-violet-400 font-mono text-xs select-none">$</span>
          <input
            ref={inputRef}
            type="text"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              runningCmd
                ? `Running: ${runningCmd} — Ctrl+C to stop`
                : 'Run a command in project directory…'
            }
            className="flex-1 bg-transparent py-2 pr-3 text-xs font-mono text-slate-100 placeholder-slate-600 outline-none"
          />
          {runningCmd ? (
            <button
              type="button"
              onClick={onKill}
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-orange-400 hover:text-orange-300 transition-colors font-medium"
              title="Stop (SIGTERM)"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="px-3 py-2 text-xs text-slate-400 hover:text-violet-400 transition-colors"
            >
              Run
            </button>
          )}
        </form>
      )}
    </div>
  );
}
