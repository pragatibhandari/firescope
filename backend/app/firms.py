"""NASA FIRMS integration (server-side only; the MAP_KEY never reaches the browser).

Endpoints used (https://firms.modaps.eosdis.nasa.gov/api/):
  * /api/area/csv/{KEY}/{SOURCE}/{W,S,E,N}/{DAY_RANGE 1-5}/{YYYY-MM-DD}
  * /api/data_availability/csv/{KEY}/ALL
  * /mapserver/mapkey_status/?MAP_KEY={KEY}
  * /data/country/{modis|viirs-snpp|viirs-noaa20|viirs-noaa21}/{YYYY}/{prefix}_{YYYY}_{Country}.csv
    (yearly country archives; best-known public path - if FIRMS changes it, download the files
     from https://firms.modaps.eosdis.nasa.gov/download/ and use the upload endpoint instead.)
"""
from __future__ import annotations

import io
import threading
import time
import uuid
from datetime import date, datetime, timedelta

import httpx
import pandas as pd

from . import store
from .config import FIRMS_BASE, FIRMS_MAP_KEY
from .schema import ValidationReport, normalize

SOURCES = {
    "MODIS_SP": "MODIS Collection 6.1 standard (Terra+Aqua, 1 km)",
    "MODIS_NRT": "MODIS Collection 6.1 near real-time (Terra+Aqua, 1 km)",
    "VIIRS_SNPP_SP": "VIIRS 375 m standard, Suomi-NPP (VNP14IMG)",
    "VIIRS_SNPP_NRT": "VIIRS 375 m near real-time, Suomi-NPP",
    "VIIRS_NOAA20_SP": "VIIRS 375 m standard, NOAA-20 (VJ114IMG)",
    "VIIRS_NOAA20_NRT": "VIIRS 375 m near real-time, NOAA-20",
    "VIIRS_NOAA21_SP": "VIIRS 375 m standard, NOAA-21",
    "VIIRS_NOAA21_NRT": "VIIRS 375 m near real-time, NOAA-21",
}

JOBS: dict[str, dict] = {}
_status_cache: dict = {"t": 0, "value": None}


def _client() -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(60, connect=15), follow_redirects=True,
                        headers={"User-Agent": "FireScope/1.0 (NASA Space Apps research tool)"})


def _get(client: httpx.Client, url: str, retries: int = 4) -> httpx.Response:
    """GET with exponential back-off on network errors, 429 and 5xx."""
    delay = 2.0
    last = None
    for _ in range(retries):
        try:
            r = client.get(url)
            if r.status_code == 429 or r.status_code >= 500:
                last = RuntimeError(f"HTTP {r.status_code}")
                time.sleep(delay); delay *= 2
                continue
            return r
        except httpx.HTTPError as e:  # network
            last = e
            time.sleep(delay); delay *= 2
    raise RuntimeError(f"FIRMS request failed after {retries} attempts: {last}")


def key_configured() -> bool:
    return bool(FIRMS_MAP_KEY)


def mapkey_status(force=False) -> dict:
    if not FIRMS_MAP_KEY:
        return {"configured": False, "reachable": None,
                "message": "No FIRMS_MAP_KEY set on the server. Running on uploaded or demo data only."}
    if not force and time.time() - _status_cache["t"] < 120 and _status_cache["value"]:
        return _status_cache["value"]
    try:
        with _client() as c:
            r = _get(c, f"{FIRMS_BASE}/mapserver/mapkey_status/?MAP_KEY={FIRMS_MAP_KEY}", retries=2)
        ok = r.status_code == 200 and "invalid" not in r.text.lower()
        info = r.json() if ok and r.headers.get("content-type", "").startswith("application/json") else {}
        val = {"configured": True, "reachable": True, "valid": ok, "details": info,
               "checked_at": datetime.utcnow().isoformat() + "Z"}
    except Exception as e:  # noqa
        val = {"configured": True, "reachable": False, "valid": None, "message": str(e),
               "checked_at": datetime.utcnow().isoformat() + "Z"}
    _status_cache.update(t=time.time(), value=val)
    return val


