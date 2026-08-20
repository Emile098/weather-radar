import { fetchJson, wmoIcon, wmoLabel, windDir, formatTime, formatDay } from "./utils.js";

export class WeatherPanel {
  constructor(cities, { onLocationChange } = {}) {
    this.cities = cities;
    this.selected = cities[0];
    this.onLocationChange = onLocationChange;

    this.searchInput = document.getElementById("city-search");
    this.suggestionsEl = document.getElementById("city-suggestions");
    this.locationLabel = document.getElementById("weather-location");
    this.selectEl = document.getElementById("city-select");

    this.debounceTimer = null;
    this.suppressBlur = false;

    this.populateSelect();
    this.bindSearch();
    this.setLocationLabel(this.selected.name);
  }

  populateSelect() {
    if (!this.selectEl) return;
    this.selectEl.innerHTML = this.cities
      .map((c) => `<option value="${c.name}">${c.name}</option>`)
      .join("");
    this.selectEl.addEventListener("change", () => {
      const idx = this.selectEl.selectedIndex;
      this.selectLocation(this.cities[idx]);
    });
  }

  bindSearch() {
    if (!this.searchInput) return;

    this.searchInput.addEventListener("input", () => {
      clearTimeout(this.debounceTimer);
      const q = this.searchInput.value.trim();
      if (q.length < 2) {
        this.hideSuggestions();
        return;
      }
      this.debounceTimer = setTimeout(() => this.search(q), 220);
    });

    this.searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.hideSuggestions();
        this.searchInput.blur();
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const first = this.suggestionsEl?.querySelector("[data-lat]");
        if (first) first.click();
      }
    });

    this.searchInput.addEventListener("blur", () => {
      setTimeout(() => {
        if (!this.suppressBlur) this.hideSuggestions();
      }, 150);
    });
  }

  async search(query) {
    const local = this.cities.filter((c) =>
      c.name.toLowerCase().includes(query.toLowerCase()),
    );

    let remote = [];
    try {
      const data = await fetchJson(`/api/geocode?q=${encodeURIComponent(query)}`);
      remote = (data.results ?? []).map((r) => ({
        name: r.name,
        label: [r.name, r.admin1, r.country_code].filter(Boolean).join(", "),
        lat: r.latitude,
        lon: r.longitude,
      }));
    } catch (err) {
      console.warn("Geocode failed:", err);
    }

    const seen = new Set();
    const merged = [];
    for (const item of [...local.map((c) => ({ ...c, label: c.name })), ...remote]) {
      const key = `${item.name}|${item.lat.toFixed(2)}|${item.lon.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }

    this.showSuggestions(merged.slice(0, 8));
  }

  showSuggestions(items) {
    if (!this.suggestionsEl) return;
    if (!items.length) {
      this.suggestionsEl.innerHTML = `<div class="city-suggestion empty">No cities found</div>`;
      this.suggestionsEl.hidden = false;
      return;
    }

    this.suggestionsEl.innerHTML = items.map((item) => `
      <button type="button" class="city-suggestion"
        data-name="${item.name}"
        data-lat="${item.lat}"
        data-lon="${item.lon}"
        data-label="${item.label || item.name}">
        <span class="city-suggestion-name">${item.label || item.name}</span>
      </button>
    `).join("");

    this.suggestionsEl.hidden = false;
    this.suggestionsEl.querySelectorAll(".city-suggestion[data-lat]").forEach((btn) => {
      btn.addEventListener("mousedown", () => { this.suppressBlur = true; });
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
      });
    });
  }

  hideSuggestions() {
    if (!this.suggestionsEl) return;
    this.suggestionsEl.hidden = true;
    this.suggestionsEl.innerHTML = "";
  }

  setLocationLabel(text) {
    if (this.locationLabel) this.locationLabel.textContent = text;
  }

  selectLocation(location) {
    this.selected = location;
    this.setLocationLabel(location.label || location.name);
    if (this.selectEl) {
      const idx = this.cities.findIndex((c) => c.name === location.name);
      if (idx >= 0) this.selectEl.selectedIndex = idx;
    }
    this.onLocationChange?.(location);
    this.refresh();
  }

  async refresh() {
    const { lat, lon } = this.selected;
    try {
      const data = await fetchJson(`/api/weather?lat=${lat}&lon=${lon}`);
      this.render(data);
    } catch (err) {
      document.getElementById("weather-desc").textContent = "Weather unavailable";
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
