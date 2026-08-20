#!/usr/bin/env bash
# Belgium Weather & Lightning Radar — Proxmox one-line installer
# Usage (on Proxmox host):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/Emile098/weather-radar/main/install/install.sh)"
#
# Usage (inside existing Debian/Ubuntu LXC or VM — app only):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/Emile098/weather-radar/main/install/install.sh)" -- --app-only

set -euo pipefail

REPO="https://github.com/Emile098/weather-radar.git"
APP_DIR="/opt/belgium-radar"
SERVICE_USER="belgium-radar"
WEB_PORT="${WEB_PORT:-80}"

# ── Defaults (override with env vars) ──
CTID="${CTID:-}"
CT_HOSTNAME="${CT_HOSTNAME:-belgium-radar}"
CT_CORES="${CT_CORES:-1}"
CT_RAM="${CT_RAM:-512}"
CT_DISK="${CT_DISK:-4}"
CT_BRIDGE="${CT_BRIDGE:-vmbr0}"
CT_IP="${CT_IP:-dhcp}"
CT_GATEWAY="${CT_GATEWAY:-}"
CT_DNS="${CT_DNS:-}"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE="${TEMPLATE:-local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst}"
UNPRIVILEGED="${UNPRIVILEGED:-1}"

APP_ONLY=0
if [[ "${1:-}" == "--app-only" ]]; then
  APP_ONLY=1
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

msg()  { echo -e "${CYAN}${BOLD}▸${NC} $*"; }
ok()   { echo -e "${GREEN}${BOLD}✔${NC} $*"; }
fail() { echo -e "${RED}${BOLD}✖${NC} $*" >&2; exit 1; }

require_root() {
  [[ $EUID -eq 0 ]] || fail "Run as root (or use sudo)."
}

pick_ctid() {
  if [[ -n "$CTID" ]]; then
    return
  fi
  CTID=$(pvesh get /cluster/nextid 2>/dev/null || echo "")
  [[ -n "$CTID" ]] || fail "Could not determine next CTID. Set CTID= manually."
}

install_app() {
  msg "Installing application to ${APP_DIR}…"

  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    python3 python3-venv python3-pip git nginx curl ca-certificates

  if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  fi

  rm -rf "$APP_DIR"
  git clone --depth 1 "$REPO" "$APP_DIR"
  python3 -m venv "$APP_DIR/venv"
  "$APP_DIR/venv/bin/pip" install --quiet --upgrade pip
  "$APP_DIR/venv/bin/pip" install --quiet -r "$APP_DIR/app/requirements.txt"

  chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

  cat > /etc/nginx/sites-available/belgium-radar <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
NGINX

  ln -sf /etc/nginx/sites-available/belgium-radar /etc/nginx/sites-enabled/belgium-radar
  rm -f /etc/nginx/sites-enabled/default
  nginx -t

  cat > /etc/systemd/system/belgium-radar.service <<SYSTEMD
[Unit]
Description=Belgium Weather & Lightning Radar Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_DIR}/app
Environment=PORT=8080
ExecStart=${APP_DIR}/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8080
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SYSTEMD

  systemctl daemon-reload
  systemctl enable belgium-radar nginx
  systemctl restart belgium-radar nginx

  ok "Application installed and running on port ${WEB_PORT}"
}

create_lxc() {
  require_root
  command -v pct >/dev/null 2>&1 || fail "pct not found — run this on a Proxmox host."

  pick_ctid
  msg "Creating LXC container CTID=${CTID} (${CT_HOSTNAME})…"

  if pveam available 2>/dev/null | grep -q "debian-12-standard"; then
    TEMPLATE=$(pveam available --section system | awk '/debian-12-standard/ {print $2; exit}')
    msg "Using template: ${TEMPLATE}"
    pveam download local "${TEMPLATE##*/}" 2>/dev/null || true
    TEMPLATE="local:vztmpl/${TEMPLATE##*/}"
  fi

  NET_CONFIG="name=eth0,bridge=${CT_BRIDGE},ip=${CT_IP}"
  [[ -n "$CT_GATEWAY" ]] && NET_CONFIG="${NET_CONFIG},gw=${CT_GATEWAY}"

  PCT_ARGS=(
    create "$CTID" "$TEMPLATE"
    --hostname "$CT_HOSTNAME"
    --cores "$CT_CORES"
    --memory "$CT_RAM"
    --swap 256
    --rootfs "${STORAGE}:${CT_DISK}"
    --net0 "$NET_CONFIG"
    --unprivileged "$UNPRIVILEGED"
    --features nesting=0
    --onboot 1
    --start 0
  )
  [[ -n "$CT_DNS" ]] && PCT_ARGS+=(--nameserver "$CT_DNS")

  pct "${PCT_ARGS[@]}"

  msg "Starting container…"
  pct start "$CTID"
  sleep 5

  msg "Installing app inside container…"
  pct exec "$CTID" -- bash -c "
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y -qq curl git ca-certificates
    bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Emile098/weather-radar/main/install/install.sh)\" -- --app-only
  "

  CT_IP_ADDR=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')
  echo ""
  echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}  Belgium Radar Dashboard — installation complete${NC}"
  echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  Container:  ${BOLD}CT ${CTID}${NC} (${CT_HOSTNAME})"
  echo -e "  Dashboard:  ${BOLD}http://${CT_IP_ADDR:-<container-ip>}/${NC}"
  echo ""
  echo -e "  Manage:  ${CYAN}pct enter ${CTID}${NC}"
  echo -e "  Logs:    ${CYAN}pct exec ${CTID} -- journalctl -u belgium-radar -f${NC}"
  echo -e "  Restart: ${CYAN}pct exec ${CTID} -- systemctl restart belgium-radar${NC}"
  echo ""
}

banner() {
  echo -e "${CYAN}${BOLD}"
  cat <<'BANNER'
  ╔══════════════════════════════════════════════════╗
  ║   Belgium Weather & Lightning Radar Dashboard  ║
  ║   Proxmox LXC · RainViewer · LightningMaps     ║
  ╚══════════════════════════════════════════════════╝
BANNER
  echo -e "${NC}"
}

banner

if [[ "$APP_ONLY" -eq 1 ]]; then
  require_root
  install_app
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo ""
  ok "Dashboard ready at http://${IP:-localhost}/"
  exit 0
fi

if command -v pct >/dev/null 2>&1 && [[ -f /etc/pve/.version ]]; then
  create_lxc
else
  msg "Not on Proxmox host — installing app locally instead."
  msg "Tip: run on your Proxmox node to auto-create an LXC container."
  require_root
  install_app
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo ""
  ok "Dashboard ready at http://${IP:-localhost}/"
fi
