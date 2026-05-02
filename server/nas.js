// NAS management router — Samba + NFS + services + mounts.
// Mounted at /api/nas in server/index.js. Auth is applied at mount time.
//
// Most operations shell out to system tools (smbstatus, pdbedit, systemctl,
// lsblk, exportfs, mount, umount). Several need root; those are invoked via
// `sudo -n <command>` and require matching entries in deploy/homebase-nas.sudoers.

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const si = require('systeminformation');

const router = express.Router();

const SMB_CONF = process.env.NAS_SMB_CONF || '/etc/samba/smb.conf';
const EXPORTS_FILE = process.env.NAS_EXPORTS_FILE || '/etc/exports';
const SAMBA_RESERVED_SECTIONS = new Set(['global', 'homes', 'printers', 'print$']);
const ALLOWED_SERVICES = new Set(['smbd', 'nmbd', 'nfs-kernel-server']);

// ---------- shell helpers ----------

function run(cmd, args = [], { input, timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: process.env });
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (code, signal) => {
      if (done) return;
      done = true;
      resolve({ code: code ?? -1, signal: signal || null, stdout, stderr });
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      finish(-1, 'TIMEOUT');
    }, timeout);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); finish(-1, err.code || 'ERROR'); });
    child.on('close', (code, signal) => { clearTimeout(timer); finish(code, signal); });
    if (input != null) {
      try { child.stdin.write(input); child.stdin.end(); } catch (_) {}
    }
  });
}

const sudo = (cmd, args = [], opts = {}) => run('sudo', ['-n', cmd, ...args], opts);

function explainShellError(label, result) {
  const msg = (result.stderr || result.stdout || '').trim();
  const reason = result.signal === 'TIMEOUT'
    ? 'timed out'
    : result.signal === 'ENOENT'
      ? 'binary not found'
      : `exit ${result.code}`;
  return `${label} failed (${reason})${msg ? `: ${msg}` : ''}`;
}

// ---------- smb.conf parsing ----------
// Minimal INI-like parser tailored for smb.conf. Preserves the order of
// sections and their key/value pairs but discards inline comments. Handles
// `key = value` and `key value` (Samba accepts both with `=`).

function parseSmbConf(text) {
  const sections = []; // [{ name, lines: [{key,value}] }]
  let current = null;
  const ensureCurrent = (name) => {
    current = { name, lines: [] };
    sections.push(current);
  };
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) { ensureCurrent(sec[1].trim()); continue; }
    if (!current) ensureCurrent('global');
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    current.lines.push({ key, value });
  }
  return sections;
}

function serializeSmbConf(sections) {
  const out = [];
  for (const sec of sections) {
    out.push(`[${sec.name}]`);
    for (const { key, value } of sec.lines) out.push(`   ${key} = ${value}`);
    out.push('');
  }
  return out.join('\n');
}

function shareFromSection(sec) {
  const get = (k, def = '') => {
    const hit = sec.lines.find((l) => l.key === k);
    return hit ? hit.value : def;
  };
  const truthy = (v) => /^(yes|true|1|on)$/i.test(String(v || '').trim());
  const path = get('path', '');
  const comment = get('comment', '');
  const writable = truthy(get('writable', get('read only', 'no') === 'no' ? 'yes' : 'no'));
  const browseable = truthy(get('browseable', 'yes'));
  const guestOk = truthy(get('guest ok', get('public', 'no')));
  const validUsers = get('valid users', '');
  const available = !get('available', '') || truthy(get('available', 'yes'));
  return {
    name: sec.name,
    path,
    comment,
    writable,
    browseable,
    guestOk,
    validUsers,
    available,
  };
}

function applyShareOverrides(sec, payload) {
  const upsert = (key, value) => {
    if (value == null || value === '') {
      sec.lines = sec.lines.filter((l) => l.key !== key);
      return;
    }
    const hit = sec.lines.find((l) => l.key === key);
    if (hit) hit.value = String(value);
    else sec.lines.push({ key, value: String(value) });
  };
  if ('path' in payload) upsert('path', payload.path);
  if ('comment' in payload) upsert('comment', payload.comment);
  if ('writable' in payload) {
    upsert('writable', payload.writable ? 'yes' : 'no');
    upsert('read only', payload.writable ? 'no' : 'yes');
  }
  if ('browseable' in payload) upsert('browseable', payload.browseable ? 'yes' : 'no');
  if ('guestOk' in payload) upsert('guest ok', payload.guestOk ? 'yes' : 'no');
  if ('validUsers' in payload) upsert('valid users', payload.validUsers || '');
  if ('available' in payload) upsert('available', payload.available ? 'yes' : 'no');
}

