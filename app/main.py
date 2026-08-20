"""Belgium Weather & Lightning Radar — lightweight FastAPI server."""

from __future__ import annotations

import os
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"

BELGIUM = {
    "name": "Belgium",
    "center": {"lat": 50.5039, "lon": 4.4699},
    "bounds": {
        "north": 51.65,
        "south": 49.45,
        "west": 2.35,
        "east": 6.45,
    },
    "cities": [
        {"name": "Brussels", "lat": 50.8503, "lon": 4.3517},
        {"name": "Antwerp", "lat": 51.2194, "lon": 4.4025},
        {"name": "Ghent", "lat": 51.0543, "lon": 3.7174},
        {"name": "Charleroi", "lat": 50.4108, "lon": 4.4446},
        {"name": "Liège", "lat": 50.6326, "lon": 5.5797},
        {"name": "Bruges", "lat": 51.2093, "lon": 3.2247},
        {"name": "Namur", "lat": 50.4674, "lon": 4.8719},
        {"name": "Leuven", "lat": 50.8798, "lon": 4.7005},
        {"name": "Mechelen", "lat": 51.0259, "lon": 4.4776},
        {"name": "Hasselt", "lat": 50.9307, "lon": 5.3378},
        {"name": "Kortrijk", "lat": 50.8270, "lon": 3.2649},
        {"name": "Ostend", "lat": 51.2300, "lon": 2.9200},
        {"name": "Mons", "lat": 50.4542, "lon": 3.9523},
        {"name": "Aalst", "lat": 50.9372, "lon": 4.0409},
        {"name": "Sint-Niklaas", "lat": 51.1657, "lon": 4.1437},
        {"name": "Tournai", "lat": 50.6057, "lon": 3.3878},
        {"name": "Genk", "lat": 50.9650, "lon": 5.5000},
        {"name": "Roeselare", "lat": 50.9445, "lon": 3.1229},
        {"name": "Verviers", "lat": 50.5891, "lon": 5.8624},
        {"name": "Arlon", "lat": 49.6833, "lon": 5.8167},
    ],
}

app = FastAPI(title="Belgium Radar Dashboard", version="1.0.0")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
async def config() -> dict:
    return BELGIUM


@app.get("/api/rainviewer")
async def rainviewer_proxy() -> dict:
    """Proxy RainViewer manifest to avoid browser CORS issues."""
    url = "https://api.rainviewer.com/public/weather-maps.json"
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(url, headers={"Accept": "application/json"})
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="RainViewer API unavailable")
    return response.json()


@app.get("/api/weather")
async def weather(
    lat: float = BELGIUM["center"]["lat"],
    lon: float = BELGIUM["center"]["lon"],
) -> dict:
    """Current conditions and short-range forecast via Open-Meteo."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,relative_humidity_2m,apparent_temperature,"
        "precipitation,weather_code,wind_speed_10m,wind_direction_10m,"
        "surface_pressure",
        "hourly": "temperature_2m,precipitation_probability,precipitation,"
        "weather_code,wind_speed_10m",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,"
        "precipitation_sum,wind_speed_10m_max",
        "timezone": "Europe/Brussels",
        "forecast_days": 3,
    }
    url = "https://api.open-meteo.com/v1/forecast"
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(url, params=params)
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Open-Meteo unavailable")
    return response.json()


@app.get("/api/geocode")
async def geocode(q: str = "") -> dict:
    """City search via Open-Meteo geocoding, biased to Belgium."""
    query = q.strip()
    if len(query) < 2:
        return {"results": []}

    params = {
        "name": query,
        "count": 8,
        "language": "en",
        "format": "json",
        "countryCode": "BE",
    }
    url = "https://geocoding-api.open-meteo.com/v1/search"
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(url, params=params)
        if response.status_code != 200:
            raise HTTPException(status_code=502, detail="Geocoding unavailable")
        data = response.json()

        # If Belgium-only search is empty, fall back to nearby countries.
        if not data.get("results"):
            params.pop("countryCode", None)
            response = await client.get(url, params=params)
            if response.status_code != 200:
                raise HTTPException(status_code=502, detail="Geocoding unavailable")
            data = response.json()

    return data


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8080"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
