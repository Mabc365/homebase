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

// WebSocket for SSH Terminal — client supplies host/port/user/password (or key)
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

    const { host, port, username, password, privateKey, passphrase, cols, rows } = creds || {};
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