def data_availability() -> list[dict]:
    if not FIRMS_MAP_KEY:
        return []
    with _client() as c:
        r = _get(c, f"{FIRMS_BASE}/api/data_availability/csv/{FIRMS_MAP_KEY}/ALL")
    r.raise_for_status()
    return pd.read_csv(io.StringIO(r.text)).to_dict("records")


def _plan_sources(sensors: list[str], start: date, end: date, avail: list[dict]) -> list[tuple[str, date, date]]:
    """Use standard-quality (SP) archives where available and NRT afterwards."""
    av = {a["data_id"]: (date.fromisoformat(str(a["min_date"])[:10]), date.fromisoformat(str(a["max_date"])[:10]))
          for a in avail if "data_id" in a}
    families = []
    if "MODIS" in sensors:
        families.append("MODIS")
    if "VIIRS" in sensors:
        families += ["VIIRS_SNPP", "VIIRS_NOAA20", "VIIRS_NOAA21"]
    plan = []
    for fam in families:
        sp, nrt = av.get(f"{fam}_SP"), av.get(f"{fam}_NRT")
        cursor = start
        if sp and sp[1] >= cursor:
            a, b = max(cursor, sp[0]), min(end, sp[1])
            if a <= b:
                plan.append((f"{fam}_SP", a, b)); cursor = b + timedelta(days=1)
        if nrt and cursor <= end:
            a, b = max(cursor, nrt[0]), min(end, nrt[1])
            if a <= b:
                plan.append((f"{fam}_NRT", a, b))
        if not sp and not nrt:  # availability endpoint unreachable: try SP then NRT blindly
            plan.append((f"{fam}_SP", start, end))
    return plan


def _wait_for_quota(client: httpx.Client, job: dict, margin: float = 0.8):
    """Pause proactively while the key's 10-minute transaction count is above `margin` of its limit."""
    for _ in range(20):
        try:
            r = client.get(f"{FIRMS_BASE}/mapserver/mapkey_status/?MAP_KEY={FIRMS_MAP_KEY}", timeout=20)
            info = r.json()
            cur, lim = float(info.get("current_transactions", 0)), float(info.get("transaction_limit", 5000))
        except Exception:  # noqa
            return
        if cur < margin * lim:
            job["status"] = "running"
            return
        job["status"] = f"waiting (NASA quota {int(cur)}/{int(lim)}, resumes automatically)"
        time.sleep(45)


def start_area_sync(bbox: list[float], start: date, end: date, sensors: list[str]) -> str:
    if not FIRMS_MAP_KEY:
        raise RuntimeError("FIRMS_MAP_KEY is not configured on the server")
    job_id = uuid.uuid4().hex[:10]
    JOBS[job_id] = {"id": job_id, "kind": "firms_area", "status": "queued", "progress": 0.0, "rows_added": 0,
                    "requests": 0, "errors": [], "params": {"bbox": bbox, "start": str(start), "end": str(end),
                                                             "sensors": sensors},
                    "started_at": datetime.utcnow()}
    threading.Thread(target=_run_area_sync, args=(job_id,), daemon=True).start()
    return job_id


