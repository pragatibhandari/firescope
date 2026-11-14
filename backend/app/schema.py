"""Ingestion: map heterogeneous FIRMS / user files onto one canonical hotspot schema.

Canonical columns (one row = one satellite detection / pixel):
    record_id, lat, lon, acq_datetime (UTC), acq_date, sensor, platform, product,
    confidence_raw, confidence_class (low|nominal|high), confidence_score (0-1),
    frp (MW), brightness (K, MODIS T21 / VIIRS I4), bright_aux (K, MODIS T31 / VIIRS I5),
    scan, track, daynight, version, fire_type, source, dataset, country, ingested_at
"""
from __future__ import annotations

import hashlib
import io
import json
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

CANONICAL = [
    "record_id", "lat", "lon", "acq_datetime", "acq_date", "sensor", "platform", "product",
    "confidence_raw", "confidence_class", "confidence_score", "frp", "brightness", "bright_aux",
    "scan", "track", "daynight", "version", "fire_type", "source", "dataset", "country", "ingested_at",
]

CONF_RANK = {"low": 0, "nominal": 1, "high": 2}

_PLATFORM_ALIASES = {
    "terra": "Terra", "t": "Terra", "mod": "Terra",
    "aqua": "Aqua", "a": "Aqua", "myd": "Aqua",
    "n": "S-NPP", "npp": "S-NPP", "snpp": "S-NPP", "s-npp": "S-NPP", "suomi npp": "S-NPP", "suomi-npp": "S-NPP",
    "n20": "NOAA-20", "noaa-20": "NOAA-20", "noaa20": "NOAA-20", "j1": "NOAA-20", "1": "NOAA-20",
    "n21": "NOAA-21", "noaa-21": "NOAA-21", "noaa21": "NOAA-21", "j2": "NOAA-21", "2": "NOAA-21",
}
_SENSOR_OF = {"Terra": "MODIS", "Aqua": "MODIS", "S-NPP": "VIIRS", "NOAA-20": "VIIRS", "NOAA-21": "VIIRS"}


@dataclass
class ValidationReport:
    rows_in: int = 0
    rows_valid: int = 0
    dropped_invalid_coords: int = 0
    dropped_missing_time: int = 0
    dropped_unknown_platform: int = 0
    duplicates_removed: int = 0
    missing_frp: int = 0
    missing_confidence: int = 0
    notes: list[str] = field(default_factory=list)

    def as_dict(self):
        return self.__dict__.copy()


def _platform(sat: pd.Series, instrument: pd.Series, product_hint: str) -> pd.Series:
    s = sat.astype(str).str.strip().str.lower().map(_PLATFORM_ALIASES)
    hint = (product_hint or "").upper()
    fallback = None
    if "NOAA20" in hint or "NOAA-20" in hint or "J1" in hint:
        fallback = "NOAA-20"
    elif "NOAA21" in hint or "J2" in hint:
        fallback = "NOAA-21"
    elif "SNPP" in hint or "SV-C2" in hint or "NPP" in hint:
        fallback = "S-NPP"
    elif "MODIS" in hint or "M-C61" in hint or "M6" in hint:
        fallback = None  # Terra/Aqua cannot be inferred from the product alone
    if fallback:
        s = s.fillna(fallback)
    # instrument-only rows (e.g. MODIS without satellite) stay NaN -> dropped with a note
    return s


def _confidence(raw: pd.Series, sensor: pd.Series) -> tuple[pd.Series, pd.Series]:
    """Standardise MODIS 0-100 % and VIIRS l/n/h into low|nominal|high plus a 0-1 score.

    MODIS C6.1 user guide: low <30, nominal 30-79, high >=80.
    VIIRS 375 m: categorical low / nominal / high (no numeric value is published).
    """
    r = raw.astype(str).str.strip().str.lower()
    num = pd.to_numeric(r, errors="coerce")
    cls = pd.Series(np.nan, index=raw.index, dtype=object)
    score = pd.Series(np.nan, index=raw.index, dtype=float)
    is_num = num.notna()
    cls[is_num & (num < 30)] = "low"
    cls[is_num & (num >= 30) & (num < 80)] = "nominal"
    cls[is_num & (num >= 80)] = "high"
    score[is_num] = (num[is_num] / 100.0).clip(0, 1)
    cat = {"l": "low", "low": "low", "n": "nominal", "nominal": "nominal", "h": "high", "high": "high"}
    c2 = r.map(cat)
    use = ~is_num & c2.notna()
    cls[use] = c2[use]
    score[use] = c2[use].map({"low": 0.2, "nominal": 0.6, "high": 0.9})
    return cls, score


def _record_id(df: pd.DataFrame) -> pd.Series:
    key = (
        df["platform"].astype(str) + "|" + df["lat"].round(4).astype(str) + "|" + df["lon"].round(4).astype(str)
        + "|" + df["acq_datetime"].astype(str)
    )
    return key.map(lambda k: hashlib.blake2b(k.encode(), digest_size=8).hexdigest())


