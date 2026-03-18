import React, { useState, useEffect, useRef, useCallback } from 'react';
import ProjectGrid from './components/ProjectGrid';
import DetailPanel from './components/DetailPanel';
import AddProjectModal from './components/AddProjectModal';
import ProcessMonitor from './components/ProcessMonitor';
import UpdateModal from './components/UpdateModal';
import SettingsPanel from './components/SettingsPanel';
import { useProjects } from './hooks/useProjects';
import {
  onProcessStatusUpdate, rebuildInstall, onLogOutput, setBadgeCount,
  onUpdaterStatus, checkForUpdates, downloadUpdate, installUpdate, getAppVersion,
} from './ipc';

const MIN_PANEL_WIDTH = 360;
const MAX_PANEL_WIDTH = 860;
const DEFAULT_PANEL_WIDTH = 460;
const FIXED_SIDEBAR_WIDTH = 354;

export default function App() {
  const { projects, gitInfo, loading, addProject, removeProject, updateProject, updateProjectStatus, reorderProjects } = useProjects();
  const [selectedProject, setSelectedProject] = useState(null);
  const [initializedIds, setInitializedIds] = useState(() => new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [showMonitor, setShowMonitor] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [runningCount, setRunningCount] = useState(0);
  const [xcodeBannerVisible, setXcodeBannerVisible] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [sidebarFixed, setSidebarFixed] = useState(() => localStorage.getItem('sidebarFixed') !== 'false');
  const [errorCounts, setErrorCounts] = useState({});
  const viewingLogsForRef = useRef(null);
  const [updateStatus, setUpdateStatus] = useState(null); // { state, version?, percent? }
  const [updateDismissed, setUpdateDismissed] = useState(false); // dismisses "available" banner
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const updateStatusRef = useRef(null);   // mirrors updateStatus but readable inside timers
  const snoozedUntilRef = useRef(null);   // timestamp: when snooze expires
  const snoozeTimerRef = useRef(null);    // setTimeout handle
  const appVersion = getAppVersion();
  const dragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const liveSelected = selectedProject
    ? projects.find((p) => p.id === selectedProject.id) || null
    : null;

  // Track which project IDs have ever been opened so we can keep their panels alive
  useEffect(() => {
    if (!liveSelected?.id) return;
    setInitializedIds((prev) => {
      if (prev.has(liveSelected.id)) return prev;
      return new Set([...prev, liveSelected.id]);
    });
  }, [liveSelected?.id]);

  // Track running count for the Processes badge
  useEffect(() => {
    const count = projects.filter((p) => p.status === 'running').length;
    setRunningCount(count);
  }, [projects]);

  // Also listen for real-time status updates to keep badge accurate
  useEffect(() => {
    const unsub = onProcessStatusUpdate(({ status }) => {
      if (status === 'running') setRunningCount((n) => n + 1);
      else setRunningCount((n) => Math.max(0, n - 1));
    });
    return () => unsub();
  }, []);

  // Track error lines globally for badge counts
  const ERROR_RE = /error|exception|fatal|failed|crash/i;
  useEffect(() => {
    const unsub = onLogOutput(({ projectId, type, data }) => {
      if (projectId === viewingLogsForRef.current) return;
      const isError = type === 'stderr' || ERROR_RE.test(data);
      if (!isError) return;
      setErrorCounts((prev) => {
        const next = { ...prev, [projectId]: (prev[projectId] || 0) + 1 };
        const total = Object.values(next).reduce((a, b) => a + b, 0);
        setBadgeCount(total);
        return next;
      });
    });
    return unsub;
  }, []);

  // Subscribe to auto-updater status events
  useEffect(() => {
    const unsub = onUpdaterStatus((status) => {
      setUpdateStatus(status);
      updateStatusRef.current = status;

      if (status.state === 'available') {
        // New version found — reset the "available" banner dismissal
        setUpdateDismissed(false);
      }

      if (status.state === 'downloaded') {
        // Show confirmation modal unless the user snoozed within the last hour
        const now = Date.now();
        if (!snoozedUntilRef.current || now >= snoozedUntilRef.current) {
          setShowUpdateModal(true);
        }
      }
    });
    return unsub;
  }, []);

  // Snooze helpers
  function handleSnoozeModal() {
    setShowUpdateModal(false);
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
    snoozedUntilRef.current = expiresAt;
    if (snoozeTimerRef.current) clearTimeout(snoozeTimerRef.current);
    snoozeTimerRef.current = setTimeout(() => {
      snoozedUntilRef.current = null;
      if (updateStatusRef.current?.state === 'downloaded') {
        setShowUpdateModal(true);
      }
    }, 60 * 60 * 1000);
  }

  // Clean up snooze timer on unmount
  useEffect(() => {
    return () => {
      if (snoozeTimerRef.current) clearTimeout(snoozeTimerRef.current);
    };
  }, []);

  // Listen for Xcode CLT missing notification from main process
  useEffect(() => {
    if (!window.electronAPI?.onXcodeCltMissing) return;
    const unsub = window.electronAPI.onXcodeCltMissing(() => {
      setXcodeBannerVisible(true);
    });
    return () => unsub();
  }, []);

  function handleToggleSidebarFixed() {
    setSidebarFixed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebarFixed', next);
      return next;
    });
  }

  const onDragMouseDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [panelWidth]);

  useEffect(() => {
    function onMouseMove(e) {
      if (!dragging.current) return;
      const delta = dragStartX.current - e.clientX;
      const next = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, dragStartWidth.current + delta));
      setPanelWidth(next);
    }
    function onMouseUp() {
      if (!dragging.current) return;
      dragging.current = false;
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

  function handleLogsViewed(projectId) {
    viewingLogsForRef.current = projectId;
    setErrorCounts((prev) => {
      if (!prev[projectId]) return prev;
      const next = { ...prev, [projectId]: 0 };
      const total = Object.values(next).reduce((a, b) => a + b, 0);
      setBadgeCount(total);
      return next;
    });
  }

  function handleLogsHidden(projectId) {
    if (viewingLogsForRef.current === projectId) {
      viewingLogsForRef.current = null;
    }
  }

  async function handleRemoveProject(id) {
    await removeProject(id);
    if (selectedProject?.id === id) setSelectedProject(null);
    setInitializedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-900">
        <div className="flex items-center gap-3 text-slate-400">
          <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  // Banner: shown for "available" (unless dismissed) and "downloading" states
  // "downloaded" state is handled by the modal; when snoozed it shows a mini badge
  const showAvailableBanner = !updateDismissed && updateStatus?.state === 'available';
  const showDownloadingBanner = updateStatus?.state === 'downloading';
  const showDownloadedBadge = updateStatus?.state === 'downloaded' && !showUpdateModal;
  const showBanner = showAvailableBanner || showDownloadingBanner || showDownloadedBadge;

  const BANNER_STYLE = {
    flexShrink: 0,
    background: 'rgba(109,40,217,0.12)',
    borderBottom: '1px solid rgba(139,92,246,0.25)',
    padding: '5px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 12,
    color: '#c4b5fd',
  };

  return (
    <div className="w-full h-full flex flex-col overflow-hidden" style={{ background: '#07090f', position: 'relative' }}>
      {/* Ambient background glows */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
        <div style={{
          position: 'absolute',
          bottom: '-60px',
          left: '-80px',
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(37,99,235,0.28) 0%, transparent 70%)',
          filter: 'blur(50px)',
        }} />
        <div style={{
          position: 'absolute',
          bottom: '-80px',
          right: '-60px',
          width: 480,
          height: 480,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(139,28,180,0.32) 0%, rgba(190,50,100,0.18) 40%, transparent 70%)',
          filter: 'blur(60px)',
        }} />
      </div>
      {/* Auto-update banner */}
      {showBanner && (
        <div style={BANNER_STYLE}>
          {showAvailableBanner && (
            <>
              <svg style={{ width: 13, height: 13, flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span style={{ flex: 1 }}>Update available: v{updateStatus.version}</span>
              <button
                onClick={() => downloadUpdate()}
                style={{ padding: '2px 10px', background: 'rgba(139,92,246,0.25)', border: '1px solid rgba(139,92,246,0.4)', borderRadius: 4, color: '#ddd6fe', fontSize: 11, cursor: 'pointer' }}
              >
                Download
              </button>
              <button onClick={() => setUpdateDismissed(true)} style={{ padding: '2px 8px', background: 'transparent', border: 'none', color: '#7c3aed', fontSize: 11, cursor: 'pointer' }}>✕</button>
            </>
          )}
          {showDownloadingBanner && (
            <>
              <svg className="animate-spin" style={{ width: 13, height: 13, flexShrink: 0 }} viewBox="0 0 24 24" fill="none">
                <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span style={{ flex: 1 }}>Downloading update… {updateStatus.percent ?? 0}%</span>
              <div style={{ width: 100, height: 4, background: 'rgba(139,92,246,0.2)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${updateStatus.percent ?? 0}%`, height: '100%', background: '#8b5cf6', borderRadius: 2, transition: 'width 300ms' }} />
              </div>
            </>
          )}
          {showDownloadedBadge && (
            <>
              <svg style={{ width: 13, height: 13, flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span style={{ flex: 1 }}>
                v{updateStatus.version} ready to install
              </span>
              <button
                onClick={() => setShowUpdateModal(true)}
                style={{ padding: '2px 10px', background: 'rgba(139,92,246,0.25)', border: '1px solid rgba(139,92,246,0.4)', borderRadius: 4, color: '#ddd6fe', fontSize: 11, cursor: 'pointer' }}
              >
                Install now
              </button>
            </>
          )}
        </div>
      )}

      {/* Xcode CLT warning banner */}
      {xcodeBannerVisible && (
        <div
          style={{
            flexShrink: 0,
            background: '#78350f',
            borderBottom: '1px solid #92400e',
            padding: '7px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 12,
            color: '#fef3c7',
          }}
        >
          <span style={{ flexShrink: 0 }}>⚠</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            Xcode Command Line Tools not found — git, make, and other tools may not work.
            {' '}Install with:
            {' '}
            <code
              style={{
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                background: 'rgba(0,0,0,0.25)',
                borderRadius: 3,
                padding: '1px 6px',
                color: '#fde68a',
              }}
            >
              xcode-select --install
            </code>
          </span>
          <button
            onClick={() => setXcodeBannerVisible(false)}
            style={{
              flexShrink: 0,
              padding: '2px 10px',
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 4,
              color: '#fef3c7',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden" style={{ position: 'relative', zIndex: 1 }}>
        {/* Left pane */}
        <div
          className="flex flex-col overflow-hidden flex-shrink-0"
          style={{
            width: sidebarFixed ? FIXED_SIDEBAR_WIDTH : liveSelected ? `calc(100% - ${panelWidth}px - 5px)` : '100%',
            flexShrink: 0,
            transition: dragging.current ? 'none' : 'width 180ms ease',
            minWidth: liveSelected ? 340 : 0,
          }}
        >
          <ProjectGrid
            projects={projects}
            gitInfo={gitInfo}
            selectedProject={liveSelected}
            onSelect={setSelectedProject}
            onStatusChange={updateProjectStatus}
            onUpdateProject={updateProject}
            onAddProject={() => setShowAddModal(true)}
            onRemove={handleRemoveProject}
            onReorder={reorderProjects}
            onOpenMonitor={() => setShowMonitor(true)}
            onOpenSettings={() => setShowSettings(true)}
            onRebuildInstall={rebuildInstall}
            runningCount={runningCount}
            updateState={updateStatus?.state}
            sidebarFixed={sidebarFixed}
            onToggleSidebarFixed={handleToggleSidebarFixed}
          />
        </div>

        {/* Drag handle */}
        {liveSelected && !sidebarFixed && (
          <div
            onMouseDown={onDragMouseDown}
            style={{
              width: 5,
              flexShrink: 0,
              cursor: 'col-resize',
              background: 'transparent',
              position: 'relative',
              zIndex: 10,
            }}
            className="group"
          >
            {/* Visible dragger line */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 2,
                width: 1,
                background: 'rgba(100,116,139,0.3)',
                transition: 'background 120ms',
              }}
              className="group-hover:!bg-violet-500/70"
            />
            {/* Center dot indicator */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 16,
                height: 40,
                borderRadius: 8,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                opacity: 0,
                transition: 'opacity 120ms',
              }}
              className="group-hover:!opacity-100"
            >
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(139,92,246,0.8)' }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Right pane — detail panels (all initialized panels kept alive, show/hide via CSS) */}
        <div
          className="overflow-hidden border-l border-slate-700/60"
          style={{
            flex: liveSelected ? '1 1 0' : '0 0 354px',
            minWidth: 0,
            position: 'relative',
            transition: dragging.current ? 'none' : 'flex-basis 180ms ease',
          }}
        >
          {[...initializedIds].map((id) => {
            const p = projects.find((proj) => proj.id === id);
            if (!p) return null;
            const isActive = liveSelected?.id === id;
            return (
              <div
                key={id}
                style={{
                  display: isActive ? 'flex' : 'none',
                  flexDirection: 'column',
                  height: '100%',
                  overflow: 'hidden',
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                <DetailPanel
                  project={p}
                  gitInfo={gitInfo[p.id]}
                  onClose={() => setSelectedProject(null)}
                  onRemove={handleRemoveProject}
                  onUpdateProject={updateProject}
                  errorCount={errorCounts[p.id] || 0}
                  onLogsViewed={handleLogsViewed}
                  onLogsHidden={handleLogsHidden}
                  isActive={isActive}
                />
              </div>
            );
          })}
        </div>
      </div>

      {showAddModal && (
        <AddProjectModal
          onAdd={addProject}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {showMonitor && (
        <ProcessMonitor onClose={() => setShowMonitor(false)} />
      )}

      {showUpdateModal && updateStatus?.state === 'downloaded' && (
        <UpdateModal
          version={updateStatus.version}
          onInstall={() => installUpdate()}
          onDismiss={handleSnoozeModal}
        />
      )}

      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
