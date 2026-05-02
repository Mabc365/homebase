import React from 'react';
import axios from 'axios';
import { Network } from 'lucide-react';
import Panel from './Panel';
import { useAutoFetch } from './util';
import { PanelError, SkeletonGrid } from './PanelState';

export default function NetworkPanel() {
  const { data, loading, refresh, error, lastUpdated } = useAutoFetch(
    () => axios.get('/api/nas/network').then((r) => r.data),
  );
  const interfaces = Array.isArray(data?.interfaces) ? data.interfaces : [];
  const visibleInterfaces = interfaces.filter((i) => !i.internal);
  const hostLabel = data?.hostname
    ? `${data.hostname}${data.fqdn && data.fqdn !== data.hostname ? ` · ${data.fqdn}` : ''}`
    : 'loading...';

  return (
    <Panel
      icon={Network}
      title="Network"
      subtitle={hostLabel}
      status={error ? 'error' : (data ? 'ok' : 'idle')}
      loading={loading}
      onRefresh={refresh}
    >
      {error && <PanelError error={error} onRetry={refresh} className="mb-3" />}
      {!data && !error && <SkeletonGrid count={3} columns="md:grid-cols-2 lg:grid-cols-3" />}
      {data && (
        <>
          <div className="text-[11px] font-mono text-slate-500 mb-3">
            updated {lastUpdated ? lastUpdated.toLocaleTimeString() : '-'}
          </div>
          {visibleInterfaces.length === 0 && <p className="text-sm text-slate-500">No external interfaces reported.</p>}
          {visibleInterfaces.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {visibleInterfaces.map((i, index) => (
                <div key={i.iface || i.mac || index} className="bg-slate-800/50 border border-slate-800 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm text-white">{i.iface || 'unknown'}</span>
                    <span className={`w-2 h-2 rounded-full ${i.operstate === 'up' ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                  </div>
                  <div className="space-y-1 text-[11px] font-mono text-slate-400">
                    {i.ip4 && <div><span className="text-slate-500">ip4 </span>{i.ip4}</div>}
                    {i.ip6 && <div className="truncate"><span className="text-slate-500">ip6 </span>{i.ip6}</div>}
                    <div><span className="text-slate-500">mac </span>{i.mac || '-'}</div>
                    <div><span className="text-slate-500">type </span>{i.type || '-'}{i.speed ? ` · ${i.speed}Mb/s` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
