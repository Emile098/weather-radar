import { fetchJson } from "./utils.js?v=8";

const REFRESH_MS = 2 * 60 * 1000;
const STORAGE_KEY = "belgium-radar-source";

export class RadarLayer {
  constructor(map, onFrameChange, onSourceChange) {
    this.map = map;
    this.onFrameChange = onFrameChange;
    this.onSourceChange = onSourceChange;
    this.sourceId = localStorage.getItem(STORAGE_KEY) || "knmi";
    this.manifest = null;
    this.frames = [];
    this.currentLayer = null;
    this.frameIndex = 0;
    this.opacity = 0.72;
    this.visible = true;
    this.playing = false;
    this.liveMode = true;
    this.playTimer = null;
    this.playDelayMs = 500;
  }

  get isLive() {
    if (!this.frames.length) return true;
    if (!this.manifest?.animated) return true;
    return this.liveMode && this.frameIndex === this.frames.length - 1;
  }

  get animated() {
    return Boolean(this.manifest?.animated && this.frames.length > 1);
  }

  async setSource(sourceId, { keepLive = true } = {}) {
    this.pause();
    this.sourceId = sourceId;
    localStorage.setItem(STORAGE_KEY, sourceId);
    await this.load({ keepLive });
    this.onSourceChange?.(this.sourceId, this.manifest);
  }

  async load({ keepLive = true } = {}) {
    const manifest = await fetchJson(
      `/api/radar/manifest?source=${encodeURIComponent(this.sourceId)}`,
    );
    this.manifest = manifest;
    this.frames = manifest.frames || [];
    if (!this.frames.length) throw new Error("No radar frames");

    if (!manifest.animated) {
      this.liveMode = true;
      this.showFrame(this.frames.length - 1, { fromLive: true });
    } else if (keepLive || this.liveMode) {
      this.goLive();
    } else {
      this.showFrame(Math.min(this.frameIndex, this.frames.length - 1));
    }

    this.onSourceChange?.(this.sourceId, this.manifest);
    return this.frames.length;
  }

  clearLayer() {
    if (this.currentLayer) {
      this.map.removeLayer(this.currentLayer);
      this.currentLayer = null;
    }
  }

  buildLayer(frame) {
    const provider = this.manifest.provider;

    if (provider === "rainviewer") {
      const size = this.manifest.tileSize || 512;
      const color = this.manifest.color ?? 2;
      const options = this.manifest.options || "1_1";
      const url =
        `${this.manifest.host}${frame.path}/${size}/{z}/{x}/{y}/${color}/${options}.png`;
      return L.tileLayer(url, {
        tileSize: 256,
        opacity: this.opacity,
        maxNativeZoom: this.manifest.maxNativeZoom || 7,
        maxZoom: 12,
        zIndex: 200,
        className: "radar-tiles",
      });
    }

    if (provider === "wms" || provider === "dwd" || provider === "knmi") {
      const wms = this.manifest.wms;
      const iso = new Date(frame.time * 1000).toISOString().slice(0, 19) + "Z";
      return L.tileLayer.wms(wms.url, {
        layers: wms.layers,
        styles: wms.styles || "",
        format: wms.format || "image/png",
        transparent: wms.transparent !== false,
        version: wms.version || "1.3.0",
        opacity: this.opacity,
        time: iso,
        uppercase: true,
        maxZoom: 12,
        zIndex: 200,
        className: "radar-tiles",
        attribution: this.manifest.attribution || "",
      });
    }

    if (provider === "owm") {
      return L.tileLayer(this.manifest.tileUrl, {
        opacity: this.opacity,
        maxNativeZoom: this.manifest.maxNativeZoom || 10,
        maxZoom: 12,
        zIndex: 200,
        className: "radar-tiles",
        attribution: "OpenWeatherMap",
      });
    }

    throw new Error(`Unsupported radar provider: ${provider}`);
  }

  showFrame(index, { fromLive = false } = {}) {
    if (!this.frames.length || !this.manifest) return;
    this.frameIndex = Math.max(0, Math.min(index, this.frames.length - 1));
    if (!fromLive && this.animated) {
      this.liveMode = this.frameIndex === this.frames.length - 1;
    }

    const frame = this.frames[this.frameIndex];
    this.clearLayer();

    if (this.visible) {
      this.currentLayer = this.buildLayer(frame);
      this.currentLayer.addTo(this.map);
    }

    this.onFrameChange?.(
      this.frameIndex,
      this.frames.length,
      frame.time,
      this.isLive,
      frame.kind || "observed",
    );
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
    else this.clearLayer();
  }

  play() {
    if (!this.animated) return false;
    this.liveMode = false;
    this.playing = true;
    this.showFrame(0);
    this.scheduleNext();
    return true;
  }

  pause() {
    this.playing = false;
    if (this.playTimer) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
  }

  togglePlay() {
    if (!this.animated) return false;
    if (this.playing) {
      this.pause();
      return false;
    }
    return this.play();
  }

  scheduleNext() {
    if (this.playTimer) clearTimeout(this.playTimer);
    if (!this.playing || !this.visible || !this.animated) return;

    this.playTimer = setTimeout(() => {
      const last = this.frames.length - 1;
      if (this.frameIndex >= last) {
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
