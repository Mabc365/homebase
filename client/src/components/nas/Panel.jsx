import React, { useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';

// Collapsible card with a header, status dot, and optional action slot.
// Matches the existing slate-900/border-slate-800/rounded-xl style used elsewhere.
export default function Panel({
  icon: Icon,
  title,
  subtitle,
  status, // 'ok' | 'warn' | 'error' | 'idle'
  loading,
  onRefresh,
  actions,
  defaultOpen = true,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const dotColor = {
    ok: 'bg-emerald-500',
    warn: 'bg-amber-500',
    error: 'bg-red-500',
    idle: 'bg-slate-600',
  }[status || 'idle'];

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-800">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-3 min-w-0 text-left flex-1"
        >
          <span className="text-slate-500">
            {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </span>
          {Icon && (
            <span className="p-2 rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
              <Icon size={18} />
            </span>
          )}
          <span className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-semibold text-white truncate">{title}</h2>
              <span className={`w-2 h-2 rounded-full ${dotColor}`} />
            </div>
            {subtitle && (
              <p className="text-xs font-mono text-slate-500 truncate mt-0.5">{subtitle}</p>
            )}
          </span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {actions}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-50"
              aria-label="Refresh"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          )}
        </div>
      </header>
      {open && <div className="p-4 sm:p-6">{children}</div>}
    </section>
  );
}
