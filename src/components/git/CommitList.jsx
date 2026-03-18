import React, { useState, useEffect, useRef, useCallback } from 'react';
import CommitRow from './CommitRow';
import { gitGetLog } from '../../ipc';

const ROW_HEIGHT = 52;
const OVERSCAN = 5;

export default function CommitList({ projectId, selectedHash, onSelect, active }) {
  const [commits, setCommits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isRepo, setIsRepo] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerH, setContainerH] = useState(400);
  const containerRef = useRef(null);
  const loadingMore = useRef(false);

  const load = useCallback(async (skip = 0) => {
    setLoading(true);
    try {
      const result = await gitGetLog(projectId, 100, skip);
      if (!result.isRepo) { setIsRepo(false); setLoading(false); return; }
      setIsRepo(true);
      setCommits(prev => skip === 0 ? result.commits : [...prev, ...result.commits]);
      setHasMore(result.commits.length === 100);
    } catch {}
    setLoading(false);
    loadingMore.current = false;
  }, [projectId]);

  useEffect(() => {
    setCommits([]);
    setHasMore(true);
    setIsRepo(true);
    load(0);
  }, [projectId, load]);

  // Refresh when tab becomes active (e.g. after a new commit)
  const prevActive = useRef(false);
  useEffect(() => {
    if (active && !prevActive.current) {
      load(0);
    }
    prevActive.current = active;
  }, [active, load]);

  // Poll for new commits every 10s while tab is active
  const latestHashRef = useRef(null);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      try {
        const result = await gitGetLog(projectId, 1, 0);
        if (!result.isRepo || !result.commits?.length) return;
        const latest = result.commits[0].hash;
        if (latestHashRef.current && latestHashRef.current !== latest) {
          load(0);
        }
        latestHashRef.current = latest;
      } catch {}
    }, 10000);
    return () => clearInterval(t);
  }, [active, projectId, load]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerH(el.clientHeight));
    ro.observe(el);
    const onScroll = () => {
      setScrollTop(el.scrollTop);
      if (!loadingMore.current && hasMore && !loading &&
          el.scrollTop + el.clientHeight > el.scrollHeight - 200) {
        loadingMore.current = true;
        load(commits.length);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', onScroll); };
  }, [commits.length, hasMore, loading, load]);

  if (!isRepo) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 text-center text-xs text-slate-500">
        Not a git repository
      </div>
    );
  }

  if (loading && commits.length === 0) {
    return (
      <div className="flex-1 p-3 space-y-2">
        {[...Array(7)].map((_, i) => (
          <div key={i} className="h-10 bg-slate-800/60 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (!loading && commits.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 text-center text-xs text-slate-500">
        No commits yet
      </div>
    );
  }

  const totalHeight = commits.length * ROW_HEIGHT + (hasMore ? ROW_HEIGHT : 0);
  const visStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visEnd = Math.min(commits.length, Math.ceil((scrollTop + containerH) / ROW_HEIGHT) + OVERSCAN);
  const visible = commits.slice(visStart, visEnd);

  return (
    <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto" style={{ position: 'relative' }}>
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visible.map((commit, i) => (
          <div
            key={commit.hash}
            style={{ position: 'absolute', top: (visStart + i) * ROW_HEIGHT, width: '100%', height: ROW_HEIGHT }}
          >
            <CommitRow
              commit={commit}
              selected={commit.hash === selectedHash}
              onClick={() => onSelect(commit)}
            />
          </div>
        ))}
        {hasMore && (
          <div
            style={{ position: 'absolute', top: commits.length * ROW_HEIGHT, width: '100%', height: ROW_HEIGHT }}
            className="flex items-center justify-center"
          >
            <span className="text-xs text-slate-600 animate-pulse">
              {loading ? 'Loading more…' : 'Scroll for more'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
