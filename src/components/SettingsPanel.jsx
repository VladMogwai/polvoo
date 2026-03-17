import React, { useState, useEffect, useRef } from 'react';

const SYSTEM_PREF_URLS = {
  notifications: 'x-apple.systempreferences:com.apple.preference.notifications',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  fullDiskAccess: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
};

const PERMISSION_META = [
  { key: 'notifications',  label: 'Notifications',    icon: '🔔', canRequest: false },
  { key: 'accessibility',  label: 'Accessibility',    icon: '🔒', canRequest: false },
  { key: 'fullDiskAccess', label: 'Full Disk Access', icon: '🖥️', canRequest: false },
  { key: 'camera',         label: 'Camera',           icon: '📷', canRequest: true  },
  { key: 'microphone',     label: 'Microphone',       icon: '🎙️', canRequest: true  },
  { key: 'screen',         label: 'Screen Recording', icon: '🎬', canRequest: false },
];

function StatusBadge({ status }) {
  if (status === 'granted') {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-medium tabular-nums">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
        Granted
      </span>
    );
  }
  if (status === 'denied') {
    return (
      <span className="inline-flex items-center gap-1.5 text-red-400 text-xs font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
        Denied
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-amber-400 text-xs font-medium">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
      Unknown
    </span>
  );
}

