"""DuckDB-backed hotspot store with provenance (columnar, fast spatial/temporal range scans).

The spec suggests PostgreSQL/PostGIS. DuckDB is used so the platform runs with zero external
services (single file DB, columnar scans over millions of rows). The query layer is isolated
here, so swapping to PostGIS only requires re-implementing this module.
"""
from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from datetime import date

import duckdb
import pandas as pd

from .config import DB_PATH
from .geo import AOI, assign_country
from .schema import CANONICAL, CONF_RANK

_lock = threading.RLock()
_con: duckdb.DuckDBPyConnection | None = None


def _root() -> duckdb.DuckDBPyConnection:
    global _con
    if _con is None:
        _con = duckdb.connect(str(DB_PATH))
        _con.execute("""
        CREATE TABLE IF NOT EXISTS hotspots (
            record_id VARCHAR, lat DOUBLE, lon DOUBLE, acq_datetime TIMESTAMP, acq_date DATE,
            sensor VARCHAR, platform VARCHAR, product VARCHAR, confidence_raw VARCHAR,
            confidence_class VARCHAR, confidence_score DOUBLE, frp DOUBLE, brightness DOUBLE,
            bright_aux DOUBLE, scan DOUBLE, track DOUBLE, daynight VARCHAR, version VARCHAR,
            fire_type DOUBLE, source VARCHAR, dataset VARCHAR, country VARCHAR, ingested_at TIMESTAMP
        )""")
        _con.execute("""
        CREATE TABLE IF NOT EXISTS sync_log (
            id VARCHAR, started_at TIMESTAMP, finished_at TIMESTAMP, kind VARCHAR, status VARCHAR,
            params VARCHAR, rows_added BIGINT, message VARCHAR
        )""")
    return _con


def con() -> duckdb.DuckDBPyConnection:
    """A fresh cursor (thread-safe handle) on the shared database connection."""
    with _lock:
        return _root().cursor()


def count(dataset: str) -> int:
    with _lock:
        return con().execute("SELECT count(*) FROM hotspots WHERE dataset = ?", [dataset]).fetchone()[0]


@dataclass
class Filters:
    dataset: str = "live"  # real satellite data only (the synthetic demo dataset was removed)
    start: date | None = None
    end: date | None = None
    sensors: list[str] = field(default_factory=lambda: ["MODIS", "VIIRS"])
    platforms: list[str] | None = None
    product: str = "all"            # all | SP | NRT
    min_conf: str = "low"           # low | nominal | high
    aoi: dict | None = None
    exclude_static: bool = True     # drop MODIS type 1/2/3 (volcano, static land, offshore) when known

    @classmethod
    def from_dict(cls, d: dict | None) -> "Filters":
        d = dict(d or {})
        f = cls()
        for k, v in d.items():
            if hasattr(f, k) and v is not None:
                setattr(f, k, v)
        f.dataset = "live"
        if isinstance(f.start, str):
            f.start = date.fromisoformat(f.start[:10])
        if isinstance(f.end, str):
            f.end = date.fromisoformat(f.end[:10])
        return f

    def key(self, ignore_dates=False) -> str:
        d = dict(self.__dict__)
        if ignore_dates:
            d.pop("start"); d.pop("end")
        return json.dumps(d, sort_keys=True, default=str)


def insert(df: pd.DataFrame) -> int:
    if df.empty:
        return 0
    df = df.copy()
    for c in ("lat", "lon", "confidence_score", "frp", "brightness", "bright_aux", "scan", "track", "fire_type"):
        df[c] = pd.to_numeric(df[c], errors="coerce").astype("float64")
    df = df.dropna(subset=["lat", "lon"])
    if df.empty:
        return 0
    df["country"] = assign_country(df["lat"].to_numpy(), df["lon"].to_numpy())
    with _lock:
        c = con()
        c.register("incoming", df[CANONICAL])
        before = c.execute("SELECT count(*) FROM hotspots").fetchone()[0]
        # Prefer standard (SP) over NRT for the same physical detection; skip exact duplicates
        c.execute("""
            INSERT INTO hotspots SELECT i.* FROM incoming i
            WHERE NOT EXISTS (SELECT 1 FROM hotspots h WHERE h.record_id = i.record_id)
        """)
        c.unregister("incoming")
        after = c.execute("SELECT count(*) FROM hotspots").fetchone()[0]
    _cache.clear()
    return after - before


def delete_dataset(dataset: str):
    with _lock:
        con().execute("DELETE FROM hotspots WHERE dataset = ?", [dataset])
    _cache.clear()


