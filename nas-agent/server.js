const express = require('express');
const path = require('path');

process.env.NAS_AGENT_MODE = 'host';
process.env.NAS_READ_ONLY = process.env.NAS_READ_ONLY || '1';

function loadNasRouter() {
  const localRouter = path.join(__dirname, 'nas-router.js');
  try {
    return require(localRouter);
  } catch (_) {
    return require('../server/nas');
  }
}

const app = express();
const router = loadNasRouter();
const port = Number(process.env.PORT || 3015);
const bindHost = process.env.BIND_HOST || '127.0.0.1';
const token = process.env.NAS_AGENT_TOKEN || '';

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  if (!token) return next();
  const supplied = req.get('x-nas-agent-token') || req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (supplied === token) return next();
  return res.status(401).json({ success: false, error: 'NAS agent token is missing or invalid.' });
});

app.use('/', router);

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'NAS agent route not found.' });
});

app.listen(port, bindHost, () => {
  console.log(`Homebase NAS host agent listening on ${bindHost}:${port}`);
});
