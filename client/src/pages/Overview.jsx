import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Cpu, Database, HardDrive, Activity } from 'lucide-react';

const StatCard = ({ icon: Icon, label, value, unit, color }) => (
  <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
    <div className="flex items-center justify-between mb-4">
      <div className={`p-2 rounded-lg ${color} bg-opacity-10`}>
        <Icon className={color} size={24} />
      </div>
      <span className="text-xs font-mono text-slate-500 uppercase tracking-wider">{label}</span>
    </div>
    <div className="flex items-baseline space-x-1">
      <span className="text-3xl font-bold text-white">{value}</span>
      <span className="text-slate-500 text-sm">{unit}</span>
    </div>
  </div>
);

const Overview = () => {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await axios.get(`http://${window.location.hostname}:3001/api/stats`);
        setStats(res.data);
      } catch (err) {
        console.error(err);
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  if (!stats) return <div className="text-slate-500">Loading system metrics...</div>;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard icon={Cpu} label="CPU Usage" value={stats.cpu} unit="%" color="text-blue-500" />
        <StatCard icon={Database} label="RAM Usage" value={stats.mem} unit="%" color="text-purple-500" />
        <StatCard icon={HardDrive} label="Disk Usage" value={stats.disk} unit="%" color="text-amber-500" />
        <StatCard icon={Activity} label="Network In" value={stats.netIn} unit="KB/s" color="text-emerald-500" />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4">System Information</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="space-y-2">
            <p><span className="text-slate-500">Hostname:</span> <span className="font-mono">{stats.hostname}</span></p>
            <p><span className="text-slate-500">OS:</span> <span className="font-mono">{stats.os}</span></p>
          </div>
          <div className="space-y-2">
            <p><span className="text-slate-500">Uptime:</span> <span className="font-mono">{Math.floor(stats.uptime / 3600)}h {Math.floor((stats.uptime % 3600) / 60)}m</span></p>
            <p><span className="text-slate-500">Status:</span> <span className="text-emerald-500 font-medium">Online</span></p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Overview;
