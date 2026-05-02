# Homebase NAS — host install

The NAS dashboard requires the backend to run on the Ubuntu host (not in a
container) so it can read `/etc/samba/smb.conf`, `/etc/exports`, `/proc`, and
shell out to `smbstatus`, `pdbedit`, `systemctl`, `mount`, etc.

## 1. System packages

```bash
sudo apt update
sudo apt install -y nodejs npm samba samba-common-bin nfs-kernel-server
```

## 2. Service user

```bash
sudo useradd --system --home-dir /opt/homebase --shell /usr/sbin/nologin homebase
sudo install -d -o homebase -g homebase /opt/homebase
```

## 3. Code + dependencies

```bash
sudo rsync -a --delete /path/to/checkout/ /opt/homebase/
sudo chown -R homebase:homebase /opt/homebase
sudo -u homebase bash -c 'cd /opt/homebase/server && npm install --omit=dev'
sudo -u homebase bash -c 'cd /opt/homebase/client && npm install && npm run build'
```

Serve `/opt/homebase/client/dist` from nginx (or any static host) and proxy
`/api/*` and `/socket.io/*` to `http://127.0.0.1:3001`.

## 4. Sudo permissions (granular — no blanket sudo)

```bash
sudo install -m 0440 deploy/homebase-nas.sudoers /etc/sudoers.d/homebase-nas
sudo visudo -cf /etc/sudoers.d/homebase-nas       # must print "parsed OK"
```

Edit the file if your service user is named something other than `homebase`.

## 5. systemd unit

```bash
sudo install -m 0644 deploy/homebase.service /etc/systemd/system/homebase.service
sudo systemctl daemon-reload
sudo systemctl enable --now homebase.service
sudo journalctl -u homebase -f
```

## 6. Verify

```bash
curl -s http://127.0.0.1:3001/api/nas/services \
  -H "Authorization: Bearer $TOKEN" | jq .
```

## Overrides

The backend looks at these env vars (set in `/opt/homebase/.env`):

- `NAS_SMB_CONF` — path to smb.conf (default `/etc/samba/smb.conf`)
- `NAS_EXPORTS_FILE` — path to exports (default `/etc/exports`)
- `PORT` — listen port (default `3001`)
- `JWT_SECRET` — auth secret (must match the rest of homebase)
