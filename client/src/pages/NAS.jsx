import React from 'react';
import { HardDrive, PlugZap, Plug } from 'lucide-react';
import SharesPanel from '../components/nas/SharesPanel';
import ExportsPanel from '../components/nas/ExportsPanel';
import ConnectionsPanel from '../components/nas/ConnectionsPanel';
import UsersPanel from '../components/nas/UsersPanel';
import ServicesPanel from '../components/nas/ServicesPanel';
import DrivesPanel from '../components/nas/DrivesPanel';
import NetworkPanel from '../components/nas/NetworkPanel';
import OverviewPanel from '../components/nas/OverviewPanel';
import NasErrorBoundary from '../components/nas/NasErrorBoundary';
import { useAutoFetch } from '../components/nas/util';
import { nasApi } from '../components/nas/api';

const panels = [
  ['Overview', OverviewPanel],
  ['Services', ServicesPanel],
  ['Network', NetworkPanel],
  ['Samba Shares', SharesPanel],
  ['NFS Exports', ExportsPanel],
  ['Active Connections', ConnectionsPanel],
  ['Samba Users', UsersPanel],
  ['Drives & Mounts', DrivesPanel],
];

// Health response shape from the proxy:
//   - reachable agent: { source: { kind: 'host-agent', ... }, backend: { nasAgentReachable: true } }
//   - missing agent : { backendRunningInDocker: true, nasAgentReachable: false, ... }
//   - direct backend: { source: { kind: 'direct-backend', ... } }
function deriveAgentState(health) {
  if (!health) return { status: 'loading', label: 'Checking host agent…' };
  const reachable = health?.backend?.nasAgentReachable ?? health?.nasAgentReachable;
  const inDocker = health?.source?.backendRunningInDocker ?? health?.backendRunningInDocker;
  if (reachable === true) return { status: 'ok', label: 'Host agent connected' };
  if (reachable === false) return { status: 'offline', label: 'Host agent offline' };
  if (inDocker === false) return { status: 'direct', label: 'Backend on host (no agent needed)' };
  return { status: 'unknown', label: 'Host agent status unknown' };
}

function AgentPill({ state }) {
  const tone = {
    ok:      'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    offline: 'bg-amber-500/10 text-amber-200 border-amber-500/40',
    direct:  'bg-slate-700 text-slate-200 border-slate-600',
    loading: 'bg-slate-700 text-slate-300 border-slate-600',
    unknown: 'bg-slate-700 text-slate-300 border-slate-600',
  }[state.status] || 'bg-slate-700 text-slate-300 border-slate-600';
  const Icon = state.status === 'offline' ? PlugZap : Plug;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider ${tone}`}>
      <Icon size={12} />
      {state.label}
    </span>
  );
}

export default function NAS() {
  const health = useAutoFetch(() => nasApi.get('/api/nas/health'), { intervalMs: 30000 });
  const nasReadOnly = Boolean(health.data?.source?.readOnly);
  const agentState = deriveAgentState(health.data);

  return (
    <div className="space-y-4 sm:space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
            <HardDrive size={22} />
          </span>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">NAS</h1>
            <p className="text-xs font-mono text-slate-500">samba · nfs · mounts · services — auto-refresh every 30s</p>
          </div>
        </div>
        <AgentPill state={agentState} />
      </div>

      {panels.map(([title, Component]) => (
        <NasErrorBoundary key={title} title={title}>
          <Component
            nasHealth={health.data}
            nasReadOnly={nasReadOnly}
            panelLabel={title}
            agentOffline={agentState.status === 'offline'}
          />
        </NasErrorBoundary>
      ))}
    </div>
  );
}
