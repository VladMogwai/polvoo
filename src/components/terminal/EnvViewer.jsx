import React, { useState, useEffect, useRef, useCallback } from 'react';
import { envScan, envSaveFile, envCreateFile } from '../../ipc';

const SECRET_RE = /key|secret|token|password|pwd|auth|credential/i;
const MIN_KEY_WIDTH = 80;
const MAX_KEY_WIDTH = 400;

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupFiles(files, search) {
  const q = search.toLowerCase().trim();
  const filtered = q
    ? files.filter((f) =>
        f.relativePath.toLowerCase().includes(q) ||
        f.variables.some(
          (v) =>
            v.key.toLowerCase().includes(q) ||
            (!v.isSecret && v.value.toLowerCase().includes(q))
        )
      )
    : files;

  const groups = new Map();
  for (const file of filtered) {
    const parts = file.relativePath.replace(/\\/g, '/').split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(file);
  }
  return [...groups.entries()].sort((a, b) => {
    if (a[0] === '') return -1;
    if (b[0] === '') return 1;
    return a[0].localeCompare(b[0]);
  });
}

function isDirty(editVars, savedVars) {
  if (editVars.length !== savedVars.length) return true;
  return editVars.some((v, i) => v.key !== savedVars[i]?.key || v.value !== savedVars[i]?.value);
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EnvViewer({ projectId }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(new Set());

  // Edit state — one file at a time
  const [editingPath, setEditingPath] = useState(null);
  const [editVars, setEditVars] = useState([]);
  const [savedVars, setSavedVars] = useState([]); // snapshot for dirty check
  const [focusKey, setFocusKey] = useState(null); // key to auto-focus on edit entry
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // View state
  const [revealed, setRevealed] = useState(new Set()); // "absPath::key"
  const [keyWidth, setKeyWidth] = useState(128);

  // New file creation
  const [showCreate, setShowCreate] = useState(false);
  const [newFileName, setNewFileName] = useState('.env');
  const [creating, setCreating] = useState(false);

  // ── Column resize ────────────────────────────────────────────────────────

  const draggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);

  const onDragMouseDown = useCallback((e) => {
    e.preventDefault();
    draggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = keyWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [keyWidth]);

  useEffect(() => {
    function onMouseMove(e) {
      if (!draggingRef.current) return;
      const delta = e.clientX - dragStartXRef.current;
      setKeyWidth(Math.min(MAX_KEY_WIDTH, Math.max(MIN_KEY_WIDTH, dragStartWidthRef.current + delta)));
    }
    function onMouseUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // ── Data loading ─────────────────────────────────────────────────────────

  const load = useCallback(async (keepExpanded = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await envScan(projectId);
      const scanned = result || [];
      setFiles(scanned);
      if (!keepExpanded && scanned.length > 0) {
        setExpanded((prev) => prev.size === 0 ? new Set([scanned[0].absolutePath]) : prev);
      }
    } catch (err) {
      setError(err?.message || 'Failed to scan env files');
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const totalVars = files.reduce((n, f) => n + f.variables.length, 0);

  // ── Expand / collapse ────────────────────────────────────────────────────

  function toggleExpand(absPath) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(absPath)) next.delete(absPath); else next.add(absPath);
      return next;
    });
  }

  // ── Edit mode ────────────────────────────────────────────────────────────

  function enterEditMode(file, clickedKey = null) {
    const vars = file.variables.map((v) => ({ key: v.key, value: v.value }));
    setEditingPath(file.absolutePath);
    setEditVars(vars);
    setSavedVars(vars);
    setFocusKey(clickedKey);
    setError(null);
    setExpanded((prev) => new Set([...prev, file.absolutePath]));
  }

  function cancelEdit() {
    setEditingPath(null);
    setEditVars([]);
    setSavedVars([]);
    setFocusKey(null);
    setError(null);
  }

  async function saveEdit(file) {
    setSaving(true);
    setError(null);
    try {
      const result = await envSaveFile(projectId, file.absolutePath, editVars);
      if (!result.success) { setError(result.error || 'Failed to save'); return; }
      setEditingPath(null);
      setFocusKey(null);
      await load(true); // keepExpanded=true — preserve user's expanded state after save
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function updateEditVar(idx, field, val) {
    setEditVars((prev) => prev.map((v, i) => i === idx ? { ...v, [field]: val } : v));
  }

  function deleteEditVar(idx) {
    setEditVars((prev) => prev.filter((_, i) => i !== idx));
  }

  function addEditVar() {
    setEditVars((prev) => [...prev, { key: '', value: '' }]);
    setFocusKey('__new__'); // signal to focus last/new row
  }

  function toggleReveal(absPath, key) {
    const id = `${absPath}::${key}`;
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── New file creation ────────────────────────────────────────────────────

  async function handleCreate() {
    const name = newFileName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const result = await envCreateFile(projectId, name);
      if (!result.success) { setError(result.error || 'Failed to create'); return; }
      setShowCreate(false);
      setNewFileName('.env');
      const updated = await envScan(projectId);
      setFiles(updated || []);
      if (result.absolutePath) {
        setExpanded((prev) => new Set([...prev, result.absolutePath]));
        const newFile = updated?.find((f) => f.absolutePath === result.absolutePath);
        if (newFile) enterEditMode(newFile);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const dirty = editingPath ? isDirty(editVars, savedVars) : false;
  const groups = groupFiles(files, search);

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/60 flex-shrink-0">
        <svg className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
        </svg>
        <span className="text-xs font-medium text-slate-400 flex-1">Environment Variables</span>
        {!loading && (
          <span className="text-[10px] text-slate-600">
            {files.length} {files.length === 1 ? 'file' : 'files'}, {totalVars} vars
          </span>
        )}
        <button
          onClick={() => { setShowCreate((v) => !v); setError(null); }}
          title="Add .env file"
          className="px-2 py-0.5 text-[10px] text-slate-500 hover:text-violet-400 hover:bg-slate-800 rounded transition-colors"
        >
          + New file
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-1.5 bg-red-900/20 border-b border-red-800/40 text-[10px] text-red-400 flex-shrink-0 flex items-center gap-2">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-400">✕</button>
        </div>
      )}

      {/* Create new file inline form */}
      {showCreate && (
        <div className="px-3 py-2 border-b border-slate-700/60 flex items-center gap-2 flex-shrink-0 bg-slate-900/40">
          <span className="text-[10px] text-slate-500 flex-shrink-0">Path:</span>
          <input
            autoFocus
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }}
            placeholder=".env or backend/.env.local"
            className="flex-1 min-w-0 bg-slate-800 border border-slate-700/60 rounded px-2 py-0.5 text-xs font-mono text-slate-300 placeholder-slate-600 outline-none focus:border-violet-500/40"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newFileName.trim()}
            className="px-2 py-0.5 text-[10px] bg-violet-600/30 hover:bg-violet-600/50 text-violet-300 border border-violet-600/40 rounded transition-colors disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
          <button
            onClick={() => setShowCreate(false)}
            className="px-2 py-0.5 text-[10px] text-slate-600 hover:text-slate-400 rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Search bar */}
      {!loading && files.length > 0 && (
        <div className="px-3 py-1.5 border-b border-slate-700/60 flex-shrink-0">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search keys and values across all files…"
            className="w-full bg-slate-800/60 border border-slate-700/60 rounded-md px-2 py-1 text-xs text-slate-300 placeholder-slate-600 outline-none focus:border-violet-500/40"
          />
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-xs text-slate-600 text-center">Scanning…</div>
        ) : files.length === 0 ? (
          <EmptyState onCreateClick={() => setShowCreate(true)} />
        ) : groups.length === 0 && search ? (
          <div className="p-4 text-xs text-slate-600 text-center">No matches for "{search}"</div>
        ) : (
          <div className="pb-4">
            {groups.map(([dir, dirFiles]) => (
              <div key={dir || '__root__'}>
                {/* Directory breadcrumb */}
                <div className="px-3 pt-3 pb-1 flex items-center gap-1 select-none">
                  <span className="text-[10px] font-medium text-slate-600 uppercase tracking-wider">
                    {dir || '/'}
                  </span>
                </div>

                {dirFiles.map((file) => {
                  const isExpanded = expanded.has(file.absolutePath);
                  const isEditing = editingPath === file.absolutePath;
                  const isFileDirty = isEditing && dirty;
                  const fileName = file.relativePath.replace(/\\/g, '/').split('/').pop();
                  const q = search.toLowerCase().trim();

                  // In edit mode, show all vars (not filtered); in view mode, filter by search
                  const filteredVars = (q && !isEditing)
                    ? file.variables.filter(
                        (v) =>
                          v.key.toLowerCase().includes(q) ||
                          (!v.isSecret && v.value.toLowerCase().includes(q))
                      )
                    : file.variables;

                  const varCount = isEditing
                    ? editVars.filter((v) => v.key.trim()).length
                    : file.variables.length;

                  return (
                    <div key={file.absolutePath} className="mx-3 mb-2 rounded-lg border border-slate-800/60 overflow-hidden">
                      {/* File header */}
                      <div
                        className="flex items-center gap-2 px-3 py-2 bg-slate-900/40 hover:bg-slate-800/40 cursor-pointer select-none"
                        onClick={() => toggleExpand(file.absolutePath)}
                      >
                        {/* Expand chevron */}
                        <svg
                          className={`w-3 h-3 text-slate-600 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>

                        {/* Filename + dirty dot */}
                        <span className="text-xs font-mono text-slate-300 font-medium flex-1 min-w-0 truncate">
                          {fileName}
                        </span>
                        {isFileDirty && (
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0 animate-pulse"
                            title="Unsaved changes"
                          />
                        )}

                        {/* Var count */}
                        <span className="text-[10px] text-slate-600 flex-shrink-0">
                          {varCount} var{varCount !== 1 ? 's' : ''}
                        </span>

                        {/* Lock icon for read-only files */}
                        {!file.isWritable && (
                          <svg
                            className="w-3 h-3 text-slate-700 flex-shrink-0"
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                            title="Read-only"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                          </svg>
                        )}

                        {/* Action buttons */}
                        {file.isWritable && !isEditing && (
                          <button
                            onClick={(e) => { e.stopPropagation(); enterEditMode(file); }}
                            className="px-2 py-0.5 text-[10px] text-slate-600 hover:text-violet-400 hover:bg-slate-700/60 rounded transition-colors flex-shrink-0"
                          >
                            Edit
                          </button>
                        )}
                        {isEditing && (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); cancelEdit(); }}
                              className="px-2 py-0.5 text-[10px] text-slate-500 hover:text-slate-300 hover:bg-slate-700/60 rounded transition-colors flex-shrink-0"
                            >
                              Discard
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); saveEdit(file); }}
                              disabled={saving || !isFileDirty}
                              className={`px-2 py-0.5 text-[10px] rounded border transition-colors flex-shrink-0 ${
                                isFileDirty
                                  ? 'bg-violet-600/30 hover:bg-violet-600/50 text-violet-300 border-violet-600/40 cursor-pointer'
                                  : 'bg-transparent text-slate-700 border-slate-800 cursor-not-allowed'
                              } disabled:opacity-50`}
                            >
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                          </>
                        )}
                      </div>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="border-t border-slate-800/60">
                          {isEditing ? (
                            <EditTable
                              vars={editVars}
                              keyWidth={keyWidth}
                              onDragMouseDown={onDragMouseDown}
                              onUpdate={updateEditVar}
                              onDelete={deleteEditVar}
                              onAdd={addEditVar}
                              focusKey={focusKey}
                              onFocusConsumed={() => setFocusKey(null)}
                            />
                          ) : filteredVars.length === 0 ? (
                            <div className="px-3 py-3 text-[10px] text-slate-700 italic">
                              {file.variables.length === 0 ? (
                                file.isWritable ? (
                                  <button
                                    onClick={() => enterEditMode(file)}
                                    className="text-slate-600 hover:text-violet-400 transition-colors"
                                  >
                                    Empty — click to add variables
                                  </button>
                                ) : 'Empty file'
                              ) : 'No matches'}
                            </div>
                          ) : (
                            <ViewTable
                              vars={filteredVars}
                              absPath={file.absolutePath}
                              keyWidth={keyWidth}
                              isWritable={file.isWritable}
                              revealed={revealed}
                              onToggleReveal={(key) => toggleReveal(file.absolutePath, key)}
                              onClickEdit={file.isWritable ? (key) => enterEditMode(file, key) : null}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ViewTable ─────────────────────────────────────────────────────────────────
// Read-only variable table. Clicking a row enters edit mode for that file.

function ViewTable({ vars, absPath, keyWidth, isWritable, revealed, onToggleReveal, onClickEdit }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {vars.map((v) => {
          const revealId = `${absPath}::${v.key}`;
          const isRevealed = revealed.has(revealId);

          return (
            <tr
              key={v.key}
              className={`border-b border-slate-800/40 last:border-0 transition-colors group ${
                isWritable ? 'hover:bg-slate-800/30 cursor-pointer' : ''
              }`}
              onClick={() => onClickEdit?.(v.key)}
              title={isWritable ? 'Click to edit' : undefined}
            >
              {/* Key cell */}
              <td
                className="px-3 py-1.5 font-mono text-violet-400 font-medium align-middle whitespace-nowrap"
                style={{ width: keyWidth, minWidth: keyWidth, maxWidth: keyWidth }}
              >
                <span className="truncate block">{v.key}</span>
              </td>

              {/* Value cell */}
              <td className="px-3 py-1.5 font-mono text-slate-400 break-all">
                {v.isSecret ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-600 select-none">
                      {isRevealed ? v.value : '••••••••'}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleReveal(v.key); }}
                      className="text-slate-700 hover:text-slate-400 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                    >
                      {isRevealed ? (
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                        </svg>
                      ) : (
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      )}
                    </button>
                  </div>
                ) : (
                  <span>{v.value || <span className="text-slate-700 italic">empty</span>}</span>
                )}
              </td>

              {/* Edit hint icon (appears on hover for writable files) */}
              {isWritable && (
                <td className="pr-2 w-5 align-middle">
                  <svg
                    className="w-3 h-3 text-slate-800 group-hover:text-slate-600 transition-colors flex-shrink-0"
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                  </svg>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── EditTable ─────────────────────────────────────────────────────────────────
// Editable table with auto-focus support, add row, and per-row delete.

function EditTable({ vars, keyWidth, onDragMouseDown, onUpdate, onDelete, onAdd, focusKey, onFocusConsumed }) {
  // Track whether we've consumed the focusKey so we don't re-focus on re-renders
  const focusConsumedRef = useRef(false);

  useEffect(() => {
    // Reset consumed flag when focusKey changes
    focusConsumedRef.current = false;
  }, [focusKey]);

  return (
    <div className="p-2 flex flex-col gap-1">
      {vars.map((v, idx) => {
        // Auto-focus: match explicit key, or '__new__' means focus last row
        const shouldFocus =
          !focusConsumedRef.current &&
          focusKey !== null &&
          (focusKey === v.key || (focusKey === '__new__' && idx === vars.length - 1));

        return (
          <EditRow
            key={idx}
            idx={idx}
            v={v}
            keyWidth={keyWidth}
            onDragMouseDown={onDragMouseDown}
            onUpdate={onUpdate}
            onDelete={onDelete}
            autoFocus={shouldFocus}
            onFocused={() => {
              focusConsumedRef.current = true;
              onFocusConsumed?.();
            }}
          />
        );
      })}

      {/* Add variable button */}
      <button
        onClick={onAdd}
        className="mt-1 flex items-center gap-1.5 px-2 py-1 text-[10px] text-slate-600 hover:text-violet-400 hover:bg-slate-800/60 rounded transition-colors self-start"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add variable
      </button>
    </div>
  );
}

// ── EditRow ───────────────────────────────────────────────────────────────────

function EditRow({ idx, v, keyWidth, onDragMouseDown, onUpdate, onDelete, autoFocus, onFocused }) {
  const valueRef = useRef(null);

  useEffect(() => {
    if (autoFocus && valueRef.current) {
      valueRef.current.focus();
      try { valueRef.current.select(); } catch {}
      onFocused?.();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentionally runs once on mount

  return (
    <div className="flex items-center gap-0 group">
      {/* Key input */}
      <input
        value={v.key}
        onChange={(e) => onUpdate(idx, 'key', e.target.value)}
        placeholder="KEY"
        style={{ width: keyWidth, minWidth: keyWidth, maxWidth: keyWidth }}
        className="flex-shrink-0 px-2 py-1 bg-slate-800 border border-slate-700/60 rounded-l text-xs font-mono text-violet-400 outline-none focus:border-violet-500/40 placeholder-slate-700"
      />

      {/* Column resize handle */}
      <div
        onMouseDown={onDragMouseDown}
        className="flex-shrink-0 w-2 self-stretch flex items-center justify-center cursor-col-resize hover:bg-violet-500/20 transition-colors"
        title="Drag to resize"
      >
        <div className="w-px h-4 bg-slate-700" />
      </div>

      {/* Value input */}
      <input
        ref={valueRef}
        value={v.value}
        onChange={(e) => onUpdate(idx, 'value', e.target.value)}
        placeholder="value"
        type={SECRET_RE.test(v.key) ? 'password' : 'text'}
        className="flex-1 min-w-0 px-2 py-1 bg-slate-800 border border-slate-700/60 rounded-r text-xs font-mono text-slate-300 outline-none focus:border-violet-500/40 placeholder-slate-700"
      />

      {/* Delete (trash) button — visible on row hover */}
      <button
        onClick={() => onDelete(idx)}
        className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-slate-700 hover:text-red-400 transition-all flex-shrink-0 ml-1"
        title="Delete variable"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
        </svg>
      </button>
    </div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

function EmptyState({ onCreateClick }) {
  return (
    <div className="p-6 text-xs text-slate-600 text-center flex flex-col items-center gap-3">
      <svg className="w-8 h-8 text-slate-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
      <span>No .env files found in this project</span>
      <button
        onClick={onCreateClick}
        className="px-3 py-1 text-[10px] bg-violet-600/20 hover:bg-violet-600/30 text-violet-400 border border-violet-600/30 rounded transition-colors"
      >
        Create .env file
      </button>
    </div>
  );
}
