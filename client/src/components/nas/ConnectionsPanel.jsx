import React, { useState } from 'react';
import { Activity, X } from 'lucide-react';
import Panel from './Panel';
import ConfirmDialog from './ConfirmDialog';
import { useAutoFetch, timeAgo, withToast } from './util';
import { PanelError, SkeletonRows } from './PanelState';
import { nasApi } from './api';

function Tabs({ value, onChange, items }) {
  return (
    <div className="flex border-b border-slate-800 mb-4">
      {items.map((item) => (
        <button
          key={item.value} onClick={() => onChange(item.value)}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${value === item.value ? 'border-blue-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Table({ columns, rows, empty }) {
  if (!rows || rows.length === 0) return <p className="text-sm text-slate-500 py-4">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-slate-500 border-b border-slate-800">
            {columns.map((c) => <th key={c.key} className="py-2 pr-3 font-medium">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.key || i} className="border-b border-slate-800/60 last:border-0">
              {columns.map((c) => (
                <td key={c.key} className="py-2 pr-3 text-slate-200">{c.render ? c.render(row) : row[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ConnectionsPanel({ nasReadOnly = false }) {
  const [tab, setTab] = useState('samba');
  const samba = useAutoFetch(() => nasApi.get('/api/nas/samba/connections'));
  const nfs = useAutoFetch(() => nasApi.get('/api/nas/nfs/connections'));
  const [confirm, setConfirm] = useState(null);

  const refresh = () => { samba.refresh(); nfs.refresh(); };
  const lastUpdated = [samba.lastUpdated, nfs.lastUpdated].filter(Boolean).sort((a, b) => b - a)[0];
  const error = samba.error || nfs.error;
  const sambaConnections = Array.isArray(samba.data) ? samba.data : [];
  const nfsConnections = Array.isArray(nfs.data) ? nfs.data : [];

  const requestDisconnect = (conn) => setConfirm({
    title: `Disconnect ${conn.user || conn.host}?`,
    message: `This sends SIGTERM to smbd PID ${conn.pid}. The client will see a dropped connection.`,
    onConfirm: async () => {
      await withToast(nasApi.post(`/api/nas/samba/connections/${conn.pid}/disconnect`).then(samba.refresh), {
        loading: 'Disconnecting…', success: 'Disconnected', error: 'Failed',
      });
      setConfirm(null);
    },
  });

  const sambaColumns = [
    { key: 'user', label: 'User' },
    { key: 'host', label: 'Host' },
    { key: 'ip', label: 'IP' },
    { key: 'shares', label: 'Shares', render: (r) => (Array.isArray(r.shares) ? r.shares.join(', ') : '') || '—' },
    { key: 'connected', label: 'Connected', render: (r) => timeAgo(r.connectedAt) },
    { key: 'openFiles', label: 'Open Files' },
    {
      key: 'action', label: '',
      render: (r) => (
        <button disabled={nasReadOnly} onClick={() => requestDisconnect(r)} className="p-1.5 rounded hover:bg-red-500/10 text-red-400 disabled:text-slate-600 disabled:hover:bg-transparent" title={nasReadOnly ? 'Read-only mode' : 'Disconnect'}>
          <X size={14} />
        </button>
      ),
    },
  ];

  const nfsColumns = [
    { key: 'host', label: 'Client' },
    { key: 'exportPath', label: 'Export' },
    { key: 'status', label: 'Status' },
  ];

  return (
    <Panel
      icon={Activity}
      title="Active Connections"
      subtitle={lastUpdated ? `updated ${lastUpdated.toLocaleTimeString()}` : 'loading…'}
      status={error ? 'error' : (samba.data || nfs.data ? 'ok' : 'idle')}
      loading={samba.loading || nfs.loading}
      onRefresh={refresh}
    >
      <Tabs
        value={tab} onChange={setTab}
        items={[
          { value: 'samba', label: `Samba (${samba.data?.length || 0})` },
          { value: 'nfs', label: `NFS (${nfs.data?.length || 0})` },
        ]}
      />
      {error && <PanelError error={error} onRetry={refresh} className="mb-3" />}
      {tab === 'samba' && !samba.data && !samba.error && <SkeletonRows count={4} />}
      {tab === 'samba' && (samba.data || samba.error) && (
        <Table
          columns={sambaColumns}
          rows={sambaConnections.map((s) => ({ ...s, key: s.pid }))}
          empty="No active Samba connections."
        />
      )}
      {tab === 'nfs' && !nfs.data && !nfs.error && <SkeletonRows count={3} />}
      {tab === 'nfs' && (nfs.data || nfs.error) && (
        <Table
          columns={nfsColumns}
          rows={nfsConnections.map((c, i) => ({ ...c, key: `${c.host}-${c.export}-${i}` }))}
          empty="No active NFS clients."
        />
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel="Disconnect"
        onConfirm={confirm?.onConfirm}
        onCancel={() => setConfirm(null)}
      />
    </Panel>
  );
}