async function readSmbConf() {
  const result = await sudo('cat', [SMB_CONF]);
  if (result.code !== 0) {
    // Fall back to direct read if sudo not configured for cat (smb.conf is
    // world-readable on most distros).
    try { return await fsp.readFile(SMB_CONF, 'utf8'); }
    catch (err) { throw new Error(explainShellError('read smb.conf', result) + ` / ${err.message}`); }
  }
  return result.stdout;
}

async function writeSmbConf(text) {
  // Write via tee so we can stay non-root. Backup first.
  const backupPath = `${SMB_CONF}.homebase.bak`;
  await sudo('cp', ['-f', SMB_CONF, backupPath]);
  const teeResult = await sudo('tee', [SMB_CONF], { input: text });
  if (teeResult.code !== 0) throw new Error(explainShellError('write smb.conf', teeResult));
  // Reload Samba config without restarting active sessions.
  await sudo('smbcontrol', ['smbd', 'reload-config']);
}

// ---------- /etc/exports parsing ----------
// Each non-comment line: <path>  <client(opts)> <client(opts)> ...
// We model an "export" per (path) line. Editing rewrites the line in place.

function parseExportsLine(line) {
  // path may be quoted if it contains spaces.
  let path = '';
  let rest = line.trim();
  if (rest.startsWith('"')) {
    const end = rest.indexOf('"', 1);
    if (end < 0) return null;
    path = rest.slice(1, end);
    rest = rest.slice(end + 1).trim();
  } else {
    const m = rest.match(/^(\S+)\s*(.*)$/);
    if (!m) return null;
    path = m[1];
    rest = m[2];
  }
  const clients = [];
  // Tokenize by whitespace but keep parentheses contents together.
  const tokens = rest.match(/\S+\([^)]*\)|\S+/g) || [];
  for (const tok of tokens) {
    const m = tok.match(/^([^(]+)(?:\(([^)]*)\))?$/);
    if (!m) continue;
    clients.push({ host: m[1], options: (m[2] || '').split(',').map((s) => s.trim()).filter(Boolean) });
  }
  return { path, clients };
}

function serializeExportsLine(entry) {
  const safePath = entry.path.includes(' ') ? `"${entry.path}"` : entry.path;
  const clients = entry.clients
    .map((c) => `${c.host}(${(c.options || []).join(',')})`)
    .join(' ');
  return `${safePath} ${clients}`.trim();
}

async function readExports() {
  const result = await sudo('cat', [EXPORTS_FILE]);
  if (result.code !== 0) {
    try { return await fsp.readFile(EXPORTS_FILE, 'utf8'); }
    catch (err) {
      if (err.code === 'ENOENT') return '';
      throw new Error(explainShellError('read exports', result) + ` / ${err.message}`);
    }
  }
  return result.stdout;
}

function listExports(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parsed = parseExportsLine(trimmed);
    if (!parsed) continue;
    out.push({ id: encodeURIComponent(parsed.path), ...parsed, lineNumber: i });
  }
  return out;
}

async function writeExports(lines) {
  const teeResult = await sudo('tee', [EXPORTS_FILE], { input: `${lines.join('\n')}\n` });
  if (teeResult.code !== 0) throw new Error(explainShellError('write exports', teeResult));
  const reload = await sudo('exportfs', ['-ra']);
  if (reload.code !== 0) throw new Error(explainShellError('exportfs -ra', reload));
}

async function rewriteExports(mutator) {
  const text = await readExports();
  const lines = text.split(/\r?\n/);
  // Drop a trailing blank line caused by split.
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const result = mutator(lines);
  await writeExports(result);
}

// ---------- smbstatus parsing ----------

async function smbstatusJson(args) {
  const result = await sudo('smbstatus', [...args, '--json']);
  if (result.code !== 0) throw new Error(explainShellError('smbstatus', result));
  try { return JSON.parse(result.stdout || '{}'); }
  catch (err) { throw new Error(`smbstatus json parse: ${err.message}`); }
}

