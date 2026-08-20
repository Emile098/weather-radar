import { fetchJson } from "./utils.js";
import { RadarLayer } from "./radar.js";
import { LightningLayer } from "./lightning.js";
import { WeatherPanel } from "./weather.js";

async function main() {
  const config = await fetchJson("/api/config");
  const { center, bounds, cities } = config;

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
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    },
  ).addTo(map);

  map.fitBounds([
    [bounds.south, bounds.west],
    [bounds.north, bounds.east],
  ]);

  const cityLayer = L.layerGroup();
  for (const city of cities) {
    L.circleMarker([city.lat, city.lon], {
      radius: 5,
      fillOpacity: 1,
      stroke: true,
      weight: 2,
      color: "#fff",
      fillColor: "#3b9eff",
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

  let radarOnline = false;
  let lightningOnline = false;

  function updateStatus() {
    if (radarOnline && lightningOnline) {
      statusEl.className = "status-pill online";
      statusEl.querySelector(".status-text").textContent = "All systems live";
    } else if (radarOnline) {
      statusEl.className = "status-pill online";
      statusEl.querySelector(".status-text").textContent = "Radar live";
    } else if (lightningOnline) {
      statusEl.className = "status-pill online";
      statusEl.querySelector(".status-text").textContent = "Lightning live";
    } else {
      statusEl.className = "status-pill offline";
      statusEl.querySelector(".status-text").textContent = "Reconnecting…";
    }
  }

  function syncPlayIcons(playing) {
    iconPlay.hidden = playing;
    iconPause.hidden = !playing;
  }

  function syncLiveButton(isLive) {
    btnLive.classList.toggle("active", isLive);
  }

  const radar = new RadarLayer(map, (idx, total, timestamp, isLive) => {
    slider.max = Math.max(0, total - 1);
    slider.value = idx;
    frameIndex.textContent = isLive ? "LIVE" : `${idx + 1} / ${total}`;
    frameTime.textContent = new Date(timestamp * 1000).toLocaleString("en-BE", {
      timeZone: "Europe/Brussels",
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short",
    });
    syncLiveButton(isLive);
    if (!radar.playing) syncPlayIcons(false);
  });

  const lightning = new LightningLayer(map, {
    north: bounds.north,
    south: bounds.south,
    west: bounds.west,
    east: bounds.east,
  }, (online, count) => {
    lightningOnline = online;
    strikeCount.textContent = count;
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

  const weather = new WeatherPanel(cities);
  weather.startAutoRefresh();

  function updateClock() {
    document.getElementById("local-clock").textContent =
      new Date().toLocaleTimeString("en-BE", {
        timeZone: "Europe/Brussels",
        hour: "2-digit",
        minute: "2-digit",
      });
  }
  updateClock();
  setInterval(updateClock, 1000);
}

main().catch((err) => {
  console.error("Startup failed:", err);
  document.getElementById("connection-status").className = "status-pill offline";
  document.getElementById("connection-status").querySelector(".status-text").textContent =
    "Startup error";
});
