"""Runtime configuration (environment variables only; never sent to the browser)."""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# Minimal .env loader (backend/.env) so secrets never need to be in code or the frontend
_env = BASE_DIR / ".env"
if _env.exists():
    for _line in _env.read_text().splitlines():
        if "=" in _line and not _line.lstrip().startswith("#"):
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))
DATA_DIR = Path(os.getenv("FIRESCOPE_DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = Path(os.getenv("FIRESCOPE_DB", DATA_DIR / "firescope.duckdb"))
COUNTRIES_PATH = BASE_DIR / "data" / "countries.geojson"

# NASA FIRMS MAP_KEY - request one free at https://firms.modaps.eosdis.nasa.gov/api/map_key/
FIRMS_MAP_KEY = os.getenv("FIRMS_MAP_KEY", "").strip()
FIRMS_BASE = os.getenv("FIRMS_BASE", "https://firms.modaps.eosdis.nasa.gov")

# Build the clearly-labelled synthetic demo dataset on first start
DEMO_ENABLED = os.getenv("FIRESCOPE_DEMO", "1") != "0"
DEMO_SEED = int(os.getenv("FIRESCOPE_DEMO_SEED", "42"))

# Admin password for sync / upload / delete. Empty = no lock (local development only!)
ADMIN_TOKEN = os.getenv("FIRESCOPE_ADMIN_TOKEN", "").strip()

CORS_ORIGINS = [o.strip() for o in os.getenv("FIRESCOPE_CORS", "*").split(",") if o.strip()]

# Mission start dates (used for coverage / observation-opportunity bookkeeping)
PLATFORM_START = {
    "Terra": "2000-11-01",
    "Aqua": "2002-07-04",
    "S-NPP": "2012-01-20",
    "NOAA-20": "2018-01-01",
    "NOAA-21": "2023-03-01",
}
SENSOR_OF = {"Terra": "MODIS", "Aqua": "MODIS", "S-NPP": "VIIRS", "NOAA-20": "VIIRS", "NOAA-21": "VIIRS"}

MAX_MAP_POINTS = int(os.getenv("FIRESCOPE_MAX_MAP_POINTS", "25000"))
