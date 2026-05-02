import React from 'react';
import { HardDrive } from 'lucide-react';
import SharesPanel from '../components/nas/SharesPanel';
import ExportsPanel from '../components/nas/ExportsPanel';
import ConnectionsPanel from '../components/nas/ConnectionsPanel';
import UsersPanel from '../components/nas/UsersPanel';
import ServicesPanel from '../components/nas/ServicesPanel';
import DrivesPanel from '../components/nas/DrivesPanel';
import NetworkPanel from '../components/nas/NetworkPanel';

export default function NAS() {
  return (
    <div className="space-y-4 sm:space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <span className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
          <HardDrive size={22} />
        </span>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">NAS</h1>
          <p className="text-xs font-mono text-slate-500">samba · nfs · mounts · services — auto-refresh every 30s</p>
        </div>
      </div>

      <ServicesPanel />
      <NetworkPanel />
      <SharesPanel />
      <ExportsPanel />
      <ConnectionsPanel />
      <UsersPanel />
      <DrivesPanel />
    </div>
  );
}
