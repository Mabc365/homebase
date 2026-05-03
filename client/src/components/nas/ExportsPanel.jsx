import React, { useState } from 'react';
import { Share2, Plus, Pencil, Trash2, RotateCw } from 'lucide-react';
import Panel from './Panel';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import { useAutoFetch, withToast } from './util';
import { PanelError, SkeletonGrid } from './PanelState';
import { nasApi } from './api';

const COMMON_OPTIONS = ['rw', 'ro', 'sync', 'async', 'no_subtree_check', 'subtree_check', 'root_squash', 'no_root_squash', 'all_squash', 'no_all_squash', 'secure', 'insecure'];

function ExportForm({ initial, onSubmit, onCancel, isEdit }) {
  const [path, setPath] = useState(initial?.path || '');
  const [clients, setClients] = useState(
    initial?.clients?.length ? initial.clients : [{ host: '*', options: ['rw', 'sync', 'no_subtree_check'] }],
  );
  const [submitting, setSubmitting] = useState(false);

  const updateClient = (i, patch) => setClients((cs) => cs.map((c, j) => j === i ? { ...c, ...patch } : c));
  const addClient = () => setClients((cs) => [...cs, { host: '', options: [] }]);
  const removeClient = (i) => setClients((cs) => cs.filter((_, j) => j !== i));
  const toggleOption = (i, opt) => updateClient(i, {
    options: clients[i].options.includes(opt)
      ? clients[i].options.filter((o) => o !== opt)
      : [...clients[i].options, opt],
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try { await onSubmit({ path, clients }); } finally { setSubmitting(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Export Path</label>
        <input
          type="text" value={path} required disabled={isEdit}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/srv/nfs/data"
          className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-60"
        />
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Allowed Clients</label>
          <button type="button" onClick={addClient} className="text-xs text-blue-400 hover:text-blue-300">+ Add client</button>
        </div>
        {clients.map((c, i) => (
          <div key={i} className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="text" value={c.host} required placeholder="* or 192.168.1.0/24 or hostname"
                onChange={(e) => updateClient(i, { host: e.target.value })}
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
              />
              {clients.length > 1 && (
                <button type="button" onClick={() => removeClient(i)} className="p-1.5 text-red-400 hover:bg-red-500/10 rounded">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_OPTIONS.map((opt) => {
                const active = c.options.includes(opt);
                return (
                  <button
                    type="button" key={opt} onClick={() => toggleOption(i, opt)}
                    className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${active ? 'bg-blue-500/10 text-blue-300 border-blue-500/40' : 'border-slate-700 text-slate-500 hover:text-slate-300'}`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
        <button type="submit" disabled={submitting} className="px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
          {submitting ? 'Saving…' : (isEdit ? 'Save changes' : 'Create export')}
        </button>
      </div>
    </form>
  );
}

export default function ExportsPanel({ nasReadOnly = false }) {
  const { data: exports, loading, refresh, error, lastUpdated } = useAutoFetch(
    () => nasApi.get('/api/nas/nfs/exports'),
  );
  const { data: connections } = useAutoFetch(
    () => nasApi.get('/api/nas/nfs/connections'),
  );
  const exportList = Array.isArray(exports) ? exports : [];
  const connectionList = Array.isArray(connections) ? connections : [];
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const clientCounts = {};
  connectionList.forEach((c) => { clientCounts[c.export] = (clientCounts[c.export] || 0) + 1; });

  const handleSubmit = async (form) => {
    const isEdit = Boolean(editing && editing.id);
    const url = isEdit ? `/api/nas/nfs/exports/${editing.id}` : '/api/nas/nfs/exports';
    const method = isEdit ? 'put' : 'post';
    await withToast(nasApi[method](url, form).then(refresh), {
      loading: isEdit ? 'Saving export…' : 'Creating export…',
      success: isEdit ? 'Export updated' : 'Export created',
      error: 'Failed',
    });
    setEditing(null);
  };

  const requestDelete = (e) => setConfirm({
    title: `Delete export "${e.path}"?`,
    message: 'This removes the line from /etc/exports and runs exportfs -ra.',
    onConfirm: async () => {
      await withToast(nasApi.delete(`/api/nas/nfs/exports/${e.id}`).then(refresh), {
        loading: 'Deleting…', success: 'Export deleted', error: 'Failed',
      });
      setConfirm(null);
    },
  });

  const reload = async () => {
    await withToast(nasApi.post('/api/nas/nfs/exports/reload').then(refresh), {
      loading: 'Reloading exports…', success: 'exportfs -ra OK', error: 'Failed',
    });
  };

  return (
    <Panel
      icon={Share2}
      title="NFS Exports"
      subtitle={lastUpdated ? `updated ${lastUpdated.toLocaleTimeString()}` : 'loading…'}
      status={error ? 'error' : (exports ? 'ok' : 'idle')}
      loading={loading}
      onRefresh={refresh}
      actions={(
        <>
          <button onClick={reload} disabled={nasReadOnly} title={nasReadOnly ? 'Host agent is running in read-only mode.' : 'Reload exports'} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-100 disabled:text-slate-500">
            <RotateCw size={14} /> Reload
          </button>
          <button onClick={() => setEditing({})} disabled={nasReadOnly} title={nasReadOnly ? 'Host agent is running in read-only mode.' : 'New export'} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:bg-slate-700 disabled:text-slate-500">
            <Plus size={14} /> New export
          </button>
        </>
      )}
    >
      {error && <PanelError error={error} onRetry={refresh} className="mb-3" />}
      {!exports && !error && <SkeletonGrid count={2} columns="md:grid-cols-2" />}
      {exports && exportList.length === 0 && <p className="text-sm text-slate-500">No exports defined.</p>}
      {exportList.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {exportList.map((e) => (
            <article key={e.id} className="bg-slate-800/50 border border-slate-800 rounded-lg p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-white font-semibold font-mono text-sm break-all">{e.path}</h3>
                <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 shrink-0">
                  {clientCounts[e.path] || 0} client{(clientCounts[e.path] || 0) === 1 ? '' : 's'}
                </span>
              </div>
              <div className="space-y-1">
                {(Array.isArray(e.clients) ? e.clients : []).map((c, i) => (
                  <div key={i} className="text-xs font-mono text-slate-300">
                    <span className="text-slate-500">{c.host}</span>
                    {c.options?.length > 0 && (
                      <span className="text-slate-500"> ({c.options.join(',')})</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-end gap-1 pt-1">
                <button disabled={nasReadOnly} onClick={() => setEditing(e)} className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white disabled:text-slate-600 disabled:hover:bg-transparent" title={nasReadOnly ? 'Read-only mode' : 'Edit'}>
                  <Pencil size={14} />
                </button>
                <button disabled={nasReadOnly} onClick={() => requestDelete(e)} className="p-1.5 rounded hover:bg-red-500/10 text-red-400 disabled:text-slate-600 disabled:hover:bg-transparent" title={nasReadOnly ? 'Read-only mode' : 'Delete'}>
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? `Edit export "${editing.path}"` : 'New NFS export'}>
        {editing && (
          <ExportForm initial={editing} isEdit={Boolean(editing.id)} onSubmit={handleSubmit} onCancel={() => setEditing(null)} />
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
