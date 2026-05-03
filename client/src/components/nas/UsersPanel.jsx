import React, { useState } from 'react';
import { Users, Plus, KeyRound, Trash2 } from 'lucide-react';
import Panel from './Panel';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import { useAutoFetch, withToast } from './util';
import { PanelError, SkeletonRows } from './PanelState';
import { nasApi } from './api';

function PasswordForm({ usernameLocked, initialUsername = '', onSubmit, onCancel }) {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const handle = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try { await onSubmit({ username, password }); } finally { setSubmitting(false); }
  };
  return (
    <form onSubmit={handle} className="space-y-4">
      <div>
        <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Username</label>
        <input
          type="text" value={username} required disabled={usernameLocked}
          onChange={(e) => setUsername(e.target.value)}
          className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-60"
        />
        {!usernameLocked && (
          <p className="mt-1 text-[11px] text-slate-500">Must already exist as a Linux user.</p>
        )}
      </div>
      <div>
        <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Password</label>
        <input
          type="password" value={password} required minLength={8}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        />
      </div>
      <div className="flex items-center justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
        <button type="submit" disabled={submitting} className="px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

export default function UsersPanel({ nasReadOnly = false }) {
  const { data, loading, refresh, error, lastUpdated } = useAutoFetch(
    () => nasApi.get('/api/nas/samba/users'),
  );
  const users = Array.isArray(data) ? data : [];
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const handleAdd = async ({ username, password }) => {
    await withToast(nasApi.post('/api/nas/samba/users', { username, password }).then(refresh), {
      loading: 'Adding user…', success: 'User added', error: 'Failed',
    });
    setAdding(false);
  };
  const handleReset = async ({ username, password }) => {
    await withToast(nasApi.post(`/api/nas/samba/users/${encodeURIComponent(username)}/password`, { password }).then(refresh), {
      loading: 'Updating password…', success: 'Password updated', error: 'Failed',
    });
    setResetting(null);
  };
  const requestDelete = (user) => setConfirm({
    title: `Delete Samba user "${user.username}"?`,
    message: 'The Linux account is not removed.',
    onConfirm: async () => {
      await withToast(nasApi.delete(`/api/nas/samba/users/${encodeURIComponent(user.username)}`).then(refresh), {
        loading: 'Deleting…', success: 'User deleted', error: 'Failed',
      });
      setConfirm(null);
    },
  });

  return (
    <Panel
      icon={Users}
      title="Samba Users"
      subtitle={lastUpdated ? `updated ${lastUpdated.toLocaleTimeString()}` : 'loading…'}
      status={error ? 'error' : (data ? 'ok' : 'idle')}
      loading={loading}
      onRefresh={refresh}
      actions={(
        <button onClick={() => setAdding(true)} disabled={nasReadOnly} title={nasReadOnly ? 'Host agent is running in read-only mode.' : 'Add user'} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:bg-slate-700 disabled:text-slate-500">
          <Plus size={14} /> Add user
        </button>
      )}
    >
      {error && <PanelError error={error} onRetry={refresh} className="mb-3" />}
      {!data && !error && <SkeletonRows count={4} />}
      {data && users.length === 0 && <p className="text-sm text-slate-500">No Samba users defined.</p>}
      {users.length > 0 && (
        <ul className="divide-y divide-slate-800">
          {users.map((u) => (
            <li key={u.username} className="flex items-center justify-between py-2">
              <div className="min-w-0">
                <div className="text-sm text-white font-medium truncate">{u.username}</div>
                <div className="text-[11px] font-mono text-slate-500">uid {u.uid ?? '—'}{u.fullName ? ` · ${u.fullName}` : ''}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button disabled={nasReadOnly} onClick={() => setResetting(u)} className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white disabled:text-slate-600 disabled:hover:bg-transparent" title={nasReadOnly ? 'Read-only mode' : 'Change password'}>
                  <KeyRound size={14} />
                </button>
                <button disabled={nasReadOnly} onClick={() => requestDelete(u)} className="p-1.5 rounded hover:bg-red-500/10 text-red-400 disabled:text-slate-600 disabled:hover:bg-transparent" title={nasReadOnly ? 'Read-only mode' : 'Delete'}>
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add Samba user">
        {adding && <PasswordForm onSubmit={handleAdd} onCancel={() => setAdding(false)} />}
      </Modal>
      <Modal open={Boolean(resetting)} onClose={() => setResetting(null)} title={`Change password — ${resetting?.username}`}>
        {resetting && <PasswordForm usernameLocked initialUsername={resetting.username} onSubmit={handleReset} onCancel={() => setResetting(null)} />}
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
