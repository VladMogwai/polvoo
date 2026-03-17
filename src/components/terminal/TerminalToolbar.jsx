import React, { useRef } from 'react';

export default function TerminalToolbar({
  onOpenPalette,
  onToggleHistory,
  historyOpen,
  historyCount = 0,
}) {
  const historyBtnRef = useRef(null);

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-slate-700/60 bg-[#0d1117] flex-shrink-0">
      {/* Command Palette */}
      <button
        onClick={onOpenPalette}
        title="Command Palette (⌘K)"
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <span>Search</span>
        <kbd className="text-[10px] border border-slate-700 rounded px-1 text-slate-600">⌘K</kbd>
      </button>

      <div className="flex-1" />

      {/* History */}
      <button
        ref={historyBtnRef}
        onClick={() => onToggleHistory?.(historyBtnRef)}
        title="Command History"
        className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
          historyOpen
            ? 'text-violet-400 bg-violet-950/40'
            : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
        }`}
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>History</span>
        {historyCount > 0 && (
          <span className="text-[10px] text-slate-600">{historyCount}</span>
        )}
      </button>

    </div>
  );
}
