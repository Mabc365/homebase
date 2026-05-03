import React, { useState } from 'react';
import { FolderInput, FolderPlus, Share2 } from 'lucide-react';
import Panel from './Panel';
import { useAutoFetch, withToast } from './util';
import { PanelError } from './PanelState';
import { nasApi } from './api';

function shareNameFromPath(folderPath) {
  const last = String(folderPath || '').split('/').filter(Boolean).pop() || 'share';
  return last.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64) || 'share';
}

export default function ImportFolderPanel({ nasReadOnly = false, panelLabel = 'Import Folder' }) {
  const { data, loading, error, refresh, lastUpdated } = useAutoFetch(
    () => nasApi.get('/api/nas/folders'),
  );
  const folders = data?.folders || [];
  const roots = data?.roots || [];

  const [folderPath, setFolderPath] = useState('');
  const [shareName, setShareName] = useState('');
  const [busy, setBusy] = useState(false);

  const submitDisabled = nasReadOnly || busy || !folderPath.trim();

  const pick = (path) => {
    setFolderPath(path);
    setShareName(shareNameFromPath(path));
  };

  const onPathChange = (value) => {
    setFolderPath(value);
    if (!shareName || shareName === shareNameFromPath(folderPath)) {
      setShareName(shareNameFromPath(value));
    }
  };

  const createSmb = async () => {
    const trimmed = folderPath.trim();
    if (!trimmed) return;
    const name = (shareName.trim() || shareNameFromPath(trimmed)).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64);
    setBusy(true);
    try {
      await withToast(nasApi.post('/api/nas/samba/shares', {
        name,
        path: trimmed,
        comment: `Imported folder ${trimmed}`,
        browsable: true,
        readOnly: false,
        guestOk: false,
        enabled: true,
      }), {
        loading: 'Creating SMB share…',
        success: 'SMB share created',
        error: 'Failed',
      });
    } finally {
      setBusy(false);
    }
  };

  const createNfs = async () => {
    const trimmed = folderPath.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await withToast(nasApi.post('/api/nas/nfs/exports', {
        path: trimmed,
        clients: [{ host: '*', options: ['rw', 'sync', 'no_subtree_check'] }],
      }), {
        loading: 'Creating NFS export…',
        success: 'NFS export created',
        error: 'Failed',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      icon={FolderInput}
      title="Import Folder"
      subtitle={lastUpdated ? `updated ${lastUpdated.toLocaleTimeString()}` : 'loading…'}
      status={error ? 'error' : 'ok'}
      loading={loading}
      onRefresh={refresh}
    >
      {error && <PanelError error={error} onRetry={refresh} className="mb-3" panelLabel={panelLabel} />}

      <div className="space-y-4">
        <div>
          <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Folder path</label>
          <input
            type="text"
            value={folderPath}
            onChange={(e) => onPathChange(e.target.value)}
            placeholder={roots[0] ? `${roots[0]}/media` : '/Xube/media'}
            className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Type a path or pick one below. ZFS datasets show up as folders under their pool mount.
          </p>
        </div>

        <div>
          <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Share name (SMB)</label>
          <input
            type="text"
            value={shareName}
            onChange={(e) => setShareName(e.target.value)}
            placeholder="auto from folder name"
            className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={createSmb}
            disabled={submitDisabled}
            title={nasReadOnly ? 'Read-only mode' : 'Create SMB share'}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:bg-slate-700 disabled:text-slate-500"
          >
            <FolderPlus size={14} /> Create SMB share
          </button>
          <button
            onClick={createNfs}
            disabled={submitDisabled}
            title={nasReadOnly ? 'Read-only mode' : 'Create NFS export'}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-100 disabled:bg-slate-800 disabled:text-slate-500"
          >
            <Share2 size={14} /> Create NFS export
          </button>
        </div>

        <div>
          <div className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-2">Existing folders</div>
          {folders.length === 0 && (
            <p className="text-sm text-slate-500">
              No folders found under {roots.join(', ') || '/Xube'}.
            </p>
          )}
          {folders.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {folders.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => pick(f.path)}
                  className={`text-left px-3 py-2 rounded-lg border text-sm font-mono truncate ${
                    folderPath === f.path
                      ? 'border-blue-500 bg-blue-500/10 text-blue-200'
                      : 'border-slate-800 bg-slate-800/40 text-slate-200 hover:border-slate-700 hover:bg-slate-800'
                  }`}
                  title={f.path}
                >
                  {f.path}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
