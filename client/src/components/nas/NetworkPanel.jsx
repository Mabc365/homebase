import React from 'react';
import axios from 'axios';
import { Network } from 'lucide-react';
import Panel from './Panel';
import { useAutoFetch } from './util';

export default function NetworkPanel() {
  const { data, loading, refresh, error, lastUpdated } = useAutoFetch(
    () => axios.get('/api/nas/network').then((r) => r.data),
  );

  return (
    <Panel
      icon={Network}
      title="Network"
      subtitle={data ? `${data.hostname}${data.fqdn && data.fqdn !== data.hostname ? ` · ${data.fqdn}` : ''}` : 'loading…'}
      status={error ? 'error' : (data ? 'ok' : 'idle')}
      loading={loading}
      onRefresh={refresh}
    >
      {error && <div className="bg-red-500/10 border border-red-500/50 text-red-300 text-sm p-3 rounded-lg mb-3">{error.message}</div>}
      {data && (
        <>
          <div className="text-[11px] font-mono text-slate-500 mb-3">
            updated {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.interfaces.filter((i) => !i.internal).map((i) => (
              <div key={i.iface} className="bg-slate-800/50 border border-slate-800 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-sm text-white">{i.iface}</span>
                  <span className={`w-2 h-2 rounded-full ${i.operstate === 'up' ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                </div>
                <div className="space-y-1 text-[11px] font-mono text-slate-400">
                  {i.ip4 && <div><span className="text-slate-500">ip4 </span>{i.ip4}</div>}
                  {i.ip6 && <div className="truncate"><span className="text-slate-500">ip6 </span>{i.ip6}</div>}
                  <div><span className="text-slate-500">mac </span>{i.mac}</div>
                  <div><span className="text-slate-500">type </span>{i.type}{i.speed ? ` · ${i.speed}Mb/s` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
