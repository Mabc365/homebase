import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { DownloadCloud, Play, RefreshCw } from 'lucide-react';

const apiBase = '';

const System = () => {
  const [updateStatus, setUpdateStatus] = useState(null);
  const [message, setMessage] = useState('');

  const fetchStatus = async () => {
    const res = await axios.get(`${apiBase}/api/system/update`);
    setUpdateStatus(res.data);
  };

  useEffect(() => {
    fetchStatus().catch((err) => setMessage(err.response?.data?.error || err.message));
  }, []);

  useEffect(() => {
    if (!updateStatus?.running) return undefined;
    const interval = setInterval(() => {
      fetchStatus().catch((err) => setMessage(err.response?.data?.error || err.message));
    }, 1500);
    return () => clearInterval(interval);
  }, [updateStatus?.running]);

  const runUpdate = async () => {
    setMessage('');
    try {
      const res = await axios.post(`${apiBase}/api/system/update`);
      setUpdateStatus(res.data);
    } catch (err) {
      setMessage(err.response?.data?.error || err.message);
    }
  };

  const statusText = !updateStatus
    ? 'Loading'
    : updateStatus.running
      ? 'Running'
      : updateStatus.error
        ? 'Failed'
        : updateStatus.exitCode === 0
          ? 'Updated'
          : updateStatus.configured
            ? 'Ready'
            : 'Not configured';

  const statusColor =
    updateStatus?.running ? 'text-amber-500'
    : updateStatus?.error ? 'text-red-500'
    : updateStatus?.exitCode === 0 ? 'text-emerald-500'
    : updateStatus?.configured ? 'text-blue-500'
    : 'text-slate-500';

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-bold">System</h2>
        <p className={`text-xs font-mono mt-1 ${statusColor}`}>{statusText}</p>
      </div>

      <section className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <DownloadCloud size={18} className="text-blue-500" />
              <h3 className="font-semibold text-white">Homebase Update</h3>
            </div>
            <p className="mt-1 text-xs text-slate-500 font-mono break-all">
              {updateStatus?.configured ? updateStatus.cwd : 'Set HOMEBASE_UPDATE_COMMAND on the server'}
            </p>
          </div>
          <button
            onClick={runUpdate}
            disabled={!updateStatus?.configured || updateStatus?.running}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {updateStatus?.running ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
            {updateStatus?.running ? 'Updating...' : 'Update'}
          </button>
        </div>

        {message && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg p-3 text-sm">
            {message}
          </div>
        )}

        {updateStatus?.lastStartedAt && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="bg-slate-800/60 rounded-lg p-3">
              <p className="text-slate-500 uppercase tracking-wider">Started</p>
              <p className="mt-1 font-mono text-slate-300">{new Date(updateStatus.lastStartedAt).toLocaleString()}</p>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-3">
              <p className="text-slate-500 uppercase tracking-wider">Finished</p>
              <p className="mt-1 font-mono text-slate-300">
                {updateStatus.lastFinishedAt ? new Date(updateStatus.lastFinishedAt).toLocaleString() : '-'}
              </p>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-3">
              <p className="text-slate-500 uppercase tracking-wider">Exit Code</p>
              <p className="mt-1 font-mono text-slate-300">{updateStatus.exitCode ?? '-'}</p>
            </div>
          </div>
        )}

        <pre className="min-h-[220px] max-h-[420px] overflow-auto bg-[#0d1117] border border-slate-800 rounded-lg p-3 text-xs text-slate-300 whitespace-pre-wrap">{updateStatus?.output || 'No update output yet.'}</pre>
      </section>
    </div>
  );
};

export default System;
