import React from 'react';
import { PlugZap, RefreshCw } from 'lucide-react';
import { getErrorMessage, isAgentOfflineError } from './util';

export function PanelError({ error, onRetry, className = '', panelLabel }) {
  if (isAgentOfflineError(error)) {
    return <AgentOfflineNotice onRetry={onRetry} className={className} panelLabel={panelLabel} />;
  }
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

// Shown in place of a panel's body when the Docker backend can't reach the host
// NAS agent. Each panel labels itself so the user knows what's missing without
// the rest of the dashboard going blank.
export function AgentOfflineNotice({ onRetry, className = '', panelLabel }) {
  const what = panelLabel ? `${panelLabel} data` : 'NAS data';
  return (
    <div className={`flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100 sm:flex-row sm:items-start sm:justify-between ${className}`}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="shrink-0 rounded-lg bg-amber-500/10 p-1.5 text-amber-300">
          <PlugZap size={16} />
        </span>
        <div className="min-w-0 space-y-1">
          <div className="font-medium text-amber-50">Host agent offline</div>
          <p className="text-xs text-amber-200/80 break-words">
            {what} comes from the Homebase NAS host agent. Run{' '}
            <code className="font-mono text-amber-100">sudo systemctl status homebase-nas-agent</code>{' '}
            on the host, or run <code className="font-mono text-amber-100">deploy/setup-nas-agent.sh</code>{' '}
            to install it. Other dashboard panels keep working.
          </p>
        </div>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-500/20"
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
