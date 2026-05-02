// NAS management router. Mounted at /api/nas by server/index.js.
//
// The read paths are intentionally tolerant: the dashboard should still show
// partial system state when one tool is missing or one config file is invalid.
// Privileged writes and service changes prefer /usr/local/sbin/homebase-nas-helper
// so sudoers can grant one narrow, audited command instead of broad shell access.

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const router = express.Router();

const SMB_CONF = process.env.NAS_SMB_CONF || '/etc/samba/smb.conf';
const EXPORTS_FILE = process.env.NAS_EXPORTS_FILE || '/etc/exports';
const HELPER = process.env.NAS_HELPER || '/usr/local/sbin/homebase-nas-helper';

const RESERVED_SMB_SECTIONS = new Set(['global', 'homes', 'printers', 'print$']);
const ALLOWED_SERVICES = new Set(['smbd', 'nmbd', 'nfs-kernel-server']);
const ALLOWED_SERVICE_ACTIONS = new Set(['status', 'start', 'stop', 'restart', 'reload']);
const NFS_OPTIONS = new Set([
  'rw', 'ro', 'sync', 'async', 'secure', 'insecure',
  'root_squash', 'no_root_squash', 'all_squash', 'no_all_squash',
  'subtree_check', 'no_subtree_check', 'crossmnt', 'nohide',
  'fsid=0', 'fsid=root',
]);
const SAFE_MOUNT_ROOTS = ['/mnt', '/media', '/run/media', '/Xube'];
const DANGEROUS_MOUNTPOINTS = new Set([
  '/', '/boot', '/boot/efi', '/dev', '/etc', '/home', '/opt',
  '/proc', '/root', '/run', '/srv', '/sys', '/tmp', '/usr', '/var',
]);

const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
const USER_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,31}\$?$/;
const HOST_RE = /^(\*|[A-Za-z0-9_.:-]+|\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?|[A-Fa-f0-9:]+(?:\/\d{1,3})?)$/;
const SAFE_PATH_RE = /^\/[^\0\r\n]*$/;

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res, status, error, details) {
  const body = { success: false, error };
  if (details !== undefined) body.details = details;
  return res.status(status).json(body);
}

function logError(req, err) {
  console.error(`[nas] ${req.method} ${req.originalUrl}:`, err && err.stack ? err.stack : err);
}

function asyncRoute(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      logError(req, err);
      fail(res, err.statusCode || 500, err.publicMessage || err.message || 'NAS operation failed.');
    }
  };
}

function httpError(statusCode, message, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.publicMessage = message;
  if (details !== undefined) err.details = details;
  return err;
}