def normalize(raw: pd.DataFrame, *, source: str, product: str = "", dataset: str = "live",
              report: ValidationReport | None = None) -> tuple[pd.DataFrame, ValidationReport]:
    """Normalise a FIRMS-style table (CSV/JSON/GeoJSON properties) to the canonical schema."""
    rep = report or ValidationReport()
    df = raw.copy()
    df.columns = [str(c).strip().lower() for c in df.columns]
    rep.rows_in += len(df)
    if df.empty:
        return pd.DataFrame(columns=CANONICAL), rep

    lat = pd.to_numeric(df.get("latitude", df.get("lat")), errors="coerce")
    lon = pd.to_numeric(df.get("longitude", df.get("lon")), errors="coerce")

    # Time: FIRMS acq_date (YYYY-MM-DD) + acq_time (HHMM, UTC, sometimes without leading zeros)
    date = pd.to_datetime(df.get("acq_date"), errors="coerce", utc=True)
    if "acq_time" in df:
        t = df["acq_time"].astype(str).str.replace(":", "", regex=False).str.extract(r"(\d+)")[0].fillna("0").str.zfill(4)
        hh = pd.to_numeric(t.str[:2], errors="coerce").fillna(0)
        mm = pd.to_numeric(t.str[2:4], errors="coerce").fillna(0)
        dt = date + pd.to_timedelta(hh, unit="h") + pd.to_timedelta(mm, unit="m")
    elif "acq_datetime" in df:
        dt = pd.to_datetime(df["acq_datetime"], errors="coerce", utc=True)
    else:
        dt = date

    inst = df.get("instrument", pd.Series("", index=df.index)).astype(str)
    platform = _platform(df.get("satellite", pd.Series("", index=df.index)), inst, product or source)
    sensor = platform.map(_SENSOR_OF)

    conf_raw = df.get("confidence", pd.Series(np.nan, index=df.index))
    conf_cls, conf_score = _confidence(conf_raw, sensor)

    bright = pd.to_numeric(df.get("brightness", df.get("bright_ti4")), errors="coerce")
    aux = pd.to_numeric(df.get("bright_t31", df.get("bright_ti5")), errors="coerce")

    out = pd.DataFrame({
        "lat": lat, "lon": lon, "acq_datetime": dt,
        "sensor": sensor, "platform": platform,
        "product": product or df.get("product", pd.Series(source, index=df.index)).astype(str),
        "confidence_raw": conf_raw.astype(str),
        "confidence_class": conf_cls, "confidence_score": conf_score,
        "frp": pd.to_numeric(df.get("frp"), errors="coerce"),
        "brightness": bright, "bright_aux": aux,
        "scan": pd.to_numeric(df.get("scan"), errors="coerce"),
        "track": pd.to_numeric(df.get("track"), errors="coerce"),
        "daynight": df.get("daynight", pd.Series(None, index=df.index)),
        "version": df.get("version", pd.Series(None, index=df.index)).astype(str),
        "fire_type": pd.to_numeric(df.get("type", pd.Series(np.nan, index=df.index)), errors="coerce"),
    })

    bad_xy = ~(out.lat.between(-90, 90) & out.lon.between(-180, 180))
    rep.dropped_invalid_coords += int(bad_xy.sum())
    bad_t = out.acq_datetime.isna() & ~bad_xy
    rep.dropped_missing_time += int(bad_t.sum())
    bad_p = out.platform.isna() & ~bad_xy & ~bad_t
    rep.dropped_unknown_platform += int(bad_p.sum())
    if bad_p.any():
        rep.notes.append("Rows without a recognisable satellite (Terra/Aqua/N/N20/N21) were dropped; "
                         "add a 'satellite' column to keep them.")
    out = out[~(bad_xy | bad_t | bad_p)].copy()

    rep.missing_frp += int(out.frp.isna().sum())
    rep.missing_confidence += int(out.confidence_class.isna().sum())
    out["confidence_class"] = out["confidence_class"].fillna("nominal")
    out["confidence_score"] = out["confidence_score"].fillna(0.5)

    out["acq_datetime"] = out["acq_datetime"].dt.tz_convert("UTC").dt.tz_localize(None)
    out["acq_date"] = out["acq_datetime"].dt.normalize()
    out["source"] = source
    out["dataset"] = dataset
    out["country"] = None
    out["ingested_at"] = pd.Timestamp.utcnow().tz_localize(None)
    out["record_id"] = _record_id(out)
    n0 = len(out)
    out = out.drop_duplicates("record_id")
    rep.duplicates_removed += n0 - len(out)
    rep.rows_valid += len(out)
    return out[CANONICAL], rep


def read_upload(content: bytes, filename: str) -> tuple[pd.DataFrame, str]:
    """Parse an uploaded CSV / JSON / GeoJSON file into a raw dataframe."""
    name = filename.lower()
    if name.endswith((".geojson", ".json")):
        obj = json.loads(content.decode("utf-8"))
        if obj.get("type") == "FeatureCollection":
            rows = []
            for f in obj.get("features", []):
                p = dict(f.get("properties") or {})
                g = f.get("geometry") or {}
                if g.get("type") == "Point":
                    p.setdefault("longitude", g["coordinates"][0])
                    p.setdefault("latitude", g["coordinates"][1])
                rows.append(p)
            return pd.DataFrame(rows), "geojson"
        if isinstance(obj, list):
            return pd.DataFrame(obj), "json"
        raise ValueError("JSON must be a GeoJSON FeatureCollection or a list of records")
    return pd.read_csv(io.BytesIO(content), low_memory=False), "csv"
