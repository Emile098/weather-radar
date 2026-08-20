import { fetchJson } from "./utils.js?v=6";

const WS_URL = "wss://live2.lightningmaps.org/";
const MAX_AGE_SEC = 20 * 60;
const MAX_STRIKES = 4000;
const MARGIN = 0.35;

// Age bands (seconds): brand-new flash → hot → warm → cool → fading
const AGE = {
  FLASH: 45,       // brand new — big white flash ring
  FRESH: 2 * 60,   // < 2 min — bright white bolt
  HOT: 5 * 60,     // 2–5 min — yellow (user asked ~5 min recolor)
  WARM: 10 * 60,   // 5–10 min — orange
  COOL: 15 * 60,   // 10–15 min — red
  // 15–20 min — deep red, fading out
};

function boltHtml(ageClass) {
  return `
    <span class="strike-wrap ${ageClass}">
      <span class="strike-ring"></span>
      <span class="strike-glow"></span>
      <svg class="strike-bolt" viewBox="0 0 24 32" aria-hidden="true">
        <path d="M13 0L3 18h8l-2 14 14-20h-8L13 0z"
              stroke="#070b12" stroke-width="2.4" stroke-linejoin="round"/>
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
    this.expireTimer = setInterval(() => this.expireStrikes(), 1000);
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
    if (ageSec < AGE.FLASH) return "strike-flash";
    if (ageSec < AGE.FRESH) return "strike-fresh";
    if (ageSec < AGE.HOT) return "strike-hot";
    if (ageSec < AGE.WARM) return "strike-warm";
    if (ageSec < AGE.COOL) return "strike-cool";
    return "strike-fade";
  }

  iconSizeForAge(ageSec) {
    if (ageSec < AGE.FLASH) return 48;
    if (ageSec < AGE.FRESH) return 36;
    if (ageSec < AGE.HOT) return 28;
    if (ageSec < AGE.WARM) return 22;
    if (ageSec < AGE.COOL) return 18;
    return 14;
  }

  zIndexForAge(ageSec) {
    if (ageSec < AGE.FLASH) return 4000;
    if (ageSec < AGE.FRESH) return 3000;
    if (ageSec < AGE.HOT) return 2500;
    return 2000;
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
      html: boltHtml(this.ageClass(ageSec)),
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
    const ageClass = this.ageClass(ageSec);
    const marker = L.marker([lat, lon], {
      icon: this.makeIcon(ageSec),
      interactive: false,
      keyboard: false,
      zIndexOffset: this.zIndexForAge(ageSec),
    });

    this.strikes.set(key, { epochSec, marker, ageClass });
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
        entry.marker.setZIndexOffset(this.zIndexForAge(age));
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
