import { fetchJson } from "./utils.js";
import { RadarLayer } from "./radar.js";
import { LightningLayer } from "./lightning.js";
import { WeatherPanel } from "./weather.js";

const BELGIUM_BORDER = [
  [51.505, 2.546], [51.475, 2.778], [51.455, 3.038], [51.418, 3.314],
  [51.358, 3.558], [51.278, 3.838], [51.218, 4.098], [51.168, 4.358],
  [51.098, 4.618], [51.048, 4.878], [51.018, 5.138], [50.988, 5.398],
  [50.948, 5.658], [50.898, 5.918], [50.848, 6.158], [50.768, 6.358],
  [50.668, 6.298], [50.568, 6.198], [50.468, 6.098], [50.368, 5.998],
  [50.268, 5.898], [50.168, 5.798], [50.068, 5.698], [49.968, 5.598],
  [49.898, 5.498], [49.868, 5.358], [49.848, 5.198], [49.838, 5.038],
  [49.828, 4.878], [49.818, 4.718], [49.808, 4.558], [49.798, 4.398],
  [49.788, 4.238], [49.778, 4.078], [49.768, 3.918], [49.758, 3.758],
  [49.748, 3.598], [49.738, 3.438], [49.728, 3.278], [49.718, 3.118],
  [49.708, 2.958], [49.698, 2.798], [49.718, 2.638], [49.758, 2.498],
  [49.818, 2.378], [49.898, 2.298], [49.998, 2.258], [50.098, 2.238],
  [50.198, 2.228], [50.298, 2.228], [50.398, 2.238], [50.498, 2.258],
  [50.598, 2.288], [50.698, 2.328], [50.798, 2.378], [50.898, 2.438],
  [50.998, 2.508], [51.098, 2.528], [51.198, 2.518], [51.298, 2.508],
  [51.398, 2.518], [51.505, 2.546],
];

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

  L.polygon(BELGIUM_BORDER, {
    color: "#3b9eff",
    weight: 2,
    opacity: 0.6,
    fillColor: "#3b9eff",
    fillOpacity: 0.04,
    interactive: false,
  }).addTo(map);

  map.fitBounds([
    [bounds.south, bounds.west],
    [bounds.north, bounds.east],
  ]);

  const cityLayer = L.layerGroup();
  for (const city of cities) {
    L.circleMarker([city.lat, city.lon], {
      radius: 4,
      className: "city-dot",
      fillOpacity: 1,
      stroke: true,
      weight: 2,
      color: "#fff",
      fillColor: "#3b9eff",
    }).addTo(cityLayer);
    L.marker([city.lat, city.lon], {
      icon: L.divIcon({
        className: "city-label-wrap",
        html: `<span class="city-label">${city.name}</span>`,
        iconSize: [0, 0],
        iconAnchor: [-8, -6],
      }),
      interactive: false,
    }).addTo(cityLayer);
  }

  const slider = document.getElementById("radar-slider");
  const frameTime = document.getElementById("frame-time");
  const frameIndex = document.getElementById("frame-index");
  const btnPlay = document.getElementById("btn-play");
  const iconPlay = document.getElementById("icon-play");
  const iconPause = document.getElementById("icon-pause");
  const statusEl = document.getElementById("connection-status");
  const strikeCount = document.getElementById("strike-count");

  const radar = new RadarLayer(map, (idx, total, timestamp) => {
    slider.max = total - 1;
    slider.value = idx;
    frameIndex.textContent = `${idx + 1} / ${total}`;
    frameTime.textContent = new Date(timestamp * 1000).toLocaleString("en-BE", {
      timeZone: "Europe/Brussels",
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short",
    });
  });

  const lightningBounds = {
    north: bounds.north,
    south: bounds.south,
    west: bounds.west,
    east: bounds.east,
  };

  const lightning = new LightningLayer(map, lightningBounds, (online, count) => {
    statusEl.className = "status-pill " + (online ? "online" : "offline");
    statusEl.querySelector(".status-text").textContent =
      online ? "Lightning live" : "Lightning reconnecting…";
    strikeCount.textContent = count;
  });

  lightning.connect();

  try {
    await radar.load();
    radar.play();
    statusEl.className = "status-pill online";
    statusEl.querySelector(".status-text").textContent = "All systems live";
  } catch (err) {
    console.error("Radar load failed:", err);
    statusEl.className = "status-pill offline";
    statusEl.querySelector(".status-text").textContent = "Radar unavailable";
  }

  radar.startAutoRefresh();

  slider.addEventListener("input", () => {
    radar.pause();
    iconPlay.hidden = false;
    iconPause.hidden = true;
    radar.showFrame(Number(slider.value));
  });

  btnPlay.addEventListener("click", () => {
    const playing = radar.togglePlay();
    iconPlay.hidden = playing;
    iconPause.hidden = !playing;
  });

  document.getElementById("radar-opacity").addEventListener("input", (e) => {
    radar.setOpacity(Number(e.target.value) / 100);
  });

  document.querySelectorAll(".toggle-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("active");
      const layer = chip.dataset.layer;
      const on = chip.classList.contains("active");

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
