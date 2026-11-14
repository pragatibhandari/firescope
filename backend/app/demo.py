"""SYNTHETIC demonstration dataset - NOT satellite observations.

Used only when no live FIRMS data has been synced or uploaded. Every record carries
source='DEMO-SYNTHETIC' and dataset='demo', and the UI shows a persistent DEMO banner.

The generator simulates fires (not detections) and then simulates how each sensor would
observe them, so that the harmonisation engine has realistic sensor differences to resolve:
  * MODIS (Terra 10:30/22:30, Aqua 13:30/01:30 local) - 1 km nadir pixel growing to ~2x4.8 km
    at swath edge, lower sensitivity to small/cool fires, swath gaps near the equator.
  * VIIRS 375 m (S-NPP from 2012-01-20, NOAA-20 from 2018, NOAA-21 from 2023-03) - ~7x more
    pixels per fire, detects smaller fires, near-daily global coverage, I4 saturation ~367 K.
  * Fire regimes with distinct seasonality, interannual variability, trends, a few injected
    anomalous months and an out-of-season episode, plus static industrial gas-flare sites.
Regime locations are placed at plausible fire-prone regions purely so the map is legible;
their magnitudes and timing are invented and must not be interpreted as real fire history.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .schema import CANONICAL

# name, lat, lon, radius_deg, seasons[(peak_month, width_months, weight)], events/yr, kind, trend/yr
REGIMES = [
    ("Southern Amazon arc", -9.5, -56.0, 5.0, [(9, 1.1, 1.0)], 260, "forest", -0.010),
    ("Cerrado savanna", -13.0, -47.0, 4.0, [(9, 1.3, 1.0)], 220, "savanna", 0.0),
    ("Gran Chaco", -23.5, -61.5, 3.5, [(9, 1.4, 0.8), (7, 1.0, 0.2)], 160, "savanna", 0.012),
    ("Parana Delta & Pampas", -33.0, -60.0, 2.0, [(8, 1.5, 1.0)], 80, "ag", 0.0),
    ("Patagonian Andes", -42.0, -71.4, 1.5, [(1, 1.0, 1.0)], 14, "forest", 0.02),
    ("Sahel belt", 10.5, 4.0, 6.0, [(12, 1.3, 1.0)], 380, "savanna", -0.008),
    ("Southern African miombo", -12.0, 25.0, 6.0, [(8, 1.2, 1.0)], 420, "savanna", -0.005),
    ("Mainland SE Asia uplands", 19.0, 101.0, 3.5, [(3, 0.9, 1.0)], 230, "ag", 0.0),
    ("Indo-Gangetic crop residue", 30.4, 75.6, 1.3, [(11, 0.5, 0.65), (5, 0.5, 0.35)], 230, "ag", 0.01),
    ("East Siberian taiga", 61.0, 118.0, 7.0, [(7, 1.0, 1.0)], 60, "forest", 0.02),
    ("Western Canadian boreal", 56.0, -116.0, 6.0, [(7, 1.0, 1.0)], 45, "forest", 0.02),
    ("California Coast Ranges", 38.5, -121.5, 2.5, [(8, 1.2, 1.0)], 22, "forest", 0.025),
    ("Northern Australian savanna", -15.5, 132.0, 4.5, [(9, 1.4, 1.0)], 230, "savanna", 0.0),
    ("SE Australian forests", -36.5, 148.5, 2.0, [(1, 1.1, 1.0)], 18, "forest", 0.01),
    ("Eastern Mediterranean", 39.0, 22.5, 5.0, [(8, 0.9, 1.0)], 40, "forest", 0.015),
    ("Borneo-Sumatra peatlands", -1.5, 111.0, 4.0, [(9, 0.9, 1.0)], 100, "peat", 0.0),
    ("Central American lowlands", 16.5, -90.0, 2.5, [(4, 0.8, 1.0)], 110, "ag", 0.0),
    ("Kazakh steppe croplands", 51.5, 62.0, 5.0, [(4, 0.7, 0.5), (9, 0.7, 0.5)], 110, "ag", -0.01),
]

GAS_FLARES = [(30.6, 47.6), (5.2, 6.3), (61.4, 73.2), (31.9, -103.4), (26.4, 50.1)]

# platform: (sensor, local overpass hours (day, night), start date, coverage prob)
PLATFORMS = {
    "Terra": ("MODIS", (10.5, 22.5), "2000-11-01", 0.78),
    "Aqua": ("MODIS", (13.5, 1.5), "2002-07-04", 0.80),
    "S-NPP": ("VIIRS", (13.5, 1.5), "2012-01-20", 0.96),
    "NOAA-20": ("VIIRS", (12.7, 0.7), "2018-01-01", 0.96),
    "NOAA-21": ("VIIRS", (14.3, 2.3), "2023-03-01", 0.96),
}

KIND = {  # log-mean size, log-sd size, mean duration (days), spread km/day, frp scale
    "ag": (-0.4, 0.55, 1.4, 0.3, 0.6),
    "savanna": (0.3, 0.75, 2.5, 1.0, 1.0),
    "forest": (1.0, 1.0, 6.0, 1.6, 1.6),
    "peat": (0.6, 0.8, 9.0, 0.4, 0.8),
}


def generate(start_year=2001, end_year=2025, seed=42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    years = np.arange(start_year, end_year + 1)
    ev = []
    # injected anomalies: (regime index, year, month, multiplier)
    anomalies = [(0, 2019, 8, 3.0), (5, 2015, 12, 2.6), (9, 2021, 7, 3.4), (12, 2023, 9, 2.2),
                 (3, 2020, 8, 4.0), (15, 2015, 9, 4.5), (10, 2023, 6, 4.0)]
    out_of_season = [(7, 2016, 10, 0.35)]  # extra events far from the regime's normal peak
    for ri, (name, la, lo, rad, seasons, rate, kind, trend) in enumerate(REGIMES):
        iav = rng.lognormal(0, 0.28, len(years))
        for yi, y in enumerate(years):
            lam = rate * iav[yi] * (1 + trend) ** (y - 2012)
            n = rng.poisson(lam)
            w = np.array([s[2] for s in seasons]); w = w / w.sum()
            si = rng.choice(len(seasons), size=n, p=w)
            peak = np.array([seasons[i][0] for i in si]); width = np.array([seasons[i][1] for i in si])
            doy = ((peak - 0.5) * 30.44 + rng.normal(0, 1, n) * width * 30.44) % 365
            extra = [a for a in anomalies if a[0] == ri and a[1] == y]
            extra += [(ri, y, m, f) for (r2, y2, m, f) in out_of_season if r2 == ri and y2 == y]
            for (_, _, m, mult) in extra:
                k = rng.poisson(rate * (mult - 1) / 3 if mult > 1 else rate * mult)
                doy = np.concatenate([doy, (m - 1) * 30.44 + rng.uniform(0, 30, k)])
            n = len(doy)
            ev.append(pd.DataFrame({
                "ri": ri, "year": y, "doy": doy.astype(int),
                "lat": la + rng.normal(0, rad / 2, n), "lon": lo + rng.normal(0, rad / 2 * 1.4, n),
            }))
    E = pd.concat(ev, ignore_index=True)
    E = E[E.lat.between(-60, 75)].reset_index(drop=True)
    # keep only fires whose ignition point is on land (synthetic regimes are ellipses that overlap seas)
    from .geo import assign_country
    E = E[assign_country(E.lat.to_numpy(), E.lon.to_numpy()) != "Ocean / unassigned"].reset_index(drop=True)
    kinds = np.array([REGIMES[i][6] for i in E.ri])
    p = np.array([KIND[k] for k in kinds])
    nE = len(E)
    E["s0"] = np.exp(rng.normal(p[:, 0], p[:, 1]))
    E["dur"] = np.clip(rng.geometric(1 / p[:, 2]), 1, 60)
    E["spread"] = p[:, 3] * rng.lognormal(0, 0.4, nE)
    E["frp_scale"] = p[:, 4]
    E["theta"] = rng.uniform(0, 2 * np.pi, nE)
    E["t0"] = pd.to_datetime(E.year.astype(str) + "-01-01") + pd.to_timedelta(E.doy, unit="D")

    # ---- expand to event-days
    rep = E.dur.to_numpy()
    idx = np.repeat(np.arange(nE), rep)
    k = np.arange(len(idx)) - np.repeat(np.cumsum(rep) - rep, rep)
    D = E.iloc[idx].reset_index(drop=True)
    D["k"] = k
    prof = np.sin(np.pi * (k + 0.5) / D.dur.to_numpy()) ** 0.6
    D["s"] = D.s0 * prof * rng.lognormal(0, 0.35, len(D))
    dist_km = D.spread * k
    D["clat"] = D.lat + dist_km * np.sin(D.theta) / 111.0
    D["clon"] = D.lon + dist_km * np.cos(D.theta) / (111.0 * np.cos(np.radians(D.lat)))
    D["date"] = D.t0 + pd.to_timedelta(k, unit="D")

    # ---- static gas flares (persistent hotspots, flagged type=2 like MODIS SP)
    days = pd.date_range(f"{start_year}-01-01", f"{end_year}-12-31", freq="D")
    fl = []
    for (la, lo) in GAS_FLARES:
        sel = days[rng.random(len(days)) < 0.5]
        fl.append(pd.DataFrame({"clat": la, "clon": lo, "date": sel, "s": 1.2, "frp_scale": 1.0,
                                "static": True}))
    F = pd.concat(fl, ignore_index=True)
    D["static"] = False
    D = pd.concat([D[["clat", "clon", "date", "s", "frp_scale", "static"]], F], ignore_index=True)

    # ---- simulate overpasses (2 per platform per day)
    rows = []
    for pl, (sensor, hours, pstart, cov) in PLATFORMS.items():
        A = D[D.date >= pd.Timestamp(pstart)]
        for hi, h in enumerate(hours):
            night = hi == 1
            m = rng.random(len(A)) < cov
            O = A[m].copy()
            s_eff = O.s.to_numpy() * (0.55 if night else 1.0)
            n = len(O)
            if sensor == "MODIS":
                scan = 1 + rng.beta(1.2, 2.2, n) * 3.8
                track = 1 + (scan - 1) * 0.27
                area = scan * track
                pdet = 1 - np.exp(-0.55 * s_eff / np.sqrt(area))
                npx_mean = s_eff / (7.0 * area ** 0.5)
            else:
                scan = 0.32 + rng.beta(1.2, 2.2, n) * 0.48
                track = 0.36 + (scan - 0.32) * 0.88
                pdet = 1 - np.exp(-1.1 * s_eff)
                npx_mean = s_eff * 0.9
            det = rng.random(n) < pdet
            O = O[det]; scan = scan[det]; track = track[det]; npx_mean = npx_mean[det]; s_eff = s_eff[det]
            npx = 1 + rng.poisson(npx_mean)
            ii = np.repeat(np.arange(len(O)), npx)
            P = O.iloc[ii].reset_index(drop=True)
            jit = (0.6 if sensor == "MODIS" else 0.35) * np.sqrt(np.repeat(s_eff, npx)) + 0.3
            P["lat"] = P.clat + rng.normal(0, jit, len(P)) / 111.0
            P["lon"] = P.clon + rng.normal(0, jit, len(P)) / (111.0 * np.cos(np.radians(P.clat)))
            tot = np.repeat(s_eff, npx) * rng.uniform(6, 26, len(P)) * P.frp_scale.to_numpy()
            frp = tot / np.repeat(npx, npx) * rng.lognormal(0, 0.45, len(P))
            if sensor == "MODIS":
                frp = np.maximum(frp * 1.6, 4 + rng.exponential(3, len(P)))
                conf = np.clip(35 + 22 * np.log10(frp) + rng.normal(0, 12, len(P)), 0, 100).round()
                conf_raw = conf.astype(int).astype(str)
                bright = 300 + 14 * np.log(frp) + rng.normal(0, 4, len(P)) - (20 if night else 0)
                aux = bright - rng.uniform(8, 30, len(P))
            else:
                frp = np.maximum(frp, 0.4 + rng.exponential(1.0, len(P)))
                u = rng.random(len(P))
                hi_c = (frp > 15) & (u < 0.55)
                lo_c = (frp < 2) & (u < 0.35)
                conf_raw = np.where(hi_c, "h", np.where(lo_c, "l", "n"))
                bright = np.minimum(367.0, 298 + 12 * np.log(frp + 1) + rng.normal(0, 5, len(P)) - (25 if night else 0))
                aux = bright - rng.uniform(15, 40, len(P))
            local = P.date + pd.to_timedelta(h + rng.normal(0, 0.3, len(P)), unit="h")
            utc = local - pd.to_timedelta(P.lon / 15.0, unit="h")
            rows.append(pd.DataFrame({
                "latitude": P.lat.round(5), "longitude": P.lon.round(5),
                "acq_datetime": utc.dt.floor("min"), "satellite": pl, "instrument": sensor,
                "confidence": conf_raw, "frp": np.round(frp, 2), "brightness": np.round(bright, 2),
                "bright_aux": np.round(aux, 2), "scan": np.repeat(scan, npx).round(2),
                "track": np.repeat(track, npx).round(2), "daynight": "N" if night else "D",
                "type": np.where(P.static.to_numpy(), 2, 0),
            }))
    R = pd.concat(rows, ignore_index=True)
    R = R[(R.acq_datetime >= f"{start_year}-01-01") & (R.acq_datetime < f"{end_year + 1}-01-01")]
    return R.reset_index(drop=True)


def to_canonical(R: pd.DataFrame) -> pd.DataFrame:
    from .schema import _confidence, _record_id  # local import to share logic
    out = pd.DataFrame({
        "lat": R.latitude, "lon": R.longitude, "acq_datetime": R.acq_datetime,
        "sensor": R.instrument, "platform": R.satellite,
        "product": np.where(R.instrument == "MODIS", "DEMO_MODIS_C61", "DEMO_VIIRS_375m"),
        "confidence_raw": R.confidence, "frp": R.frp, "brightness": R.brightness, "bright_aux": R.bright_aux,
        "scan": R.scan, "track": R.track, "daynight": R.daynight,
        "version": "synthetic-1.0", "fire_type": R["type"].astype(float),
    })
    cls, score = _confidence(out.confidence_raw, out.sensor)
    out["confidence_class"] = cls; out["confidence_score"] = score
    out["acq_date"] = out.acq_datetime.dt.normalize()
    out["source"] = "DEMO-SYNTHETIC"; out["dataset"] = "demo"; out["country"] = None
    out["ingested_at"] = pd.Timestamp.utcnow().tz_localize(None)
    out["record_id"] = _record_id(out)
    return out.drop_duplicates("record_id")[CANONICAL]
