"""FireScope API - FastAPI application."""
from __future__ import annotations

import functools
import io
import json
import threading
import time
from datetime import date, datetime, timedelta

import httpx
import numpy as np
import pandas as pd
import shapely
import hmac

from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from shapely.geometry import mapping, shape

from . import analytics, firms, store
from .config import ADMIN_TOKEN, AUTOSYNC_HOURS, CORS_ORIGINS, MAX_MAP_POINTS, PLATFORM_START
from .geo import AOI, countries_geojson_simplified, country_index
from .harmonize import HarmonizationParams, run, sensitivity
from .reports import LIMITATIONS, build_pdf
from .schema import normalize, read_upload

app = FastAPI(title="FireScope API", version="1.0.0",
              description="Global burning-activity intelligence & MODIS-VIIRS harmonisation (NASA FIRMS)")
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=2000)

def require_admin(x_admin_token: str | None = Header(default=None)):
    """Protects data-changing endpoints when FIRESCOPE_ADMIN_TOKEN is set (always set it on a public server)."""
    if ADMIN_TOKEN and not hmac.compare_digest((x_admin_token or "").encode(), ADMIN_TOKEN.encode()):
        raise HTTPException(401, "Admin password required for this action.")


STATE = {"started": datetime.utcnow().isoformat() + "Z"}
AUTOSYNC = {"enabled": False, "every_hours": AUTOSYNC_HOURS, "last_run": None, "last_status": None,
            "last_rows": 0, "next_run": None, "job_id": None}


def _autosync_loop():
    """Every AUTOSYNC_HOURS: fetch the newest MODIS + VIIRS near-real-time detections for the whole world.

    Re-fetches the last 2 days each time (NRT files grow during the day); duplicates are skipped on insert,
    so only new detections are added. Uses a handful of FIRMS API transactions per run.
    """
    time.sleep(90)  # let the server finish starting
    while True:
        try:
            today = datetime.utcnow().date()
            last = store.dataset_summary()
            lasts = [str(d["last_date"])[:10] for d in last if d["dataset"] == "live" and str(d["last_date"]) not in ("NaT", "None")]
            last_obs = date.fromisoformat(max(lasts)) if lasts else today - timedelta(days=2)
            # catch up from the last stored day (at most 10 days back to protect the API quota)
            start = max(min(last_obs, today - timedelta(days=1)) - timedelta(days=1), today - timedelta(days=10))
            AUTOSYNC.update(last_run=datetime.utcnow().isoformat() + "Z", last_status="running")
            jid = firms.start_area_sync([-180, -90, 180, 90], start, today, ["MODIS", "VIIRS"], chunk_days=1)  # whole world: one day per request
            AUTOSYNC["job_id"] = jid
            while firms.JOBS.get(jid, {}).get("status") in ("queued", "running") or str(firms.JOBS.get(jid, {}).get("status", "")).startswith("waiting"):
                time.sleep(10)
            j = firms.JOBS.get(jid, {})
            AUTOSYNC.update(last_status=j.get("status"), last_rows=j.get("rows_added", 0))
            if j.get("rows_added"):
                _clear_caches()
            _warm_default_view()
        except Exception as e:  # noqa
            AUTOSYNC.update(last_status=f"error: {e}")
        nxt = datetime.utcnow() + timedelta(hours=AUTOSYNC_HOURS)
        AUTOSYNC["next_run"] = nxt.isoformat() + "Z"
        time.sleep(AUTOSYNC_HOURS * 3600)


@app.on_event("startup")
def _startup():
    # real satellite data only: drop any synthetic demo rows left from older versions (frees memory and disk)
    try:
        if store.count("demo"):
            store.delete_dataset("demo")
    except Exception:  # noqa
        pass
    threading.Thread(target=_warm_default_view, daemon=True).start()
    if AUTOSYNC_HOURS > 0 and firms.key_configured():
        AUTOSYNC["enabled"] = True
        threading.Thread(target=_autosync_loop, daemon=True).start()


