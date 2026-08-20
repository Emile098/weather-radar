# Belgium Weather & Lightning Radar Dashboard

A professional web dashboard for live precipitation radar and lightning strikes over Belgium. Designed for self-hosting on Proxmox with a one-line LXC install.

![Belgium](https://img.shields.io/badge/region-Belgium-black)
![Proxmox](https://img.shields.io/badge/Proxmox-LXC-orange)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **Live precipitation radar** — animated RainViewer composite (refreshes every 5 min)
- **Real-time lightning** — LightningMaps WebSocket feed with 20-minute age trail
- **Weather panel** — current conditions + hourly/daily forecast via Open-Meteo
- **Professional UI** — dark glassmorphism dashboard, timeline scrubber, layer toggles
- **Belgium-focused** — map bounds, border outline, major city markers
- **Lightweight** — runs in a 512 MB LXC container on Proxmox

## One-line install (Proxmox)

Run on your **Proxmox host** as root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Emile098/weather-radar/main/install/install.sh)"
```

This will:

1. Create an unprivileged Debian 12 LXC container
2. Install Python, nginx, and the dashboard
3. Start the service and print the URL

Open `http://<container-ip>/` in your browser.

### Customise the container

```bash
CTID=200 CT_HOSTNAME=radar CT_RAM=1024 CT_DISK=8 CT_IP=192.168.1.50/24 CT_GATEWAY=192.168.1.1 \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/Emile098/weather-radar/main/install/install.sh)"
```

| Variable | Default | Description |
|----------|---------|-------------|
| `CTID` | auto | Container ID |
| `CT_HOSTNAME` | `belgium-radar` | Hostname |
| `CT_CORES` | `1` | CPU cores |
| `CT_RAM` | `512` | RAM (MB) |
| `CT_DISK` | `4` | Disk (GB) |
| `CT_BRIDGE` | `vmbr0` | Network bridge |
| `CT_IP` | `dhcp` | IP config |
| `STORAGE` | `local-lvm` | Rootfs storage pool |
| `TEMPLATE_STORAGE` | `local` | Where LXC templates live |
| `TEMPLATE` | auto | Override template, e.g. `local:vztmpl/debian-12-standard_….tar.zst` |

The installer auto-detects a downloaded Debian 12 template, or downloads the newest `debian-12-standard` image via `pveam` if none is present.

### App-only install (existing LXC/VM)

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Emile098/weather-radar/main/install/install.sh)" -- --app-only
```

## Manual development

```bash
cd app
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
```

Open http://localhost:8080

## Data sources

| Layer | Source | Notes |
|-------|--------|-------|
| Radar | [RainViewer](https://www.rainviewer.com/) | Free for personal use; attribution required |
| Lightning | [LightningMaps](https://www.lightningmaps.org/) | Real-time WebSocket |
| Forecast | [Open-Meteo](https://open-meteo.com/) | No API key needed |

## Architecture

```
┌─────────────────────────────────────────┐
│  nginx :80                              │
│    └─► FastAPI :8080                    │
│          ├─ /api/rainviewer  (proxy)    │
│          ├─ /api/weather    (Open-Meteo)│
│          └─ /static         (dashboard) │
└─────────────────────────────────────────┘
         Browser
           ├─ Leaflet map + RainViewer tiles
           └─ LightningMaps WSS (direct)
```

## Management

```bash
# Enter container
pct enter <CTID>

# View logs
journalctl -u belgium-radar -f

# Restart
systemctl restart belgium-radar
```

## License

MIT — use freely for personal and educational purposes. Respect RainViewer and LightningMaps terms of use.
