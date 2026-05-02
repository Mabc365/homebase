import React, { useEffect } from 'react';
import { X } from 'lucide-react';

// Right-side slide-in panel used for add/edit forms.
export default function Modal({ open, onClose, title, children, footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="ml-auto h-full w-full max-w-md bg-[#0d1117] border-l border-slate-800 flex flex-col relative animate-[slideIn_.18s_ease-out]">
        <header className="h-14 border-b border-slate-800 flex items-center justify-between px-4 shrink-0">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-auto p-4 sm:p-5">{children}</div>
        {footer && (
          <footer className="border-t border-slate-800 p-4 flex items-center justify-end gap-2 shrink-0">
            {footer}
          </footer>
        )}
      </div>
      <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
    </div>
  );
}