function run(command, args = [], { input, timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      finish(-1, 'TIMEOUT');
    }, timeout);
    function finish(code, signal) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code == null ? -1 : code, signal: signal || null, stdout, stderr });
    }
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => finish(-1, err.code || 'ERROR'));
    child.on('close', finish);
    if (input != null) {
      child.stdin.write(input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

const sudo = (args, opts = {}) => run('sudo', ['-n', ...args], opts);

function shellMessage(label, result) {
  const text = (result.stderr || result.stdout || '').trim();
  const reason = result.signal === 'TIMEOUT'
    ? 'timed out'
    : result.signal === 'ENOENT'
      ? 'binary not found'
      : `exit ${result.code}`;
  return `${label} failed (${reason})${text ? `: ${text}` : ''}`;
}

async function commandExists(name) {
  const result = await run('which', [name], { timeout: 3000 });
  return result.code === 0 ? result.stdout.trim() : null;
}

async function sudoReadFile(filePath) {
  try {
    return await fsp.readFile(filePath, 'utf8');
  } catch (directErr) {
    const result = await sudo(['cat', filePath]);
    if (result.code === 0) return result.stdout;
    throw httpError(500, `Unable to read ${filePath}.`, {
      direct: directErr.message,
      sudo: shellMessage(`sudo cat ${filePath}`, result),
    });
  }
}

async function helper(action, args = [], opts = {}) {
  const result = await sudo([HELPER, action, ...args], opts);
  if (result.code !== 0) throw httpError(500, shellMessage(`helper ${action}`, result));
  return result;
}

function validateAbsolutePath(value, label = 'Path') {
  const valueText = String(value || '').trim();
  if (!valueText || !SAFE_PATH_RE.test(valueText)) throw httpError(400, `${label} must be an absolute path.`);
  if (valueText.includes('/../') || valueText.endsWith('/..')) throw httpError(400, `${label} cannot contain parent-directory traversal.`);
  return valueText;
}

function isDangerousMountpoint(mountpoint) {
  if (!mountpoint) return true;
  const clean = path.posix.normalize(mountpoint);
  const appRoot = path.resolve(__dirname, '..');
  if (DANGEROUS_MOUNTPOINTS.has(clean)) return true;
  if (clean.startsWith('/var/lib/docker') || clean.startsWith('/var/lib/containerd')) return true;
  if (appRoot.startsWith(clean.endsWith('/') ? clean : `${clean}/`)) return true;
  return false;
}

function isSafeMountRoot(mountpoint) {
  const clean = path.posix.normalize(mountpoint);
  return SAFE_MOUNT_ROOTS.some((root) => clean === root || clean.startsWith(`${root}/`));
}

function validateShareName(name) {
  const clean = String(name || '').trim();
  if (!NAME_RE.test(clean)) throw httpError(400, 'Share name must start with a letter, number, or underscore and contain only letters, numbers, dot, dash, and underscore.');
  if (RESERVED_SMB_SECTIONS.has(clean.toLowerCase())) throw httpError(400, 'That Samba section is reserved.');
  return clean;
}

function validateUsername(username) {
  const clean = String(username || '').trim();
  if (!USER_RE.test(clean)) throw httpError(400, 'Invalid username.');
  return clean;
}

function parseBool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(yes|true|1|on)$/i.test(String(value).trim());
}

function boolToSamba(value) {
  return value ? 'yes' : 'no';
}

function parseSmbConf(text) {
  const sections = [];
  let current = { name: null, lines: [] };
  sections.push(current);

  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    const header = trimmed.match(/^\[([^\]]+)]$/);
    if (header) {
      current = { name: header[1].trim(), lines: [{ raw, type: 'header' }] };
      sections.push(current);
      continue;
    }

    const keyMatch = trimmed.match(/^([^#;=\s][^=]*?)\s*=\s*(.*)$/);
    if (keyMatch) {
      current.lines.push({
        raw,
        type: 'kv',
        key: keyMatch[1].trim().toLowerCase(),
        originalKey: keyMatch[1].trim(),
        value: keyMatch[2].trim(),
      });
    } else {
      current.lines.push({ raw, type: 'raw' });
    }
  }

  return sections;
}

function serializeSmbConf(sections) {
  const lines = [];
  sections.forEach((section, sectionIndex) => {
    section.lines.forEach((line, lineIndex) => {
      if (sectionIndex === 0 && lineIndex === 0 && line.raw === '') return;
      if (line.type === 'kv') lines.push(`   ${line.originalKey || line.key} = ${line.value}`);
      else if (line.type === 'header') lines.push(`[${section.name}]`);
      else lines.push(line.raw || '');
    });
  });
  return `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd()}\n`;
}

function getSmbValue(section, key, fallback = '') {
  const match = section.lines.find((line) => line.type === 'kv' && line.key === key);
  return match ? match.value : fallback;
}

function setSmbValue(section, key, value, displayKey = key) {
  section.lines = section.lines.filter((line) => !(line.type === 'kv' && line.key === key && (value == null || value === '')));
  if (value == null || value === '') return;
  const existing = section.lines.find((line) => line.type === 'kv' && line.key === key);
  if (existing) {
    existing.value = String(value);
    return;
  }
  section.lines.push({ type: 'kv', key, originalKey: displayKey, value: String(value) });
}

function shareFromSection(section) {
  const readOnlyValue = getSmbValue(section, 'read only', '');
  const writableValue = getSmbValue(section, 'writable', getSmbValue(section, 'writeable', ''));
  const readOnly = readOnlyValue
    ? parseBool(readOnlyValue, false)
    : !parseBool(writableValue, true);
  const enabled = parseBool(getSmbValue(section, 'available', 'yes'), true);
  return {
    name: section.name,
    path: getSmbValue(section, 'path', ''),
    comment: getSmbValue(section, 'comment', ''),
    browsable: parseBool(getSmbValue(section, 'browseable', getSmbValue(section, 'browsable', 'yes')), true),
    readOnly,
    writable: !readOnly,
    guestOk: parseBool(getSmbValue(section, 'guest ok', getSmbValue(section, 'public', 'no')), false),
    validUsers: getSmbValue(section, 'valid users', ''),
    writeList: getSmbValue(section, 'write list', ''),
    createMask: getSmbValue(section, 'create mask', ''),
    directoryMask: getSmbValue(section, 'directory mask', ''),
    enabled,
    available: enabled,
  };
}

function applySharePayload(section, payload) {
  if ('path' in payload) setSmbValue(section, 'path', validateAbsolutePath(payload.path, 'Share path'));
  if ('comment' in payload) setSmbValue(section, 'comment', String(payload.comment || '').slice(0, 200));
  const hasReadOnly = 'readOnly' in payload;
  const hasWritable = 'writable' in payload;
  if (hasReadOnly || hasWritable) {
    const readOnly = hasReadOnly ? Boolean(payload.readOnly) : !Boolean(payload.writable);
    setSmbValue(section, 'read only', boolToSamba(readOnly), 'read only');
    setSmbValue(section, 'writable', boolToSamba(!readOnly), 'writable');
  }
  if ('browsable' in payload || 'browseable' in payload) {
    setSmbValue(section, 'browseable', boolToSamba(Boolean(payload.browsable ?? payload.browseable)), 'browseable');
  }
  if ('guestOk' in payload) setSmbValue(section, 'guest ok', boolToSamba(Boolean(payload.guestOk)), 'guest ok');
  if ('validUsers' in payload) setSmbValue(section, 'valid users', String(payload.validUsers || '').trim(), 'valid users');
  if ('writeList' in payload) setSmbValue(section, 'write list', String(payload.writeList || '').trim(), 'write list');
  if ('createMask' in payload) {
    const mask = String(payload.createMask || '').trim();
    if (mask && !/^[0-7]{3,4}$/.test(mask)) throw httpError(400, 'Create mask must be an octal mode such as 0664.');
    setSmbValue(section, 'create mask', mask, 'create mask');
  }
  if ('directoryMask' in payload) {
    const mask = String(payload.directoryMask || '').trim();
    if (mask && !/^[0-7]{3,4}$/.test(mask)) throw httpError(400, 'Directory mask must be an octal mode such as 0775.');
    setSmbValue(section, 'directory mask', mask, 'directory mask');
  }
  if ('enabled' in payload || 'available' in payload) {
    setSmbValue(section, 'available', boolToSamba(Boolean(payload.enabled ?? payload.available)), 'available');
  }
}

async function readSmbConf() {
  return sudoReadFile(SMB_CONF);
}

async function writeSmbConf(text) {
  const result = await sudo([HELPER, 'write-smb-conf'], { input: text, timeout: 30000 });
  if (result.code !== 0) throw httpError(500, shellMessage('write smb.conf', result));
}

function visibleSmbSections(sections) {
  return sections.filter((section) => section.name && !RESERVED_SMB_SECTIONS.has(section.name.toLowerCase()));
}

async function listSambaShares() {
  const sections = parseSmbConf(await readSmbConf());
  const counts = await getShareConnectionCounts().catch(() => ({}));
  return visibleSmbSections(sections).map((section) => {
    const share = shareFromSection(section);
    return { ...share, activeConnections: counts[share.name] || 0 };
  });
}

function parseExportsLine(line) {
  let exportPath = '';
  let rest = line.trim();
  if (!rest || rest.startsWith('#')) return null;
  if (rest.startsWith('"')) {
    const end = rest.indexOf('"', 1);
    if (end < 0) return null;
    exportPath = rest.slice(1, end);
    rest = rest.slice(end + 1).trim();
  } else {
    const match = rest.match(/^(\S+)\s*(.*)$/);
    if (!match) return null;
    exportPath = match[1];
    rest = match[2] || '';
  }

  const tokens = rest.match(/\S+\([^)]*\)|\S+/g) || [];
  const clients = tokens.map((token) => {
    const match = token.match(/^([^(]+)(?:\(([^)]*)\))?$/);
    if (!match) return null;
    return {
      host: match[1],
      options: (match[2] || '').split(',').map((option) => option.trim()).filter(Boolean),
    };
  }).filter(Boolean);

  return { path: exportPath, clients };
}

function exportId(exportPath) {
  return encodeURIComponent(exportPath);
}

function serializeExportsLine(entry) {
  const exportPath = entry.path.includes(' ') ? `"${entry.path}"` : entry.path;
  const clients = entry.clients.map((client) => `${client.host}(${client.options.join(',')})`).join(' ');
  return `${exportPath} ${clients}`.trim();
}

async function readExports() {
  try {
    return await sudoReadFile(EXPORTS_FILE);
  } catch (err) {
    if (err.details && String(err.details.direct || '').includes('ENOENT')) return '';
    throw err;
  }
}

function listExportsFromText(text) {
  return text.split(/\r?\n/).map((raw, lineNumber) => {
    const parsed = parseExportsLine(raw);
    return parsed ? { id: exportId(parsed.path), lineNumber, ...parsed } : null;
  }).filter(Boolean);
}

async function listNfsExports() {
  return listExportsFromText(await readExports());
}

async function validateExportPayload(body, { requireExistingPath = true } = {}) {
  const exportPath = validateAbsolutePath(body && body.path, 'Export path');
  if (requireExistingPath) {
    try {
      const stat = await fsp.stat(exportPath);
      if (!stat.isDirectory()) throw httpError(400, 'NFS export path must be an existing directory.');
    } catch (err) {
      if (err.statusCode) throw err;
      throw httpError(400, `NFS export path does not exist: ${exportPath}`);
    }
  }
  if (!Array.isArray(body.clients) || body.clients.length === 0) {
    throw httpError(400, 'At least one NFS client is required.');
  }
  const clients = body.clients.map((client) => {
    const host = String(client.host || '').trim();
    if (!HOST_RE.test(host)) throw httpError(400, `Invalid NFS client host: ${host || '(empty)'}`);
    const options = Array.isArray(client.options) && client.options.length ? client.options : ['rw', 'sync', 'no_subtree_check'];
    options.forEach((option) => {
      if (!NFS_OPTIONS.has(option)) throw httpError(400, `Unsupported NFS option: ${option}`);
    });
    return { host, options };
  });
  return { path: exportPath, clients };
}

async function writeExports(text) {
  const result = await sudo([HELPER, 'write-exports'], { input: text, timeout: 30000 });
  if (result.code !== 0) throw httpError(500, shellMessage('write exports', result));
}

async function rewriteExports(mutator) {
  const text = await readExports();
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const nextLines = await mutator(lines);
  await writeExports(`${nextLines.join('\n').trimEnd()}\n`);
}

async function smbstatusJson() {
  const direct = await run('smbstatus', ['--json'], { timeout: 12000 });
  const result = direct.code === 0 ? direct : await sudo(['smbstatus', '--json'], { timeout: 12000 });
  if (result.code !== 0) throw new Error(shellMessage('smbstatus --json', result));
  return JSON.parse(result.stdout || '{}');
}

function normalizeSmbJsonConnections(data) {
  const sessions = data.sessions || {};
  const tcons = data.tcons || {};
  const openFiles = data.open_files || {};
  const sessionShares = {};
  const openFilesByTcon = {};
  Object.values(openFiles).forEach((file) => {
    const tcon = String(file.tcon_id || file.tcon || '');
    if (tcon) openFilesByTcon[tcon] = (openFilesByTcon[tcon] || 0) + 1;
  });
  const openFilesBySession = {};
  Object.entries(tcons).forEach(([tconId, tcon]) => {
    const sessionId = String(tcon.session_id || tcon.sess_id || tcon.session || tcon.pid || '');
    const share = tcon.share || tcon.service;
    if (!sessionId) return;
    if (share) (sessionShares[sessionId] = sessionShares[sessionId] || []).push(share);
    openFilesBySession[sessionId] = (openFilesBySession[sessionId] || 0) + (openFilesByTcon[tconId] || 0);
  });
  return Object.entries(sessions).map(([pid, session]) => ({
    pid: String(session.pid || pid),
    username: session.username || session.user || '',
    user: session.username || session.user || '',
    host: session.remote_machine || session.machine || session.client || '',
    ip: session.remote_ip || session.ipaddr || '',
    share: (sessionShares[pid] || [])[0] || '',
    shares: sessionShares[pid] || [],
    connectedAt: session.connect_at || session.connected_at || null,
    openFiles: openFilesBySession[pid] || 0,
  }));
}

async function smbstatusTextConnections() {
  const direct = await run('smbstatus', [], { timeout: 12000 });
  const result = direct.code === 0 ? direct : await sudo(['smbstatus'], { timeout: 12000 });
  if (result.code !== 0) throw new Error(shellMessage('smbstatus', result));
  const rows = [];
  let inPidSection = false;
  for (const raw of result.stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^PID\s+Username\s+Group/i.test(line)) { inPidSection = true; continue; }
    if (!inPidSection || !line || /^-+$/.test(line)) continue;
    if (/^Service\s+pid/i.test(line)) break;
    const parts = line.split(/\s+/);
    if (/^\d+$/.test(parts[0])) {
      rows.push({ pid: parts[0], username: parts[1] || '', user: parts[1] || '', host: '', ip: '', shares: [], share: '', connectedAt: null, openFiles: 0 });
    }
  }
  return rows;
}

