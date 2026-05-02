const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const si = require('systeminformation');
const Docker = require('dockerode');
const { Client: SSHClient } = require('ssh2');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const db = new Database('homebase.db');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Initialize DB
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    description TEXT,
    status TEXT,
    priority TEXT,
    org TEXT,
    due_date TEXT
  );
  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    url TEXT,
    category TEXT,
    color TEXT,
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS machines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER DEFAULT 22,
    username TEXT NOT NULL,
    auth_method TEXT NOT NULL DEFAULT 'password',
    password TEXT,
    private_key TEXT,
    passphrase TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'homebase_secret_key_7860';
const AUTH_USER = "xube";
const AUTH_PASS = "7860";

// Simple Auth Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Login Route
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === AUTH_USER && password === AUTH_PASS) {
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ token, user: { name: 'xube' } });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

// API Endpoints (Protected)
app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    const cpu = await si.currentLoad();
    const mem = await si.mem();
    const disk = await si.fsSize();
    const net = await si.networkStats();
    const os = await si.osInfo();
    const uptime = si.time().uptime;

    res.json({
      cpu: cpu.currentLoad.toFixed(2),
      mem: ((mem.active / mem.total) * 100).toFixed(2),
      disk: disk[0] ? disk[0].use.toFixed(2) : 0,
      netIn: net[0] ? (net[0].rx_sec / 1024).toFixed(2) : 0,
      netOut: net[0] ? (net[0].tx_sec / 1024).toFixed(2) : 0,
      uptime,
      hostname: os.hostname,
      os: os.distro
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/docker/containers', authenticateToken, async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true });
    res.json(containers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/docker/action', authenticateToken, async (req, res) => {
  const { id, action } = req.body;
  const container = docker.getContainer(id);
  try {
    if (action === 'start') await container.start();
    if (action === 'stop') await container.stop();
    if (action === 'restart') await container.restart();
    if (action === 'remove') await container.remove();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects', authenticateToken, (req, res) => {
  const rows = db.prepare('SELECT * FROM projects').all();
  res.json(rows);
});

app.post('/api/projects', authenticateToken, (req, res) => {
  const { title, description, status, priority, org, due_date } = req.body;
  const info = db.prepare('INSERT INTO projects (title, description, status, priority, org, due_date) VALUES (?, ?, ?, ?, ?, ?)').run(title, description, status, priority, org, due_date);
  res.json({ id: info.lastInsertRowid });
});

app.get('/api/links', authenticateToken, (req, res) => {
  const rows = db.prepare('SELECT * FROM links').all();
  res.json(rows);
});

app.post('/api/links', authenticateToken, (req, res) => {
  const { title, url, category, color, notes } = req.body;
  const info = db.prepare('INSERT INTO links (title, url, category, color, notes) VALUES (?, ?, ?, ?, ?)').run(title, url, category, color, notes);
  res.json({ id: info.lastInsertRowid });
});

const publicMachineSelect = `
  SELECT id, name, host, port, username, auth_method AS authMethod, created_at AS createdAt, updated_at AS updatedAt
  FROM machines
`;

app.get('/api/machines', authenticateToken, (req, res) => {
  const rows = db.prepare(`${publicMachineSelect} ORDER BY name COLLATE NOCASE`).all();
  res.json(rows);
});

app.post('/api/machines', authenticateToken, (req, res) => {
  const {
    name,
    host,
    port = 22,
    username,
    authMethod = 'password',
    password,
    privateKey,
    passphrase,
  } = req.body || {};

  const cleanName = String(name || '').trim();
  const cleanHost = String(host || '').trim();
  const cleanUsername = String(username || '').trim();
  const cleanAuthMethod = authMethod === 'key' ? 'key' : 'password';
  const cleanPort = Number(port) || 22;

  if (!cleanName || !cleanHost || !cleanUsername) {
    return res.status(400).json({ error: 'Name, host, and username are required.' });
  }
  if (cleanAuthMethod === 'password' && !password) {
    return res.status(400).json({ error: 'Password is required for password auth.' });
  }
  if (cleanAuthMethod === 'key' && !privateKey) {
    return res.status(400).json({ error: 'Private key is required for key auth.' });
  }

  const info = db.prepare(`
    INSERT INTO machines (name, host, port, username, auth_method, password, private_key, passphrase)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    cleanName,
    cleanHost,
    cleanPort,
    cleanUsername,
    cleanAuthMethod,
    cleanAuthMethod === 'password' ? password : null,
    cleanAuthMethod === 'key' ? privateKey : null,
    cleanAuthMethod === 'key' ? (passphrase || null) : null
  );

  const machine = db.prepare(`${publicMachineSelect} WHERE id = ?`).get(info.lastInsertRowid);
  res.status(201).json(machine);
});

app.delete('/api/machines/:id', authenticateToken, (req, res) => {
  const info = db.prepare('DELETE FROM machines WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Machine not found.' });
  res.json({ success: true });
});

let updateState = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  exitCode: null,
  output: '',
  error: null,
};

const updateCwd = process.env.HOMEBASE_UPDATE_CWD || path.resolve(__dirname, '..');
const updateCommand = process.env.HOMEBASE_UPDATE_COMMAND || (
  fs.existsSync(path.join(updateCwd, '.git')) ? 'git pull --ff-only' : ''
);

const getUpdateStatus = () => ({
  ...updateState,
  configured: Boolean(updateCommand),
  cwd: updateCwd,
});

app.get('/api/system/update', authenticateToken, (req, res) => {
  res.json(getUpdateStatus());
});

app.post('/api/system/update', authenticateToken, (req, res) => {
  if (!updateCommand) {
    return res.status(400).json({
      error: 'Update command is not configured. Set HOMEBASE_UPDATE_COMMAND to enable one-click updates.',
    });
  }
  if (updateState.running) {
    return res.status(409).json({ error: 'An update is already running.' });
  }

  updateState = {
    running: true,
    lastStartedAt: new Date().toISOString(),
    lastFinishedAt: null,
    exitCode: null,
    output: '',
    error: null,
  };

  const child = spawn(updateCommand, {
    cwd: updateCwd,
    shell: true,
    env: process.env,
  });

  const appendOutput = (chunk) => {
    updateState.output = (updateState.output + chunk.toString()).slice(-12000);
  };

  child.stdout.on('data', appendOutput);
  child.stderr.on('data', appendOutput);
  child.on('error', (err) => {
    updateState.running = false;
    updateState.lastFinishedAt = new Date().toISOString();
    updateState.error = err.message;
  });
  child.on('close', (code) => {
    updateState.running = false;
    updateState.lastFinishedAt = new Date().toISOString();
    updateState.exitCode = code;
    if (code !== 0 && !updateState.error) updateState.error = `Update exited with code ${code}.`;
  });

  res.status(202).json(getUpdateStatus());
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required.'));

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return next(new Error('Invalid token.'));
    socket.user = user;
    next();
  });
});

// WebSocket for SSH Terminal — browser selects a saved machine by id
io.on('connection', (socket) => {
  let sshClient = null;
  let sshStream = null;

  const cleanup = () => {
    try { sshStream && sshStream.end(); } catch (_) {}
    try { sshClient && sshClient.end(); } catch (_) {}
    sshStream = null;
    sshClient = null;
  };

  socket.on('ssh-connect', (creds) => {
    if (sshClient) {
      socket.emit('ssh-status', { type: 'error', message: 'Already connected. Disconnect first.' });
      return;
    }

    const machine = creds?.machineId
      ? db.prepare('SELECT * FROM machines WHERE id = ?').get(creds.machineId)
      : null;

    if (creds?.machineId && !machine) {
      socket.emit('ssh-status', { type: 'error', message: 'Machine not found.' });
      return;
    }

    const { cols, rows } = creds || {};
    const host = machine?.host || creds?.host;
    const port = machine?.port || creds?.port;
    const username = machine?.username || creds?.username;
    const password = machine ? machine.password : creds?.password;
    const privateKey = machine ? machine.private_key : creds?.privateKey;
    const passphrase = machine ? machine.passphrase : creds?.passphrase;

    if (!host || !username || (!password && !privateKey)) {
      socket.emit('ssh-status', { type: 'error', message: 'Missing required SSH credentials.' });
      return;
    }

    const client = new SSHClient();
    sshClient = client;

    client
      .on('ready', () => {
        socket.emit('ssh-status', { type: 'ready', message: `Connected to ${username}@${host}` });
        client.shell({ term: 'xterm-color', cols: cols || 80, rows: rows || 30 }, (err, stream) => {
          if (err) {
            socket.emit('ssh-status', { type: 'error', message: err.message });
            cleanup();
            return;
          }
          sshStream = stream;
          stream.on('data', (data) => socket.emit('output', data.toString('utf-8')));
          stream.stderr.on('data', (data) => socket.emit('output', data.toString('utf-8')));
          stream.on('close', () => {
            socket.emit('ssh-status', { type: 'closed', message: 'Session closed.' });
            cleanup();
          });
        });
      })
      .on('error', (err) => {
        socket.emit('ssh-status', { type: 'error', message: err.message });
        cleanup();
      })
      .on('end', () => {
        socket.emit('ssh-status', { type: 'closed', message: 'Connection ended.' });
        cleanup();
      })
      .on('close', () => {
        socket.emit('ssh-status', { type: 'closed', message: 'Connection closed.' });
        cleanup();
      });

    const connectOpts = {
      host,
      port: port || 22,
      username,
      readyTimeout: 15000,
    };
    if (password) connectOpts.password = password;
    if (privateKey) {
      connectOpts.privateKey = privateKey;
      if (passphrase) connectOpts.passphrase = passphrase;
    }

    try {
      client.connect(connectOpts);
    } catch (err) {
      socket.emit('ssh-status', { type: 'error', message: err.message });
      cleanup();
    }
  });

  socket.on('input', (data) => {
    if (sshStream) sshStream.write(data);
  });

  socket.on('resize', (size) => {
    if (sshStream && size && size.cols && size.rows) {
      try { sshStream.setWindow(size.rows, size.cols); } catch (_) {}
    }
  });

  socket.on('ssh-disconnect', () => {
    cleanup();
    socket.emit('ssh-status', { type: 'closed', message: 'Disconnected.' });
  });

  socket.on('disconnect', cleanup);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
