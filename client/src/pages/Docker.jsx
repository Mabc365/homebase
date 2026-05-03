import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Play, Square, RotateCcw, Trash2 } from 'lucide-react';

const Docker = () => {
  const [containers, setContainers] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchContainers = async () => {
    try {
      const res = await axios.get('/api/docker/containers');
      setContainers(res.data);
      setLoading(false);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchContainers();
    const interval = setInterval(fetchContainers, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleAction = async (id, action) => {
    try {
      await axios.post('/api/docker/action', { id, action });
      fetchContainers();
    } catch (err) {
      alert('Action failed: ' + err.message);
    }
  };

  if (loading) return <div className="text-slate-500">Scanning Docker daemon...</div>;

  const ActionButtons = ({ c }) => (
    <div className="flex space-x-2">
      {c.State !== 'running' ? (
        <button onClick={() => handleAction(c.Id, 'start')} className="p-1.5 text-emerald-500 hover:bg-emerald-500/10 rounded" aria-label="Start"><Play size={16} /></button>
      ) : (
        <button onClick={() => handleAction(c.Id, 'stop')} className="p-1.5 text-amber-500 hover:bg-amber-500/10 rounded" aria-label="Stop"><Square size={16} /></button>
      )}
      <button onClick={() => handleAction(c.Id, 'restart')} className="p-1.5 text-blue-500 hover:bg-blue-500/10 rounded" aria-label="Restart"><RotateCcw size={16} /></button>
      <button onClick={() => handleAction(c.Id, 'remove')} className="p-1.5 text-red-500 hover:bg-red-500/10 rounded" aria-label="Remove"><Trash2 size={16} /></button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-xl font-bold">Docker Containers</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            placeholder="Image name (e.g. nginx:latest)"
            className="bg-slate-900 border border-slate-800 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
          />
          <button className="bg-blue-600 hover:bg-blue-500 px-4 py-1.5 rounded text-sm font-medium transition-colors">
            Pull Image
          </button>
        </div>
      </div>

      {/* Mobile: stacked card view */}
      <div className="md:hidden space-y-3">
        {containers.map((c) => (
          <div key={c.Id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-white truncate">{c.Names[0].replace('/', '')}</p>
                <p className="text-xs text-slate-400 font-mono truncate mt-0.5">{c.Image}</p>
              </div>
              <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase shrink-0 ${
                c.State === 'running' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
              }`}>
                {c.State}
              </span>
            </div>
            <div className="mt-3 text-xs text-slate-500 font-mono break-all">
              {c.Ports.map(p => `${p.PublicPort}:${p.PrivatePort}`).join(', ') || 'no ports'}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-800 flex justify-end">
              <ActionButtons c={c} />
            </div>
          </div>
        ))}
        {containers.length === 0 && (
          <div className="text-slate-500 text-sm text-center py-8">No containers found</div>
        )}
      </div>

      {/* Desktop: table view */}
      <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-800 text-slate-400 uppercase text-xs font-mono">
              <tr>
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Image</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Ports</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {containers.map((c) => (
                <tr key={c.Id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="px-6 py-4 font-medium text-white">{c.Names[0].replace('/', '')}</td>
                  <td className="px-6 py-4 text-slate-400 font-mono text-xs">{c.Image}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                      c.State === 'running' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                    }`}>
                      {c.State}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-500 font-mono text-xs">
                    {c.Ports.map(p => `${p.PublicPort}:${p.PrivatePort}`).join(', ') || '-'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end">
                      <ActionButtons c={c} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Docker;
