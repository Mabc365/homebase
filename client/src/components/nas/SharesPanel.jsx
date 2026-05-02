import React, { useState } from 'react';
import { Folder, Plus, Pencil, Trash2, Power } from 'lucide-react';
import Panel from './Panel';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import { useAutoFetch, withToast } from './util';
import { PanelError, SkeletonGrid } from './PanelState';
import { nasApi } from './api';

const emptyForm = {
  name: '', path: '', comment: '',
  writable: true, browseable: true, guestOk: false, validUsers: '',
};

function ShareForm({ initial, onSubmit, onCancel, isEdit }) {
  const normalizedInitial = initial
    ? {
        ...initial,
        browseable: initial.browseable ?? initial.browsable ?? true,
        writable: initial.writable ?? !initial.readOnly,
      }
    : {};
  const [form, setForm] = useState({ ...emptyForm, ...normalizedInitial });
  const [submitting, setSubmitting] = useState(false);
  const update = (patch) => setForm((f) => ({ ...f, ...patch }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try { await onSubmit(form); } finally { setSubmitting(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Share Name</label>
        <input
          type="text" value={form.name} required disabled={isEdit}
          onChange={(e) => update({ name: e.target.value })}
          className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-60"
        />
      </div>
      <div>
        <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Path</label>
        <input
          type="text" value={form.path} required placeholder="/srv/share"
          onChange={(e) => update({ path: e.target.value })}
          className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        />
      </div>
      <div>
        <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Comment</label>
        <input
          type="text" value={form.comment}
          onChange={(e) => update({ comment: e.target.value })}
          className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        />
      </div>
      <div>
        <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Valid Users</label>
        <input
          type="text" value={form.validUsers} placeholder="user1, user2"
          onChange={(e) => update({ validUsers: e.target.value })}
          className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        />
      </div>
      <div className="space-y-2">
        {[
          ['writable', 'Writable'],
          ['browseable', 'Browseable'],
          ['guestOk', 'Allow guest access'],
        ].map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox" checked={Boolean(form[k])}
              onChange={(e) => update({ [k]: e.target.checked })}
              className="rounded border-slate-600 bg-slate-800"
            />
            {label}
          </label>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
        <button type="submit" disabled={submitting} className="px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
          {submitting ? 'Saving…' : (isEdit ? 'Save changes' : 'Create share')}
        </button>
      </div>
    </form>
  );
}

export default function SharesPanel() {
  const { data, loading, refresh, error, lastUpdated } = useAutoFetch(
    () => nasApi.get('/api/nas/samba/shares'),
  );
  const shares = Array.isArray(data) ? data : [];
  const [editing, setEditing] = useState(null); // share or {} for new
  const [confirm, setConfirm] = useState(null);

  const startCreate = () => setEditing({});
  const startEdit = (s) => setEditing(s);
  const close = () => setEditing(null);

  const handleSubmit = async (form) => {
    const isEdit = Boolean(editing && editing.name);
    const url = isEdit ? `/api/nas/samba/shares/${encodeURIComponent(editing.name)}` : '/api/nas/samba/shares';
    const method = isEdit ? 'put' : 'post';
    await withToast(nasApi[method](url, form).then(refresh), {
      loading: isEdit ? 'Saving share…' : 'Creating share…',
      success: isEdit ? 'Share updated' : 'Share created',
      error: 'Failed',
    });
    close();
  };

  const toggle = async (share) => {
    await withToast(
      nasApi.post(`/api/nas/samba/shares/${encodeURIComponent(share.name)}/toggle`, { enabled: !share.enabled }).then(refresh),
      { loading: 'Updating...', success: share.enabled ? 'Disabled' : 'Enabled', error: 'Failed' },
    );
  };

  const requestDelete = (share) => setConfirm({
    title: `Delete share "${share.name}"?`,
    message: `This removes the [${share.name}] section from smb.conf. The path on disk is not deleted.`,
    onConfirm: async () => {
      await withToast(
        nasApi.delete(`/api/nas/samba/shares/${encodeURIComponent(share.name)}`).then(refresh),
        { loading: 'Deleting...', success: 'Share deleted', error: 'Failed' },
      );
      setConfirm(null);
    },
  });

  return (
    <Panel
      icon={Folder}
      title="Samba Shares"
      subtitle={lastUpdated ? `updated ${lastUpdated.toLocaleTimeString()}` : 'loading…'}
      status={error ? 'error' : (data ? 'ok' : 'idle')}
      loading={loading}
      onRefresh={refresh}
      actions={(
        <button onClick={startCreate} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white">
          <Plus size={14} /> New share
        </button>
      )}
    >
      {error && <PanelError error={error} onRetry={refresh} className="mb-3" />}
      {!data && !error && <SkeletonGrid count={3} columns="md:grid-cols-2 lg:grid-cols-3" />}
      {data && shares.length === 0 && <p className="text-sm text-slate-500">No shares defined.</p>}
      {shares.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {shares.map((s) => (
            <article key={s.name} className="bg-slate-800/50 border border-slate-800 rounded-lg p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-white font-semibold truncate">{s.name}</h3>
                  <p className="text-xs font-mono text-slate-500 truncate">{s.path}</p>
                </div>
                <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded ${s.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                  {s.enabled ? 'on' : 'off'}
                </span>
              </div>
              {s.comment && <p className="text-xs text-slate-400 truncate">{s.comment}</p>}
              <div className="flex flex-wrap gap-1.5 text-[10px] font-mono uppercase tracking-wider">
                <span className={`px-1.5 py-0.5 rounded ${!s.readOnly ? 'bg-blue-500/10 text-blue-400' : 'bg-slate-700 text-slate-400'}`}>{!s.readOnly ? 'rw' : 'ro'}</span>
                {s.browsable && <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">browsable</span>}
                {s.guestOk && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">guest</span>}
                {s.validUsers && <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 truncate max-w-full">{s.validUsers}</span>}
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{s.activeConnections} connection{s.activeConnections === 1 ? '' : 's'}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => toggle(s)} className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white" title={s.enabled ? 'Disable' : 'Enable'}>
                    <Power size={14} />
                  </button>
                  <button onClick={() => startEdit(s)} className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white" title="Edit">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => requestDelete(s)} className="p-1.5 rounded hover:bg-red-500/10 text-red-400" title="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={close}
        title={editing && editing.name ? `Edit share "${editing.name}"` : 'New Samba share'}
      >
        {editing && (
          <ShareForm
            initial={editing}
            isEdit={Boolean(editing.name)}
            onSubmit={handleSubmit}
            onCancel={close}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel="Delete"
        onConfirm={confirm?.onConfirm}
        onCancel={() => setConfirm(null)}
      />
    </Panel>
  );
}
