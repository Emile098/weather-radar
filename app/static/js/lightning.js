const WS_URL = "wss://live2.lightningmaps.org/";
const MAX_AGE_SEC = 20 * 60;
const MAX_STRIKES = 3000;
const MARGIN = 0.35;

function boltSvg(ageClass) {
  // Filled bolt with dark outline — readable over bright radar echoes.
  return `
    <span class="strike-wrap ${ageClass}">
      <span class="strike-glow"></span>
      <svg class="strike-bolt" viewBox="0 0 24 32" aria-hidden="true">
        <path d="M13 0L3 18h8l-2 14 14-20h-8L13 0z"
              stroke="#0a0f18" stroke-width="2" stroke-linejoin="round"/>
      </svg>
    </span>
  `;
}

export class LightningLayer {
  constructor(map, bounds, onStatus) {
    this.map = map;
    this.bounds = bounds;
    this.onStatus = onStatus;
    this.strikes = new Map();
    this.layerGroup = L.layerGroup().addTo(map);
    this.visible = true;
    this.connected = false;
    this.ws = null;
    this.reconnectTimer = null;
    this.expireTimer = setInterval(() => this.expireStrikes(), 2000);
  }

  buildSubscription() {
    const { north, south, west, east } = this.bounds;
    return JSON.stringify({
      v: 24, i: {}, s: false, x: 0, w: 0, tx: 0, tw: 1,
      a: 4, z: 6, b: true, h: "",
      l: 1, t: 1, from_lightningmaps_org: true,
      p: [north, east, south, west],
      r: "A",
    });
  }

  connect() {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
    }

    this.ws = new WebSocket(WS_URL);
    this.ws.onopen = () => {
      this.ws.send(this.buildSubscription());
      this.setConnected(true);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (Array.isArray(data.strokes)) {
          for (const stroke of data.strokes) {
            this.addStrike(stroke);
          }
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    this.ws.onclose = () => {
      this.setConnected(false);
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.setConnected(false);
    };
  }

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), 5000);
  }

  setConnected(state) {
    this.connected = state;
    this.onStatus?.(state, this.strikes.size);
  }

  ageClass(ageSec) {
    if (ageSec < 120) return "strike-fresh";
    if (ageSec < 300) return "strike-young";
    if (ageSec < 600) return "strike-mid";
    return "strike-old";
  }

  iconSizeForAge(ageSec) {
    if (ageSec < 120) return 34;
    if (ageSec < 300) return 28;
    if (ageSec < 600) return 22;
    return 18;
  }

  inBounds(lat, lon) {
    const { north, south, west, east } = this.bounds;
    return lat >= south - MARGIN && lat <= north + MARGIN
      && lon >= west - MARGIN && lon <= east + MARGIN;
  }

  makeIcon(ageSec) {
    const size = this.iconSizeForAge(ageSec);
    return L.divIcon({
      className: "strike-marker",
      html: boltSvg(this.ageClass(ageSec)),
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  addStrike(stroke) {
    const { lat, lon, time, id } = stroke;
    if (lat == null || lon == null || !this.inBounds(lat, lon)) return;

    const key = id ?? `${time}-${lat.toFixed(3)}-${lon.toFixed(3)}`;
    if (this.strikes.has(key)) return;

    const epochSec = time > 1e12 ? Math.floor(time / 1000) : time;
    const ageSec = Math.max(0, Math.floor(Date.now() / 1000) - epochSec);
    const marker = L.marker([lat, lon], {
      icon: this.makeIcon(ageSec),
      interactive: false,
      keyboard: false,
      zIndexOffset: 2000,
    });

    this.strikes.set(key, { epochSec, marker, ageClass: this.ageClass(ageSec) });
    if (this.visible) marker.addTo(this.layerGroup);

    while (this.strikes.size > MAX_STRIKES) {
      const oldest = this.strikes.keys().next().value;
      this.removeStrike(oldest);
    }

    this.onStatus?.(this.connected, this.strikes.size);
  }

  removeStrike(key) {
    const entry = this.strikes.get(key);
    if (!entry) return;
    this.layerGroup.removeLayer(entry.marker);
    this.strikes.delete(key);
  }

  expireStrikes() {
    const now = Math.floor(Date.now() / 1000);
    for (const [key, entry] of this.strikes) {
      const age = now - entry.epochSec;
      if (age > MAX_AGE_SEC) {
        this.removeStrike(key);
        continue;
      }
      const nextClass = this.ageClass(age);
      if (nextClass !== entry.ageClass) {
        entry.ageClass = nextClass;
        entry.marker.setIcon(this.makeIcon(age));
      }
    }
    this.onStatus?.(this.connected, this.strikes.size);
  }

  setVisible(visible) {
    this.visible = visible;
    if (visible) {
      if (!this.map.hasLayer(this.layerGroup)) {
        this.layerGroup.addTo(this.map);
      }
    } else if (this.map.hasLayer(this.layerGroup)) {
      this.map.removeLayer(this.layerGroup);
    }
  }

  destroy() {
    clearInterval(this.expireTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) this.ws.close();
    this.map.removeLayer(this.layerGroup);
  }
}
