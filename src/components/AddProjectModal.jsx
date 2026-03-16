import React, { useState } from 'react';
import { openFolderDialog } from '../ipc';

export default function AddProjectModal({ onAdd, onClose }) {
  const [form, setForm] = useState({
    name: '',
    path: '',
    startCommand: '',
    envFile: '',
  });
  const [error, setError] = useState('');

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function pickFolder() {
    const folder = await openFolderDialog();
    if (folder) {
      set('path', folder);
      if (!form.name) {
        const parts = folder.split('/');
        set('name', parts[parts.length - 1] || folder);
      }
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!form.name.trim()) { setError('Project name is required.'); return; }
    if (!form.path.trim()) { setError('Project folder is required.'); return; }
    if (!form.startCommand.trim()) { setError('Start command is required.'); return; }

    await onAdd({
      name: form.name.trim(),
      path: form.path.trim(),
      startCommand: form.startCommand.trim(),
      envFile: form.envFile.trim() || null,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[520px] bg-slate-800 rounded-xl shadow-2xl border border-slate-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h2 className="text-base font-semibold text-slate-100">Add Project</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Display Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="My API Server"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-violet-500 transition-colors"
            />
          </div>

          {/* Path */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Project Folder</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.path}
                onChange={(e) => set('path', e.target.value)}
                placeholder="/Users/you/projects/my-api"
                className="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-violet-500 transition-colors font-mono"
              />
              <button
                type="button"
                onClick={pickFolder}
                className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg transition-colors whitespace-nowrap"
              >
                Browse…
              </button>
            </div>
          </div>

          {/* Start command */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Start Command</label>
            <input
              type="text"
              value={form.startCommand}
              onChange={(e) => set('startCommand', e.target.value)}
              placeholder="npm run dev"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-violet-500 transition-colors font-mono"
            />
          </div>

          {/* Env file */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Env File <span className="text-slate-600">(optional)</span>
            </label>
            <input
              type="text"
              value={form.envFile}
              onChange={(e) => set('envFile', e.target.value)}
              placeholder=".env or /absolute/path/.env"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-violet-500 transition-colors font-mono"
            />
          </div>

          {error && (
            <p className="text-red-400 text-xs">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Add Project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
