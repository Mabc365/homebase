import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

export default function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger = true, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const handleConfirm = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={busy ? undefined : onCancel} />
      <div className="relative bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${danger ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'} shrink-0`}>
            <AlertTriangle size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-white">{title}</h3>
            <p className="text-sm text-slate-400 mt-1 break-words">{message}</p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className={`px-3 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'}`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