def _json(obj):
    def conv(o):
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating,)):
            return None if np.isnan(o) else float(o)
        if isinstance(o, (pd.Timestamp, datetime, date)):
            return o.isoformat()
        if isinstance(o, pd.Period):
            return str(o)
        if isinstance(o, np.ndarray):
            return o.tolist()
        if isinstance(o, np.bool_):
            return bool(o)
        return str(o)
    txt = json.dumps(obj, default=conv)
    clean = json.loads(txt, parse_constant=lambda c: None)
    body = json.dumps(clean, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    # X-Content-Bytes = uncompressed size, so the browser can show real download progress even when gzipped
    return Response(content=body, media_type="application/json", headers={"X-Content-Bytes": str(len(body))})


# --------------------------------------------------------------------------- harmonisation cache
_hcache: dict[str, tuple] = {}
_hlock = threading.Lock()

# --------------------------------------------------------------------------- response cache
# Finished responses for identical requests (same filters + parameters) are served from memory.
# Cleared whenever the data changes (upload, sync, delete), so results are never stale.
_rcache: dict[str, tuple[bytes, dict]] = {}


def _num(o):
    """Normalise numbers so 3 and 3.0 give the same cache key."""
    if isinstance(o, bool) or o is None:
        return o
    if isinstance(o, (int, float)):
        return float(o)
    if isinstance(o, dict):
        return {k: _num(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_num(v) for v in o]
    return o


def _rkey(name: str, body: dict) -> str:
    f = store.Filters.from_dict(body.get("filters"))
    p = HarmonizationParams.from_dict(body.get("params"))
    rest = {k: v for k, v in body.items() if k not in ("filters", "params")}
    return "|".join([name, f.key(), json.dumps(_num(dict(p.__dict__)), sort_keys=True, default=str), json.dumps(_num(rest), sort_keys=True, default=str)])


def cached(fn):
    @functools.wraps(fn)
    def wrapper(body: dict = Body(...)):
        try:
            k = _rkey(fn.__name__, body)
        except Exception:  # noqa
            return fn(body)
        hit = _rcache.get(k)
        if hit is not None:
            return Response(content=hit[0], media_type="application/json", headers=hit[1])
        r = fn(body)
        if getattr(r, "status_code", 200) == 200 and hasattr(r, "body"):
            if len(_rcache) >= 60:
                _rcache.pop(next(iter(_rcache)))
            _rcache[k] = (bytes(r.body), {"X-Content-Bytes": str(len(r.body))})
        return r
    return wrapper


def _clear_caches():
    with _hlock:
        _hcache.clear()
    _rcache.clear()


def _warm_default_view():
    """Pre-compute the home page (whole world, last 90 days of data) so the first visitor gets it instantly."""
    try:
        lasts = [str(d["last_date"])[:10] for d in store.dataset_summary()
                 if d["dataset"] == "live" and str(d["last_date"]) not in ("NaT", "None")]
        if not lasts:
            return
        end = date.fromisoformat(max(lasts))
        start = end - timedelta(days=89)
        body = {"filters": {"dataset": "live", "start": str(start), "end": str(end), "sensors": ["MODIS", "VIIRS"],
                            "product": "all", "min_conf": "nominal", "aoi": {"kind": "world"}, "exclude_static": True},
                "params": {}}
        points(body)
        summary(body)
        # Argentina (the challenge author's country, full 2000-today record): pre-compute its analysis pages too
        arg = {"filters": {**body["filters"], "aoi": {"kind": "country", "country": "Argentina"}}, "params": {}}
        for fn in (points, summary, calendar, harmonization, anomalies):
            try:
                fn(arg)
            except Exception:  # noqa
                pass
    except Exception:  # noqa
        pass


LARGE_AOI_KM2 = 40_000_000  # larger areas (e.g. the whole globe) are analysed for the selected period only


def is_large(f: store.Filters) -> bool:
    return AOI(f.aoi).area_km2 > LARGE_AOI_KM2


def harmonized(f: store.Filters, p: HarmonizationParams):
    large = is_large(f)
    key = f.key(ignore_dates=not large) + p.key()
    with _hlock:
        if key in _hcache:
            return _hcache[key]
    raw_all = store.query(f, all_dates=not large, columns=store.SLIM)
    cov = store.coverage(f.dataset)
    hr = run(raw_all, p, cov)
    if large:
        hr.notes.append("Very large area: analysis covers the selected period only (historical baselines and "
                        "long-term calibration are computed for regional areas such as a continent or country).")
    with _hlock:
        if len(_hcache) > 12:
            _hcache.pop(next(iter(_hcache)))
        _hcache[key] = (raw_all, hr)
    return raw_all, hr


def _ctx(body: dict):
    f = store.Filters.from_dict(body.get("filters"))
    p = HarmonizationParams.from_dict(body.get("params"))
    raw_all, hr = harmonized(f, p)
    m = np.ones(len(raw_all), bool)
    if f.start:
        m &= raw_all.acq_date >= pd.Timestamp(f.start)
    if f.end:
        m &= raw_all.acq_date <= pd.Timestamp(f.end)
    return f, p, raw_all, raw_all[m], hr, m


def _full_rows(f: store.Filters, raw_all: pd.DataFrame, hr, sample: int | None = None) -> pd.DataFrame:
    """All columns for the selected period (points / exports), with harmonisation status joined by record_id."""
    full = store.query(f, sample=sample)
    if full.empty:
        return full.assign(status=pd.Series(dtype=object), event=pd.Series(dtype="int64"))
    ids = raw_all["record_id"].astype(str).to_numpy()
    st = pd.Series(hr.det_status.to_numpy(), index=ids)
    ev = pd.Series(hr.det_event.to_numpy(), index=ids)
    st = st[~st.index.duplicated()]; ev = ev[~ev.index.duplicated()]
    full["status"] = st.reindex(full.record_id.astype(str)).fillna("").to_numpy()
    full["event"] = ev.reindex(full.record_id.astype(str)).fillna(-1).astype("int64").to_numpy()
    return full


# --------------------------------------------------------------------------- status & metadata
@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/status")
def status():
    ds = store.dataset_summary()
    live = [d for d in ds if d["dataset"] == "live"]
    last = max([d["last_date"] for d in live], default=None)
    fresh_h = None
    if last and last != "NaT":
        fresh_h = round((datetime.utcnow() - pd.Timestamp(last).to_pydatetime()).total_seconds() / 3600, 1)
    return _json({
        "server_time": datetime.utcnow().isoformat() + "Z",
        "firms": firms.mapkey_status(), "datasets": ds, "default_dataset": "live",
        "live_last_observation": last, "live_freshness_hours": fresh_h, "sync_history": store.sync_history(),
        "autosync": AUTOSYNC,
        "coverage": {d: store.coverage(d).assign(first_date=lambda x: x.first_date.astype(str), last_date=lambda x: x.last_date.astype(str)).to_dict("records")
                     for d in ("live",)},
        "platform_start": PLATFORM_START, "sources": firms.SOURCES, "admin_required": bool(ADMIN_TOKEN),
    })


@app.get("/api/admin/check", dependencies=[Depends(require_admin)])
def admin_check():
    return {"ok": True}


@app.get("/api/regions")
def regions():
    return country_index()


@app.get("/api/geo/countries")
def countries_geo():
    return countries_geojson_simplified()


@app.get("/api/geocode")
def geocode(q: str):
    """Place / administrative-region search (OpenStreetMap Nominatim, server-side proxy)."""
    try:
        with httpx.Client(timeout=15, headers={"User-Agent": "FireScope/1.0 (NASA Space Apps)"}) as c:
            r = c.get("https://nominatim.openstreetmap.org/search",
                      params={"q": q, "format": "json", "limit": 6, "polygon_geojson": 1, "polygon_threshold": 0.01})
        r.raise_for_status()
    except Exception as e:  # noqa
        raise HTTPException(502, f"Geocoder unavailable: {e}")
    out = []
    for it in r.json():
        bb = [float(it["boundingbox"][2]), float(it["boundingbox"][0]), float(it["boundingbox"][3]), float(it["boundingbox"][1])]
        geom = it.get("geojson")
        if geom and geom.get("type") in ("Polygon", "MultiPolygon"):
            g = shapely.simplify(shape(geom), 0.01, preserve_topology=True)
            geom = mapping(g)
        else:
            geom = None
        out.append({"name": it.get("display_name"), "type": it.get("type"), "class": it.get("class"), "bbox": bb, "geometry": geom})
    return out


# --------------------------------------------------------------------------- analytics endpoints
@app.post("/api/summary")
@cached
def summary(body: dict = Body(...)):
    f, p, raw_all, raw, hr, _ = _ctx(body)
    out = analytics.summary(raw, hr, f.start, f.end)
    out["aoi"] = {"name": AOI(f.aoi).name, "area_km2": AOI(f.aoi).area_km2}
    out["notes"] = hr.notes
    out["dataset"] = f.dataset
    return _json(out)


@app.post("/api/harmonization")
@cached
def harmonization(body: dict = Body(...)):
    f, p, raw_all, raw, hr, _ = _ctx(body)
    mon = hr.monthly[["date", "modis_det", "viirs_det", "naive_sum", "modis_cd", "viirs_cd", "union_cd",
                      "matched_modis_cd", "matched_viirs_cd", "harmonized", "harm_lo", "harm_hi", "fai", "calibrated"]].copy()
    mon["date"] = mon.date.dt.strftime("%Y-%m")
    overlap = hr.monthly[~hr.monthly.calibrated & (hr.monthly.modis_cd > 0)]
    scatter = [{"date": d.strftime("%Y-%m"), "modis_cd": int(m), "union_cd": int(u)} for d, m, u in
               zip(overlap.date, overlap.modis_cd, overlap.union_cd)]
    status_counts = hr.det_status.value_counts().to_dict()
    stages = {
        "raw_detections": int(len(raw_all)),
        "excluded_platform": int(hr.det_status.str.startswith("excluded").sum()),
        "modis_cell_days": int(hr.daily.modis_cd.sum()), "viirs_cell_days": int(hr.daily.viirs_cd.sum()),
        "matched_modis_cell_days": int(hr.daily.matched_modis_cd.sum()),
        "matched_viirs_cell_days": int(hr.daily.matched_viirs_cd.sum()),
        "union_cell_days": int(hr.daily.union_cd.sum()),
        "estimated_events": int(len(hr.events)),
        "harmonized_total": float(hr.daily.harmonized.sum()),
    }
    return _json({"params": hr.params, "calibration": hr.calibration, "validation": hr.validation, "notes": hr.notes,
                  "monthly": mon.round(3).to_dict("records"), "overlap_scatter": scatter,
                  "status_counts": status_counts, "stages": stages, "dataset": f.dataset})


@app.post("/api/harmonization/sensitivity")  # heavy but read-only
def harmonization_sensitivity(body: dict = Body(...)):
    f = store.Filters.from_dict(body.get("filters"))
    p = HarmonizationParams.from_dict(body.get("params"))
    raw_all = store.query(f, all_dates=not is_large(f), columns=store.SLIM)
    if len(raw_all) > 1_500_000:
        raw_all = raw_all.sample(1_500_000, random_state=0)
    return _json({"runs": sensitivity(raw_all, p, store.coverage(f.dataset))})


@app.post("/api/calendar")
@cached
def calendar(body: dict = Body(...)):
    f, p, raw_all, raw, hr, _ = _ctx(body)
    return _json(analytics.calendar(hr, f.start, f.end, body.get("metric", "harmonized")))


@app.post("/api/calendar/day")
def calendar_day(body: dict = Body(...)):
    f, p, raw_all, raw, hr, _ = _ctx(body)
    return _json(analytics.day_detail(raw_all, hr, date.fromisoformat(body["date"])))


@app.post("/api/history")
@cached
def history(body: dict = Body(...)):
    f, p, raw_all, raw, hr, _ = _ctx(body)
    return _json(analytics.history(raw_all, hr, body.get("compare")))


@app.post("/api/recurrence")
@cached
def recurrence(body: dict = Body(...)):
    f, p, raw_all, raw, hr, _ = _ctx(body)
    aoi = AOI(f.aoi)
    w, s, e, n = aoi.bbox
    span = max(e - w, n - s)
    cell = body.get("cell_deg") or (1.0 if span > 120 else 0.5 if span > 40 else 0.25 if span > 15 else 0.1 if span > 5 else 0.05)
    keep = ~hr.det_status.str.startswith("excluded")
    return _json(analytics.recurrence(raw_all[keep.to_numpy()], cell))


@app.post("/api/anomalies")
@cached
def anomalies(body: dict = Body(...)):
    f, p, raw_all, raw, hr, _ = _ctx(body)
    a = body.get("anomaly", {})
    return _json(analytics.anomalies(hr, AOI(f.aoi).name, f.start, f.end, method=a.get("method", "robust_z"),
                                     threshold=float(a.get("threshold", 2.0)), min_value=float(a.get("min_value", 5)),
                                     ref_years=a.get("ref_years")))


@app.post("/api/points")
@cached
def points(body: dict = Body(...)):
    """Hotspots for the map (server-side filtered; random sample above the cap, with the true count reported)."""
    f, p, raw_all, raw, hr, m = _ctx(body)
    limit = int(body.get("limit") or MAX_MAP_POINTS)
    total = int(len(raw))
    sampled = total > limit
    # sample inside the database (extra margin for rows later removed by the polygon mask)
    sub = _full_rows(f, raw_all, hr, sample=int(limit * 1.5) if sampled else None)
    if len(sub) > limit:
        sub = sub.sample(limit, random_state=1)
    t0 = pd.Timestamp(f.start) if f.start else sub.acq_date.min()
    feats = []
    for r in sub.itertuples(index=False):
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(r.lon, 4), round(r.lat, 4)]},
                      "properties": {"id": r.record_id, "sensor": r.sensor, "platform": r.platform,
                                     "t": r.acq_datetime.strftime("%Y-%m-%d %H:%M"), "d": int((r.acq_date - t0).days),
                                     "conf": r.confidence_class, "conf_raw": r.confidence_raw,
                                     "frp": None if pd.isna(r.frp) else round(float(r.frp), 1),
                                     "bright": None if pd.isna(r.brightness) else round(float(r.brightness), 1),
                                     "scan": None if pd.isna(r.scan) else float(r.scan),
                                     "track": None if pd.isna(r.track) else float(r.track),
                                     "src": r.source, "product": r.product, "status": r.status, "event": int(r.event),
                                     "country": r.country, "dn": r.daynight}})
    return _json({"type": "FeatureCollection", "features": feats, "total": total, "sampled": sampled,
                  "t0": str(t0.date()) if pd.notna(t0) else None})


