import React from 'react';
import { startProcess, stopProcess } from '../ipc';

const STATUS_COLORS = {
  running: 'bg-emerald-500',
  stopped: 'bg-slate-500',
  error: 'bg-red-500',
};

const STATUS_LABELS = {
  running: 'Running',
  stopped: 'Stopped',
  error: 'Error',
};

const STATUS_TEXT = {
  running: 'text-emerald-400',
  stopped: 'text-slate-400',
  error: 'text-red-400',
};

export default function ProjectTile({ project, gitInfo, isSelected, onSelect, onStatusChange }) {
  const status = project.status || 'stopped';
  const branch = gitInfo?.branch;

  async function handleStart(e) {
    e.stopPropagation();
    onStatusChange(project.id, 'running');
    await startProcess(project.id);
  }

  async function handleStop(e) {
    e.stopPropagation();
    onStatusChange(project.id, 'stopped');
    await stopProcess(project.id);
  }

  return (
    <div
      onClick={() => onSelect(project)}
      className={`
        relative flex flex-col gap-3 p-4 rounded-xl border cursor-pointer
        transition-all duration-150 select-none
        ${isSelected
          ? 'bg-slate-700/80 border-violet-500/60 shadow-lg shadow-violet-900/20'
          : 'bg-slate-800 border-slate-700 hover:border-slate-600 hover:bg-slate-750'}
      `}
    >
      {/* Status dot */}
      <div className="absolute top-4 right-4 flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[status]} ${status === 'running' ? 'animate-pulse' : ''}`} />
        <span className={`text-xs font-medium ${STATUS_TEXT[status]}`}>
          {STATUS_LABELS[status]}
        </span>
      </div>

      {/* Name */}
      <div className="pr-20">
        <h3 className="font-semibold text-slate-100 text-sm truncate">{project.name}</h3>
        <p className="text-xs text-slate-500 mt-0.5 truncate font-mono">{project.path}</p>
      </div>

      {/* Git branch */}
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        {branch ? (
          <>
            <svg className="w-3 h-3 text-slate-500" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
            </svg>
            <span className="font-mono truncate">{branch}</span>
          </>
        ) : (
          <span className="text-slate-600">no git</span>
        )}
      </div>

      {/* Start command */}
      <p className="text-xs text-slate-600 font-mono truncate">{project.startCommand}</p>

      {/* Buttons */}
      <div className="flex gap-2 mt-1">
        {status !== 'running' ? (
          <button
            onClick={handleStart}
            className="flex-1 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 text-xs font-medium rounded-lg border border-emerald-600/30 transition-colors"
          >
            Start
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="flex-1 px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs font-medium rounded-lg border border-red-600/30 transition-colors"
          >
            Stop
          </button>
        )}
      </div>
    </div>
  );
}