async function getSambaConnections() {
  try {
    return normalizeSmbJsonConnections(await smbstatusJson());
  } catch (_) {
    return smbstatusTextConnections();
  }
}

async function getShareConnectionCounts() {
  const counts = {};
  const connections = await getSambaConnections();
  connections.forEach((connection) => {
    (connection.shares || []).forEach((share) => {
      counts[share] = (counts[share] || 0) + 1;
    });
  });
  return counts;
}

async function listSambaUsers() {
  const direct = await run('pdbedit', ['-L'], { timeout: 12000 });
  const result = direct.code === 0 ? direct : await sudo(['pdbedit', '-L'], { timeout: 12000 });
  if (result.code !== 0) throw httpError(500, shellMessage('pdbedit -L', result));
  return result.stdout.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [username, uid, fullName] = line.split(':');
      return { username, uid: Number(uid) || null, fullName: fullName || '' };
    });
}

async function assertLinuxUser(username) {
  const result = await run('getent', ['passwd', username], { timeout: 5000 });
  if (result.code !== 0) {
    throw httpError(400, `Linux user "${username}" does not exist. Create the system user first, then add the Samba password.`);
  }
}

async function setSambaPassword(username, password, add) {
  if (String(password || '').length < 8) throw httpError(400, 'Password must be at least 8 characters.');
  if (add) await assertLinuxUser(username);
  const args = add ? ['smbpasswd-add', username] : ['smbpasswd-change', username];
  const result = await sudo([HELPER, ...args], { input: `${password}\n${password}\n`, timeout: 20000 });
  if (result.code !== 0) throw httpError(500, shellMessage('smbpasswd', result));
}

