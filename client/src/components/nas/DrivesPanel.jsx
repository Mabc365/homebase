import React, { useState } from 'react';
import axios from 'axios';
import { HardDrive, Unplug, Plus } from 'lucide-react';
import Panel from './Panel';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import { useAutoFetch, formatBytes, withToast } from './util';

function MountForm({ initial, onSubmit, onCancel }) {
  const [device, setDevice] = useState(initial?.device || '');
  const [mountpoint, setMountpoint] = useState('');
  const [fstype, setFstype] = useState(initial?.fstype || '');
  const [options, setOptions] = useState('defaults');
  const [submitting, setSubmitting] = useState(false);
  const handle = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try { await onSubmit({ device, mountpoint, fstype, options }); } finally { setSubmitting(false); }
  };
  return (
    <form onSubmit={handle} className="space-y-4">
      <div>
        <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Device</label>
        <input
          type="text" value={device} required onChange={(e) => setDevice(e.target.value)}
          className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
        />
      </div>
      <div>
        <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Mountpoint</label>
        <input
          type="text" value={mountpoint} required placeholder="/mnt/data"
          onChange={(e) => setMountpoint(e.target.value)}
          className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Filesystem</label>
          <input
            type="text" value={fstype} placeholder="auto"
            onChange={(e) => setFstype(e.target.value)}
            className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Options</label>
          <input
            type="text" value={options} onChange={(e) => setOptions(e.target.value)}
            className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
        <button type="submit" disabled={submitting} className="px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
          {submitting ? 'Mounting…' : 'Mount'}
        </button>
      </div>
    </form>
  );
}

function UsageBar({ usage }) {
  if (!usage) return <div className="h-2 bg-slate-800 rounded" />;
  const pct = Math.min(100, Number(usage.usePercent) || 0);
  const color = pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div>
      <div className="h-2 bg-slate-800 rounded overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[11px] font-mono text-slate-500 mt-1">
        <span>{formatBytes(usage.usedBytes)} used</span>
        <span>{pct.toFixed(0)}%</span>
        <span>{formatBytes(usage.sizeBytes)} total</span>
      </div>
    </div>
  );
}

export default function DrivesPanel() {
  const { data, loading, refresh, error, lastUpdated } = useAutoFetch(
    () => axios.get('/api/nas/mounts').then((r) => r.data),
  );
  const [mounting, setMounting] = useState(null);
  const [confirm, setConfirm] = useState(null);

  // Show only partitions and disks that have a filesystem (skip loop devices etc.)
  const drives = (data || []).filter((d) => (d.type === 'part' || d.type === 'disk') && d.fstype);

  const handleMount = async (form) => {
    await withToast(axios.post('/api/nas/mounts/mount', form).then(refresh), {
      loading: 'Mounting…', success: 'Mounted', error: 'Failed',
    });
    setMounting(null);
  };

  const requestUnmount = (drive) => setConfirm({
    title: `Unmount ${drive.mountpoint}?`,
    message: `This unmounts ${drive.device} from ${drive.mountpoint}. Active writes may be interrupted.`,
    onConfirm: async () => {
      await withToast(axios.post('/api/nas/mounts/unmount', { target: drive.mountpoint }).then(refresh), {
        loading: 'Unmounting…', success: 'Unmounted', error: 'Failed',
      });
      setConfirm(null);
    },
  });

  return (
    <Panel
      icon={HardDrive}
      title="Drives & Mounts"
      subtitle={lastUpdated ? `updated ${lastUpdated.toLocaleTimeString()}` : 'loading…'}
      status={error ? 'error' : (data ? 'ok' : 'idle')}
      loading={loading}
      onRefresh={refresh}
      actions={(
        <button onClick={() => setMounting({})} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white">
          <Plus size={14} /> Mount
        </button>
      )}
    >
      {error && <div className="bg-red-500/10 border border-red-500/50 text-red-300 text-sm p-3 rounded-lg mb-3">{error.message}</div>}
      {!data && !error && <p className="text-sm text-slate-500">Loading…</p>}
      {drives.length === 0 && data && <p className="text-sm text-slate-500">No filesystems detected.</p>}
      {drives.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {drives.map((d) => (
            <article key={d.device} className="bg-slate-800/50 border border-slate-800 rounded-lg p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-white font-mono text-sm truncate">{d.device}</h3>
                  <p className="text-[11px] text-slate-500 truncate">
                    {d.fstype}{d.label ? ` · ${d.label}` : ''}{d.mountpoint ? ` · ${d.mountpoint}` : ' · not mounted'}
                  </p>
                </div>
                <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-slate-700 text-slate-300">
                  {formatBytes(d.size)}
                </span>
              </div>
              <UsageBar usage={d.usage} />
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-slate-500 truncate">
                  {d.uuid ? `uuid ${d.uuid.slice(0, 8)}…` : ''}
                </span>
                {d.mountpoint && (
                  <button onClick={() => requestUnmount(d)} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-red-500/10 text-red-400">
                    <Unplug size={12} /> Unmount
                  </button>
                )}
                {!d.mountpoint && (
                  <button onClick={() => setMounting({ device: d.device, fstype: d.fstype })} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-blue-500/10 text-blue-400">
                    <Plus size={12} /> Mount
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal open={Boolean(mounting)} onClose={() => setMounting(null)} title="Mount filesystem">
        {mounting && <MountForm initial={mounting} onSubmit={handleMount} onCancel={() => setMounting(null)} />}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel="Unmount"
        onConfirm={confirm?.onConfirm}
        onCancel={() => setConfirm(null)}
      />
    </Panel>
  );
}
