import React, { useState, useEffect, useRef } from 'react';
import {
  getInstalledTerminals, openInTerminal,
  addCustomTerminal, removeCustomTerminal,
  getSettings, setSettings,
  pickAppDialog,
} from '../ipc';

const TERMINAL_ICONS = {
  warp: '⬡', iterm2: '⌘', ghostty: '◈', wezterm: '◆',
  alacritty: '◎', hyper: '⬢', kitty: '◉', terminal: '▶',
};

export default function TerminalMenu({ projectPath }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('list'); // 'list' | 'add'
  const [terminals, setTerminals] = useState([]);
  const [preferred, setPreferred] = useState(null);
  const [launching, setLaunching] = useState(null);
  const [error, setError] = useState(null);
  const wrapperRef = useRef(null);

  // Add-terminal form state
  const [form, setForm] = useState({ name: '', appPath: '', extraPath: '', openCommand: '' });
  const [formError, setFormError] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [list, s] = await Promise.all([getInstalledTerminals(), getSettings()]);
    setTerminals(list);
    const pref = s.preferredTerminal && list.find(t => t.id === s.preferredTerminal)
      ? s.preferredTerminal : list[0]?.id ?? null;
    setPreferred(pref);
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        setView('list');
        setError(null);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function launch(id) {
    setLaunching(id);
    setError(null);
    const result = await openInTerminal(id, projectPath);
    setLaunching(null);
    if (!result.success) setError(result.error || 'Failed to open');
    else setOpen(false);
  }

  async function makeDefault(id) {
    setPreferred(id);
    await setSettings({ preferredTerminal: id });
  }

  async function handleRemoveCustom(id) {
    await removeCustomTerminal(id);
    await loadData();
  }

  async function pickApp() {
    const p = await pickAppDialog();
    if (p) {
      const name = p.split('/').pop().replace('.app', '');
      setForm(f => ({ ...f, appPath: p, name: f.name || name }));
    }
  }

  async function handleAddSubmit(e) {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) { setFormError('Name is required'); return; }
    if (!form.appPath.trim() && !form.openCommand.trim()) {
      setFormError('Either app path or open command is required'); return;
    }
    const newTerminal = {
      id: `custom-${Date.now()}`,
      name: form.name.trim(),
      appPath: form.appPath.trim(),
      extraPath: form.extraPath.trim(),
      openCommand: form.openCommand.trim(),
    };
    await addCustomTerminal(newTerminal);
    setForm({ name: '', appPath: '', extraPath: '', openCommand: '' });
    setView('list');
    await loadData();
  }

  const preferredT = terminals.find(t => t.id === preferred);
  const others = terminals.filter(t => t.id !== preferred);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => { setOpen(o => !o); setView('list'); setError(null); }}
        className="flex items-center gap-1.5 px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg border border-slate-600/50 transition-colors"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Terminal
        <svg className={`w-3 h-3 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-80 bg-[#1a2540] border border-slate-700/70 rounded-xl shadow-2xl overflow-hidden">
          {view === 'list' ? (
            <>
              <div className="px-3 pt-3 pb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Open in Terminal</span>
                <button
                  onClick={() => setView('add')}
                  className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                >
                  + Add custom
                </button>
              </div>

              {terminals.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-slate-500">
                  No terminals detected.
                  <button onClick={() => setView('add')} className="block mx-auto mt-2 text-violet-400 hover:text-violet-300">
                    Add one manually →
                  </button>
                </div>
              ) : (
                <div className="py-1 max-h-72 overflow-y-auto">
                  {/* Preferred terminal gets a prominent row */}
                  {preferredT && (
                    <div className="px-2 pb-1">
                      <button
                        onClick={() => launch(preferredT.id)}
                        disabled={!!launching}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-colors text-left disabled:opacity-50"
                      >
                        <span className="text-base w-5 text-center text-slate-300">
                          {TERMINAL_ICONS[preferredT.id] ?? '▶'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-slate-100 truncate">
                            {launching === preferredT.id ? 'Opening…' : preferredT.name}
                          </div>
                          <div className="text-[10px] text-slate-500">Default</div>
                        </div>
                      </button>
                    </div>
                  )}

                  {others.length > 0 && (
                    <div className="px-2 pb-2 border-t border-slate-700/40 pt-1">
                      {others.map(t => (
                        <div key={t.id} className="flex items-center gap-1">
                          <button
                            onClick={() => launch(t.id)}
                            disabled={!!launching}
                            className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-700/50 transition-colors text-left disabled:opacity-50"
                          >
                            <span className="text-sm w-4 text-center text-slate-400">
                              {TERMINAL_ICONS[t.id] ?? '▶'}
                            </span>
                            <span className="text-xs text-slate-300 truncate">
                              {launching === t.id ? 'Opening…' : t.name}
                            </span>
                          </button>
                          <button
                            onClick={() => makeDefault(t.id)}
                            className="px-2 py-1 text-[10px] text-slate-600 hover:text-violet-400 transition-colors whitespace-nowrap rounded"
                          >
                            Set default
                          </button>
                          {t.isCustom && (
                            <button
                              onClick={() => handleRemoveCustom(t.id)}
                              className="px-1.5 py-1 text-slate-700 hover:text-red-400 transition-colors text-xs rounded"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div className="px-3 pb-3 text-xs text-red-400">{error}</div>
              )}
            </>
          ) : (
            /* Add custom terminal form */
            <form onSubmit={handleAddSubmit} className="p-4 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-300">Add Custom Terminal</span>
                <button type="button" onClick={() => setView('list')} className="text-slate-500 hover:text-slate-300 text-lg leading-none">×</button>
              </div>

              {/* Name */}
              <div>
                <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="My Terminal"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-violet-500 transition-colors"
                />
              </div>

              {/* App path */}
              <div>
                <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">App (.app bundle)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.appPath}
                    onChange={e => setForm(f => ({ ...f, appPath: e.target.value }))}
                    placeholder="/Applications/MyTerm.app"
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-violet-500 transition-colors font-mono"
                  />
                  <button
                    type="button"
                    onClick={pickApp}
                    className="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors whitespace-nowrap"
                  >
                    Browse…
                  </button>
                </div>
              </div>

              {/* Extra PATH */}
              <div>
                <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">
                  Extra PATH <span className="normal-case text-slate-600">(optional)</span>
                </label>
                <input
                  type="text"
                  value={form.extraPath}
                  onChange={e => setForm(f => ({ ...f, extraPath: e.target.value }))}
                  placeholder="/opt/homebrew/bin:/usr/local/bin"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-violet-500 transition-colors font-mono"
                />
              </div>

              {/* Custom open command */}
              <div>
                <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wider">
                  Custom open command <span className="normal-case text-slate-600">(optional, overrides app path)</span>
                </label>
                <input
                  type="text"
                  value={form.openCommand}
                  onChange={e => setForm(f => ({ ...f, openCommand: e.target.value }))}
                  placeholder='open -a "MyTerm" "{path}"'
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-violet-500 transition-colors font-mono"
                />
                <p className="text-[10px] text-slate-600 mt-1">Use <code className="text-violet-500">{'{path}'}</code> as placeholder for project directory</p>
              </div>

              {formError && <p className="text-xs text-red-400">{formError}</p>}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className="flex-1 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  Add Terminal
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
