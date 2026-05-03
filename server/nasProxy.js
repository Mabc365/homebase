const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const nasRouter = require('./nas');

const router = express.Router();
const NAS_AGENT_URL = process.env.NAS_AGENT_URL || '';
const NAS_AGENT_TOKEN = process.env.NAS_AGENT_TOKEN || '';

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res, status, error, details) {
  const body = { success: false, error };
  if (details !== undefined) body.details = details;
  return res.status(status).json(body);
}

function isRunningInDocker() {
  if (fs.existsSync('/.dockerenv')) return true;
  try {
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    return /docker|containerd|kubepods|podman/i.test(cgroup);
  } catch (_) {
    return false;
  }
}

function dockerDiagnostic(reachable = false, details) {
  return {
    backendRunningInDocker: isRunningInDocker(),
    nasAgentUrlConfigured: Boolean(NAS_AGENT_URL),
    nasAgentReachable: reachable,
    nasAgentUrl: NAS_AGENT_URL || null,
    message: reachable
      ? 'NAS host agent connected.'
      : 'NAS host agent is required because the backend is running inside Docker.',
    details,
  };
}

function missingAgentOverview() {
  return {
    source: {
      kind: 'missing-host-agent',
      backendRunningInDocker: true,
      containerDataSuppressed: true,
    },
    samba: { status: 'host agent missing', shares: 0, activeConnections: 0 },
    nfs: { status: 'host agent missing', exports: 0, activeClients: 0 },
    drives: { mounted: null, total: null },
    network: { hostname: 'Host NAS agent not connected.', primaryIps: [] },
    errors: [{ error: 'Host NAS agent not connected.' }],
    diagnostics: dockerDiagnostic(false),
    refreshedAt: new Date().toISOString(),
  };
}

function proxyToAgent(req, res) {
  const target = new URL(req.url || '/', NAS_AGENT_URL);
  const client = target.protocol === 'https:' ? https : http;
  const body = req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : null;
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  if (body) headers['content-length'] = Buffer.byteLength(body);
  if (NAS_AGENT_TOKEN) headers['x-nas-agent-token'] = NAS_AGENT_TOKEN;

  const upstream = client.request(target, {
    method: req.method,
    headers,
    timeout: 30000,
  }, (upstreamRes) => {
    let text = '';
    upstreamRes.setEncoding('utf8');
    upstreamRes.on('data', (chunk) => { text += chunk; });
    upstreamRes.on('end', () => {
      let payload;
      try {
        payload = text ? JSON.parse(text) : { success: true, data: null };
      } catch (_) {
        return fail(res, 502, 'NAS host agent returned non-JSON response.', text.slice(0, 500));
      }
      if (req.path === '/health' && payload && payload.success !== false) {
        payload.data = {
          ...(payload.data || {}),
          backend: dockerDiagnostic(true),
        };
      }
      return res.status(upstreamRes.statusCode || 502).json(payload);
    });
  });

  upstream.on('timeout', () => {
    upstream.destroy(new Error('NAS host agent request timed out.'));
  });
  upstream.on('error', (err) => {
    if (req.path === '/health') {
      return ok(res, dockerDiagnostic(false, err.message), 503);
    }
    if (req.path === '/overview') {
      return ok(res, missingAgentOverview(), 200);
    }
    return fail(res, 503, 'Host NAS agent not connected.', dockerDiagnostic(false, err.message));
  });
  if (body) upstream.write(body);
  upstream.end();
  return null;
}

router.use((req, res, next) => {
  const runningInDocker = isRunningInDocker();
  if (NAS_AGENT_URL) return proxyToAgent(req, res);
  if (!runningInDocker) return nasRouter(req, res, next);

  if (req.path === '/health') return ok(res, dockerDiagnostic(false), 503);
  if (req.path === '/overview') return ok(res, missingAgentOverview());
  return fail(res, 503, 'Host NAS agent not connected.', dockerDiagnostic(false));
});

module.exports = router;