async function deleteSambaUser(username) {
  const result = await sudo([HELPER, 'smbpasswd-delete', username], { timeout: 15000 });
  if (result.code !== 0) throw httpError(500, shellMessage('delete Samba user', result));
}

async function getNfsConnections() {
  const direct = await run('showmount', ['-a', '--no-headers'], { timeout: 12000 });
  const result = direct.code === 0 ? direct : await sudo(['showmount', '-a', '--no-headers'], { timeout: 12000 });
  if (result.code !== 0) throw httpError(500, shellMessage('showmount -a', result));
  return result.stdout.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(':');
      const host = idx >= 0 ? line.slice(0, idx) : line;
      const exportPath = idx >= 0 ? line.slice(idx + 1) : '';
      return { host, client: host, export: exportPath, exportPath, mountInfo: exportPath || 'best effort from showmount', status: 'reported by showmount' };
    });
}

async function getServiceStatus(name) {
  if (!ALLOWED_SERVICES.has(name)) throw httpError(400, 'Service not allowed.');
  const props = 'ActiveState,SubState,LoadState,UnitFileState,ActiveEnterTimestamp,Description,StatusText';
  const result = await run('systemctl', ['show', name, `--property=${props}`], { timeout: 8000 });
  const data = {};
  if (result.code === 0) {
    result.stdout.split(/\r?\n/).forEach((line) => {
      const idx = line.indexOf('=');
      if (idx >= 0) data[line.slice(0, idx)] = line.slice(idx + 1);
    });
  }
  let lastLine = '';
  if (result.code !== 0 || data.ActiveState !== 'active') {
    const status = await run('systemctl', ['status', name, '--no-pager', '-l'], { timeout: 8000 });
    lastLine = (status.stdout || status.stderr || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-1)[0] || '';
  }
  let uptimeSec = null;
  if (data.ActiveEnterTimestamp) {
    const started = new Date(data.ActiveEnterTimestamp);
    if (!Number.isNaN(started.getTime())) uptimeSec = Math.max(0, Math.floor((Date.now() - started.getTime()) / 1000));
  }
  return {
    name,
    description: data.Description || name,
    activeState: data.ActiveState || (result.code === 0 ? 'unknown' : 'unavailable'),
    subState: data.SubState || '',
    loadState: data.LoadState || '',
    unitFileState: data.UnitFileState || '',
    enabled: data.UnitFileState === 'enabled',
    activeEnter: data.ActiveEnterTimestamp || null,
    uptimeSec,
    statusLine: data.StatusText || lastLine,
    error: result.code === 0 ? null : shellMessage('systemctl show', result),
  };
}

