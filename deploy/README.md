# Homebase NAS — Docker app with host NAS agent

When Homebase runs in Docker, the app container can only see container state.
The NAS dashboard needs a small host-side agent so it can read the real Ubuntu
host files, services, mounts, Samba config, and NFS exports.

## 1. System packages

```bash
sudo apt update
sudo apt install -y nodejs npm samba samba-common-bin nfs-kernel-server
```

## 2. One-shot installer (recommended)

```bash
sudo deploy/setup-nas-agent.sh
```

The installer creates the `homebase` system user, copies `nas-agent/` and the
NAS router into `/opt/homebase-nas-agent`, runs `npm install --omit=dev`,
installs the privileged helper at `/usr/local/sbin/homebase-nas-helper` plus
the matching `/etc/sudoers.d/homebase-nas`, generates a random
`NAS_AGENT_TOKEN` into `/etc/homebase/nas-agent.env`, and registers the
systemd unit so it starts on boot. It prints the token at the end so you can
paste it into the Docker backend's `.env`.

Re-running the script keeps the existing token and just re-syncs the agent
files and helper.

## 3. Manual install (if you prefer)

```bash
sudo useradd --system --home-dir /opt/homebase --shell /usr/sbin/nologin homebase
sudo install -d -o homebase -g homebase /opt/homebase
sudo install -d -o homebase -g homebase /opt/homebase-nas-agent
sudo cp -a nas-agent/* /opt/homebase-nas-agent/
sudo cp server/nas.js /opt/homebase-nas-agent/nas-router.js
sudo chown -R homebase:homebase /opt/homebase-nas-agent
sudo -u homebase bash -c 'cd /opt/homebase-nas-agent && npm install --omit=dev'
```

The agent defaults to read-only mode. It provides host discovery first:
`/health`, `/overview`, `/services`, `/network`, `/drives`, `/mounts`,
`/samba/shares`, `/samba/connections`, `/samba/users`, `/nfs/exports`, and
`/nfs/connections`.

## 4. Optional write permissions (granular — no blanket sudo)

```bash
sudo install -Dm755 deploy/homebase-nas-helper /usr/local/sbin/homebase-nas-helper
sudo install -m 0440 deploy/homebase-nas.sudoers /etc/sudoers.d/homebase-nas
sudo visudo -cf /etc/sudoers.d/homebase-nas       # must print "parsed OK"
```

Edit the file if your service user is named something other than `homebase`.
The sudoers file grants the backend only the controlled NAS helper plus
read-only discovery commands. It does not grant `NOPASSWD: ALL`.

For read-only discovery, the agent can still report whatever the `homebase`
service user can read and execute. Install the helper when you are ready to
enable write/service actions.

## 5. systemd unit for the host agent

```bash
sudo install -m 0644 deploy/homebase-nas-agent.service /etc/systemd/system/homebase-nas-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now homebase-nas-agent.service
sudo journalctl -u homebase-nas-agent -f
```

The unit reads `/etc/homebase/nas-agent.env` via `EnvironmentFile=`, so
`NAS_AGENT_TOKEN` lives in that file (created by `setup-nas-agent.sh` with
`0640 root:homebase` permissions). To rotate the token, edit the file and
restart `homebase-nas-agent.service`.

## 6. Docker app configuration

`docker-compose.yml` configures the backend container with:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
environment:
  - NAS_AGENT_URL=http://host.docker.internal:3015
  - NAS_AGENT_TOKEN=${NAS_AGENT_TOKEN}
```

Rebuild after changing compose or the frontend nginx config:

```bash
docker compose up --build -d
```

## 7. Verify

```bash
# On the host:
curl -s http://localhost:3015/health | jq .
curl -s http://localhost:3015/network | jq .
curl -s http://localhost:3015/drives | jq .
curl -s http://localhost:3015/samba/shares | jq .

# From inside the backend container:
docker exec homebase-server curl -s http://host.docker.internal:3015/health

# Through the app backend:
curl -s http://localhost:3001/api/nas/health -H "Authorization: Bearer $TOKEN" | jq .
```

## Overrides

The backend looks at these env vars (set in `/opt/homebase/.env`):

- `NAS_SMB_CONF` — path to smb.conf (default `/etc/samba/smb.conf`)
- `NAS_EXPORTS_FILE` — path to exports (default `/etc/exports`)
- `NAS_HELPER` — root helper path (default `/usr/local/sbin/homebase-nas-helper`)
- `NAS_AGENT_URL` — Docker backend proxy target for host NAS data
- `NAS_AGENT_TOKEN` — optional shared token sent by Docker backend to the host agent
- `PORT` — listen port (default `3001`)
- `JWT_SECRET` — auth secret (must match the rest of homebase)

## Troubleshooting

- If the dashboard says "Host NAS agent not connected", verify
  `systemctl status homebase-nas-agent` on the host and
  `docker exec homebase-server curl http://host.docker.internal:3015/health`.
- If health says the helper is unavailable, write/service actions will not work;
  reinstall `/usr/local/sbin/homebase-nas-helper` and validate sudoers with
  `visudo`.
- If config writes fail, check `journalctl -u homebase -n 100` and run
  `sudo testparm -s /etc/samba/smb.conf` or `sudo exportfs -ra` on the host.
- If the frontend can log in but NAS panels fail in Vite development, set
  `VITE_API_BASE_URL=http://server-ip:3001` or use the default port 3001 on the
  same host.
