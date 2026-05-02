import React from 'react';
import { RefreshCw } from 'lucide-react';
import { getErrorMessage } from './util';

export function PanelError({ error, onRetry, className = '' }) {
  return (
    <div className={`flex flex-col gap-3 rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-200 sm:flex-row sm:items-center sm:justify-between ${className}`}>
      <span className="min-w-0 break-words">{getErrorMessage(error)}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-100 hover:bg-red-500/20"
        >
          <RefreshCw size={14} />
          Retry
        </button>
      )}
    </div>
  );
}

export function SkeletonGrid({ count = 3, columns = 'md:grid-cols-3' }) {
  return (
    <div className={`grid grid-cols-1 gap-3 ${columns}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-slate-800 bg-slate-800/40 p-4">
          <div className="mb-3 h-4 w-1/2 animate-pulse rounded bg-slate-700" />
          <div className="space-y-2">
            <div className="h-3 w-full animate-pulse rounded bg-slate-800" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-slate-800" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-slate-800" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonRows({ count = 4 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded bg-slate-800/60" />
      ))}
    </div>
  );
}
