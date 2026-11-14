"""MODIS-VIIRS harmonisation engine.

Pipeline (every step is parameterised and reported back to the UI):

 1. Platform selection - choose which satellites form a temporally consistent record
    (VIIRS 'reference' mode uses one VIIRS platform per day: S-NPP, else NOAA-20, else NOAA-21,
    so that the launch of extra VIIRS satellites does not inflate activity).
 2. Common grid + day basis - every detection is assigned to a grid cell (default 0.01 deg,
    ~1.1 km, i.e. the MODIS nadir footprint) and a UTC or local-solar day.
 3. Within-sensor de-duplication - all detections of one sensor in one cell-day collapse to
    ONE "active-fire cell-day" (AFCD). This removes the 375 m multi-pixel effect and repeat
    overpasses (Terra+Aqua, S-NPP+NOAA-20) from the activity unit.
 4. Cross-sensor matching - MODIS and VIIRS cell-days within `match_km` and `match_days`
    are flagged as the same observed activity (co-detections). Union cell-days =
    VIIRS cell-days + MODIS cell-days with no VIIRS match: no fire is counted twice simply
    because both sensors saw it.
 5. Cross-sensor calibration - in the overlap era (2012+) a transfer function from MODIS
    cell-days to union cell-days is fitted for the AOI (seasonal ratio with shrinkage, or a
    robust log-linear Theil-Sen fit). It back-casts 2000-2011 into the same units, so the
    calendar is continuous across the sensor transition. Uncertainty comes from leave-one-
    year-out cross-validation residuals.
 6. Fire Activity Index (FAI) - confidence-weighted (and optionally FRP-weighted) harmonised
    cell-days, with VIIRS FRP rescaled to MODIS-equivalent using matched cell-days.
 7. Estimated fire events - space-time connected components of union cell-days. These are
    ESTIMATES (clusters of detections), never confirmed individual fires.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict

import numpy as np
import pandas as pd

EPOCH = np.datetime64("1970-01-01", "D")


@dataclass
class HarmonizationParams:
    grid_deg: float = 0.01
    day_basis: str = "utc"              # utc | solar
    match_km: float = 2.0
    match_days: int = 0
    viirs_mode: str = "reference"       # reference | all
    modis_mode: str = "all"             # all | aqua | terra
    calibration: str = "seasonal_ratio"  # seasonal_ratio | loglinear | none
    target: str = "viirs"               # viirs (VIIRS-era union units) | modis (MODIS-equivalent units)
    conf_weights: dict = field(default_factory=lambda: {"low": 0.5, "nominal": 1.0, "high": 1.0})
    frp_beta: float = 0.0               # 0 = pure detection-based FAI; >0 adds intensity weighting
    shrinkage: float = 3.0              # pseudo-months pulling monthly ratios toward the global ratio
    event_gap_days: int = 1
    compute_events: bool = True

    @classmethod
    def from_dict(cls, d: dict | None) -> "HarmonizationParams":
        p = cls()
        for k, v in (d or {}).items():
            if hasattr(p, k) and v is not None:
                setattr(p, k, v)
        p.grid_deg = float(p.grid_deg); p.match_km = float(p.match_km)
        p.match_days = int(p.match_days); p.frp_beta = float(p.frp_beta)
        return p

    def key(self):
        return str(sorted(asdict(self).items()))


# --------------------------------------------------------------------------- coverage helpers
def coverage_days(cov: pd.DataFrame, platforms: list[str]) -> tuple[np.datetime64, np.datetime64] | None:
    c = cov[cov.platform.isin(platforms)]
    if c.empty:
        return None
    return np.datetime64(pd.Timestamp(c.first_date.min()).date(), "D"), np.datetime64(pd.Timestamp(c.last_date.max()).date(), "D")


def _platform_windows(cov: pd.DataFrame) -> dict[str, tuple[np.datetime64, np.datetime64]]:
    out = {}
    for _, r in cov.iterrows():
        out[r.platform] = (np.datetime64(pd.Timestamp(r.first_date).date(), "D"),
                           np.datetime64(pd.Timestamp(r.last_date).date(), "D"))
    return out


# --------------------------------------------------------------------------- main
@dataclass
class HarmonizationResult:
    params: dict
    daily: pd.DataFrame
    monthly: pd.DataFrame
    calibration: dict
    validation: dict
    det_status: pd.Series
    det_event: pd.Series
    events: pd.DataFrame
    notes: list[str]


def _cell_keys(lat, lon, g):
    nx = int(np.ceil(360 / g))
    ix = np.floor((lon + 180.0) / g).astype(np.int64)
    iy = np.floor((lat + 90.0) / g).astype(np.int64)
    return iy, ix, nx


def run(df: pd.DataFrame, p: HarmonizationParams, cov: pd.DataFrame) -> HarmonizationResult:
    notes: list[str] = []
    win = _platform_windows(cov)
    d = df[["lat", "lon", "acq_datetime", "sensor", "platform", "confidence_class", "frp"]].copy()
    for c in ("sensor", "platform", "confidence_class"):
        d[c] = d[c].astype(object)
    d["frp"] = d["frp"].astype("float64")
    status = pd.Series("", index=df.index, dtype=object)

    # ---- 1. platform selection
    modis_pl = {"all": ["Terra", "Aqua"], "aqua": ["Aqua"], "terra": ["Terra"]}[p.modis_mode]
    viirs_all = ["S-NPP", "NOAA-20", "NOAA-21"]
    if p.target == "viirs" and p.calibration == "none":
        notes.append("Calibration disabled: pre-VIIRS years are shown in raw MODIS units (expect a step change in 2012).")

    if p.day_basis == "solar":
        t = d.acq_datetime + pd.to_timedelta(d.lon / 15.0, unit="h")
    else:
        t = d.acq_datetime
    day_np = t.to_numpy().astype("datetime64[D]")
    d["dayn"] = (day_np - EPOCH).astype(np.int64)

    keep = d.platform.isin(modis_pl) | d.platform.isin(viirs_all)
    status[d.platform.isin(["Terra", "Aqua"]) & ~d.platform.isin(modis_pl)] = "excluded: MODIS platform not selected"
    if p.viirs_mode == "reference":
        ref = np.full(len(d), "", dtype=object)
        dd = d.dayn.to_numpy()
        for pl in reversed(viirs_all):  # lowest priority first, overwritten by higher priority
            if pl in win:
                a, b = [int((x - EPOCH).astype(np.int64)) for x in win[pl]]
                ref[(dd >= a) & (dd <= b)] = pl
        isv = d.sensor.to_numpy() == "VIIRS"
        nonref = isv & (d.platform.to_numpy() != ref)
        status[nonref] = "excluded: non-reference VIIRS platform"
        keep &= ~nonref
    d = d[keep]

    # ---- 2. grid
    iy, ix, nx = _cell_keys(d.lat.to_numpy(), d.lon.to_numpy(), p.grid_deg)
    ny = int(np.ceil(180 / p.grid_deg)) + 1
    dayn = d.dayn.to_numpy()
    cell = iy * nx + ix
    key = dayn * (nx * ny) + cell
    d = d.assign(cell=cell, key=key,
                 w=d.confidence_class.map(p.conf_weights).fillna(1.0).to_numpy(),
                 hi=(d.confidence_class == "high").to_numpy())

    # ---- 3. sensor cell-days
    g = d.groupby(["sensor", "key"], sort=False).agg(
        dayn=("dayn", "first"), cell=("cell", "first"), n=("lat", "size"), frp_sum=("frp", "sum"),
        frp_max=("frp", "max"), w=("w", "max"), lat=("lat", "mean"), lon=("lon", "mean")).reset_index()
    M = g[g.sensor == "MODIS"].reset_index(drop=True)
    V = g[g.sensor == "VIIRS"].reset_index(drop=True)

    # ---- 4. cross-sensor matching via neighbourhood key lookup
    mean_lat = float(np.clip(np.abs(d.lat).mean() if len(d) else 0, 0, 75))
    k_lat = int(np.ceil(p.match_km / (p.grid_deg * 111.32)))
    k_lon = int(np.ceil(p.match_km / (p.grid_deg * 111.32 * np.cos(np.radians(mean_lat)))))
    cap = 4
    if k_lat > cap or k_lon > cap:
        notes.append(f"Match radius capped at {cap} cells; increase grid size for large match distances.")
        k_lat, k_lon = min(k_lat, cap), min(k_lon, cap)
    offs = [(dt, dy, dx) for dt in range(-p.match_days, p.match_days + 1)
            for dy in range(-k_lat, k_lat + 1) for dx in range(-k_lon, k_lon + 1)]
    off = np.array([dt * (nx * ny) + dy * nx + dx for dt, dy, dx in offs], dtype=np.int64)

    def matched(src: pd.DataFrame, other: pd.DataFrame) -> np.ndarray:
        if src.empty or other.empty:
            return np.zeros(len(src), dtype=bool)
        okeys = np.sort(other.key.to_numpy())
        res = np.zeros(len(src), dtype=bool)
        sk = src.key.to_numpy()
        for o in off:
            c = sk + o
            pos = np.searchsorted(okeys, c)
            pos[pos >= len(okeys)] = len(okeys) - 1
            res |= okeys[pos] == c
        return res

    M["matched"] = matched(M, V)
    V["matched"] = matched(V, M)

    # coverage flags per day
    vplat = viirs_all
    vcov = coverage_days(cov, vplat)
    mcov = coverage_days(cov, modis_pl)

    # ---- 6a. FRP scale (VIIRS -> MODIS-equivalent) from exactly co-located cell-days
    both = M[["key", "frp_sum"]].merge(V[["key", "frp_sum"]], on="key", suffixes=("_m", "_v"))
    both = both[(both.frp_sum_m > 0) & (both.frp_sum_v > 0)]
    if len(both) >= 30:
        ratio = both.frp_sum_m / both.frp_sum_v
        frp_scale = float(np.median(ratio)); frp_iqr = [float(ratio.quantile(.25)), float(ratio.quantile(.75))]
    else:
        frp_scale, frp_iqr = 1.0, None
        notes.append("Too few co-located cell-days (<30) to estimate a VIIRS->MODIS FRP scale; using 1.0.")

    def fai(frame, scale=1.0):
        f = frame.frp_sum.fillna(0).to_numpy() * scale
        return frame.w.to_numpy() * (1 + p.frp_beta * np.log10(1 + f / 10.0))

    M["fai"] = fai(M); V["fai"] = fai(V, frp_scale)
    M["frp_h"] = M.frp_sum; V["frp_h"] = V.frp_sum * frp_scale

    # ---- daily table
    if len(d):
        d0, d1 = d.dayn.min(), d.dayn.max()
    else:
        d0 = d1 = 0
    # the calendar starts where this area's own data starts (dataset-wide coverage may come from other regions)
    days = np.arange(d0, d1 + 1)
    daily = pd.DataFrame(index=pd.Index(days, name="dayn"))

    def agg(frame, col, how="sum"):
        if frame.empty:
            return pd.Series(dtype=float)
        return frame.groupby("dayn")[col].agg(how)

    det = d.groupby(["sensor", "dayn"]).size().unstack(0) if len(d) else pd.DataFrame()
    daily["modis_det"] = det.get("MODIS", pd.Series(dtype=float))
    daily["viirs_det"] = det.get("VIIRS", pd.Series(dtype=float))
    hi = d[d.hi].groupby("dayn").size() if len(d) else pd.Series(dtype=float)
    daily["high_conf_det"] = hi
    daily["modis_cd"] = agg(M, "n", "size")
    daily["viirs_cd"] = agg(V, "n", "size")
    daily["matched_modis_cd"] = agg(M[M.matched], "n", "size")
    daily["matched_viirs_cd"] = agg(V[V.matched], "n", "size")
    daily["modis_only_cd"] = agg(M[~M.matched], "n", "size")
    daily["fai_m"] = agg(M, "fai")
    daily["fai_union"] = agg(V, "fai").add(agg(M[~M.matched], "fai"), fill_value=0)
    daily["frp_sum_m"] = agg(M, "frp_sum")
    daily["frp_sum_v"] = agg(V, "frp_sum")
    daily["frp_harm"] = agg(V, "frp_h").add(agg(M[~M.matched], "frp_h"), fill_value=0)
    frp_det = d.groupby("dayn").frp.agg(["mean", "max"]) if len(d) else pd.DataFrame(columns=["mean", "max"])
    daily["frp_mean"] = frp_det["mean"]; daily["frp_max"] = frp_det["max"]
    daily = daily.fillna({c: 0 for c in daily.columns if c not in ("frp_mean", "frp_max")})
    daily["union_cd"] = daily.viirs_cd + daily.modis_only_cd
    date = EPOCH + days.astype("timedelta64[D]")  # datetime64[D]
    daily["date"] = pd.to_datetime(date)
    daily["viirs_cov"] = False if vcov is None else (date >= vcov[0]) & (date <= vcov[1])
    daily["modis_cov"] = False if mcov is None else (date >= mcov[0]) & (date <= mcov[1])
    daily["month"] = daily.date.dt.to_period("M")
    daily = daily.reset_index()

    # ---- 5. calibration on monthly sums (overlap months fully covered by both sensors)
    mon = daily.groupby("month").agg(
        modis_cd=("modis_cd", "sum"), viirs_cd=("viirs_cd", "sum"), union_cd=("union_cd", "sum"),
        fai_m=("fai_m", "sum"), fai_union=("fai_union", "sum"),
        vcov=("viirs_cov", "all"), mcov=("modis_cov", "all"), vany=("viirs_cov", "any"), many=("modis_cov", "any"))
    overlap = mon[mon.vcov & mon.mcov]
    calib = _calibrate(overlap, p, notes)
    calib["frp_scale_viirs_to_modis"] = frp_scale
    calib["frp_scale_iqr"] = frp_iqr
    calib["n_colocated_cell_days"] = int(len(both))

    # apply
    moy = daily.date.dt.month.to_numpy()
    r_m = np.array([calib["ratio_by_month"].get(int(m), calib["ratio_global"]) for m in moy])
    if p.target == "viirs":
        calibrated = ~daily.viirs_cov.to_numpy()
        daily["harmonized"] = np.where(calibrated, daily.modis_cd * r_m, daily.union_cd)
        daily["fai"] = np.where(calibrated, daily.fai_m * r_m, daily.fai_union)
    else:  # MODIS-equivalent units; post-MODIS days converted from union
        calibrated = ~daily.modis_cov.to_numpy()
        daily["harmonized"] = np.where(calibrated, daily.union_cd / np.where(r_m > 0, r_m, 1), daily.modis_cd)
        daily["fai"] = np.where(calibrated, daily.fai_union / np.where(r_m > 0, r_m, 1), daily.fai_m)
    daily["calibrated"] = calibrated
    daily["naive_sum"] = daily.modis_det + daily.viirs_det

    q = calib.get("cv_ratio_quantiles") or {"p10": 1.0, "p90": 1.0}
    daily["harm_lo"] = np.where(calibrated, daily.harmonized * q["p10"], np.maximum(0, daily.harmonized - np.sqrt(daily.harmonized)))
    daily["harm_hi"] = np.where(calibrated, daily.harmonized * q["p90"], daily.harmonized + np.sqrt(daily.harmonized))

    monthly = daily.groupby("month").agg(
        modis_det=("modis_det", "sum"), viirs_det=("viirs_det", "sum"), naive_sum=("naive_sum", "sum"),
        modis_cd=("modis_cd", "sum"), viirs_cd=("viirs_cd", "sum"), union_cd=("union_cd", "sum"),
        matched_modis_cd=("matched_modis_cd", "sum"), matched_viirs_cd=("matched_viirs_cd", "sum"),
        harmonized=("harmonized", "sum"), harm_lo=("harm_lo", "sum"), harm_hi=("harm_hi", "sum"),
        fai=("fai", "sum"), high_conf_det=("high_conf_det", "sum"), frp_harm=("frp_harm", "sum"),
        frp_max=("frp_max", "max"), calibrated=("calibrated", "any")).reset_index()
    monthly["date"] = monthly.month.dt.to_timestamp()

    # ---- detection-level status
    st_m = pd.Series(np.where(M.matched, "matched (MODIS & VIIRS co-detection)", "MODIS only"), index=M.key)
    st_v = pd.Series(np.where(V.matched, "matched (MODIS & VIIRS co-detection)", "VIIRS only"), index=V.key)
    dm = d.sensor == "MODIS"
    s_m = st_m.reindex(d.key[dm].to_numpy()).to_numpy()
    s_m = np.where(daily.set_index("dayn").viirs_cov.reindex(d.dayn[dm].to_numpy()).to_numpy(), s_m,
                   "MODIS (pre-VIIRS era, calibrated)")
    status.loc[d.index[dm]] = s_m
    status.loc[d.index[~dm]] = st_v.reindex(d.key[~dm].to_numpy()).to_numpy()

    # ---- 7. estimated events
    det_event = pd.Series(-1, index=df.index, dtype=np.int64)
    events = pd.DataFrame()
    U = pd.concat([V, M[~M.matched]], ignore_index=True)
    if p.compute_events and 0 < len(U) <= 2_500_000:
        lab = _components(U.key.to_numpy(), nx, ny, p.event_gap_days)
        U["event"] = lab
        events = U.groupby("event").agg(start=("dayn", "min"), end=("dayn", "max"), cell_days=("key", "size"),
                                        frp_sum=("frp_h", "sum"), lat=("lat", "mean"), lon=("lon", "mean"))
        events["duration_days"] = events.end - events.start + 1
        events["start"] = pd.to_datetime(EPOCH + events.start.to_numpy().astype("timedelta64[D]"))
        events["end"] = pd.to_datetime(EPOCH + events.end.to_numpy().astype("timedelta64[D]"))
        # map detections -> event (MODIS matched detections inherit via VIIRS neighbour; left -1)
        kmap = pd.Series(lab, index=U.sensor.str[0] + U.key.astype(str))
        dk = d.sensor.str[0] + d.key.astype(str)
        det_event.loc[d.index] = kmap.reindex(dk.to_numpy()).fillna(-1).astype(np.int64).to_numpy()
        new = events.groupby(events.start).size()
        daily["events_started"] = daily.date.map(new).fillna(0)
    elif p.compute_events:
        notes.append("Event clustering skipped (too many cell-days); narrow the AOI or coarsen the grid.")

    validation = _validate(daily, monthly, M, V, overlap, calib, p)
    return HarmonizationResult(asdict(p), daily, monthly, calib, validation, status, det_event, events, notes)


def _components(keys: np.ndarray, nx: int, ny: int, gap: int) -> np.ndarray:
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    order = np.argsort(keys)
    sk = keys[order]
    n = len(sk)
    rows, cols = [], []
    for dt in range(0, gap + 1):
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dt == 0 and (dy, dx) <= (0, 0):
                    continue  # forward-only offsets at same day
                c = sk + dt * (nx * ny) + dy * nx + dx
                pos = np.searchsorted(sk, c)
                pos[pos >= n] = n - 1
                hit = sk[pos] == c
                rows.append(np.nonzero(hit)[0]); cols.append(pos[hit])
    r = np.concatenate(rows) if rows else np.array([], int)
    c = np.concatenate(cols) if cols else np.array([], int)
    A = coo_matrix((np.ones(len(r), dtype=np.int8), (r, c)), shape=(n, n))
    _, lab_sorted = connected_components(A, directed=False)
    lab = np.empty(n, dtype=np.int64)
    lab[order] = lab_sorted
    return lab


def _fit_ratio(sub: pd.DataFrame, p: HarmonizationParams) -> tuple[float, dict]:
    sm, su = sub.modis_cd.sum(), sub.union_cd.sum()
    if sm <= 0:
        return float("nan"), {}
    rg = su / sm
    if p.calibration == "none":
        return 1.0, {m: 1.0 for m in range(1, 13)}
    mbar = sub.modis_cd.mean()
    by = {}
    for m in range(1, 13):
        s = sub[sub.index.month == m]
        by[m] = float((s.union_cd.sum() + p.shrinkage * rg * mbar) / (s.modis_cd.sum() + p.shrinkage * mbar)) if mbar > 0 else rg
    if p.calibration == "loglinear":
        x, y = np.log1p(sub.modis_cd.to_numpy()), np.log1p(sub.union_cd.to_numpy())
        a, b = _theil_sen(x, y)
        # monthly effective ratio from predicted monthly totals (use climatological monthly MODIS)
        for m in range(1, 13):
            s = sub[sub.index.month == m]
            mm = s.modis_cd.mean() if len(s) else mbar
            by[m] = float(np.expm1(a + b * np.log1p(mm)) / mm) if mm > 0 else rg
        return float(rg), {**by, "_a": a, "_b": b}
    return float(rg), by


def _theil_sen(x, y):
    n = len(x)
    if n < 3:
        return 0.0, 1.0
    i, j = np.triu_indices(n, 1)
    dx = x[j] - x[i]
    ok = dx != 0
    b = float(np.median((y[j] - y[i])[ok] / dx[ok])) if ok.any() else 1.0
    a = float(np.median(y - b * x))
    return a, b


def _predict(sub: pd.DataFrame, rg: float, by: dict, p: HarmonizationParams) -> np.ndarray:
    if p.calibration == "loglinear" and "_a" in by:
        return np.expm1(by["_a"] + by["_b"] * np.log1p(sub.modis_cd.to_numpy()))
    r = np.array([by.get(m, rg) for m in sub.index.month])
    return sub.modis_cd.to_numpy() * r


def _calibrate(overlap: pd.DataFrame, p: HarmonizationParams, notes: list[str]) -> dict:
    out = {"method": p.calibration, "n_overlap_months": int(len(overlap)), "ratio_global": 1.0,
           "ratio_by_month": {m: 1.0 for m in range(1, 13)}, "cv": None, "cv_ratio_quantiles": None}
    if len(overlap) < 12 or overlap.modis_cd.sum() < 20:
        notes.append("Insufficient MODIS/VIIRS overlap for this AOI (<12 months or <20 MODIS cell-days): "
                     "using a ratio of 1.0 - pre-VIIRS values are uncalibrated MODIS counts.")
        return out
    ov = overlap.copy()
    ov.index = ov.index.to_timestamp()
    rg, by = _fit_ratio(ov, p)
    out["ratio_global"] = rg if np.isfinite(rg) else 1.0
    out["ratio_by_month"] = {m: float(by.get(m, rg)) for m in range(1, 13)}
    if "_a" in by:
        out["loglinear"] = {"a": by["_a"], "b": by["_b"]}
    out["overlap_start"] = str(ov.index.min().date()); out["overlap_end"] = str(ov.index.max().date())

    # leave-one-year-out cross-validation
    years = sorted(set(ov.index.year))
    preds, acts, yrs = [], [], []
    for y in years:
        tr, te = ov[ov.index.year != y], ov[ov.index.year == y]
        if len(tr) < 12 or tr.modis_cd.sum() <= 0:
            continue
        rg_, by_ = _fit_ratio(tr, p)
        preds.append(_predict(te, rg_, by_, p)); acts.append(te.union_cd.to_numpy()); yrs += [y] * len(te)
    if preds and sum(len(x) for x in preds) > 0:
        pr, ac = np.concatenate(preds), np.concatenate(acts)
        ok = ac > 0
        ape = np.abs(pr[ok] - ac[ok]) / ac[ok]
        lr = np.log((ac[ok] + 1) / (pr[ok] + 1))
        yy = np.array(yrs)
        ann = pd.DataFrame({"y": yy, "p": pr, "a": ac}).groupby("y").sum()
        ann_ape = (np.abs(ann.p - ann.a) / ann.a.replace(0, np.nan)).dropna()
        out["cv"] = {
            "scheme": "leave-one-year-out over overlap years",
            "n_years": len(years), "n_months": int(len(pr)),
            "monthly_mape_pct": float(np.mean(ape) * 100) if len(ape) else None,
            "monthly_median_ape_pct": float(np.median(ape) * 100) if len(ape) else None,
            "annual_mape_pct": float(ann_ape.mean() * 100) if len(ann_ape) else None,
            "bias_pct": float((pr.sum() - ac.sum()) / ac.sum() * 100) if ac.sum() else None,
            "r2_log": float(1 - np.sum((np.log1p(ac) - np.log1p(pr)) ** 2) / np.sum((np.log1p(ac) - np.log1p(ac).mean()) ** 2)) if len(ac) > 2 else None,
            "annual": [{"year": int(y), "predicted": float(r.p), "observed": float(r.a)} for y, r in ann.iterrows()],
        }
        if len(lr) >= 3:
            out["cv_ratio_quantiles"] = {"p10": float(np.exp(np.quantile(lr, .1))), "p90": float(np.exp(np.quantile(lr, .9)))}
        else:
            notes.append("Too few overlap years for cross-validated uncertainty bands.")
    return out


def _validate(daily, monthly, M, V, overlap, calib, p) -> dict:
    v: dict = {}
    ovd = daily[daily.viirs_cov & daily.modis_cov]
    mo = ovd.modis_cd.sum(); vo = ovd.viirs_cd.sum()
    v["overlap_days"] = int(len(ovd))
    v["p_viirs_given_modis"] = float(ovd.matched_modis_cd.sum() / mo) if mo else None
    v["p_modis_given_viirs"] = float(ovd.matched_viirs_cd.sum() / vo) if vo else None
    v["detections_per_cell_day"] = {"MODIS": float(M.n.mean()) if len(M) else None,
                                    "VIIRS": float(V.n.mean()) if len(V) else None}
    v["raw_viirs_to_modis_detection_ratio"] = float(ovd.viirs_det.sum() / ovd.modis_det.sum()) if ovd.modis_det.sum() else None
    v["naive_sum_inflation"] = float(ovd.naive_sum.sum() / ovd.union_cd.sum()) if ovd.union_cd.sum() else None
    if len(overlap) > 3:
        x, y = overlap.modis_cd.to_numpy(float), overlap.union_cd.to_numpy(float)
        v["pearson_r_monthly"] = float(np.corrcoef(x, y)[0, 1]) if x.std() and y.std() else None
        v["spearman_rho_monthly"] = float(pd.Series(x).rank().corr(pd.Series(y).rank()))
    # transition consistency: does the harmonised series jump at VIIRS start more than MODIS itself does?
    mon = monthly.set_index("month")
    if mon.calibrated.any() and (~mon.calibrated).any():
        first_obs = mon.index[~mon.calibrated.to_numpy()].min()
        pre = mon[(mon.index < first_obs) & (mon.index >= first_obs - 36)]
        post = mon[(mon.index >= first_obs) & (mon.index < first_obs + 36)]
        if len(pre) >= 12 and len(post) >= 12 and pre.modis_cd.sum() > 0:
            modis_step = post.modis_cd.mean() / pre.modis_cd.mean()
            stitched_step = post.union_cd.mean() / pre.modis_cd.mean()
            naive_step = post.naive_sum.mean() / max(pre.naive_sum.mean(), 1e-9)
            harm_step = post.harmonized.mean() / max(pre.harmonized.mean(), 1e-9)
            v["transition"] = {
                "window": "36 months either side of first VIIRS month",
                "modis_only_step": float(modis_step), "naive_detection_step": float(naive_step),
                "stitched_uncalibrated_step": float(stitched_step), "harmonized_step": float(harm_step),
                "interpretation": "MODIS alone is a continuous record, so its step is the reference for the real "
                                  "change in activity. A harmonised step close to the MODIS step means the sensor "
                                  "transition no longer creates an artificial jump.",
            }
    return v


def sensitivity(df: pd.DataFrame, base: HarmonizationParams, cov: pd.DataFrame,
                grids=(0.005, 0.01, 0.025, 0.05, 0.1), match=(1.0, 2.0, 4.0)) -> list[dict]:
    out = []
    for g in grids:
        for mk in match:
            p = HarmonizationParams.from_dict({**asdict(base), "grid_deg": g, "match_km": mk, "compute_events": False})
            r = run(df, p, cov)
            cv = r.calibration.get("cv") or {}
            out.append({"grid_deg": g, "match_km": mk,
                        "p_viirs_given_modis": r.validation.get("p_viirs_given_modis"),
                        "ratio_global": r.calibration["ratio_global"],
                        "cv_monthly_mape_pct": cv.get("monthly_mape_pct"),
                        "cv_annual_mape_pct": cv.get("annual_mape_pct"),
                        "total_harmonized": float(r.daily.harmonized.sum()),
                        "harmonized_step": (r.validation.get("transition") or {}).get("harmonized_step")})
    return out