export default function SettingsPanel({ onClose }) {
  const [visible, setVisible] = useState(false);
  const [permissions, setPermissions] = useState({});
  const [loadingPerms, setLoadingPerms] = useState(true);
  const [requestingPerm, setRequestingPerm] = useState(null);
  const [general, setGeneral] = useState({ version: '', launchAtLogin: false });
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Slide-in animation
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  function dismiss() {
    setVisible(false);
    setTimeout(onClose, 210);
  }

  useEffect(() => {
    loadPerms();
    loadGeneral();
  }, []);

  async function loadPerms() {
    setLoadingPerms(true);
    try {
      const res = await window.electronAPI.getPermissions();
      setPermissions(res || {});
    } catch {
      setPermissions({});
    } finally {
      setLoadingPerms(false);
    }
  }

  async function loadGeneral() {
    try {
      const res = await window.electronAPI.getGeneralSettings();
      if (res) setGeneral(res);
    } catch {}
  }

  async function handleRequest(key) {
    setRequestingPerm(key);
    try {
      await window.electronAPI.requestPermission(key);
      await loadPerms();
    } catch {}
    setRequestingPerm(null);
  }

  async function handleOpenPrefs(key) {
    const url = SYSTEM_PREF_URLS[key] || 'x-apple.systempreferences:';
    try {
      await window.electronAPI.openSystemPrefs(url);
    } catch {}
  }

  async function handleLaunchAtLoginToggle() {
    const next = !general.launchAtLogin;
    setGeneral((g) => ({ ...g, launchAtLogin: next }));
    try {
      await window.electronAPI.setLaunchAtLogin(next);
    } catch {
      setGeneral((g) => ({ ...g, launchAtLogin: !next }));
    }
  }

  async function handleClearData() {
    setClearing(true);
    try {
      await window.electronAPI.clearAllData();
      window.location.reload();
    } catch {
      setClearing(false);
      setConfirmClear(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end"
      style={{
        background: visible ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)',
        transition: 'background 210ms ease',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div
        className="relative flex flex-col shadow-2xl overflow-hidden"
        style={{
          width: 480,
          background: '#0d1626',
          borderLeft: '1px solid rgba(51,65,85,0.6)',
          transform: visible ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 210ms cubic-bezier(0.4,0,0.2,1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center justify-between px-5 border-b border-slate-700/60 flex-shrink-0"
          style={{ height: 52, minHeight: 52, WebkitAppRegion: 'no-drag' }}
        >
          <div className="flex items-center gap-2.5 select-none">
            <div className="w-6 h-6 rounded-md bg-slate-700/80 flex items-center justify-center flex-shrink-0">
              <svg className="w-3.5 h-3.5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-slate-100">Settings</span>
          </div>
          <button
            onClick={dismiss}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Permissions section ── */}
          <section className="px-5 pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Permissions</h2>
              <button
                onClick={loadPerms}
                disabled={loadingPerms}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition-colors disabled:opacity-40"
              >
                <svg className={`w-3 h-3 ${loadingPerms ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            </div>

            <div className="border border-slate-700/60 rounded-lg overflow-hidden">
              {PERMISSION_META.map((perm, idx) => {
                const status = permissions[perm.key] || 'not-determined';
                const isGranted = status === 'granted';
                // Only offer "Request" for camera/mic when not yet determined
                const showRequest = perm.canRequest && status === 'not-determined';
                const showOpenSettings = !isGranted;

                return (
                  <div
                    key={perm.key}
                    className={`flex items-center gap-3 px-4 py-2.5 ${
                      idx > 0 ? 'border-t border-slate-700/40' : ''
                    }`}
                  >
                    <span className="text-sm flex-shrink-0 w-5 text-center leading-none">{perm.icon}</span>
                    <span className="flex-1 text-sm text-slate-200 font-medium min-w-0">{perm.label}</span>
                    <StatusBadge status={status} />
                    <div className="w-32 flex justify-end flex-shrink-0">
                      {showRequest && (
                        <button
                          onClick={() => handleRequest(perm.key)}
                          disabled={requestingPerm === perm.key}
                          className="px-3 py-1 text-[11px] text-slate-200 hover:text-white bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-md transition-colors disabled:opacity-40"
                        >
                          {requestingPerm === perm.key ? 'Requesting…' : 'Request'}
                        </button>
                      )}
                      {!showRequest && showOpenSettings && (
                        <button
                          onClick={() => handleOpenPrefs(perm.key)}
                          className="px-2 py-1 text-[11px] text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 rounded-md transition-colors"
                        >
                          Open Settings →
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="mx-5 border-t border-slate-700/40" />

          {/* ── General section ── */}
          <section className="px-5 pt-4 pb-6">
            <h2 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">General</h2>

            <div className="border border-slate-700/60 rounded-lg overflow-hidden">
              {/* Version */}
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-slate-200 font-medium">Version</span>
                <span className="text-xs text-slate-500 font-mono">
                  {general.version ? `v${general.version}` : '—'}
                </span>
              </div>

              {/* Launch at Login */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700/40">
                <div>
                  <p className="text-sm text-slate-200 font-medium">Launch at Login</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Start Dev Dashboard when you log in</p>
                </div>
                <button
                  type="button"
                  onClick={handleLaunchAtLoginToggle}
                  className={`relative w-9 h-5 rounded-full transition-colors duration-150 flex-shrink-0 focus:outline-none ${
                    general.launchAtLogin ? 'bg-violet-600' : 'bg-slate-700'
                  }`}
                  aria-checked={general.launchAtLogin}
                  role="switch"
                >
                  <span
                    className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-150"
                    style={{ transform: general.launchAtLogin ? 'translateX(18px)' : 'translateX(2px)' }}
                  />
                </button>
              </div>

              {/* Theme — placeholder */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700/40 opacity-40 pointer-events-none select-none">
                <div>
                  <p className="text-sm text-slate-200 font-medium">Theme</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Coming soon</p>
                </div>
                <span className="text-xs text-slate-400 px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-md">
                  Dark
                </span>
              </div>
            </div>

            {/* Clear data */}
            <div className="mt-4">
              {!confirmClear ? (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="w-full px-4 py-2.5 text-sm text-red-400 hover:text-red-300 bg-red-950/20 hover:bg-red-950/40 border border-red-900/30 hover:border-red-800/50 rounded-lg transition-colors font-medium"
                >
                  Clear all project data…
                </button>
              ) : (
                <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-lg">
                  <p className="text-sm text-red-300 font-medium mb-0.5">Remove all projects?</p>
                  <p className="text-xs text-slate-400 mb-3">
                    This will permanently delete all saved projects. The app will reload.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleClearData}
                      disabled={clearing}
                      className="flex-1 px-3 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 rounded-md transition-colors disabled:opacity-40"
                    >
                      {clearing ? 'Clearing…' : 'Yes, clear everything'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClear(false)}
                      disabled={clearing}
                      className="flex-1 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition-colors disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