async function getSambaConnections() {
  const data = await smbstatusJson([]);
  // Schema: { sessions: { pid: {...} }, tcons: { id: { share, machine, ... } }, open_files: { id: {...} } }
  const sessions = data.sessions || {};
  const tcons = data.tcons || {};
  const openFiles = data.open_files || {};
  const filesByTcon = {};
  for (const f of Object.values(openFiles)) {
    const tcon = f.tcon_id || f.tcon;
    if (!tcon) continue;
    filesByTcon[tcon] = (filesByTcon[tcon] || 0) + 1;
  }
  const filesBySession = {};
  for (const t of Object.values(tcons)) {
    const sid = t.session_id || t.sess_id;
    if (!sid) continue;
    filesBySession[sid] = (filesBySession[sid] || 0) + (filesByTcon[t.tcon_id || t.tid] || 0);
  }
  const tconBySession = {};
  for (const t of Object.values(tcons)) {
    const sid = t.session_id || t.sess_id;
    if (!sid) continue;
    (tconBySession[sid] = tconBySession[sid] || []).push(t.share || t.service);
  }
  return Object.entries(sessions).map(([pid, s]) => ({
    pid,
    user: s.username || s.user || '',
    host: s.remote_machine || s.machine || s.client || '',
    ip: s.remote_ip || s.ipaddr || '',
    connectedAt: s.connect_at || s.session_dialect_str || null,
    shares: tconBySession[pid] || [],
    openFiles: filesBySession[pid] || 0,
  }));
}

async function getShareConnectionCounts() {
  const data = await smbstatusJson([]).catch(() => ({}));
  const tcons = data.tcons || {};
  const counts = {};
  for (const t of Object.values(tcons)) {
    const name = t.share || t.service;
    if (!name) continue;
    counts[name] = (counts[name] || 0) + 1;
  }
  return counts;
}

// ---------- pdbedit (samba users) ----------

async function listSambaUsers() {
  const result = await sudo('pdbedit', ['-L']);
  if (result.code !== 0) throw new Error(explainShellError('pdbedit -L', result));
  return result.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [username, uid, fullName] = line.split(':');
      return { username, uid: Number(uid) || null, fullName: fullName || '' };
    });
}

async function setSambaPassword(username, password) {
  // smbpasswd accepts password twice on stdin via -s -a (add) or -s (set).
  // We try -s alone first; if user doesn't exist, fall back to -a.
  const input = `${password}\n${password}\n`;
  let result = await sudo('smbpasswd', ['-s', username], { input });
  if (result.code !== 0) {
    result = await sudo('smbpasswd', ['-s', '-a', username], { input });
  }
  if (result.code !== 0) throw new Error(explainShellError('smbpasswd', result));
}

async function deleteSambaUser(username) {
  const result = await sudo('smbpasswd', ['-x', username]);
  if (result.code !== 0) throw new Error(explainShellError('smbpasswd -x', result));
}

// ---------- NFS connections ----------

async function getNfsConnections() {
  const result = await sudo('showmount', ['-a', '--no-headers']);
  if (result.code !== 0) throw new Error(explainShellError('showmount -a', result));
  // lines: "host:/path"
  return result.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(':');
      if (idx < 0) return null;
      return {
        host: line.slice(0, idx),
        export: line.slice(idx + 1),
      };
    })
    .filter(Boolean);
}

// ---------- services (systemctl) ----------

async function getServiceStatus(name) {
  if (!ALLOWED_SERVICES.has(name)) throw new Error(`service not allowed: ${name}`);
  const props = ['ActiveState', 'SubState', 'LoadState', 'UnitFileState', 'ActiveEnterTimestamp', 'Description'];
  const result = await run('systemctl', ['show', name, `--property=${props.join(',')}`]);
  const out = {};
  for (const line of result.stdout.split('\n')) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  let uptimeSec = null;
  if (out.ActiveEnterTimestamp) {
    const d = new Date(out.ActiveEnterTimestamp);
    if (!Number.isNaN(d.getTime())) uptimeSec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  }
  return {
    name,
    description: out.Description || name,
    activeState: out.ActiveState || 'unknown',
    subState: out.SubState || '',
    loadState: out.LoadState || '',
    unitFileState: out.UnitFileState || '',
    activeEnter: out.ActiveEnterTimestamp || null,
    uptimeSec,
  };
}

