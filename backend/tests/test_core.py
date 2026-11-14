"""Core tests: ingestion normalisation, harmonisation logic, API smoke test (no network needed)."""
import io
import os
import tempfile

import numpy as np
import pandas as pd

os.environ.setdefault("FIRESCOPE_DB", os.path.join(tempfile.mkdtemp(), "test.duckdb"))
os.environ.setdefault("FIRESCOPE_DEMO", "0")

from app.schema import normalize  # noqa: E402
from app.harmonize import HarmonizationParams, run  # noqa: E402

MODIS_CSV = """latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type
-31.512,-64.301,325.4,1.2,1.1,2024-08-20,1405,Aqua,MODIS,72,6.1NRT,296.1,24.5,D,0
-31.514,-64.298,331.0,1.2,1.1,2024-08-20,325,Terra,MODIS,85,6.1NRT,297.0,40.1,N,0
999,-64.1,310,1,1,2024-08-21,1350,Aqua,MODIS,50,6.1,295,9,D,0
"""
VIIRS_CSV = """latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
-31.5122,-64.3015,340.2,0.39,0.36,2024-08-20,1720,N,VIIRS,n,2.0NRT,290.1,5.4,D
-31.5122,-64.3015,340.2,0.39,0.36,2024-08-20,1720,N,VIIRS,n,2.0NRT,290.1,5.4,D
-35.0,-60.0,330.0,0.4,0.37,2024-08-22,1810,N20,VIIRS,l,2.0NRT,289.0,1.1,D
"""


def test_normalize_modis_and_viirs():
    m, rep = normalize(pd.read_csv(io.StringIO(MODIS_CSV)), source="t", product="MODIS_NRT")
    assert len(m) == 2 and rep.dropped_invalid_coords == 1
    assert set(m.platform) == {"Aqua", "Terra"}
    assert list(m.sort_values("acq_datetime").confidence_class) == ["high", "nominal"]  # 85 -> high, 72 -> nominal
    assert m.acq_datetime.min() == pd.Timestamp("2024-08-20 03:25")  # HHMM without leading zero
    v, rep = normalize(pd.read_csv(io.StringIO(VIIRS_CSV)), source="t", product="VIIRS_SNPP_NRT")
    assert len(v) == 2 and rep.duplicates_removed == 1
    assert set(v.platform) == {"S-NPP", "NOAA-20"} and set(v.sensor) == {"VIIRS"}


def _synthetic(ratio_small=3, years=range(2005, 2021), seed=0):
    """MODIS sees 1 cell-day per fire; VIIRS (from 2012) sees each fire plus `ratio_small-1` small fires MODIS misses."""
    rng = np.random.default_rng(seed)
    rows = []
    for y in years:
        for d in pd.date_range(f"{y}-01-01", f"{y}-12-31", freq="3D"):
            lat, lon = rng.uniform(-20, -10), rng.uniform(-60, -50)
            rows.append(dict(lat=lat, lon=lon, acq_datetime=d + pd.Timedelta(hours=14), sensor="MODIS", platform="Aqua", confidence_class="nominal", frp=30.0))
            if y >= 2012:
                rows.append(dict(lat=lat + 0.002, lon=lon, acq_datetime=d + pd.Timedelta(hours=14), sensor="VIIRS", platform="S-NPP", confidence_class="nominal", frp=8.0))
                for _ in range(ratio_small - 1):
                    rows.append(dict(lat=rng.uniform(-20, -10), lon=rng.uniform(-60, -50), acq_datetime=d + pd.Timedelta(hours=14), sensor="VIIRS", platform="S-NPP", confidence_class="nominal", frp=2.0))
    df = pd.DataFrame(rows)
    cov = pd.DataFrame([{"platform": "Aqua", "sensor": "MODIS", "first_date": f"{min(years)}-01-01", "last_date": f"{max(years)}-12-31"},
                        {"platform": "S-NPP", "sensor": "VIIRS", "first_date": "2012-01-01", "last_date": f"{max(years)}-12-31"}])
    return df, cov


def test_matching_avoids_double_counting_and_calibration_recovers_ratio():
    df, cov = _synthetic(ratio_small=3)
    r = run(df, HarmonizationParams(), cov)
    ov = r.daily[r.daily.viirs_cov]
    # every MODIS cell-day in the overlap is co-detected by VIIRS -> union == VIIRS cell-days (no double counting)
    assert ov.matched_modis_cd.sum() == ov.modis_cd.sum()
    assert ov.union_cd.sum() == ov.viirs_cd.sum()
    # true union/MODIS ratio is 3 -> calibration should find ~3 and the series should have no step at 2012
    assert abs(r.calibration["ratio_global"] - 3.0) < 0.05
    assert abs(r.validation["transition"]["harmonized_step"] - 1.0) < 0.1
    assert r.validation["transition"]["naive_detection_step"] > 3


def test_api_smoke():
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        r = c.post("/api/ingest/upload", files={"file": ("m.csv", MODIS_CSV)})
        assert r.status_code == 200 and r.json()["rows_added"] == 2
        c.post("/api/ingest/upload", files={"file": ("v.csv", VIIRS_CSV)})
        body = {"filters": {"dataset": "live", "start": "2024-08-01", "end": "2024-08-31", "min_conf": "low"}}
        s = c.post("/api/summary", json=body).json()
        assert s["kpi"]["total_detections"] == 4
        for ep in ("calendar", "harmonization", "anomalies", "history", "points", "density"):
            assert c.post(f"/api/{ep}", json=body).status_code == 200, ep
        assert c.post("/api/export/csv", json=body).status_code == 200
        assert c.post("/api/report/pdf", json=body).content[:4] == b"%PDF"