@app.post("/api/density")
@cached
def density(body: dict = Body(...)):
    """Gridded harmonised density: union cell-days per coarse cell (pre-VIIRS MODIS scaled by the calibration ratio)."""
    f, p, raw_all, raw, hr, m = _ctx(body)
    use = raw_all if body.get("all_dates") else raw
    st = hr.det_status if body.get("all_dates") else hr.det_status[m]
    is_m = (use.sensor == "MODIS").to_numpy()
    keep = ~st.str.startswith("excluded").to_numpy() & ~(is_m & (st == "matched (MODIS & VIIRS co-detection)").to_numpy())
    u = use[keep]
    aoi = AOI(f.aoi)
    w, s, e, n = aoi.bbox
    span = max(e - w, n - s)
    cell = body.get("cell_deg") or (1.0 if span > 120 else 0.5 if span > 40 else 0.2 if span > 15 else 0.1 if span > 5 else 0.025)
    g = p.grid_deg
    fine = (np.floor(u.lon / g).astype(np.int64) * 100000 + np.floor(u.lat / g).astype(np.int64)).astype(str) + "_" + u.acq_date.dt.strftime("%Y%m%d") + "_" + u.sensor.astype(str)
    r_m = hr.calibration["ratio_by_month"]
    df = pd.DataFrame({"cx": np.floor(u.lon / cell).astype(int), "cy": np.floor(u.lat / cell).astype(int), "fine": fine,
                       "w": np.where(st[keep].to_numpy() == "MODIS (pre-VIIRS era, calibrated)", u.acq_date.dt.month.map(lambda mm: r_m.get(mm, 1.0)), 1.0),
                       "frp": u.frp.fillna(0)})
    cd = df.drop_duplicates("fine")
    agg = cd.groupby(["cx", "cy"]).agg(harmonized=("w", "sum"), cell_days=("w", "size")).join(
        df.groupby(["cx", "cy"]).agg(detections=("w", "size"), frp_sum=("frp", "sum"))).reset_index()
    feats = []
    for r in agg.itertuples():
        x0, y0 = r.cx * cell, r.cy * cell
        feats.append({"type": "Feature", "properties": {"harmonized": round(float(r.harmonized), 2), "cell_days": int(r.cell_days),
                                                        "detections": int(r.detections), "frp_sum": round(float(r.frp_sum), 1)},
                      "geometry": {"type": "Polygon", "coordinates": [[[x0, y0], [x0 + cell, y0], [x0 + cell, y0 + cell], [x0, y0 + cell], [x0, y0]]]}})
    return _json({"type": "FeatureCollection", "features": feats, "cell_deg": cell,
                  "max": float(agg.harmonized.max()) if len(agg) else 0})