async function getDrives() {
  const [lsblk, findmnt, df] = await Promise.all([
    run('lsblk', ['-J', '-b', '-o', 'NAME,PATH,SIZE,TYPE,FSTYPE,MOUNTPOINTS,UUID,LABEL,MODEL,SERIAL'], { timeout: 12000 }),
    run('findmnt', ['-J'], { timeout: 12000 }),
    run('df', ['-B1', '--output=source,fstype,size,used,avail,pcent,target'], { timeout: 12000 }),
  ]);
  if (lsblk.code !== 0) throw httpError(500, shellMessage('lsblk', lsblk));

  let block;
  try { block = JSON.parse(lsblk.stdout || '{}'); } catch (err) { throw httpError(500, `Unable to parse lsblk JSON: ${err.message}`); }

  const mountByTarget = {};
  if (findmnt.code === 0) {
    try {
      const parsed = JSON.parse(findmnt.stdout || '{}');
      const walkMount = (node) => {
        if (!node) return;
        if (node.target) mountByTarget[node.target] = node;
        (node.children || []).forEach(walkMount);
      };
      (parsed.filesystems || []).forEach(walkMount);
    } catch (_) {}
  }

  const usageByTarget = {};
  const usageBySource = {};
  if (df.code === 0) {
    df.stdout.split(/\r?\n/).slice(1).forEach((line) => {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 7) return;
      const [source, fstype, size, used, avail, pcent, ...targetParts] = cols;
      const target = targetParts.join(' ');
      const usage = {
        source,
        fstype,
        sizeBytes: Number(size) || 0,
        usedBytes: Number(used) || 0,
        availBytes: Number(avail) || 0,
        usePercent: Number(String(pcent).replace('%', '')) || 0,
        target,
      };
      usageByTarget[target] = usage;
      usageBySource[source] = usage;
    });
  }

  const rows = [];
  const walkBlock = (node, parent = null) => {
    const mountpoints = Array.isArray(node.mountpoints)
      ? node.mountpoints.filter(Boolean)
      : (node.mountpoint ? [node.mountpoint] : []);
    const primaryMount = mountpoints[0] || null;
    const usage = primaryMount ? usageByTarget[primaryMount] : usageBySource[node.path];
    const canUnmount = Boolean(primaryMount && !isDangerousMountpoint(primaryMount) && isSafeMountRoot(primaryMount));
    const canMount = Boolean(!primaryMount && node.path && /^\/dev\//.test(node.path) && (node.type === 'part' || node.type === 'disk'));
    rows.push({
      name: node.name,
      device: node.path || (node.name ? `/dev/${node.name}` : ''),
      path: node.path || '',
      type: node.type || '',
      fstype: node.fstype || null,
      label: node.label || null,
      uuid: node.uuid || null,
      model: node.model || null,
      serial: node.serial || null,
      size: Number(node.size) || 0,
      mountpoint: primaryMount,
      mountpoints,
      mounted: Boolean(primaryMount),
      parent: parent ? parent.name : null,
      usage: usage || null,
      findmnt: primaryMount ? mountByTarget[primaryMount] || null : null,
      canMount,
      canUnmount,
      safetyNote: primaryMount && !canUnmount ? 'Unmount disabled for system, Docker, app, or non-allowlisted mount points.' : '',
    });
    (node.children || []).forEach((child) => walkBlock(child, node));
  };
  (block.blockdevices || []).forEach((device) => walkBlock(device));
  const existingMountpoints = new Set(rows.flatMap((row) => row.mountpoints || []));
  const candidateFolders = [
    '/Xube',
    '/Xube/immich',
    '/Xube/media',
    '/Xube/quran',
    '/Xube/researchpaper',
    '/Xube/school',
    '/Xube/vm',
    '/Xube/xube',
  ];
  try {
    const children = await fsp.readdir('/Xube', { withFileTypes: true });
    children.filter((entry) => entry.isDirectory()).forEach((entry) => {
      candidateFolders.push(path.posix.join('/Xube', entry.name));
    });
  } catch (_) {}

  const uniqueFolders = [...new Set(candidateFolders)];
  for (const folder of uniqueFolders) {
    if (existingMountpoints.has(folder)) continue;
    try {
      const stat = await fsp.stat(folder);
      if (!stat.isDirectory()) continue;
      rows.push({
        name: path.posix.basename(folder) || folder,
        device: '',
        path: folder,
        type: 'folder',
        fstype: 'directory',
        label: null,
        uuid: null,
        model: null,
        serial: null,
        size: 0,
        mountpoint: folder,
        mountpoints: [folder],
        mounted: true,
        parent: path.posix.dirname(folder),
        usage: usageByTarget[folder] || usageByTarget['/Xube'] || null,
        findmnt: mountByTarget[folder] || null,
        canMount: false,
        canUnmount: false,
        safetyNote: 'This is a NAS folder, not a standalone mount.',
      });
    } catch (_) {}
  }
  return rows;
}

