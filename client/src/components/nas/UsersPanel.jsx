import React, { useState } from 'react';
import { Users, KeyRound, ShieldCheck, X } from 'lucide-react';
import Panel from './Panel';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import { useAutoFetch, withToast } from './util';
import { PanelError, SkeletonRows } from './PanelState';
import { nasApi } from './api';

function PasswordForm({ username, onSubmit, onCancel }) {
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
        <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">User</label>
        <div className="mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white font-mono">{username}</div>
      </div>
      <div>
        <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Samba password</label>
        <input
          type="password" value={password} required minLength={8} autoFocus
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        />
        <p className="mt-1 text-[11px] text-slate-500">Used by SMB clients. The Linux account password is not changed.</p>
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

export default function UsersPanel({ nasReadOnly = false, panelLabel = 'Users' }) {
  const { data, loading, refresh, error, lastUpdated } = useAutoFetch(
    () => nasApi.get('/api/nas/users'),
  );
  const users = Array.isArray(data) ? data : [];
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const handleSetPassword = async ({ username, password }) => {
    const enable = !users.find((u) => u.username === username)?.sambaEnabled;
    const url = enable
      ? '/api/nas/samba/users'
      : `/api/nas/samba/users/${encodeURIComponent(username)}/password`;
    const body = enable ? { username, password } : { password };
    await withToast(nasApi.post(url, body).then(refresh), {
      loading: enable ? 'Enabling Samba…' : 'Updating password…',
      success: enable ? 'Samba enabled' : 'Password updated',
      error: 'Failed',
    });
    setEditing(null);
  };

  const requestDisable = (user) => setConfirm({
    title: `Disable Samba for "${user.username}"?`,
    message: 'Removes the Samba password. The Linux account is not deleted.',
    onConfirm: async () => {
      await withToast(nasApi.delete(`/api/nas/samba/users/${encodeURIComponent(user.username)}`).then(refresh), {
        loading: 'Disabling…', success: 'Samba disabled', error: 'Failed',
      });
      setConfirm(null);
    },
  });

  return (
    <Panel
      icon={Users}
      title="Users"
      subtitle={lastUpdated ? `updated ${lastUpdated.toLocaleTimeString()}` : 'loading…'}
      status={error ? 'error' : (data ? 'ok' : 'idle')}
      loading={loading}
      onRefresh={refresh}
    >
      {error && <PanelError error={error} onRetry={refresh} className="mb-3" panelLabel={panelLabel} />}
      {!data && !error && <SkeletonRows count={4} />}
      {data && users.length === 0 && <p className="text-sm text-slate-500">No Linux users found (uid &gt;= 1000).</p>}
      {users.length > 0 && (
        <ul className="divide-y divide-slate-800">
          {users.map((u) => (
            <li key={u.username} className="flex items-center justify-between py-2 gap-3">
              <div className="min-w-0 flex items-center gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-white font-medium truncate flex items-center gap-2">
                    {u.username}
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 text-[10px] font-mono uppercase tracking-wider">
                      <ShieldCheck size={10} /> admin
                    </span>
                    {u.sambaEnabled && (
                      <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 text-[10px] font-mono uppercase tracking-wider">
                        smb
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 truncate">
                    uid {u.uid}{u.fullName ? ` · ${u.fullName}` : ''}{u.home ? ` · ${u.home}` : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  disabled={nasReadOnly}
                  onClick={() => setEditing(u)}
                  className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white disabled:text-slate-600 disabled:hover:bg-transparent"
                  title={nasReadOnly ? 'Read-only mode' : (u.sambaEnabled ? 'Change Samba password' : 'Set Samba password')}
                >
                  <KeyRound size={14} />
                </button>
                {u.sambaEnabled && (
                  <button
                    disabled={nasReadOnly}
                    onClick={() => requestDisable(u)}
                    className="p-1.5 rounded hover:bg-red-500/10 text-red-400 disabled:text-slate-600 disabled:hover:bg-transparent"
                    title={nasReadOnly ? 'Read-only mode' : 'Disable Samba access'}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.sambaEnabled ? `Change Samba password — ${editing.username}` : `Enable Samba — ${editing?.username}`}>
        {editing && <PasswordForm username={editing.username} onSubmit={handleSetPassword} onCancel={() => setEditing(null)} />}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel="Disable"
        onConfirm={confirm?.onConfirm}
        onCancel={() => setConfirm(null)}
      />
    </Panel>
  );
}
