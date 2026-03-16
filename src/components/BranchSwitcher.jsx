import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getBranches, checkoutBranch } from '../ipc';

// Git branch icon
function GitBranchIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
    </svg>
  );
}

function ChevronDownIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
    </svg>
  );
}

function CheckIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
    </svg>
  );
}

function SpinnerIcon({ className }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export default function BranchSwitcher({ projectPath, currentBranch, onBranchChange }) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(null); // branch name being checked out

  const wrapperRef = useRef(null);
  const filterInputRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;

    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        setFilter('');
      }
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Fetch branches when opened
  const handleOpen = useCallback(async () => {
    if (open) {
      setOpen(false);
      setFilter('');
      return;
    }

    setOpen(true);
    setLoading(true);
    setFilter('');
    setBranches([]);

    try {
      const result = await getBranches(projectPath);
      setBranches(result.branches || []);
    } catch {
      setBranches([]);
    } finally {
      setLoading(false);
    }
  }, [open, projectPath]);

  // Focus filter input when dropdown opens
  useEffect(() => {
    if (open && filterInputRef.current) {
      setTimeout(() => filterInputRef.current && filterInputRef.current.focus(), 50);
    }
  }, [open]);

  const handleCheckout = useCallback(async (branchName) => {
    if (branchName === currentBranch || switching) return;

    setSwitching(branchName);
    try {
      const result = await checkoutBranch(projectPath, branchName);
      if (result.success) {
        setOpen(false);
        setFilter('');
        if (onBranchChange) onBranchChange();
      } else {
        console.error('Checkout failed:', result.error);
      }
    } catch (err) {
      console.error('Checkout error:', err);
    } finally {
      setSwitching(null);
    }
  }, [currentBranch, switching, projectPath, onBranchChange]);

  // Filter branches
  const lowerFilter = filter.toLowerCase().trim();
  const filteredBranches = lowerFilter
    ? branches.filter((b) => b.name.toLowerCase().includes(lowerFilter))
    : branches;

  // Split into recent (first 6 non-current by date) and other
  const nonCurrent = filteredBranches.filter((b) => !b.isCurrent);
  const recentBranches = nonCurrent.slice(0, 6);
  const otherBranches = nonCurrent.slice(6);
  const currentBranchEntry = filteredBranches.find((b) => b.isCurrent);

  if (!currentBranch) {
    return null;
  }

  return (
    <div ref={wrapperRef} className="relative flex-shrink-0">
      {/* Trigger pill button */}
      <button
        onClick={handleOpen}
        className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 hover:border-slate-600/60 transition-colors text-slate-300 hover:text-slate-100 max-w-[180px]"
        title={currentBranch}
      >
        <GitBranchIcon className="w-3 h-3 text-slate-500 flex-shrink-0" />
        <span className="font-mono text-xs truncate">{currentBranch}</span>
        <ChevronDownIcon className={`w-3 h-3 text-slate-500 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-72 bg-[#1a2540] border border-slate-700/70 rounded-xl shadow-2xl overflow-hidden">
          {/* Filter input */}
          <div className="px-3 pt-3 pb-2">
            <input
              ref={filterInputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter branches…"
              className="w-full bg-slate-800/80 border border-slate-700/60 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/30 transition-colors"
            />
          </div>

          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6 text-slate-500">
                <SpinnerIcon className="w-4 h-4 mr-2" />
                <span className="text-xs">Loading branches…</span>
              </div>
            ) : (
              <>
                {/* Current branch always shown at top (unless filtered out) */}
                {currentBranchEntry && (
                  <div className="px-2 pb-1">
                    <div className="px-2 py-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Current</span>
                    </div>
                    <BranchRow
                      branch={currentBranchEntry}
                      isCurrent
                      switching={switching}
                      onCheckout={handleCheckout}
                    />
                  </div>
                )}

                {/* Recent branches */}
                {recentBranches.length > 0 && (
                  <div className="px-2 pb-1">
                    <div className="px-2 py-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Recent Branches</span>
                    </div>
                    {recentBranches.map((b) => (
                      <BranchRow
                        key={b.name}
                        branch={b}
                        isCurrent={false}
                        switching={switching}
                        onCheckout={handleCheckout}
                      />
                    ))}
                  </div>
                )}

                {/* Other branches */}
                {otherBranches.length > 0 && (
                  <div className="px-2 pb-2">
                    <div className="px-2 py-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Other Branches</span>
                    </div>
                    {otherBranches.map((b) => (
                      <BranchRow
                        key={b.name}
                        branch={b}
                        isCurrent={false}
                        switching={switching}
                        onCheckout={handleCheckout}
                      />
                    ))}
                  </div>
                )}

                {/* Empty state */}
                {filteredBranches.length === 0 && (
                  <div className="py-6 text-center text-xs text-slate-500">
                    {filter ? 'No branches match your filter' : 'No branches found'}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function BranchRow({ branch, isCurrent, switching, onCheckout }) {
  const isBeingSwitched = switching === branch.name;

  return (
    <button
      onClick={() => onCheckout(branch.name)}
      disabled={isCurrent || !!switching}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors group
        ${isCurrent
          ? 'text-violet-300 cursor-default'
          : switching
          ? 'text-slate-500 cursor-not-allowed'
          : 'text-slate-300 hover:bg-slate-700/60 hover:text-slate-100 cursor-pointer'
        }`}
    >
      {/* Check / spinner */}
      <span className="w-3.5 flex-shrink-0 flex items-center justify-center">
        {isCurrent ? (
          <CheckIcon className="w-3.5 h-3.5 text-violet-400" />
        ) : isBeingSwitched ? (
          <SpinnerIcon className="w-3.5 h-3.5 text-violet-400" />
        ) : null}
      </span>

      {/* Branch name */}
      <span className="flex-1 min-w-0 font-mono text-xs truncate">{branch.name}</span>

      {/* Relative date */}
      {branch.date && (
        <span className="text-[10px] text-slate-600 flex-shrink-0 group-hover:text-slate-500 transition-colors">
          {branch.date}
        </span>
      )}
    </button>
  );
}
