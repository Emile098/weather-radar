import { fetchJson } from "./utils.js";

const TILE_SIZE = 512;
const COLOR_SCHEME = 2;
const TILE_OPTIONS = "1_1";
const REFRESH_MS = 2 * 60 * 1000;

export class RadarLayer {
  constructor(map, onFrameChange) {
    this.map = map;
    this.onFrameChange = onFrameChange;
    this.frames = [];
    this.host = "";
    this.currentLayer = null;
    this.frameIndex = 0;
    this.opacity = 0.75;
    this.visible = true;
    this.playing = false;
    this.liveMode = true;
    this.playTimer = null;
    this.playDelayMs = 500;
  }

  get isLive() {
    return this.liveMode && this.frameIndex === this.frames.length - 1;
  }

  async load({ keepLive = true } = {}) {
    const data = await fetchJson("/api/rainviewer");
    this.host = data.host;
    const past = data.radar?.past ?? [];
    this.frames = past;
    if (this.frames.length === 0) throw new Error("No radar frames");

    if (keepLive || this.liveMode) {
      this.goLive();
    } else {
      this.showFrame(Math.min(this.frameIndex, this.frames.length - 1));
    }
    return this.frames.length;
  }

  tileUrl(frame) {
    return `${this.host}${frame.path}/${TILE_SIZE}/{z}/{x}/{y}/${COLOR_SCHEME}/${TILE_OPTIONS}.png`;
  }

  showFrame(index, { fromLive = false } = {}) {
    if (!this.frames.length) return;
    this.frameIndex = Math.max(0, Math.min(index, this.frames.length - 1));
    if (!fromLive) {
      this.liveMode = this.frameIndex === this.frames.length - 1;
    }
    const frame = this.frames[this.frameIndex];

    if (this.currentLayer) {
      this.map.removeLayer(this.currentLayer);
      this.currentLayer = null;
    }

    if (this.visible) {
      this.currentLayer = L.tileLayer(this.tileUrl(frame), {
        tileSize: 256,
        opacity: this.opacity,
        maxNativeZoom: 7,
        maxZoom: 12,
        zIndex: 200,
        className: "radar-tiles",
      });
      this.currentLayer.addTo(this.map);
    }

    this.onFrameChange?.(this.frameIndex, this.frames.length, frame.time, this.isLive);
  }

  goLive() {
    this.liveMode = true;
    this.pause();
    this.showFrame(this.frames.length - 1, { fromLive: true });
  }

  setOpacity(value) {
    this.opacity = value;
    if (this.currentLayer) this.currentLayer.setOpacity(value);
  }

  setVisible(visible) {
    this.visible = visible;
    if (visible) this.showFrame(this.frameIndex, { fromLive: this.liveMode });
    else if (this.currentLayer) {
      this.map.removeLayer(this.currentLayer);
      this.currentLayer = null;
    }
  }

  play() {
    this.liveMode = false;
    this.playing = true;
    // Start replay from the oldest frame so history is visible.
    this.showFrame(0);
    this.scheduleNext();
  }

  pause() {
    this.playing = false;
    if (this.playTimer) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
  }

  togglePlay() {
    if (this.playing) {
      this.pause();
      return false;
    }
    this.play();
    return true;
  }

  scheduleNext() {
    if (this.playTimer) clearTimeout(this.playTimer);
    if (!this.playing || !this.visible) return;

    this.playTimer = setTimeout(() => {
      const last = this.frames.length - 1;
      if (this.frameIndex >= last) {
        // Finished history — settle on live instead of looping back in time.
        this.pause();
        this.goLive();
        return;
      }
      this.showFrame(this.frameIndex + 1);
      this.scheduleNext();
    }, this.playDelayMs);
  }

  startAutoRefresh() {
    setInterval(async () => {
      try {
        const wasLive = this.liveMode && !this.playing;
        await this.load({ keepLive: wasLive });
      } catch (err) {
        console.warn("Radar refresh failed:", err);
      }
    }, REFRESH_MS);
  }
}