async function getNetworkInfo() {
  const [hostname, ips, ipJson] = await Promise.all([
    run('hostname', [], { timeout: 5000 }),
    run('hostname', ['-I'], { timeout: 5000 }),
    run('ip', ['-j', 'addr'], { timeout: 8000 }),
  ]);
  let interfaces = [];
  if (ipJson.code === 0) {
    try {
      interfaces = JSON.parse(ipJson.stdout || '[]').map((iface) => ({
        iface: iface.ifname,
        operstate: iface.operstate,
        mac: iface.address,
        mtu: iface.mtu,
        type: iface.link_type,
        internal: iface.ifname === 'lo',
        addresses: (iface.addr_info || []).map((addr) => ({
          family: addr.family,
          local: addr.local,
          prefixlen: addr.prefixlen,
          scope: addr.scope,
        })),
        ip4: (iface.addr_info || []).find((addr) => addr.family === 'inet')?.local || '',
        ip6: (iface.addr_info || []).find((addr) => addr.family === 'inet6')?.local || '',
      }));
    } catch (_) {}
  }
  return {
    hostname: hostname.stdout.trim() || '',
    primaryIps: ips.stdout.trim().split(/\s+/).filter(Boolean),
    interfaces,
  };
}

async function getOverview() {
  const settled = await Promise.allSettled([
    Promise.all([...ALLOWED_SERVICES].map(getServiceStatus)),
    listSambaShares(),
    listNfsExports(),
    getSambaConnections(),
    getNfsConnections(),
    getDrives(),
    getNetworkInfo(),
  ]);
  const value = (index, fallback) => settled[index].status === 'fulfilled' ? settled[index].value : fallback;
  const services = value(0, []);
  const smbShares = value(1, []);
  const nfsExports = value(2, []);
  const sambaConnections = value(3, []);
  const nfsConnections = value(4, []);
  const drives = value(5, []);
  const network = value(6, {});
  return {
    services,
    samba: {
      status: services.find((service) => service.name === 'smbd')?.activeState || 'unknown',
      shares: smbShares.length,
      activeConnections: sambaConnections.length,
    },
    nfs: {
      status: services.find((service) => service.name === 'nfs-kernel-server')?.activeState || 'unknown',
      exports: nfsExports.length,
      activeClients: nfsConnections.length,
    },
    drives: {
      mounted: drives.filter((drive) => drive.mounted).length,
      total: drives.length,
    },
    network: {
      hostname: network.hostname || '',
      primaryIps: network.primaryIps || [],
    },
    errors: settled.map((result, index) => (result.status === 'rejected' ? { index, error: result.reason.message } : null)).filter(Boolean),
    refreshedAt: new Date().toISOString(),
  };
}

router.get('/health', asyncRoute(async (req, res) => {
  const commandNames = ['smbstatus', 'pdbedit', 'smbpasswd', 'testparm', 'systemctl', 'exportfs', 'showmount', 'lsblk', 'findmnt', 'df', 'hostname', 'ip'];
  const commands = {};
  await Promise.all(commandNames.map(async (name) => { commands[name] = await commandExists(name); }));
  const configs = {};
  for (const filePath of [SMB_CONF, EXPORTS_FILE]) {
    try {
      await sudoReadFile(filePath);
      configs[filePath] = { readable: true };
    } catch (err) {
      configs[filePath] = { readable: false, error: err.message };
    }
  }
  const helperCheck = await sudo([HELPER, 'health'], { timeout: 5000 });
  ok(res, {
    commands,
    configs,
    helper: {
      path: HELPER,
      available: helperCheck.code === 0,
      message: helperCheck.code === 0 ? helperCheck.stdout.trim() : shellMessage('helper health', helperCheck),
    },
    services: await Promise.all([...ALLOWED_SERVICES].map((name) => getServiceStatus(name).catch((err) => ({ name, error: err.message })))),
  });
}));

router.get('/overview', asyncRoute(async (req, res) => ok(res, await getOverview())));