# --------------------------------------------------------------------------- exports & reports
@app.post("/api/export/csv")
def export_csv(body: dict = Body(...)):
    f, p, raw_all, raw, hr, m = _ctx(body)
    kind = body.get("kind", "detections")
    if kind == "calendar_daily":
        d = analytics._range(hr.daily, f.start, f.end)
        out = d[["date", "modis_det", "viirs_det", "high_conf_det", "modis_cd", "viirs_cd", "matched_modis_cd", "union_cd",
                 "harmonized", "harm_lo", "harm_hi", "fai", "calibrated", "frp_mean", "frp_max"]]
        name = "firescope_harmonized_daily.csv"
    elif kind == "calendar_monthly":
        out = hr.monthly.drop(columns=["month"])
        name = "firescope_harmonized_monthly.csv"
    else:
        out = _full_rows(f, raw_all, hr).rename(columns={"status": "harmonization_status", "event": "estimated_event_id"})
        name = "firescope_hotspots.csv"
    buf = io.StringIO()
    buf.write(f"# FireScope export | dataset={f.dataset} | aoi={AOI(f.aoi).name} | {f.start}..{f.end} | generated {datetime.utcnow():%Y-%m-%dT%H:%MZ}\n")
    buf.write(f"# filters={f.key()} | params={json.dumps(hr.params, default=str)}\n")
    out.to_csv(buf, index=False)
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={name}"})


