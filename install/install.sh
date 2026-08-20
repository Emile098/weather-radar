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
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
TEMPLATE="${TEMPLATE:-}"
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
    if pct status "$CTID" &>/dev/null; then
      fail "CTID ${CTID} already exists. Destroy it first (pct destroy ${CTID}) or pick another CTID=."
    fi
    return
  fi
  CTID=$(pvesh get /cluster/nextid 2>/dev/null || echo "")
  [[ -n "$CTID" ]] || fail "Could not determine next CTID. Set CTID= manually."
}

# Resolve a usable Debian LXC template volume path (storage:vztmpl/file).
resolve_template() {
  if [[ -n "$TEMPLATE" ]]; then
    if [[ "$TEMPLATE" == *":"* ]]; then
      ok "Using provided template: ${TEMPLATE}"
      return
    fi
    TEMPLATE="${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}"
    ok "Using provided template: ${TEMPLATE}"
    return
  fi

  local filename=""

  # 1) Prefer an already-downloaded Debian 12 template.
  filename=$(pveam list "$TEMPLATE_STORAGE" 2>/dev/null \
    | awk '/debian-12-standard/ {print $1; exit}' \
    | sed 's|.*/||')

  if [[ -z "$filename" ]]; then
    filename=$(pveam list "$TEMPLATE_STORAGE" 2>/dev/null \
      | awk '/debian-1[2-9]-standard/ {print $1; exit}' \
      | sed 's|.*/||')
  fi

  # 2) Otherwise discover + download the newest Debian 12 standard image.
  if [[ -z "$filename" ]]; then
    msg "Updating Proxmox appliance catalog…"
    pveam update >/dev/null || true

    filename=$(pveam available --section system 2>/dev/null \
      | awk '/debian-12-standard/ {print $NF}' \
      | sort -V \
      | tail -n1)

    if [[ -z "$filename" ]]; then
      filename=$(pveam available 2>/dev/null \
        | awk '/debian-12-standard/ {print $NF}' \
        | sort -V \
        | tail -n1)
    fi

    [[ -n "$filename" ]] || fail \
      "No debian-12-standard template found. Download one first, e.g.:
  pveam update
  pveam available | grep debian-12
  pveam download ${TEMPLATE_STORAGE} <filename>
Or re-run with TEMPLATE=local:vztmpl/<your-template>.tar.zst"

    msg "Downloading template ${filename} to ${TEMPLATE_STORAGE}…"
    pveam download "$TEMPLATE_STORAGE" "$filename" \
      || fail "Failed to download template ${filename}"
  else
    msg "Found downloaded template: ${filename}"
  fi

  TEMPLATE="${TEMPLATE_STORAGE}:vztmpl/${filename}"
  ok "Using template: ${TEMPLATE}"
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
  command -v pveam >/dev/null 2>&1 || fail "pveam not found — run this on a Proxmox host."

  pick_ctid
  resolve_template

  msg "Creating LXC container CTID=${CTID} (${CT_HOSTNAME})…"

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

  if ! pct "${PCT_ARGS[@]}"; then
    fail "Failed to create CT ${CTID}. Check TEMPLATE=${TEMPLATE} and STORAGE=${STORAGE}."
  fi

  msg "Starting container…"
  pct start "$CTID"

  # Wait until the guest has networking / can run commands.
  local ready=0
  for _ in $(seq 1 30); do
    if pct exec "$CTID" -- true &>/dev/null; then
      ready=1
      break
    fi
    sleep 1
  done
  [[ "$ready" -eq 1 ]] || fail "CT ${CTID} started but is not responding to pct exec."

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