router.get('/samba/shares', asyncRoute(async (req, res) => ok(res, await listSambaShares())));
router.get('/shares', asyncRoute(async (req, res) => ok(res, await listSambaShares())));

router.get('/samba/shares/:name', asyncRoute(async (req, res) => {
  const name = validateShareName(req.params.name);
  const share = (await listSambaShares()).find((candidate) => candidate.name === name);
  if (!share) throw httpError(404, 'Samba share not found.');
  ok(res, share);
}));

router.post('/samba/shares', asyncRoute(async (req, res) => {
  const name = validateShareName(req.body && req.body.name);
  const sections = parseSmbConf(await readSmbConf());
  if (sections.some((section) => section.name && section.name.toLowerCase() === name.toLowerCase())) {
    throw httpError(409, 'A Samba share with that name already exists.');
  }
  const section = { name, lines: [{ type: 'header', raw: `[${name}]` }] };
  applySharePayload(section, { readOnly: false, browsable: true, guestOk: false, enabled: true, ...req.body, name });
  sections.push(section);
  await writeSmbConf(serializeSmbConf(sections));
  ok(res, shareFromSection(section), 201);
}));
router.post('/shares', asyncRoute(async (req, res) => {
  req.url = '/samba/shares';
  return router.handle(req, res);
}));

router.put('/samba/shares/:name', asyncRoute(async (req, res) => {
  const name = validateShareName(req.params.name);
  const sections = parseSmbConf(await readSmbConf());
  const section = sections.find((candidate) => candidate.name === name);
  if (!section) throw httpError(404, 'Samba share not found.');
  applySharePayload(section, req.body || {});
  await writeSmbConf(serializeSmbConf(sections));
  ok(res, shareFromSection(section));
}));
router.put('/shares/:name', asyncRoute(async (req, res) => {
  req.url = `/samba/shares/${encodeURIComponent(req.params.name)}`;
  return router.handle(req, res);
}));

router.delete('/samba/shares/:name', asyncRoute(async (req, res) => {
  const name = validateShareName(req.params.name);
  const sections = parseSmbConf(await readSmbConf());
  const next = sections.filter((section) => section.name !== name);
  if (next.length === sections.length) throw httpError(404, 'Samba share not found.');
  await writeSmbConf(serializeSmbConf(next));
  ok(res, { deleted: true });
}));
router.delete('/shares/:name', asyncRoute(async (req, res) => {
  req.url = `/samba/shares/${encodeURIComponent(req.params.name)}`;
  return router.handle(req, res);
}));

router.post('/samba/shares/:name/toggle', asyncRoute(async (req, res) => {
  const name = validateShareName(req.params.name);
  const sections = parseSmbConf(await readSmbConf());
  const section = sections.find((candidate) => candidate.name === name);
  if (!section) throw httpError(404, 'Samba share not found.');
  applySharePayload(section, { enabled: Boolean(req.body && req.body.enabled) });
  await writeSmbConf(serializeSmbConf(sections));
  ok(res, shareFromSection(section));
}));
router.post('/shares/:name/toggle', asyncRoute(async (req, res) => {
  req.url = `/samba/shares/${encodeURIComponent(req.params.name)}/toggle`;
  return router.handle(req, res);
}));

router.get('/samba/users', asyncRoute(async (req, res) => ok(res, await listSambaUsers())));
router.get('/samba/users/:username', asyncRoute(async (req, res) => {
  const username = validateUsername(req.params.username);
  const user = (await listSambaUsers()).find((candidate) => candidate.username === username);
  if (!user) throw httpError(404, 'Samba user not found.');
  ok(res, user);
}));
router.post('/samba/users', asyncRoute(async (req, res) => {
  const username = validateUsername(req.body && req.body.username);
  await setSambaPassword(username, req.body && req.body.password, true);
  ok(res, { username }, 201);
}));
router.delete('/samba/users/:username', asyncRoute(async (req, res) => {
  const username = validateUsername(req.params.username);
  await deleteSambaUser(username);
  ok(res, { deleted: true });
}));
router.post('/samba/users/:username/password', asyncRoute(async (req, res) => {
  const username = validateUsername(req.params.username);
  await setSambaPassword(username, req.body && req.body.password, false);
  ok(res, { changed: true });
}));

router.get('/samba/connections', asyncRoute(async (req, res) => ok(res, await getSambaConnections())));
router.post('/samba/connections/:pid/disconnect', asyncRoute(async (req, res) => {
  const pid = String(req.params.pid || '');
  if (!/^\d+$/.test(pid)) throw httpError(400, 'Invalid Samba session PID.');
  const result = await sudo([HELPER, 'disconnect-samba-pid', pid], { timeout: 10000 });
  if (result.code !== 0) throw httpError(500, shellMessage('disconnect Samba session', result));
  ok(res, { disconnected: true, pid });
}));

router.get('/nfs/exports', asyncRoute(async (req, res) => ok(res, await listNfsExports())));
router.get('/exports', asyncRoute(async (req, res) => ok(res, await listNfsExports())));

router.get('/nfs/exports/:id', asyncRoute(async (req, res) => {
  const targetPath = decodeURIComponent(req.params.id);
  const entry = (await listNfsExports()).find((candidate) => candidate.path === targetPath);
  if (!entry) throw httpError(404, 'NFS export not found.');
  ok(res, entry);
}));

