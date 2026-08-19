import { fetchJson, wmoIcon, wmoLabel, windDir, formatTime, formatDay } from "./utils.js";

export class WeatherPanel {
  constructor(cities) {
    this.cities = cities;
    this.selected = cities[0];
    this.selectEl = document.getElementById("city-select");
    this.populateSelect();
    this.selectEl.addEventListener("change", () => {
      const idx = this.selectEl.selectedIndex;
      this.selected = this.cities[idx];
      this.refresh();
    });
  }

  populateSelect() {
    this.selectEl.innerHTML = this.cities
      .map((c) => `<option value="${c.name}">${c.name}</option>`)
      .join("");
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
    const temps = daily.temperature_2m_max;
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
