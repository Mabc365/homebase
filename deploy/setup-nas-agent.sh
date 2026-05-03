#!/usr/bin/env bash
# Installs the Homebase NAS host agent on this machine.
#
# What it does:
#   - creates the `homebase` system user (if missing)
#   - copies nas-agent/ into /opt/homebase-nas-agent and runs `npm install --omit=dev`
#   - copies server/nas.js as the router so the agent uses the same code as the backend
#   - installs /usr/local/sbin/homebase-nas-helper and /etc/sudoers.d/homebase-nas
#   - generates a random token into /etc/homebase/nas-agent.env (or reuses the existing one)
#   - installs and enables the homebase-nas-agent systemd unit
#   - prints the token so you can paste it into the Docker backend's NAS_AGENT_TOKEN
#
# Re-running is safe: existing tokens are kept and the service is restarted in place.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "setup-nas-agent.sh must be run with sudo or as root." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_SRC="$REPO_ROOT/nas-agent"
ROUTER_SRC="$REPO_ROOT/server/nas.js"
HELPER_SRC="$REPO_ROOT/deploy/homebase-nas-helper"
SUDOERS_SRC="$REPO_ROOT/deploy/homebase-nas.sudoers"
SERVICE_SRC="$REPO_ROOT/deploy/homebase-nas-agent.service"

AGENT_DIR="/opt/homebase-nas-agent"
CONFIG_DIR="/etc/homebase"
CONFIG_FILE="$CONFIG_DIR/nas-agent.env"
HELPER_DST="/usr/local/sbin/homebase-nas-helper"
SUDOERS_DST="/etc/sudoers.d/homebase-nas"
SERVICE_DST="/etc/systemd/system/homebase-nas-agent.service"

SERVICE_USER="${SERVICE_USER:-homebase}"
BIND_HOST="${BIND_HOST:-0.0.0.0}"
PORT="${PORT:-3015}"

for src in "$AGENT_SRC/server.js" "$AGENT_SRC/package.json" "$ROUTER_SRC" "$HELPER_SRC" "$SUDOERS_SRC" "$SERVICE_SRC"; do
  [ -f "$src" ] || { echo "Missing source file: $src" >&2; exit 1; }
done

command -v node >/dev/null 2>&1 || { echo "node is required (apt install nodejs npm)" >&2; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "npm is required (apt install nodejs npm)"  >&2; exit 1; }

echo "==> Ensuring service user '$SERVICE_USER' exists"
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir /opt/homebase --shell /usr/sbin/nologin "$SERVICE_USER"
fi

echo "==> Installing agent files into $AGENT_DIR"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" "$AGENT_DIR"
install -m 0644 -o "$SERVICE_USER" -g "$SERVICE_USER" "$AGENT_SRC/server.js"     "$AGENT_DIR/server.js"
install -m 0644 -o "$SERVICE_USER" -g "$SERVICE_USER" "$AGENT_SRC/package.json"  "$AGENT_DIR/package.json"
install -m 0644 -o "$SERVICE_USER" -g "$SERVICE_USER" "$ROUTER_SRC"              "$AGENT_DIR/nas-router.js"

echo "==> Installing npm dependencies"
sudo -u "$SERVICE_USER" -H bash -lc "cd '$AGENT_DIR' && npm install --omit=dev --no-audit --no-fund"

echo "==> Installing privileged helper at $HELPER_DST"
install -Dm 0755 "$HELPER_SRC" "$HELPER_DST"

echo "==> Installing sudoers fragment at $SUDOERS_DST"
TMP_SUDOERS="$(mktemp /tmp/homebase-nas.sudoers.XXXXXX)"
trap 'rm -f "$TMP_SUDOERS"' EXIT
sed "s/^homebase /${SERVICE_USER} /" "$SUDOERS_SRC" > "$TMP_SUDOERS"
install -m 0440 "$TMP_SUDOERS" "$SUDOERS_DST"
visudo -cf "$SUDOERS_DST" >/dev/null

echo "==> Generating or reusing agent token at $CONFIG_FILE"
install -d -m 0750 -o root -g "$SERVICE_USER" "$CONFIG_DIR"
if [ -s "$CONFIG_FILE" ] && grep -q '^NAS_AGENT_TOKEN=' "$CONFIG_FILE"; then
  TOKEN="$(grep -E '^NAS_AGENT_TOKEN=' "$CONFIG_FILE" | head -n1 | cut -d= -f2-)"
  echo "    Reusing existing token from $CONFIG_FILE"
else
  TOKEN="$(head -c 48 /dev/urandom | base64 | tr -d '/+=' | cut -c1-48)"
  umask 077
  cat > "$CONFIG_FILE" <<EOF
# Homebase NAS host agent. Read by systemd via EnvironmentFile=.
NAS_AGENT_TOKEN=${TOKEN}
PORT=${PORT}
BIND_HOST=${BIND_HOST}
NAS_READ_ONLY=1
EOF
  chown root:"$SERVICE_USER" "$CONFIG_FILE"
  chmod 0640 "$CONFIG_FILE"
fi

echo "==> Installing systemd unit at $SERVICE_DST"
install -m 0644 "$SERVICE_SRC" "$SERVICE_DST"
systemctl daemon-reload
systemctl enable homebase-nas-agent.service >/dev/null
systemctl restart homebase-nas-agent.service

echo
echo "==> Agent service status:"
systemctl --no-pager --lines=0 status homebase-nas-agent.service || true

echo
echo "============================================================"
echo "Homebase NAS host agent installed."
echo
echo "Token (also stored in $CONFIG_FILE):"
echo "    $TOKEN"
echo
echo "Add this to the Docker backend env (e.g. .env at repo root):"
echo "    NAS_AGENT_URL=http://host.docker.internal:${PORT}"
echo "    NAS_AGENT_TOKEN=${TOKEN}"
echo
echo "Then rebuild the backend container:"
echo "    docker compose up --build -d server"
echo "============================================================"