@app.post("/api/export/geojson")
def export_geojson(body: dict = Body(...)):
    f, p, raw_all, raw, hr, m = _ctx(body)
    sub = _full_rows(f, raw_all, hr).rename(columns={"status": "harmonization_status", "event": "estimated_event_id"})
    feats = []
    for r in sub.to_dict("records"):
        lon, lat = r.pop("lon"), r.pop("lat")
        props = {k: (None if (isinstance(v, float) and np.isnan(v)) else (v.isoformat() if hasattr(v, "isoformat") else v)) for k, v in r.items()}
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props})
    fc = {"type": "FeatureCollection", "name": "firescope_hotspots",
          "metadata": {"dataset": f.dataset, "aoi": AOI(f.aoi).name, "start": str(f.start), "end": str(f.end),
                       "params": hr.params}, "features": feats}
    return Response(json.dumps(fc, default=str), media_type="application/geo+json",
                    headers={"Content-Disposition": "attachment; filename=firescope_hotspots.geojson"})


@app.post("/api/report/pdf")
def report_pdf(body: dict = Body(...)):
    f, p, raw_all, raw, hr, _ = _ctx(body)
    aoi = AOI(f.aoi)
    srcs = sorted(raw.source.unique().tolist()) if len(raw) else []
    prods = sorted(raw["product"].unique().tolist()) if len(raw) else []
    ctx = {"aoi_name": aoi.name, "start": f.start, "end": f.end, "dataset": f.dataset,
           "sources": f"{', '.join(srcs)} ({', '.join(prods)})" if srcs else "none",
           "summary": analytics.summary(raw, hr, f.start, f.end), "calendar": analytics.calendar(hr, f.start, f.end),
           "history": analytics.history(raw_all, hr), "anomalies": analytics.anomalies(hr, aoi.name, f.start, f.end),
           "harmonization": {"calibration": hr.calibration, "validation": hr.validation},
           "settings": {"filters": json.loads(f.key()), "harmonization": hr.params}}
    pdf = build_pdf(ctx)
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename=firescope_report_{aoi.name[:30].replace(' ', '_')}.pdf"})


