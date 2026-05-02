import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { io } from 'socket.io-client';
import { Server, User, Lock, Key, Plug, PowerOff } from 'lucide-react';
import 'xterm/css/xterm.css';

const Terminal = () => {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitRef = useRef(null);
  const socketRef = useRef(null);

  const [form, setForm] = useState({
    host: '',
    port: 22,
    username: '',
    password: '',
    privateKey: '',
    passphrase: '',
    authMethod: 'password',
  });
  const [status, setStatus] = useState({ type: 'idle', message: 'Not connected' });
  const [connected, setConnected] = useState(false);

  // Initialize the socket once
  useEffect(() => {
    const socket = io(`http://${window.location.hostname}:3001`);
    socketRef.current = socket;

    socket.on('output', (data) => {
      if (xtermRef.current) xtermRef.current.write(data);
    });

    socket.on('ssh-status', (s) => {
      setStatus(s);
      if (s.type === 'ready') {
        setConnected(true);
        if (xtermRef.current) xtermRef.current.writeln(`\r\n\x1b[32m✓ ${s.message}\x1b[0m`);
      } else if (s.type === 'closed') {
        setConnected(false);
        if (xtermRef.current) xtermRef.current.writeln(`\r\n\x1b[33m${s.message}\x1b[0m`);
      } else if (s.type === 'error') {
        setConnected(false);
        if (xtermRef.current) xtermRef.current.writeln(`\r\n\x1b[31m✗ ${s.message}\x1b[0m`);
      }
    });

    return () => socket.disconnect();
  }, []);

  // Initialize xterm only when connected & the container is mounted
  useEffect(() => {
    if (!connected || !terminalRef.current || xtermRef.current) return;

    const term = new XTerm({
      theme: { background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff' },
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitRef.current = fitAddon;

    term.onData((data) => socketRef.current?.emit('input', data));

    const handleResize = () => {
      try {
        fitAddon.fit();
        socketRef.current?.emit('resize', { cols: term.cols, rows: term.rows });
      } catch (_) {}
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, [connected]);

  const handleConnect = (e) => {
    e.preventDefault();
    setStatus({ type: 'connecting', message: 'Connecting...' });

    const payload = {
      host: form.host.trim(),
      port: Number(form.port) || 22,
      username: form.username.trim(),
      cols: 80,
      rows: 30,
    };
    if (form.authMethod === 'password') {
      payload.password = form.password;
    } else {
      payload.privateKey = form.privateKey;
      if (form.passphrase) payload.passphrase = form.passphrase;
    }
    socketRef.current?.emit('ssh-connect', payload);
  };

  const handleDisconnect = () => {
    socketRef.current?.emit('ssh-disconnect');
  };

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const statusColor =
    status.type === 'ready' ? 'text-emerald-500'
    : status.type === 'error' ? 'text-red-500'
    : status.type === 'connecting' ? 'text-amber-500'
    : 'text-slate-500';

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">SSH Terminal</h2>
          <p className={`text-xs font-mono mt-1 ${statusColor}`}>{status.message}</p>
        </div>
        {connected && (
          <button
            onClick={handleDisconnect}
            className="flex items-center gap-2 text-xs bg-red-600/20 hover:bg-red-600/30 text-red-400 px-3 py-1.5 rounded transition-colors"
          >
            <PowerOff size={14} />
            Disconnect
          </button>
        )}
      </div>

      {!connected ? (
        <form
          onSubmit={handleConnect}
          className="bg-slate-900 border border-slate-800 rounded-xl p-5 sm:p-6 max-w-2xl space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Host</label>
              <div className="relative mt-1">
                <Server className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input
                  type="text"
                  value={form.host}
                  onChange={update('host')}
                  placeholder="192.168.1.10 or example.com"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  required
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Port</label>
              <input
                type="number"
                value={form.port}
                onChange={update('port')}
                placeholder="22"
                className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Username</label>
            <div className="relative mt-1">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
              <input
                type="text"
                value={form.username}
                onChange={update('username')}
                placeholder="root"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                required
              />
            </div>
          </div>

          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, authMethod: 'password' }))}
              className={`flex-1 py-1.5 rounded border transition-colors ${form.authMethod === 'password' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}
            >
              Password
            </button>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, authMethod: 'key' }))}
              className={`flex-1 py-1.5 rounded border transition-colors ${form.authMethod === 'key' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}
            >
              Private Key
            </button>
          </div>

          {form.authMethod === 'password' ? (
            <div>
              <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Password</label>
              <div className="relative mt-1">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input
                  type="password"
                  value={form.password}
                  onChange={update('password')}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  required
                />
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Private Key</label>
                <div className="relative mt-1">
                  <Key className="absolute left-3 top-3 text-slate-500" size={16} />
                  <textarea
                    value={form.privateKey}
                    onChange={update('privateKey')}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    rows={5}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Passphrase (optional)</label>
                <input
                  type="password"
                  value={form.passphrase}
                  onChange={update('passphrase')}
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={status.type === 'connecting'}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors"
          >
            <Plug size={16} />
            {status.type === 'connecting' ? 'Connecting...' : 'Connect'}
          </button>
        </form>
      ) : (
        <div className="flex-1 bg-[#0d1117] rounded-xl border border-slate-800 overflow-hidden p-2 min-h-[300px]">
          <div ref={terminalRef} className="h-full w-full" />
        </div>
      )}
    </div>
  );
};

export default Terminal;
