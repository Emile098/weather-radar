const WMO_ICONS = {
  0: "☀️", 1: "🌤", 2: "⛅", 3: "☁️", 45: "🌫", 48: "🌫",
  51: "🌦", 53: "🌦", 55: "🌧", 61: "🌧", 63: "🌧", 65: "🌧",
  71: "🌨", 73: "🌨", 75: "❄️", 77: "❄️", 80: "🌦", 81: "🌧",
  82: "⛈", 85: "🌨", 86: "❄️", 95: "⛈", 96: "⛈", 99: "⛈",
};

const WMO_TEXT = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Depositing rime fog", 51: "Light drizzle", 53: "Drizzle",
  55: "Dense drizzle", 61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
  71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Rain showers", 81: "Moderate showers", 82: "Violent showers",
  85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorm",
  96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail",
};

export function wmoIcon(code) {
  return WMO_ICONS[code] ?? "🌡";
}

export function wmoLabel(code) {
  return WMO_TEXT[code] ?? "Unknown";
}

export function windDir(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

export function formatTime(iso, opts = { hour: "2-digit", minute: "2-digit" }) {
  return new Date(iso).toLocaleTimeString("en-BE", { ...opts, timeZone: "Europe/Brussels" });
}

export function formatDay(iso) {
  return new Date(iso).toLocaleDateString("en-BE", {
    weekday: "short", timeZone: "Europe/Brussels",
  });
}

export async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
