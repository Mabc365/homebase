import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { getErrorMessage } from './util';

export default class NasErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('NAS panel crashed', error, info);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <section className="rounded-xl border border-red-500/40 bg-slate-900 p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="shrink-0 rounded-lg bg-red-500/10 p-2 text-red-300">
              <AlertTriangle size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-white">{this.props.title || 'Panel unavailable'}</h2>
              <p className="mt-1 break-words text-sm text-red-200">{getErrorMessage(error)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={this.reset}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-sm font-medium text-red-100 hover:bg-red-500/20"
          >
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      </section>
    );
  }
}