// ---------- mounts (lsblk + df) ----------

async function getMounts() {
  const lsblk = await run('lsblk', ['-J', '-b', '-O']);
  if (lsblk.code !== 0) throw new Error(explainShellError('lsblk', lsblk));
  let tree;
  try { tree = JSON.parse(lsblk.stdout); }
  catch (err) { throw new Error(`lsblk parse: ${err.message}`); }

  const df = await run('df', ['-PB1', '--output=source,size,used,avail,pcent']);
  const usageBySource = {};
  if (df.code === 0) {
    const lines = df.stdout.split('\n').slice(1);
    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 5) continue;
      const [source, size, used, avail, pcent] = cols;
      usageBySource[source] = {
        sizeBytes: Number(size) || 0,
        usedBytes: Number(used) || 0,
        availBytes: Number(avail) || 0,
        usePercent: Number(String(pcent).replace('%', '')) || 0,
      };
    }
  }

  const flat = [];
  const walk = (node, parent) => {
    const device = `/dev/${node.name}`;
    const usage = usageBySource[device] || null;
    flat.push({
      name: node.name,
      device,
      type: node.type,
      fstype: node.fstype || null,
      label: node.label || null,
      uuid: node.uuid || null,
      size: Number(node.size) || 0,
      mountpoint: node.mountpoint || null,
      mountpoints: node.mountpoints || (node.mountpoint ? [node.mountpoint] : []),
      readonly: Boolean(node.ro),
      removable: Boolean(node.rm),
      parent: parent ? parent.name : null,
      usage,
    });
    if (Array.isArray(node.children)) for (const c of node.children) walk(c, node);
  };
  for (const dev of tree.blockdevices || []) walk(dev, null);
  return flat;
}

// ---------- network info ----------

async function getNetworkInfo() {
  const [ifaces, osInfo] = await Promise.all([si.networkInterfaces(), si.osInfo()]);
  return {
    hostname: osInfo.hostname,
    fqdn: osInfo.fqdn || osInfo.hostname,
    interfaces: ifaces.map((i) => ({
      iface: i.iface,
      ip4: i.ip4,
      ip6: i.ip6,
      mac: i.mac,
      type: i.type,
      operstate: i.operstate,
      speed: i.speed,
      duplex: i.duplex,
      mtu: i.mtu,
      internal: i.internal,
    })),
  };
}

// ---------- input validation ----------

const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_\-.]{0,63}$/;
const PATH_RE = /^\/[A-Za-z0-9_\-./ ]+$/;
const HOST_RE = /^[A-Za-z0-9_\-.*?/:]+$/; // permissive: hostnames, CIDRs, wildcards

function badRequest(res, msg) { return res.status(400).json({ error: msg }); }

// ---------- routes: shares ----------

