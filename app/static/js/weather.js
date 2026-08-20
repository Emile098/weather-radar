import { fetchJson, wmoIcon, wmoLabel, windDir, formatTime, formatDay } from "./utils.js?v=8";

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export class WeatherPanel {
  constructor(cities, { onLocationChange } = {}) {
    this.cities = cities;
    this.selected = cities[0];
    this.onLocationChange = onLocationChange;

    this.searchInput = document.getElementById("city-search");
    this.suggestionsEl = document.getElementById("city-suggestions");
    this.locationLabel = document.getElementById("weather-location");
    this.updatedEl = document.getElementById("weather-updated");

    this.debounceTimer = null;
    this.requestId = 0;
    this.suppressBlur = false;
    this.activeIndex = -1;
    this.currentItems = [];

    if (!this.searchInput || !this.suggestionsEl) {
      console.error("City search elements missing from DOM");
      return;
    }

    this.bindSearch();
    this.setLocationLabel(this.selected.name);
    this.searchInput.value = this.selected.name;
  }

  bindSearch() {
    this.searchInput.addEventListener("focus", () => {
      const q = this.searchInput.value.trim();
      if (q.length >= 1) this.search(q);
      else this.showSuggestions(this.defaultCities());
    });

    this.searchInput.addEventListener("input", () => {
      clearTimeout(this.debounceTimer);
      this.activeIndex = -1;
      const q = this.searchInput.value.trim();
      if (q.length < 1) {
        this.showSuggestions(this.defaultCities());
        return;
      }
      this.showLocalMatches(q);
      this.debounceTimer = setTimeout(() => this.search(q), 160);
    });

    this.searchInput.addEventListener("keydown", (event) => {
      const buttons = [...this.suggestionsEl.querySelectorAll(".city-suggestion[data-lat]")];

      if (event.key === "Escape") {
        this.hideSuggestions();
        this.searchInput.blur();
        return;
      }

      if (event.key === "ArrowDown" && buttons.length) {
        event.preventDefault();
        this.activeIndex = (this.activeIndex + 1) % buttons.length;
        this.paintActive(buttons);
        return;
      }

      if (event.key === "ArrowUp" && buttons.length) {
        event.preventDefault();
        this.activeIndex = (this.activeIndex - 1 + buttons.length) % buttons.length;
        this.paintActive(buttons);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const target = buttons[this.activeIndex] || buttons[0];
        if (target) target.click();
      }
    });

    this.searchInput.addEventListener("blur", () => {
      setTimeout(() => {
        if (!this.suppressBlur) this.hideSuggestions();
      }, 160);
    });

    this.suggestionsEl.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.suppressBlur = true;
    });

    window.addEventListener("keydown", (event) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        this.searchInput.focus();
        this.searchInput.select();
      }
    });
  }

  defaultCities() {
    return this.cities.slice(0, 8).map((c) => ({ ...c, label: c.name, meta: "Belgium" }));
  }

  paintActive(buttons) {
    buttons.forEach((btn, idx) => {
      btn.classList.toggle("active", idx === this.activeIndex);
      if (idx === this.activeIndex) btn.scrollIntoView({ block: "nearest" });
    });
  }

  showLocalMatches(query) {
    const q = normalize(query);
    const local = this.cities
      .filter((c) => normalize(c.name).includes(q))
      .map((c) => ({ ...c, label: c.name, meta: "Belgium" }));
    if (local.length) this.showSuggestions(local.slice(0, 8));
  }

  async search(query) {
    const requestId = ++this.requestId;
    const q = normalize(query);

    const local = this.cities
      .filter((c) => normalize(c.name).includes(q))
      .map((c) => ({ ...c, label: c.name, meta: "Belgium" }));

    let remote = [];
    let geocodeError = null;
    try {
      const data = await fetchJson(`/api/geocode?q=${encodeURIComponent(query)}`);
      remote = (data.results ?? []).map((r) => ({
        name: r.name,
        label: r.name,
        meta: [r.admin1, r.country_code || r.country].filter(Boolean).join(" · "),
        lat: r.latitude,
        lon: r.longitude,
      }));
    } catch (err) {
      geocodeError = err;
      console.warn("Geocode failed:", err);
    }

    if (requestId !== this.requestId) return;

    const seen = new Set();
    const merged = [];
    for (const item of [...local, ...remote]) {
      if (item.lat == null || item.lon == null) continue;
      const key = `${normalize(item.name)}|${Number(item.lat).toFixed(2)}|${Number(item.lon).toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }

    if (!merged.length && geocodeError) {
      this.showSuggestions([], "Search unavailable — try Brussels, Ghent, Liège…");
      return;
    }

    this.showSuggestions(merged.slice(0, 8));
  }

  showSuggestions(items, emptyMessage = "No cities found") {
    this.currentItems = items;
    this.activeIndex = -1;

    if (!items.length) {
      this.suggestionsEl.innerHTML =
        `<div class="city-suggestion empty">${emptyMessage}</div>`;
      this.suggestionsEl.hidden = false;
      return;
    }

    this.suggestionsEl.innerHTML = items.map((item) => {
      const label = item.label || item.name;
      const meta = item.meta || "";
      return `
        <button type="button" class="city-suggestion" role="option"
          data-name="${escapeAttr(item.name)}"
          data-lat="${item.lat}"
          data-lon="${item.lon}"
          data-label="${escapeAttr(label)}">
          <span class="city-suggestion-name">${escapeHtml(label)}</span>
          ${meta ? `<span class="city-suggestion-meta">${escapeHtml(meta)}</span>` : ""}
        </button>
      `;
    }).join("");

    this.suggestionsEl.hidden = false;

    this.suggestionsEl.querySelectorAll(".city-suggestion[data-lat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.selectLocation({
          name: btn.dataset.name,
          lat: Number(btn.dataset.lat),
          lon: Number(btn.dataset.lon),
          label: btn.dataset.label,
        });
        this.searchInput.value = btn.dataset.name;
        this.hideSuggestions();
        this.suppressBlur = false;
        this.searchInput.blur();
      });
    });
  }

  hideSuggestions() {
    this.suggestionsEl.hidden = true;
    this.suggestionsEl.innerHTML = "";
    this.suppressBlur = false;
    this.activeIndex = -1;
  }

  setLocationLabel(text) {
    if (this.locationLabel) this.locationLabel.textContent = text;
  }

  selectLocation(location) {
    this.selected = location;
    this.setLocationLabel(location.label || location.name);
    this.onLocationChange?.(location);
    this.refresh();
  }

  async refresh() {
    const { lat, lon } = this.selected;
    if (this.updatedEl) this.updatedEl.textContent = "Updating…";
    try {
      const data = await fetchJson(`/api/weather?lat=${lat}&lon=${lon}`);
      this.render(data);
      if (this.updatedEl) {
        this.updatedEl.textContent = `Updated ${new Date().toLocaleTimeString("en-BE", {
          timeZone: "Europe/Brussels",
          hour: "2-digit",
          minute: "2-digit",
        })}`;
      }
    } catch (err) {
      document.getElementById("weather-desc").textContent = "Weather unavailable";
      if (this.updatedEl) this.updatedEl.textContent = "Update failed";
      console.warn("Weather fetch failed:", err);
    }
  }

  render(data) {
    const cur = data.current;
    const code = cur.weather_code;

    document.getElementById("weather-icon").textContent = wmoIcon(code);
    document.getElementById("temp-main").textContent = `${Math.round(cur.temperature_2m)}°`;
    document.getElementById("temp-feels").textContent =
      `Feels like ${Math.round(cur.apparent_temperature)}°`;
    document.getElementById("weather-desc").textContent = wmoLabel(code);

    document.getElementById("metric-wind").textContent =
      `${Math.round(cur.wind_speed_10m)} km/h ${windDir(cur.wind_direction_10m)}`;
    document.getElementById("metric-humidity").textContent = `${cur.relative_humidity_2m}%`;
    document.getElementById("metric-pressure").textContent =
      `${Math.round(cur.surface_pressure)} hPa`;
    document.getElementById("metric-precip").textContent =
      `${cur.precipitation} mm`;

    this.renderHourly(data);
    this.renderDaily(data);
  }

  renderHourly(data) {
    const hourly = data.hourly;
    const now = new Date();
    const container = document.getElementById("hourly-forecast");
    const cards = [];

    for (let i = 0; i < hourly.time.length && cards.length < 12; i++) {
      const t = new Date(hourly.time[i]);
      if (t <= now) continue;
      cards.push(`
        <div class="hour-card">
          <div class="h-time">${formatTime(hourly.time[i])}</div>
          <div class="h-icon">${wmoIcon(hourly.weather_code[i])}</div>
          <div class="h-temp">${Math.round(hourly.temperature_2m[i])}°</div>
          <div class="h-rain">${hourly.precipitation_probability[i] ?? 0}%</div>
        </div>
      `);
    }
    container.innerHTML = cards.join("");
  }

  renderDaily(data) {
    const daily = data.daily;
    const container = document.getElementById("daily-forecast");
    const minAll = Math.min(...daily.temperature_2m_min);
    const maxAll = Math.max(...daily.temperature_2m_max);
    const span = maxAll - minAll || 1;

    container.innerHTML = daily.time.map((day, i) => {
      const lo = daily.temperature_2m_min[i];
      const hi = daily.temperature_2m_max[i];
      const left = ((lo - minAll) / span) * 100;
      const width = ((hi - lo) / span) * 100;
      return `
        <div class="day-row">
          <span class="d-name">${formatDay(day)}</span>
          <span class="d-icon">${wmoIcon(daily.weather_code[i])}</span>
          <div class="d-bar-wrap">
            <div class="d-bar" style="left:${left}%;width:${Math.max(width, 8)}%"></div>
          </div>
          <span class="d-min">${Math.round(lo)}°</span>
          <span class="d-max">${Math.round(hi)}°</span>
        </div>
      `;
    }).join("");
  }

  startAutoRefresh() {
    this.refresh();
    setInterval(() => this.refresh(), 10 * 60 * 1000);
  }
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