_cache: dict[str, pd.DataFrame] = {}


# Columns needed by the harmonisation + analytics (about 1/4 of the memory of all 23 columns)
SLIM = ["record_id", "lat", "lon", "acq_datetime", "acq_date", "sensor", "platform", "product", "source",
        "confidence_class", "frp", "country"]
_CATEGORICAL = ("sensor", "platform", "product", "source", "confidence_class", "country")


def query(f: Filters, *, all_dates: bool = False, columns: list[str] | None = None, sample: int | None = None) -> pd.DataFrame:
    """Server-side filtering. all_dates=True returns the AOI's full history (for baselines)."""
    key = f.key(ignore_dates=all_dates) + ("|all" if all_dates else "") + str(columns) + f"|s{sample}"
    if key in _cache:
        return _cache[key]
    aoi = AOI(f.aoi)
    w, s, e, n = aoi.bbox
    where = ["dataset = ?", "lat BETWEEN ? AND ?", "lon BETWEEN ? AND ?"]
    params: list = [f.dataset, s, n, w, e]
    if not all_dates:
        if f.start:
            where.append("acq_date >= ?"); params.append(f.start)
        if f.end:
            where.append("acq_date <= ?"); params.append(f.end)
    if f.sensors:
        where.append(f"sensor IN ({','.join('?' * len(f.sensors))})"); params += list(f.sensors)
    if f.platforms:
        where.append(f"platform IN ({','.join('?' * len(f.platforms))})"); params += list(f.platforms)
    if f.product in ("SP", "NRT"):
        where.append("product LIKE ?"); params.append(f"%{f.product}%")
    rank = CONF_RANK.get(f.min_conf, 0)
    allowed = [k for k, v in CONF_RANK.items() if v >= rank]
    where.append(f"confidence_class IN ({','.join('?' * len(allowed))})"); params += allowed
    if f.exclude_static:
        where.append("(fire_type IS NULL OR fire_type = 0)")
    cols = ", ".join(columns) if columns else "*"
    sql = f"SELECT {cols} FROM hotspots WHERE {' AND '.join(where)}"
    if sample:
        sql = f"SELECT * FROM ({sql}) USING SAMPLE reservoir({int(sample)} ROWS) REPEATABLE (1)"
    with _lock:
        df = con().execute(sql, params).df()
    if not df.empty:
        df = df[aoi.mask(df)].reset_index(drop=True)
        df["acq_date"] = pd.to_datetime(df["acq_date"])
        if columns:  # compact dtypes for the large analysis frames
            for c in _CATEGORICAL:
                if c in df:
                    df[c] = df[c].astype("category")
            if "record_id" in df:
                df["record_id"] = df["record_id"].astype("string[pyarrow]")
            for c in ("lat", "lon"):
                if c in df:
                    df[c] = df[c].astype("float64")
            if "frp" in df:
                df["frp"] = df["frp"].astype("float32")
    if len(_cache) > 24:
        _cache.pop(next(iter(_cache)))
    _cache[key] = df
    return df


def coverage(dataset: str) -> pd.DataFrame:
    """Observed temporal coverage per platform (used for observation-opportunity bookkeeping)."""
    with _lock:
        return con().execute("""
            SELECT platform, sensor, min(acq_date) AS first_date, max(acq_date) AS last_date, count(*) AS n
            FROM hotspots WHERE dataset = ? GROUP BY 1, 2 ORDER BY 2, 1
        """, [dataset]).df()


def dataset_summary() -> list[dict]:
    with _lock:
        df = con().execute("""
            SELECT dataset, source, sensor, platform, count(*) n, min(acq_date) first_date, max(acq_date) last_date,
                   max(ingested_at) last_ingest
            FROM hotspots GROUP BY ALL ORDER BY dataset, sensor, platform, source
        """).df()
    for c in ("first_date", "last_date", "last_ingest"):
        df[c] = df[c].astype(str)
    return df.to_dict("records")


def log_sync(entry: dict):
    with _lock:
        con().execute("INSERT INTO sync_log VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
            entry["id"], entry.get("started_at"), entry.get("finished_at"), entry.get("kind"), entry.get("status"),
            json.dumps(entry.get("params", {})), entry.get("rows_added", 0), entry.get("message", "")])


def sync_history(limit=20) -> list[dict]:
    with _lock:
        df = con().execute("SELECT * FROM sync_log ORDER BY started_at DESC LIMIT ?", [limit]).df()
    return [{k: (str(v) if k.endswith("_at") else v) for k, v in r.items()} for r in df.to_dict("records")]