router.get('/shares', async (req, res) => {
  try {
    const conf = await readSmbConf();
    const sections = parseSmbConf(conf);
    const counts = await getShareConnectionCounts().catch(() => ({}));
    const shares = sections
      .filter((s) => !SAMBA_RESERVED_SECTIONS.has(s.name.toLowerCase()))
      .map(shareFromSection)
      .map((s) => ({ ...s, activeConnections: counts[s.name] || 0 }));
    res.json(shares);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/shares', async (req, res) => {
  try {
    const { name, path: sharePath } = req.body || {};
    if (!name || !NAME_RE.test(name)) return badRequest(res, 'Invalid share name.');
    if (!sharePath || !PATH_RE.test(sharePath)) return badRequest(res, 'Invalid share path.');
    if (SAMBA_RESERVED_SECTIONS.has(name.toLowerCase())) return badRequest(res, 'Reserved share name.');

    const conf = await readSmbConf();
    const sections = parseSmbConf(conf);
    if (sections.some((s) => s.name === name)) return res.status(409).json({ error: 'Share already exists.' });
    const sec = { name, lines: [] };
    applyShareOverrides(sec, { path: sharePath, ...req.body });
    sections.push(sec);
    await writeSmbConf(serializeSmbConf(sections));
    res.status(201).json(shareFromSection(sec));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/shares/:name', async (req, res) => {
  try {
    const { name } = req.params;
    if (SAMBA_RESERVED_SECTIONS.has(name.toLowerCase())) return badRequest(res, 'Reserved share name.');
    const conf = await readSmbConf();
    const sections = parseSmbConf(conf);
    const sec = sections.find((s) => s.name === name);
    if (!sec) return res.status(404).json({ error: 'Share not found.' });
    if (req.body.path && !PATH_RE.test(req.body.path)) return badRequest(res, 'Invalid share path.');
    applyShareOverrides(sec, req.body);
    await writeSmbConf(serializeSmbConf(sections));
    res.json(shareFromSection(sec));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/shares/:name', async (req, res) => {
  try {
    const { name } = req.params;
    if (SAMBA_RESERVED_SECTIONS.has(name.toLowerCase())) return badRequest(res, 'Reserved share name.');
    const conf = await readSmbConf();
    const sections = parseSmbConf(conf);
    const next = sections.filter((s) => s.name !== name);
    if (next.length === sections.length) return res.status(404).json({ error: 'Share not found.' });
    await writeSmbConf(serializeSmbConf(next));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/shares/:name/toggle', async (req, res) => {
  try {
    const { name } = req.params;
    const { enabled } = req.body || {};
    if (SAMBA_RESERVED_SECTIONS.has(name.toLowerCase())) return badRequest(res, 'Reserved share name.');
    const conf = await readSmbConf();
    const sections = parseSmbConf(conf);
    const sec = sections.find((s) => s.name === name);
    if (!sec) return res.status(404).json({ error: 'Share not found.' });
    applyShareOverrides(sec, { available: Boolean(enabled) });
    await writeSmbConf(serializeSmbConf(sections));
    res.json(shareFromSection(sec));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- routes: samba connections + users ----------

router.get('/samba/connections', async (req, res) => {
  try { res.json(await getSambaConnections()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/samba/connections/:pid/disconnect', async (req, res) => {
  try {
    const pid = String(req.params.pid).match(/^\d+$/);
    if (!pid) return badRequest(res, 'Invalid PID.');
    const result = await sudo('kill', [pid[0]]);
    if (result.code !== 0) return res.status(500).json({ error: explainShellError('kill', result) });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/samba/users', async (req, res) => {
  try { res.json(await listSambaUsers()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/samba/users', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !NAME_RE.test(username)) return badRequest(res, 'Invalid username.');
    if (!password || password.length < 4) return badRequest(res, 'Password must be at least 4 characters.');
    await setSambaPassword(username, password);
    res.status(201).json({ username });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/samba/users/:name', async (req, res) => {
  try {
    const { name } = req.params;
    if (!NAME_RE.test(name)) return badRequest(res, 'Invalid username.');
    await deleteSambaUser(name);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/samba/users/:name/password', async (req, res) => {
  try {
    const { name } = req.params;
    const { password } = req.body || {};
    if (!NAME_RE.test(name)) return badRequest(res, 'Invalid username.');
    if (!password || password.length < 4) return badRequest(res, 'Password must be at least 4 characters.');
    await setSambaPassword(name, password);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- routes: NFS exports ----------

router.get('/exports', async (req, res) => {
  try {
    const text = await readExports();
    res.json(listExports(text));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function validateExportPayload(body) {
  if (!body || !body.path || !PATH_RE.test(body.path)) return 'Invalid export path.';
  if (!Array.isArray(body.clients) || body.clients.length === 0) return 'At least one client is required.';
  for (const c of body.clients) {
    if (!c.host || !HOST_RE.test(c.host)) return `Invalid client host: ${c.host}`;
    if (c.options && !Array.isArray(c.options)) return 'Client options must be an array.';
    for (const opt of c.options || []) {
      if (!/^[a-z0-9_=,-]+$/i.test(opt)) return `Invalid option: ${opt}`;
    }
  }
  return null;
}

router.post('/exports', async (req, res) => {
  try {
    const err = validateExportPayload(req.body);
    if (err) return badRequest(res, err);
    await rewriteExports((lines) => {
      // Reject duplicate path.
      const existing = listExports(lines.join('\n'));
      if (existing.some((e) => e.path === req.body.path)) {
        const e = new Error('Export already exists for this path.');
        e.statusCode = 409;
        throw e;
      }
      lines.push(serializeExportsLine(req.body));
      return lines;
    });
    res.status(201).json({ id: encodeURIComponent(req.body.path), ...req.body });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/exports/:id', async (req, res) => {
  try {
    const targetPath = decodeURIComponent(req.params.id);
    const next = { path: req.body.path || targetPath, clients: req.body.clients };
    const err = validateExportPayload(next);
    if (err) return badRequest(res, err);
    await rewriteExports((lines) => {
      let replaced = false;
      const out = lines.map((raw) => {
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith('#')) return raw;
        const parsed = parseExportsLine(trimmed);
        if (parsed && parsed.path === targetPath) {
          replaced = true;
          return serializeExportsLine(next);
        }
        return raw;
      });
      if (!replaced) {
        const e = new Error('Export not found.');
        e.statusCode = 404;
        throw e;
      }
      return out;
    });
    res.json({ id: encodeURIComponent(next.path), ...next });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.delete('/exports/:id', async (req, res) => {
  try {
    const targetPath = decodeURIComponent(req.params.id);
    let removed = false;
    await rewriteExports((lines) => {
      const out = lines.filter((raw) => {
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith('#')) return true;
        const parsed = parseExportsLine(trimmed);
        if (parsed && parsed.path === targetPath) { removed = true; return false; }
        return true;
      });
      return out;
    });
    if (!removed) return res.status(404).json({ error: 'Export not found.' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/exports/reload', async (req, res) => {
  try {
    const result = await sudo('exportfs', ['-ra']);
    if (result.code !== 0) return res.status(500).json({ error: explainShellError('exportfs -ra', result) });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/nfs/connections', async (req, res) => {
  try { res.json(await getNfsConnections()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- routes: services ----------

router.get('/services', async (req, res) => {
  try {
    const list = await Promise.all([...ALLOWED_SERVICES].map((n) => getServiceStatus(n).catch((err) => ({
      name: n, error: err.message, activeState: 'unknown',
    }))));
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/services/:name/:action', async (req, res) => {
  try {
    const { name, action } = req.params;
    if (!ALLOWED_SERVICES.has(name)) return badRequest(res, 'Service not allowed.');
    if (!['start', 'stop', 'restart'].includes(action)) return badRequest(res, 'Action not allowed.');
    const result = await sudo('systemctl', [action, name]);
    if (result.code !== 0) return res.status(500).json({ error: explainShellError(`systemctl ${action}`, result) });
    res.json(await getServiceStatus(name));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- routes: network + mounts ----------

router.get('/network', async (req, res) => {
  try { res.json(await getNetworkInfo()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/mounts', async (req, res) => {
  try { res.json(await getMounts()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/mounts/mount', async (req, res) => {
  try {
    const { device, mountpoint, fstype, options } = req.body || {};
    if (!device || !/^\/dev\/[A-Za-z0-9_\-./]+$/.test(device)) return badRequest(res, 'Invalid device.');
    if (!mountpoint || !PATH_RE.test(mountpoint)) return badRequest(res, 'Invalid mountpoint.');
    const args = [];
    if (fstype) {
      if (!/^[a-z0-9]+$/i.test(fstype)) return badRequest(res, 'Invalid fstype.');
      args.push('-t', fstype);
    }
    if (options) {
      if (!/^[a-z0-9_=,-]+$/i.test(options)) return badRequest(res, 'Invalid options.');
      args.push('-o', options);
    }
    args.push(device, mountpoint);
    // Make sure the mountpoint exists.
    await sudo('mkdir', ['-p', mountpoint]);
    const result = await sudo('mount', args);
    if (result.code !== 0) return res.status(500).json({ error: explainShellError('mount', result) });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/mounts/unmount', async (req, res) => {
  try {
    const { target } = req.body || {};
    if (!target) return badRequest(res, 'Target is required.');
    if (!/^\/[A-Za-z0-9_\-./ ]+$/.test(target) && !/^\/dev\/[A-Za-z0-9_\-./]+$/.test(target)) {
      return badRequest(res, 'Invalid target.');
    }
    const result = await sudo('umount', [target]);
    if (result.code !== 0) return res.status(500).json({ error: explainShellError('umount', result) });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
