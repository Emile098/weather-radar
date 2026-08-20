"""Belgium Weather & Lightning Radar — lightweight FastAPI server."""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
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
RAINVIEWER_MAPS = "https://api.rainviewer.com/public/weather-maps.json"
KNMI_WMS = "https://geoservices.knmi.nl/wms"
DWD_WMS = "https://maps.dwd.de/geoserver/dwd/wms"
DEFAULT_RADAR_SOURCE = "knmi"
RAINVIEWER_PROBE_TTL = 300.0

# (checked_at, available, reason)
_rv_health: tuple[float, bool, str] | None = None


def _wms_time_frames(hours: float = 2.0, step_min: int = 5) -> list[dict[str, Any]]:
    now = int(time.time())
    step = step_min * 60
    end = (now // step) * step - step
    count = max(1, int((hours * 3600) / step))
    return [{"time": end - i * step, "kind": "observed"} for i in range(count - 1, -1, -1)]


async def probe_rainviewer_tiles(client: httpx.AsyncClient) -> tuple[bool, str]:
    """RainViewer often publishes a catalog while CDN tile paths return 404/410."""
    global _rv_health
    if _rv_health and time.time() - _rv_health[0] < RAINVIEWER_PROBE_TTL:
        return _rv_health[1], _rv_health[2]

    try:
        response = await client.get(RAINVIEWER_MAPS, headers={"Accept": "application/json"})
        if response.status_code != 200:
            result = (False, f"catalog HTTP {response.status_code}")
        else:
            data = response.json()
            host = str(data.get("host", "")).rstrip("/")
            past = data.get("radar", {}).get("past") or []
            if not host or not past:
                result = (False, "empty RainViewer catalog")
            else:
                path = past[-1]["path"]
                tile = f"{host}{path}/256/2/1/1/2/1_1.png"
                tile_resp = await client.get(tile)
                ok = tile_resp.status_code == 200 and len(tile_resp.content) > 200
                result = (
                    (True, "OK")
                    if ok
                    else (
                        False,
                        f"tiles unavailable ({tile_resp.status_code}) — RainViewer CDN currently broken",
                    )
                )
    except Exception as exc:  # noqa: BLE001
        result = (False, f"probe failed: {exc}")

    _rv_health = (time.time(), result[0], result[1])
    return result


async def radar_sources(client: httpx.AsyncClient | None = None) -> list[dict]:
    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(timeout=15.0, follow_redirects=True)
    assert client is not None
    try:
        rv_ok, rv_reason = await probe_rainviewer_tiles(client)
    finally:
        if own_client:
            await client.aclose()

    sources = [
        {
            "id": "knmi",
            "name": "KNMI Benelux",
            "short": "KNMI",
            "description": "Official Dutch radar composite — best coverage for Belgium",
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
            "id": "rainviewer",
            "name": "RainViewer",
            "short": "Global",
            "description": "Global radar composite · ~10 min steps"
            + ("" if rv_ok else f" · {rv_reason}"),
            "animated": True,
            "available": rv_ok,
        },
        {
            "id": "rainviewer_forecast",
            "name": "RainViewer + Forecast",
            "short": "RV+FC",
            "description": "RainViewer history plus nowcast frames when available"
            + ("" if rv_ok else f" · {rv_reason}"),
            "animated": True,
            "available": rv_ok,
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


def pick_default_source(sources: list[dict]) -> str:
    for candidate in ("knmi", "dwd", "rainviewer", "owm"):
        if any(s["id"] == candidate and s.get("available") for s in sources):
            return candidate
    return DEFAULT_RADAR_SOURCE


app = FastAPI(title="Belgium Radar Dashboard", version="1.2.0")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
async def config() -> dict:
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        sources = await radar_sources(client)
    payload = dict(BELGIUM)
    payload["radarSources"] = sources
    payload["defaultRadarSource"] = pick_default_source(sources)
    return payload


@app.get("/api/radar/sources")
async def list_radar_sources() -> dict:
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        sources = await radar_sources(client)
    return {"sources": sources, "default": pick_default_source(sources)}


@app.get("/api/rainviewer")
async def rainviewer_proxy() -> dict:
    """Proxy RainViewer manifest to avoid browser CORS issues."""
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        response = await client.get(RAINVIEWER_MAPS, headers={"Accept": "application/json"})
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="RainViewer API unavailable")
    return response.json()


@app.get("/api/radar/manifest")
async def radar_manifest(source: str = DEFAULT_RADAR_SOURCE) -> dict:
    """Normalized radar frame manifest for the selected source."""
    source = source.strip().lower()

    if source == "knmi":
        return {
            "source": "knmi",
            "provider": "wms",
            "animated": True,
            "wms": {
                "url": "/api/radar/wms/knmi",
                "layers": "RAD_NL25_PCP_CM",
                "styles": "precip-blue-transparent/nearest",
                "format": "image/png",
                "transparent": True,
                "version": "1.3.0",
            },
            "frames": _wms_time_frames(hours=2.0, step_min=5),
            "attribution": "KNMI",
            "note": "KNMI Benelux radar — best Belgium / Low Countries coverage",
        }

    if source in {"rainviewer", "rainviewer_forecast"}:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            rv_ok, rv_reason = await probe_rainviewer_tiles(client)
            if not rv_ok:
                raise HTTPException(status_code=503, detail=rv_reason)
            response = await client.get(RAINVIEWER_MAPS, headers={"Accept": "application/json"})
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
        return {
            "source": "dwd",
            "provider": "wms",
            "animated": True,
            "wms": {
                "url": "/api/radar/wms/dwd",
                "layers": "dwd:Niederschlagsradar",
                "styles": "",
                "format": "image/png",
                "transparent": True,
                "version": "1.3.0",
            },
            "frames": _wms_time_frames(hours=2.0, step_min=5),
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


@app.get("/api/radar/wms/{provider}")
async def radar_wms_proxy(provider: str, request: Request) -> Response:
    """Proxy WMS GetMap so browsers avoid CORS/quirks and we can pin DATASET/layers."""
    params = {k: v for k, v in request.query_params.multi_items()}
    provider = provider.strip().lower()

    if provider == "knmi":
        upstream = KNMI_WMS
        params.setdefault("DATASET", "RADAR")
        params.setdefault("LAYERS", "RAD_NL25_PCP_CM")
        params.setdefault("STYLES", "precip-blue-transparent/nearest")
    elif provider == "dwd":
        upstream = DWD_WMS
        params.setdefault("LAYERS", "dwd:Niederschlagsradar")
        params.setdefault("STYLES", "")
    else:
        raise HTTPException(status_code=404, detail=f"Unknown WMS provider: {provider}")

    params.setdefault("SERVICE", "WMS")
    params.setdefault("VERSION", "1.3.0")
    params.setdefault("REQUEST", "GetMap")
    params.setdefault("FORMAT", "image/png")
    params.setdefault("TRANSPARENT", "true")
    params.setdefault("CRS", "EPSG:3857")

    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        try:
            response = await client.get(upstream, params=params)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"WMS upstream error: {exc}") from exc

    content_type = response.headers.get("content-type", "image/png")
    return Response(
        content=response.content,
        status_code=response.status_code,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=60"},
    )


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
