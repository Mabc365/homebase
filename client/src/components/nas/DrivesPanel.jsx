import React, { useState } from 'react';
import { HardDrive, Unplug, Plus, FolderPlus, Share2 } from 'lucide-react';
import Panel from './Panel';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import { useAutoFetch, formatBytes, withToast } from './util';
import { PanelError, SkeletonGrid } from './PanelState';
import { nasApi } from './api';

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

export default function DrivesPanel({ nasReadOnly = false, panelLabel = 'Drives & Mounts' }) {
  const { data, loading, refresh, error, lastUpdated } = useAutoFetch(
    () => nasApi.get('/api/nas/drives'),
  );
  const [mounting, setMounting] = useState(null);
  const [confirm, setConfirm] = useState(null);

  // Show block filesystems plus discovered NAS folders such as /Xube/media.
  const mounts = Array.isArray(data) ? data : [];
  const drives = mounts.filter((d) => ((d.type === 'part' || d.type === 'disk') && d.fstype) || d.type === 'folder');

  const handleMount = async (form) => {
    await withToast(nasApi.post('/api/nas/mounts/mount', form).then(refresh), {
      loading: 'Mounting…', success: 'Mounted', error: 'Failed',
    });
    setMounting(null);
  };

  const requestUnmount = (drive) => setConfirm({
    title: `Unmount ${drive.mountpoint}?`,
    message: `This unmounts ${drive.device} from ${drive.mountpoint}. Active writes may be interrupted.`,
    onConfirm: async () => {
      await withToast(nasApi.post('/api/nas/mounts/unmount', { target: drive.mountpoint }).then(refresh), {
        loading: 'Unmounting…', success: 'Unmounted', error: 'Failed',
      });
      setConfirm(null);
    },
  });

  const shareNameFromPath = (mountpoint, prefix) => {
    const name = String(mountpoint || '').split('/').filter(Boolean).pop() || 'share';
    return `${prefix}_${name}`.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64);
  };

  const createSmbShare = async (drive) => {
    await withToast(nasApi.post('/api/nas/samba/shares', {
      name: shareNameFromPath(drive.mountpoint, 'smb'),
      path: drive.mountpoint,
      comment: `Created from ${drive.device || drive.path}`,
      browsable: true,
      readOnly: false,
      guestOk: false,
      enabled: true,
    }), {
      loading: 'Creating SMB share...',
      success: 'SMB share created',
      error: 'Failed',
    });
  };

  const createNfsExport = async (drive) => {
    await withToast(nasApi.post('/api/nas/nfs/exports', {
      path: drive.mountpoint,
      clients: [{ host: '*', options: ['rw', 'sync', 'no_subtree_check'] }],
    }), {
      loading: 'Creating NFS export...',
      success: 'NFS export created',
      error: 'Failed',
    });
  };

  return (
    <Panel
      icon={HardDrive}
      title="Drives & Mounts"
      subtitle={lastUpdated ? `updated ${lastUpdated.toLocaleTimeString()}` : 'loading…'}
      status={error ? 'error' : (data ? 'ok' : 'idle')}
      loading={loading}
      onRefresh={refresh}
      actions={(
        <button onClick={() => setMounting({})} disabled={nasReadOnly} title={nasReadOnly ? 'Host agent is running in read-only mode.' : 'Mount'} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:bg-slate-700 disabled:text-slate-500">
          <Plus size={14} /> Mount
        </button>
      )}
    >
      {error && <PanelError error={error} onRetry={refresh} className="mb-3" panelLabel={panelLabel} />}
      {!data && !error && <SkeletonGrid count={2} columns="md:grid-cols-2" />}
      {drives.length === 0 && data && <p className="text-sm text-slate-500">No filesystems detected.</p>}
      {drives.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {drives.map((d) => (
            <article key={d.device} className="bg-slate-800/50 border border-slate-800 rounded-lg p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-white font-mono text-sm truncate">{d.device || d.path}</h3>
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
                  {d.uuid ? `uuid ${d.uuid.slice(0, 8)}…` : d.type}
                </span>
                <div className="flex flex-wrap justify-end gap-1">
                  {d.mountpoint && (
                    <>
                      <button disabled={nasReadOnly} onClick={() => createSmbShare(d)} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-blue-500/10 text-blue-400 disabled:text-slate-600 disabled:hover:bg-transparent" title={nasReadOnly ? 'Read-only mode' : 'Create SMB share'}>
                        <FolderPlus size={12} /> SMB
                      </button>
                      <button disabled={nasReadOnly} onClick={() => createNfsExport(d)} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-blue-500/10 text-blue-400 disabled:text-slate-600 disabled:hover:bg-transparent" title={nasReadOnly ? 'Read-only mode' : 'Create NFS export'}>
                        <Share2 size={12} /> NFS
                      </button>
                      <button
                        onClick={() => requestUnmount(d)}
                        disabled={nasReadOnly || !d.canUnmount}
                        title={d.safetyNote || 'Unmount'}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-red-500/10 text-red-400 disabled:text-slate-600 disabled:hover:bg-transparent"
                      >
                        <Unplug size={12} /> Unmount
                      </button>
                    </>
                  )}
                  {!d.mountpoint && (
                    <button
                      onClick={() => setMounting({ device: d.device, fstype: d.fstype })}
                      disabled={nasReadOnly || !d.canMount}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-blue-500/10 text-blue-400 disabled:text-slate-600 disabled:hover:bg-transparent"
                    >
                      <Plus size={12} /> Mount
                    </button>
                  )}
                </div>
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
