"""Belgium Weather & Lightning Radar — lightweight FastAPI server."""

from __future__ import annotations

import os
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
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

OWM_API_KEY = os.environ.get("OWM_API_KEY", "").strip()


def radar_sources() -> list[dict]:
    sources = [
        {
            "id": "rainviewer",
            "name": "RainViewer",
            "short": "Global",
            "description": "Global radar composite · ~10 min steps · best Belgium coverage",
            "animated": True,
            "available": True,
        },
        {
            "id": "rainviewer_forecast",
            "name": "RainViewer + Forecast",
            "short": "RV+FC",
            "description": "RainViewer history plus nowcast frames when available",
            "animated": True,
            "available": True,
        },
        {
            "id": "dwd",
            "name": "DWD Germany",
            "short": "DWD",
            "description": "Deutscher Wetterdienst precipitation · strong for east Belgium / border storms",
            "animated": True,
            "available": True,
        },
        {
            "id": "owm",
            "name": "OpenWeatherMap",
            "short": "OWM",
            "description": "Live precipitation tiles"
            + (" · configured" if OWM_API_KEY else " · set OWM_API_KEY to enable"),
            "animated": False,
            "available": bool(OWM_API_KEY),
        },
    ]
    return sources


app = FastAPI(title="Belgium Radar Dashboard", version="1.1.0")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
async def config() -> dict:
    payload = dict(BELGIUM)
    payload["radarSources"] = radar_sources()
    payload["defaultRadarSource"] = "rainviewer"
    return payload


@app.get("/api/radar/sources")
async def list_radar_sources() -> dict:
    return {"sources": radar_sources(), "default": "rainviewer"}


@app.get("/api/rainviewer")
async def rainviewer_proxy() -> dict:
    """Proxy RainViewer manifest to avoid browser CORS issues."""
    url = "https://api.rainviewer.com/public/weather-maps.json"
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(url, headers={"Accept": "application/json"})
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="RainViewer API unavailable")
    return response.json()


@app.get("/api/radar/manifest")
async def radar_manifest(source: str = "rainviewer") -> dict:
    """Normalized radar frame manifest for the selected source."""
    source = source.strip().lower()

    if source in {"rainviewer", "rainviewer_forecast"}:
        url = "https://api.rainviewer.com/public/weather-maps.json"
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(url, headers={"Accept": "application/json"})
        if response.status_code != 200:
            raise HTTPException(status_code=502, detail="RainViewer API unavailable")
        data = response.json()
        past = data.get("radar", {}).get("past") or []
        nowcast = data.get("radar", {}).get("nowcast") or []
        frames = list(past)
        if source == "rainviewer_forecast":
            frames = list(past) + list(nowcast)
        if not frames:
            raise HTTPException(status_code=502, detail="No RainViewer frames")
        latest_observed = int(past[-1]["time"]) if past else int(frames[-1]["time"])
        return {
            "source": source,
            "provider": "rainviewer",
            "animated": True,
            "host": data.get("host", "https://tilecache.rainviewer.com"),
            "color": 2,
            "options": "1_1",
            "tileSize": 512,
            "maxNativeZoom": 7,
            "frames": [
                {
                    "time": int(frame["time"]),
                    "path": frame["path"],
                    "kind": "forecast"
                    if int(frame["time"]) > latest_observed
                    else "observed",
                }
                for frame in frames
            ],
            "attribution": "RainViewer",
        }

    if source == "dwd":
        # 5-minute cadence; last ~2 hours of observed frames.
        now = int(time.time())
        step = 5 * 60
        end = (now // step) * step - step
        frames = []
        for i in range(23, -1, -1):
            ts = end - i * step
            frames.append({"time": ts, "kind": "observed"})
        return {
            "source": "dwd",
            "provider": "dwd",
            "animated": True,
            "wms": {
                "url": "https://maps.dwd.de/geoserver/dwd/wms",
                "layers": "dwd:Niederschlagsradar",
                "format": "image/png",
                "transparent": True,
                "version": "1.3.0",
            },
            "frames": frames,
            "attribution": "DWD",
            "note": "German radar network — strongest near eastern Belgium / borders",
        }

    if source == "owm":
        if not OWM_API_KEY:
            raise HTTPException(
                status_code=503,
                detail="OpenWeatherMap not configured. Set OWM_API_KEY on the server.",
            )
        now = int(time.time())
        return {
            "source": "owm",
            "provider": "owm",
            "animated": False,
            "tileUrl": "/api/radar/owm/{z}/{x}/{y}.png",
            "maxNativeZoom": 10,
            "frames": [{"time": now, "kind": "observed"}],
            "attribution": "OpenWeatherMap",
        }

    raise HTTPException(status_code=400, detail=f"Unknown radar source: {source}")


@app.get("/api/radar/owm/{z}/{x}/{y}.png")
async def owm_tile_proxy(z: int, x: int, y: int):
    """Proxy OpenWeatherMap precipitation tiles so the API key stays server-side."""
    if not OWM_API_KEY:
        raise HTTPException(status_code=503, detail="OWM_API_KEY not configured")

    url = (
        f"https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png"
        f"?appid={OWM_API_KEY}"
    )
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(url)
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="OpenWeatherMap tile unavailable")

    return Response(
        content=response.content,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=120"},
    )


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
