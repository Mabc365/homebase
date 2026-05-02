const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const si = require('systeminformation');
const Docker = require('dockerode');
const pty = require('node-pty');
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

// WebSocket for Terminal (Token validation could be added here too)
io.on('connection', (socket) => {
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    cwd: process.env.HOME,
    env: process.env
  });

  ptyProcess.on('data', (data) => {
    socket.emit('output', data);
  });

  socket.on('input', (data) => {
    ptyProcess.write(data);
  });

  socket.on('resize', (size) => {
    ptyProcess.resize(size.cols, size.rows);
  });

  socket.on('disconnect', () => {
    ptyProcess.kill();
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
