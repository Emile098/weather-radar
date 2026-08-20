import { fetchJson } from "./utils.js?v=6";
import { RadarLayer } from "./radar.js?v=6";
import { LightningLayer } from "./lightning.js?v=6";
import { WeatherPanel } from "./weather.js?v=6";

async function main() {
  const config = await fetchJson("/api/config");
  const { center, bounds, cities, radarSources = [], defaultRadarSource = "rainviewer" } = config;

  const map = L.map("map", {
    center: [center.lat, center.lon],
    zoom: 8,
    minZoom: 6,
    maxZoom: 12,
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> · <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    },
  ).addTo(map);

  map.fitBounds([
    [bounds.south, bounds.west],
    [bounds.north, bounds.east],
  ], { padding: [24, 24] });

  const cityLayer = L.layerGroup();
  let selectedMarker = null;

  for (const city of cities) {
    L.circleMarker([city.lat, city.lon], {
      radius: 4,
      fillOpacity: 1,
      stroke: true,
      weight: 1.5,
      color: "rgba(255,255,255,0.9)",
      fillColor: "#56c2b0",
      interactive: false,
    }).addTo(cityLayer);
    L.marker([city.lat, city.lon], {
      icon: L.divIcon({
        className: "city-label-wrap",
        html: `<span class="city-label">${city.name}</span>`,
        iconSize: [0, 0],
        iconAnchor: [-10, -8],
      }),
      interactive: false,
    }).addTo(cityLayer);
  }

  const slider = document.getElementById("radar-slider");
  const frameTime = document.getElementById("frame-time");
  const frameIndex = document.getElementById("frame-index");
  const btnLive = document.getElementById("btn-live");
  const btnPlay = document.getElementById("btn-play");
  const iconPlay = document.getElementById("icon-play");
  const iconPause = document.getElementById("icon-pause");
  const statusEl = document.getElementById("connection-status");
  const strikeCount = document.getElementById("strike-count");
  const sourceSelect = document.getElementById("radar-source");
  const sourceBadge = document.getElementById("source-badge");
  const radarControls = document.querySelector(".radar-controls");

  let radarOnline = false;
  let lightningOnline = false;

  function populateSources() {
    const saved = localStorage.getItem("belgium-radar-source") || defaultRadarSource;
    sourceSelect.innerHTML = radarSources.map((source) => {
      const disabled = source.available ? "" : "disabled";
      const label = source.available ? source.name : `${source.name} (unavailable)`;
      return `<option value="${source.id}" ${disabled}>${label}</option>`;
    }).join("");

    const usable = radarSources.find((s) => s.id === saved && s.available)
      || radarSources.find((s) => s.available)
      || radarSources[0];
    if (usable) sourceSelect.value = usable.id;
  }

  function updateStatus() {
    if (radarOnline && lightningOnline) {
      statusEl.className = "status-pill online";
      statusEl.querySelector(".status-text").textContent = "Systems live";
    } else if (radarOnline) {
      statusEl.className = "status-pill online";
      statusEl.querySelector(".status-text").textContent = "Radar live";
    } else if (lightningOnline) {
      statusEl.className = "status-pill online";
      statusEl.querySelector(".status-text").textContent = "Lightning live";
    } else {
      statusEl.className = "status-pill offline";
      statusEl.querySelector(".status-text").textContent = "Reconnecting";
    }
  }

  function syncPlayIcons(playing) {
    iconPlay.hidden = playing;
    iconPause.hidden = !playing;
  }

  function syncLiveButton(isLive) {
    btnLive.classList.toggle("active", isLive);
  }

  function syncAnimationUi(animated) {
    radarControls.classList.toggle("is-static", !animated);
    btnPlay.disabled = !animated;
    slider.disabled = !animated;
    if (!animated) syncPlayIcons(false);
  }

  populateSources();

  const radar = new RadarLayer(
    map,
    (idx, total, timestamp, isLive, kind = "observed") => {
      slider.max = Math.max(0, total - 1);
      slider.value = idx;
      const prefix = kind === "forecast" ? "FC " : "";
      frameIndex.textContent = isLive ? "LIVE" : `${idx + 1} / ${total}`;
      frameTime.textContent = prefix + new Date(timestamp * 1000).toLocaleString("en-BE", {
        timeZone: "Europe/Brussels",
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "short",
      });
      syncLiveButton(isLive);
      if (!radar.playing) syncPlayIcons(false);
    },
    (sourceId, manifest) => {
      const meta = radarSources.find((s) => s.id === sourceId);
      sourceBadge.textContent = meta?.name || sourceId;
      sourceBadge.title = manifest?.note || meta?.description || "";
      syncAnimationUi(Boolean(manifest?.animated));
    },
  );

  // Ensure RadarLayer starts on the selected source.
  radar.sourceId = sourceSelect.value;

  const lightning = new LightningLayer(map, {
    north: bounds.north,
    south: bounds.south,
    west: bounds.west,
    east: bounds.east,
  }, (online, count) => {
    lightningOnline = online;
    strikeCount.textContent = count.toLocaleString("en-BE");
    updateStatus();
  });

  lightning.connect();

  try {
    await radar.load({ keepLive: true });
    radarOnline = true;
    syncPlayIcons(false);
    syncLiveButton(true);
  } catch (err) {
    console.error("Radar load failed:", err);
    radarOnline = false;
  }
  updateStatus();
  radar.startAutoRefresh();

  sourceSelect.addEventListener("change", async () => {
    const next = sourceSelect.value;
    sourceSelect.disabled = true;
    try {
      await radar.setSource(next, { keepLive: true });
      radarOnline = true;
      syncPlayIcons(false);
      syncLiveButton(true);
    } catch (err) {
      console.error("Radar source switch failed:", err);
      radarOnline = false;
      sourceBadge.textContent = "Radar unavailable";
    } finally {
      sourceSelect.disabled = false;
      updateStatus();
    }
  });

  slider.addEventListener("input", () => {
    radar.pause();
    syncPlayIcons(false);
    radar.liveMode = false;
    radar.showFrame(Number(slider.value));
  });

  btnLive.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    radar.goLive();
    syncPlayIcons(false);
  });

  btnPlay.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const playing = radar.togglePlay();
    syncPlayIcons(playing);
  });

  document.getElementById("radar-opacity").addEventListener("input", (e) => {
    radar.setOpacity(Number(e.target.value) / 100);
  });

  document.querySelectorAll(".toggle-chip").forEach((chip) => {
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const on = !chip.classList.contains("active");
      chip.classList.toggle("active", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");

      const layer = chip.dataset.layer;
      if (layer === "radar") radar.setVisible(on);
      if (layer === "lightning") lightning.setVisible(on);
      if (layer === "cities") {
        if (on) cityLayer.addTo(map);
        else map.removeLayer(cityLayer);
      }
    });
  });

  const weather = new WeatherPanel(cities, {
    onLocationChange(location) {
      map.flyTo([location.lat, location.lon], Math.max(map.getZoom(), 10), {
        duration: 0.85,
      });
      if (selectedMarker) map.removeLayer(selectedMarker);
      selectedMarker = L.marker([location.lat, location.lon], {
        icon: L.divIcon({
          className: "selected-pin-wrap",
          html: '<div class="selected-pin"></div>',
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
        interactive: false,
        zIndexOffset: 1500,
      }).addTo(map);
    },
  });
  weather.startAutoRefresh();

  function updateClock() {
    const now = new Date();
    document.getElementById("local-clock").textContent = now.toLocaleTimeString("en-BE", {
      timeZone: "Europe/Brussels",
      hour: "2-digit",
      minute: "2-digit",
    });
    document.getElementById("local-date").textContent = now.toLocaleDateString("en-BE", {
      timeZone: "Europe/Brussels",
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }
  updateClock();
  setInterval(updateClock, 1000);
}

main().catch((err) => {
  console.error("Startup failed:", err);
  const statusEl = document.getElementById("connection-status");
  statusEl.className = "status-pill offline";
  statusEl.querySelector(".status-text").textContent = "Startup error";
});
