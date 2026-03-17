import React from 'react';

export default function UpdateModal({ version, onInstall, onDismiss }) {
  return (
    <>
      <style>{`
        @keyframes updateModalIn {
          from { opacity: 0; transform: scale(0.96) translateY(-6px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);    }
        }
        .update-modal-anim {
          animation: updateModalIn 180ms ease-out forwards;
        }
      `}</style>

      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
        onClick={onDismiss}
      >
        {/* Card */}
        <div
          className="update-modal-anim bg-[#0d1626] border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden"
          style={{ width: 380 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Body */}
          <div className="px-6 pt-6 pb-5">
            {/* Icon + title */}
            <div className="flex items-start gap-3.5 mb-4">
              <div className="w-9 h-9 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-4.5 h-4.5 text-violet-400" style={{ width: 18, height: 18 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-100 leading-snug">
                  Dev Dashboard {version} is ready
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  New version downloaded and ready to install
                </p>
              </div>
            </div>

            {/* Description */}
            <div className="pl-[52px]">
              <p className="text-xs text-slate-400 leading-relaxed">
                The app will restart automatically after the update. Your projects and settings will be preserved.
              </p>
              <p className="text-[11px] text-slate-600 mt-2 leading-relaxed">
                If you dismiss, you'll be reminded again in 1 hour.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-slate-700/50 px-6 py-3.5 flex items-center justify-end gap-2.5 bg-slate-900/30">
            <button
              onClick={onDismiss}
              className="px-3.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-700/60 transition-colors"
            >
              Maybe later
            </button>
            <button
              onClick={onInstall}
              className="px-4 py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors flex items-center gap-1.5"
            >
              <svg style={{ width: 12, height: 12, flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              Restart &amp; Update
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
