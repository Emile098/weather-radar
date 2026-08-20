import { fetchJson } from "./utils.js";

const TILE_SIZE = 512;
const COLOR_SCHEME = 2;
const TILE_OPTIONS = "1_1";
const REFRESH_MS = 5 * 60 * 1000;

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
    this.playing = true;
    this.playTimer = null;
    this.playDelayMs = 600;
  }

  async load() {
    const data = await fetchJson("/api/rainviewer");
    this.host = data.host;
    const past = data.radar?.past ?? [];
    this.frames = past;
    if (this.frames.length === 0) throw new Error("No radar frames");
    this.frameIndex = this.frames.length - 1;
    this.showFrame(this.frameIndex);
    return this.frames.length;
  }

  tileUrl(frame) {
    return `${this.host}${frame.path}/${TILE_SIZE}/{z}/{x}/{y}/${COLOR_SCHEME}/${TILE_OPTIONS}.png`;
  }

  showFrame(index) {
    if (!this.frames.length) return;
    this.frameIndex = Math.max(0, Math.min(index, this.frames.length - 1));
    const frame = this.frames[this.frameIndex];

    if (this.currentLayer) {
      this.map.removeLayer(this.currentLayer);
    }

    if (this.visible) {
      this.currentLayer = L.tileLayer(this.tileUrl(frame), {
        tileSize: 256,
        opacity: this.opacity,
        maxNativeZoom: 7,
        maxZoom: 12,
        zIndex: 200,
      });
      this.currentLayer.addTo(this.map);
    }

    this.onFrameChange?.(this.frameIndex, this.frames.length, frame.time);
  }

  setOpacity(value) {
    this.opacity = value;
    if (this.currentLayer) this.currentLayer.setOpacity(value);
  }

  setVisible(visible) {
    this.visible = visible;
    if (visible) this.showFrame(this.frameIndex);
    else if (this.currentLayer) {
      this.map.removeLayer(this.currentLayer);
      this.currentLayer = null;
    }
  }

  play() {
    this.playing = true;
    this.scheduleNext();
  }

  pause() {
    this.playing = false;
    if (this.playTimer) clearTimeout(this.playTimer);
  }

  togglePlay() {
    if (this.playing) this.pause();
    else this.play();
    return this.playing;
  }

  scheduleNext() {
    if (this.playTimer) clearTimeout(this.playTimer);
    if (!this.playing || !this.visible) return;
    this.playTimer = setTimeout(() => {
      const next = (this.frameIndex + 1) % this.frames.length;
      this.showFrame(next);
      this.scheduleNext();
    }, this.playDelayMs);
  }

  startAutoRefresh() {
    setInterval(async () => {
      try {
        const prevLen = this.frames.length;
        await this.load();
        if (this.frames.length !== prevLen) {
          console.info("Radar: refreshed", this.frames.length, "frames");
        }
      } catch (err) {
        console.warn("Radar refresh failed:", err);
      }
    }, REFRESH_MS);
  }
}
