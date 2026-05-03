import React, { useState } from 'react';
import { Server, Play, Square, RotateCw } from 'lucide-react';
import Panel from './Panel';
import ConfirmDialog from './ConfirmDialog';
import { useAutoFetch, formatUptime, withToast } from './util';
import { PanelError, SkeletonGrid } from './PanelState';
import { nasApi } from './api';

const STATE_COLORS = {
  active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  inactive: 'bg-slate-700 text-slate-400 border-slate-600',
  failed: 'bg-red-500/10 text-red-400 border-red-500/30',
  activating: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  deactivating: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
};

export default function ServicesPanel({ nasReadOnly = false, panelLabel = 'Services' }) {
  const { data, loading, refresh, error, lastUpdated } = useAutoFetch(
    () => nasApi.get('/api/nas/services'),
  );
  const services = Array.isArray(data) ? data : [];
  const [confirm, setConfirm] = useState(null);

  const action = async (svc, act) => {
    await withToast(
      nasApi.post(`/api/nas/services/${svc.name}/${act}`).then(refresh),
      { loading: `${act} ${svc.name}…`, success: `${svc.name} ${act}ed`, error: `${act} failed` },
    );
  };

  const guardedAction = (svc, act) => {
    if (act === 'start') return action(svc, act);
    setConfirm({
      title: `${act === 'stop' ? 'Stop' : 'Restart'} ${svc.name}?`,
      message: act === 'stop'
        ? 'Clients may lose access while this service is stopped.'
        : 'Active clients may briefly lose access while the service restarts.',
      confirmLabel: act === 'stop' ? 'Stop' : 'Restart',
      onConfirm: async () => {
        await action(svc, act);
        setConfirm(null);
      },
    });
    return null;
  };

  const overall = data && services.every((s) => s.activeState === 'active') ? 'ok'
    : data && services.some((s) => s.activeState === 'failed') ? 'error'
    : data ? 'warn' : 'idle';

  return (
    <Panel
      icon={Server}
      title="Services"
      subtitle={lastUpdated ? `updated ${lastUpdated.toLocaleTimeString()}` : 'loading…'}
      status={error ? 'error' : overall}
      loading={loading}
      onRefresh={refresh}
    >
      {error && <PanelError error={error} onRetry={refresh} className="mb-3" panelLabel={panelLabel} />}
      {!data && !error && <SkeletonGrid count={3} columns="md:grid-cols-3" />}
      {data && services.length === 0 && <p className="text-sm text-slate-500">No NAS services reported.</p>}
      {services.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {services.map((s) => (
          <article key={s.name} className="bg-slate-800/50 border border-slate-800 rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-white font-mono text-sm truncate">{s.name}</h3>
                <p className="text-[11px] text-slate-500 truncate">{s.description}</p>
              </div>
              <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${STATE_COLORS[s.activeState] || STATE_COLORS.inactive}`}>
                {s.activeState}
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-500">
              {s.subState && <span>{s.subState}</span>}
              {s.uptimeSec != null && <span> · up {formatUptime(s.uptimeSec)}</span>}
              {s.error && <span className="text-red-400"> · {s.error}</span>}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => guardedAction(s, 'start')} disabled={nasReadOnly || s.activeState === 'active'} title={nasReadOnly ? 'Host agent is running in read-only mode.' : 'Start'} className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs bg-slate-800 hover:bg-emerald-500/10 hover:text-emerald-400 text-slate-300 disabled:opacity-40">
                <Play size={12} /> Start
              </button>
              <button onClick={() => guardedAction(s, 'stop')} disabled={nasReadOnly || s.activeState !== 'active'} title={nasReadOnly ? 'Host agent is running in read-only mode.' : 'Stop'} className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs bg-slate-800 hover:bg-red-500/10 hover:text-red-400 text-slate-300 disabled:opacity-40">
                <Square size={12} /> Stop
              </button>
              <button onClick={() => guardedAction(s, 'restart')} disabled={nasReadOnly} title={nasReadOnly ? 'Host agent is running in read-only mode.' : 'Restart'} className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs bg-slate-800 hover:bg-blue-500/10 hover:text-blue-400 text-slate-300 disabled:opacity-40">
                <RotateCw size={12} /> Restart
              </button>
            </div>
          </article>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        onConfirm={confirm?.onConfirm}
        onCancel={() => setConfirm(null)}
      />
    </Panel>
  );
}
