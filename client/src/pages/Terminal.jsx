import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { io } from 'socket.io-client';
import 'xterm/css/xterm.css';

const Terminal = () => {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    const term = new XTerm({
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
      },
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    const socket = io('http://localhost:3001');
    socketRef.current = socket;
    xtermRef.current = term;

    term.onData((data) => {
      socket.emit('input', data);
    });

    socket.on('output', (data) => {
      term.write(data);
    });

    window.addEventListener('resize', () => fitAddon.fit());

    return () => {
      socket.disconnect();
      term.dispose();
    };
  }, []);

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold">System Terminal</h2>
        <button 
          onClick={() => window.location.reload()}
          className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1 rounded text-slate-400 transition-colors"
        >
          Reconnect
        </button>
      </div>
      <div className="flex-1 bg-[#0d1117] rounded-xl border border-slate-800 overflow-hidden p-2">
        <div ref={terminalRef} className="h-full w-full" />
      </div>
    </div>
  );
};

export default Terminal;
