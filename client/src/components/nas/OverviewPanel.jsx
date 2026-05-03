import React from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import Panel from './Panel';
import { useAutoFetch } from './util';
import { PanelError, SkeletonGrid } from './PanelState';
import { nasApi } from './api';

function Metric({ label, value, tone = 'slate' }) {
  const tones = {
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    blue: 'text-blue-400',
    slate: 'text-white',
  };
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-800/50 p-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${tones[tone] || tones.slate}`}>{value}</div>
    </div>
  );
}

function stateTone(state) {
  if (state === 'active') return 'emerald';
  if (state === 'failed') return 'red';
  if (state === 'inactive' || state === 'unknown') return 'amber';
  return 'slate';
}

export default function OverviewPanel() {
  const { data, loading, error, refresh, lastUpdated } = useAutoFetch(
    () => nasApi.get('/api/nas/overview'),
  );
  const ipLabel = data?.network?.primaryIps?.length ? data.network.primaryIps.join(', ') : '-';
  const diagnostics = data?.diagnostics || data?.backend || {};
  const sourceLabel = data?.source?.kind === 'host-agent'
    ? 'Host NAS agent'
    : data?.source?.kind === 'missing-host-agent'
      ? 'Host NAS agent not connected'
      : data?.source?.backendRunningInDocker
        ? 'Docker backend'
        : 'Direct backend';

  return (
    <Panel
      icon={Gauge}
      title="Overview"
      subtitle={lastUpdated ? `updated ${lastUpdated.toLocaleTimeString()}` : 'loading...'}
      status={error ? 'error' : (data ? (data.errors?.length ? 'warn' : 'ok') : 'idle')}
      loading={loading}
      onRefresh={refresh}
      actions={(
        <button onClick={refresh} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-600">
          <RefreshCw size={14} /> Refresh
        </button>
      )}
    >
      {error && <PanelError error={error} onRetry={refresh} className="mb-3" />}
      {!data && !error && <SkeletonGrid count={8} columns="sm:grid-cols-2 lg:grid-cols-4" />}
      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Data Source" value={sourceLabel} tone={data.source?.kind === 'missing-host-agent' ? 'red' : 'emerald'} />
            <Metric label="Backend Docker" value={String(Boolean(data.source?.backendRunningInDocker ?? diagnostics.backendRunningInDocker))} tone="slate" />
            <Metric label="Samba" value={data.samba?.status || 'unknown'} tone={stateTone(data.samba?.status)} />
            <Metric label="NFS" value={data.nfs?.status || 'unknown'} tone={stateTone(data.nfs?.status)} />
            <Metric label="SMB Shares" value={data.samba?.shares ?? 0} tone="blue" />
            <Metric label="NFS Exports" value={data.nfs?.exports ?? 0} tone="blue" />
            <Metric label="SMB Connections" value={data.samba?.activeConnections ?? 0} />
            <Metric label="NFS Clients" value={data.nfs?.activeClients ?? 0} />
            <Metric label="Mounted Drives" value={`${data.drives?.mounted ?? 0}/${data.drives?.total ?? 0}`} />
            <Metric label={data.network?.hostname || 'Host'} value={ipLabel} />
          </div>
          {data.source?.kind === 'missing-host-agent' && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              Host NAS agent not connected. The Docker backend is suppressing container NAS probes so the dashboard does not show misleading container data.
            </div>
          )}
          {data.errors?.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
              Some NAS probes failed. Other panels remain usable.
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