router.post('/nfs/exports', asyncRoute(async (req, res) => {
  const entry = await validateExportPayload(req.body || {});
  await rewriteExports((lines) => {
    if (listExportsFromText(lines.join('\n')).some((existing) => existing.path === entry.path)) {
      throw httpError(409, 'An NFS export already exists for that path.');
    }
    return [...lines, serializeExportsLine(entry)];
  });
  ok(res, { id: exportId(entry.path), ...entry }, 201);
}));
router.post('/exports', asyncRoute(async (req, res) => {
  req.url = '/nfs/exports';
  return router.handle(req, res);
}));

router.put('/nfs/exports/:id', asyncRoute(async (req, res) => {
  const targetPath = decodeURIComponent(req.params.id);
  const entry = await validateExportPayload({ ...(req.body || {}), path: req.body?.path || targetPath });
  let replaced = false;
  await rewriteExports((lines) => lines.map((raw) => {
    const parsed = parseExportsLine(raw);
    if (parsed && parsed.path === targetPath) {
      replaced = true;
      return serializeExportsLine(entry);
    }
    return raw;
  }));
  if (!replaced) throw httpError(404, 'NFS export not found.');
  ok(res, { id: exportId(entry.path), ...entry });
}));
router.put('/exports/:id', asyncRoute(async (req, res) => {
  req.url = `/nfs/exports/${encodeURIComponent(req.params.id)}`;
  return router.handle(req, res);
}));

router.delete('/nfs/exports/:id', asyncRoute(async (req, res) => {
  const targetPath = decodeURIComponent(req.params.id);
  let removed = false;
  await rewriteExports((lines) => lines.filter((raw) => {
    const parsed = parseExportsLine(raw);
    if (parsed && parsed.path === targetPath) {
      removed = true;
      return false;
    }
    return true;
  }));
  if (!removed) throw httpError(404, 'NFS export not found.');
  ok(res, { deleted: true });
}));
router.delete('/exports/:id', asyncRoute(async (req, res) => {
  req.url = `/nfs/exports/${encodeURIComponent(req.params.id)}`;
  return router.handle(req, res);
}));

router.post('/nfs/exports/reload', asyncRoute(async (req, res) => {
  await helper('reload-nfs', [], { timeout: 20000 });
  ok(res, { reloaded: true });
}));
router.post('/exports/reload', asyncRoute(async (req, res) => {
  req.url = '/nfs/exports/reload';
  return router.handle(req, res);
}));

router.get('/nfs/connections', asyncRoute(async (req, res) => ok(res, await getNfsConnections())));

router.get('/services', asyncRoute(async (req, res) => {
  ok(res, await Promise.all([...ALLOWED_SERVICES].map((name) => getServiceStatus(name).catch((err) => ({
    name,
    activeState: 'unknown',
    error: err.message,
  })))));
}));

router.post('/services/:service/:action', asyncRoute(async (req, res) => {
  const { service, action } = req.params;
  if (!ALLOWED_SERVICES.has(service)) throw httpError(400, 'Service not allowed.');
  if (!ALLOWED_SERVICE_ACTIONS.has(action) || action === 'status') throw httpError(400, 'Service action not allowed.');
  await helper('service-action', [service, action], { timeout: 30000 });
  ok(res, await getServiceStatus(service));
}));

router.get('/drives', asyncRoute(async (req, res) => ok(res, await getDrives())));
router.get('/mounts', asyncRoute(async (req, res) => ok(res, await getDrives())));

router.post('/mounts/mount', asyncRoute(async (req, res) => {
  const device = String(req.body?.device || '').trim();
  const mountpoint = validateAbsolutePath(req.body?.mountpoint, 'Mount point');
  const fstype = String(req.body?.fstype || '').trim();
  const options = String(req.body?.options || 'defaults').trim();
  if (!/^\/dev\/[A-Za-z0-9_.\/-]+$/.test(device)) throw httpError(400, 'Invalid device path.');
  if (isDangerousMountpoint(mountpoint) || !isSafeMountRoot(mountpoint)) {
    throw httpError(400, 'Mount point is outside the NAS safe mount roots.');
  }
  if (fstype && !/^[A-Za-z0-9_.-]+$/.test(fstype)) throw httpError(400, 'Invalid filesystem type.');
  if (options && !/^[A-Za-z0-9_=,.-]+$/.test(options)) throw httpError(400, 'Invalid mount options.');
  const args = [device, mountpoint, fstype || 'auto', options || 'defaults'];
  await helper('mount', args, { timeout: 30000 });
  ok(res, { mounted: true });
}));

router.post('/mounts/unmount', asyncRoute(async (req, res) => {
  const target = validateAbsolutePath(req.body?.target, 'Unmount target');
  if (isDangerousMountpoint(target) || !isSafeMountRoot(target)) {
    throw httpError(400, 'Unmount refused for system, Docker, app, or non-allowlisted mount points.');
  }
  await helper('unmount', [target], { timeout: 30000 });
  ok(res, { unmounted: true });
}));

router.get('/network', asyncRoute(async (req, res) => ok(res, await getNetworkInfo())));

module.exports = router;
