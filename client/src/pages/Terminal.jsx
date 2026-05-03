import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { io } from 'socket.io-client';
import { Key, Lock, Monitor, Plug, Plus, PowerOff, Server, Trash2, User } from 'lucide-react';
import 'xterm/css/xterm.css';

const apiBase = '';

const emptyForm = {
  name: '',
  host: '',
  port: 22,
  username: '',
  password: '',
  privateKey: '',
  passphrase: '',
  authMethod: 'password',
};

const Terminal = () => {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitRef = useRef(null);
  const socketRef = useRef(null);

  const [machines, setMachines] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState({ type: 'idle', message: 'Not connected' });
  const [connected, setConnected] = useState(false);
  const [activeMachine, setActiveMachine] = useState(null);
  const [saving, setSaving] = useState(false);

  const fetchMachines = async () => {
    const res = await axios.get(`${apiBase}/api/machines`);
    setMachines(res.data);
  };

  useEffect(() => {
    fetchMachines().catch((err) => {
      setStatus({ type: 'error', message: err.response?.data?.error || err.message });
    });
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const socket = io(apiBase, { auth: { token } });
    socketRef.current = socket;

    socket.on('connect_error', (err) => {
      setConnected(false);
      setStatus({ type: 'error', message: err.message });
    });

    socket.on('output', (data) => {
      if (xtermRef.current) xtermRef.current.write(data);
    });

    socket.on('ssh-status', (s) => {
      setStatus(s);
      if (s.type === 'ready') {
        setConnected(true);
        if (xtermRef.current) xtermRef.current.writeln(`\r\nConnected: ${s.message}`);
      } else if (s.type === 'closed') {
        setConnected(false);
        setActiveMachine(null);
        if (xtermRef.current) xtermRef.current.writeln(`\r\n${s.message}`);
      } else if (s.type === 'error') {
        setConnected(false);
        setActiveMachine(null);
        if (xtermRef.current) xtermRef.current.writeln(`\r\nError: ${s.message}`);
      }
    });

    return () => socket.disconnect();
  }, []);

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

  const update = (key) => (e) => setForm((current) => ({ ...current, [key]: e.target.value }));

  const handleSaveMachine = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await axios.post(`${apiBase}/api/machines`, {
        ...form,
        port: Number(form.port) || 22,
      });
      setForm(emptyForm);
      await fetchMachines();
      setStatus({ type: 'idle', message: 'Machine saved' });
    } catch (err) {
      setStatus({ type: 'error', message: err.response?.data?.error || err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMachine = async (machine) => {
    if (!window.confirm(`Delete ${machine.name}?`)) return;
    try {
      await axios.delete(`${apiBase}/api/machines/${machine.id}`);
      setMachines((current) => current.filter((item) => item.id !== machine.id));
      setStatus({ type: 'idle', message: 'Machine deleted' });
    } catch (err) {
      setStatus({ type: 'error', message: err.response?.data?.error || err.message });
    }
  };

  const handleConnect = (machine) => {
    setActiveMachine(machine);
    setStatus({ type: 'connecting', message: `Connecting to ${machine.name}...` });
    socketRef.current?.emit('ssh-connect', {
      machineId: machine.id,
      cols: 80,
      rows: 30,
    });
  };

  const handleDisconnect = () => {
    socketRef.current?.emit('ssh-disconnect');
  };

  const statusColor =
    status.type === 'ready' ? 'text-emerald-500'
    : status.type === 'error' ? 'text-red-500'
    : status.type === 'connecting' ? 'text-amber-500'
    : 'text-slate-500';

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">SSH Machines</h2>
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

      {connected ? (
        <div className="flex-1 flex flex-col gap-3 min-h-[360px]">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Monitor size={16} />
            <span className="font-mono truncate">
              {activeMachine ? `${activeMachine.username}@${activeMachine.host}:${activeMachine.port}` : 'Active SSH session'}
            </span>
          </div>
          <div className="flex-1 bg-[#0d1117] rounded-lg border border-slate-800 overflow-hidden p-2 min-h-[300px]">
            <div ref={terminalRef} className="h-full w-full" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-5">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-300">Saved Machines</h3>
              <span className="text-xs font-mono text-slate-500">{machines.length} total</span>
            </div>

            {machines.length === 0 ? (
              <div className="border border-dashed border-slate-800 rounded-lg p-6 text-sm text-slate-500">
                No machines saved yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {machines.map((machine) => (
                  <div key={machine.id} className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Server size={16} className="text-blue-500 shrink-0" />
                          <p className="font-medium text-white truncate">{machine.name}</p>
                        </div>
                        <p className="mt-1 text-xs font-mono text-slate-400 truncate">
                          {machine.username}@{machine.host}:{machine.port}
                        </p>
                        <p className="mt-2 text-[11px] uppercase tracking-wider text-slate-500">
                          {machine.authMethod === 'key' ? 'Private key' : 'Password'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteMachine(machine)}
                        className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded"
                        aria-label={`Delete ${machine.name}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleConnect(machine)}
                      disabled={status.type === 'connecting'}
                      className="mt-4 w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium py-2 rounded transition-colors"
                    >
                      <Plug size={16} />
                      Connect
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <form onSubmit={handleSaveMachine} className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Plus size={16} className="text-blue-500" />
              <h3 className="text-sm font-semibold text-slate-300">Add Machine</h3>
            </div>

            <div>
              <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={update('name')}
                placeholder="Lab server"
                className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                required
              />
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_92px] gap-3">
              <div>
                <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Host</label>
                <div className="relative mt-1">
                  <Server className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                  <input
                    type="text"
                    value={form.host}
                    onChange={update('host')}
                    placeholder="192.168.1.10"
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

            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => setForm((current) => ({ ...current, authMethod: 'password' }))}
                className={`py-1.5 rounded border transition-colors ${form.authMethod === 'password' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}
              >
                Password
              </button>
              <button
                type="button"
                onClick={() => setForm((current) => ({ ...current, authMethod: 'key' }))}
                className={`py-1.5 rounded border transition-colors ${form.authMethod === 'key' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}
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
                  <label className="text-xs font-mono text-slate-500 uppercase tracking-wider">Passphrase</label>
                  <input
                    type="password"
                    value={form.passphrase}
                    onChange={update('passphrase')}
                    placeholder="Optional"
                    className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors"
            >
              <Plus size={16} />
              {saving ? 'Saving...' : 'Save Machine'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default Terminal;