# --------------------------------------------------------------------------- ingestion
@app.post("/api/ingest/upload", dependencies=[Depends(require_admin)])
async def ingest_upload(file: UploadFile = File(...), product: str = Form("")):
    content = await file.read()
    try:
        raw, kind = read_upload(content, file.filename or "upload.csv")
    except Exception as e:  # noqa
        raise HTTPException(400, f"Could not parse file: {e}")
    cols = {str(c).strip().lower() for c in raw.columns}
    missing = [n for n, opts in {"latitude": ("latitude", "lat"), "longitude": ("longitude", "lon"),
                                 "acq_date": ("acq_date", "acq_datetime"), "satellite": ("satellite",)}.items()
               if not cols.intersection(opts)]
    if missing:
        raise HTTPException(400, f"Not a FIRMS hotspot file: missing column(s) {', '.join(missing)}. "
                                 f"Upload the fire_archive_*.csv / fire_nrt_*.csv files from the NASA download.")
    norm, rep = normalize(raw, source=f"UPLOAD:{file.filename}", product=product or f"UPLOAD_{kind.upper()}", dataset="live")
    added = store.insert(norm)
    _clear_caches()
    store.log_sync({"id": f"up{int(time.time())}", "started_at": datetime.utcnow(), "finished_at": datetime.utcnow(),
                    "kind": "upload", "status": "done", "params": {"file": file.filename}, "rows_added": added,
                    "message": "; ".join(rep.notes)})
    return _json({"rows_added": added, "validation": rep.as_dict(), "format": kind})