def _run_area_sync(job_id: str):
    job = JOBS[job_id]
    p = job["params"]
    start, end = date.fromisoformat(p["start"]), date.fromisoformat(p["end"])
    area = ",".join(f"{v:.4f}" for v in p["bbox"])
    job["status"] = "running"
    try:
        try:
            avail = data_availability()
        except Exception as e:  # noqa
            avail = []
            job["errors"].append(f"data_availability unavailable: {e}")
        plan = _plan_sources(p["sensors"], start, end, avail)
        chunks = []
        for src, a, b in plan:
            d = a
            while d <= b:
                n = min(5, (b - d).days + 1)
                chunks.append((src, d, n))
                d += timedelta(days=n)
        job["total_requests"] = len(chunks)
        rep = ValidationReport()
        buf = []
        with _client() as c:
            for i, (src, d, n) in enumerate(chunks):
                url = f"{FIRMS_BASE}/api/area/csv/{FIRMS_MAP_KEY}/{src}/{area}/{n}/{d.isoformat()}"
                if i and i % 20 == 0:
                    _wait_for_quota(c, job)
                waited = 0
                while True:
                    try:
                        r = _get(c, url)
                        job["requests"] += 1
                        txt = r.text
                        if "transaction limit" in txt.lower():
                            # NASA quota (5000 transactions / 10 min) reached: wait and retry the SAME chunk
                            if waited >= 15 * 60:
                                job["errors"].append(f"{src} {d}: still rate-limited after 15 min, skipped")
                                break
                            job["status"] = "waiting (NASA rate limit, resumes automatically)"
                            time.sleep(60); waited += 60
                            continue
                        job["status"] = "running"
                        if r.status_code != 200 or txt.lower().startswith(("invalid", "error")):
                            job["errors"].append(f"{src} {d}: {txt[:120]}")
                        elif txt.strip() and "latitude" in txt[:200]:
                            raw = pd.read_csv(io.StringIO(txt))
                            norm, rep = normalize(raw, source="FIRMS-API", product=src, dataset="live", report=rep)
                            if len(norm):
                                buf.append(norm)
                    except Exception as e:  # noqa
                        job["errors"].append(f"{src} {d}: {e}")
                    break
                if len(buf) >= 40:
                    job["rows_added"] += store.insert(pd.concat(buf)); buf = []
                job["progress"] = (i + 1) / max(1, len(chunks))
                time.sleep(0.15)
        if buf:
            job["rows_added"] += store.insert(pd.concat(buf))
        job["validation"] = rep.as_dict()
        job["status"] = "done" if not job["errors"] or job["rows_added"] else "failed"
    except Exception as e:  # noqa
        job["status"] = "failed"; job["errors"].append(str(e))
    job["finished_at"] = datetime.utcnow()
    store.log_sync({**job, "message": "; ".join(job["errors"][:5])})


COUNTRY_PREFIX = {"MODIS": ("modis", "modis"), "S-NPP": ("viirs-snpp", "viirs-snpp"),
                  "NOAA-20": ("viirs-noaa20", "viirs-noaa20"), "NOAA-21": ("viirs-noaa21", "viirs-noaa21")}


def start_country_sync(country: str, years: list[int], platforms: list[str]) -> str:
    job_id = uuid.uuid4().hex[:10]
    JOBS[job_id] = {"id": job_id, "kind": "firms_country", "status": "queued", "progress": 0.0, "rows_added": 0,
                    "requests": 0, "errors": [], "params": {"country": country, "years": years, "platforms": platforms},
                    "started_at": datetime.utcnow()}
    threading.Thread(target=_run_country_sync, args=(job_id,), daemon=True).start()
    return job_id


def _run_country_sync(job_id: str):
    job = JOBS[job_id]
    p = job["params"]
    cname = p["country"].replace(" ", "_")
    tasks = [(pl, y) for pl in p["platforms"] for y in p["years"]]
    job["status"] = "running"; job["total_requests"] = len(tasks)
    rep = ValidationReport()
    with _client() as c:
        for i, (pl, y) in enumerate(tasks):
            folder, prefix = COUNTRY_PREFIX[pl]
            url = f"{FIRMS_BASE}/data/country/{folder}/{y}/{prefix}_{y}_{cname}.csv"
            try:
                r = _get(c, url, retries=2)
                job["requests"] += 1
                if r.status_code == 200 and "latitude" in r.text[:300]:
                    raw = pd.read_csv(io.StringIO(r.text), low_memory=False)
                    product = {"MODIS": "MODIS_SP", "S-NPP": "VIIRS_SNPP_SP", "NOAA-20": "VIIRS_NOAA20_SP",
                               "NOAA-21": "VIIRS_NOAA21_SP"}[pl]
                    norm, rep = normalize(raw, source="FIRMS-COUNTRY-CSV", product=product, dataset="live", report=rep)
                    job["rows_added"] += store.insert(norm)
                else:
                    job["errors"].append(f"{url} -> HTTP {r.status_code}")
            except Exception as e:  # noqa
                job["errors"].append(f"{url}: {e}")
            job["progress"] = (i + 1) / len(tasks)
    job["validation"] = rep.as_dict()
    job["status"] = "done" if job["rows_added"] else "failed"
    job["finished_at"] = datetime.utcnow()
    store.log_sync({**job, "message": "; ".join(job["errors"][:5])})


def job_view(job_id: str) -> dict:
    j = JOBS.get(job_id)
    if not j:
        return {}
    return {k: (str(v) if isinstance(v, datetime) else v) for k, v in j.items()}