@app.post("/api/upload/aoi")
async def upload_aoi(file: UploadFile = File(...)):
    obj = json.loads((await file.read()).decode("utf-8"))
    try:
        a = AOI({"kind": "geojson", "geometry": obj, "name": file.filename})
    except Exception as e:  # noqa
        raise HTTPException(400, f"Invalid GeoJSON boundary: {e}")
    return {"name": file.filename, "bbox": list(a.bbox), "geometry": a.geojson(), "area_km2": a.area_km2}


@app.post("/api/sync/firms", dependencies=[Depends(require_admin)])
def sync_firms(body: dict = Body(...)):
    try:
        if body.get("mode") == "country":
            jid = firms.start_country_sync(body["country"], [int(y) for y in body["years"]], body.get("platforms", ["MODIS", "S-NPP"]))
        else:
            jid = firms.start_area_sync(body["bbox"], date.fromisoformat(body["start"]), date.fromisoformat(body["end"]),
                                        body.get("sensors", ["MODIS", "VIIRS"]))
    except Exception as e:  # noqa
        raise HTTPException(400, str(e))
    _clear_caches()
    return {"job_id": jid}


@app.get("/api/jobs/{job_id}")
def job(job_id: str):
    j = firms.job_view(job_id)
    if not j:
        raise HTTPException(404, "unknown job")
    if j.get("status") in ("done", "failed"):
        _clear_caches()
    return _json(j)


@app.get("/api/firms/status", dependencies=[Depends(require_admin)])
def firms_status():
    return firms.mapkey_status(force=True)


@app.delete("/api/dataset/{name}", dependencies=[Depends(require_admin)])
def delete_dataset(name: str):
    if name != "live":
        raise HTTPException(400, "unknown dataset")
    store.delete_dataset(name)
    _clear_caches()
    return {"deleted": name}


@app.get("/api/methodology/limitations")
def limitations():
    return LIMITATIONS
