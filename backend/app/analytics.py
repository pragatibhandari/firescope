"""Dashboard, burning-activity calendar, historical analysis and anomaly detection.

All analytics run on the harmonised daily/monthly tables produced by harmonize.run() for the
AOI's FULL history, so that baselines are always available; the user's date range selects
what is displayed.
"""
from __future__ import annotations

import math
from datetime import date

import numpy as np
import pandas as pd

from .harmonize import HarmonizationResult

CLASS_NAMES = ["none", "very low", "low", "moderate", "high", "extreme"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _f(x, nd=3):
    if x is None:
        return None
    try:
        if isinstance(x, (float, np.floating)) and (math.isnan(x) or math.isinf(x)):
            return None
        return round(float(x), nd)
    except Exception:  # noqa
        return x


def thresholds(values: pd.Series) -> list[float]:
    nz = values[values > 0]
    if len(nz) < 5:
        return [1, 2, 3, 4]
    return [float(nz.quantile(q)) for q in (0.25, 0.5, 0.75, 0.9)]


def classify(v: np.ndarray, th: list[float]) -> np.ndarray:
    v = np.asarray(v, float)
    out = np.where(v <= 0, 0, 1 + np.searchsorted(th, v, side="left"))
    return np.clip(out, 0, 5)


def _range(daily: pd.DataFrame, start: date | None, end: date | None) -> pd.DataFrame:
    m = np.ones(len(daily), bool)
    if start:
        m &= daily.date >= pd.Timestamp(start)
    if end:
        m &= daily.date <= pd.Timestamp(end)
    return daily[m]


# =========================================================================== dashboard
def summary(raw: pd.DataFrame, hr: HarmonizationResult, start, end) -> dict:
    d = _range(hr.daily, start, end)
    if start and end:
        span = (pd.Timestamp(end) - pd.Timestamp(start)).days + 1
        prev = _range(hr.daily, pd.Timestamp(start) - pd.Timedelta(days=span), pd.Timestamp(start) - pd.Timedelta(days=1))
    else:
        prev = d.iloc[0:0]

    def pct(a, b):
        return _f((a - b) / b * 100, 1) if b else None

    ev = hr.events
    n_events = None
    if len(ev):
        e = ev
        if start:
            e = e[e.end >= pd.Timestamp(start)]
        if end:
            e = e[e.start <= pd.Timestamp(end)]
        n_events = int(len(e))
    frp = raw.frp.dropna()
    kpi = {
        "total_detections": int(len(raw)),
        "modis_detections": int((raw.sensor == "MODIS").sum()),
        "viirs_detections": int((raw.sensor == "VIIRS").sum()),
        "high_conf_detections": int((raw.confidence_class == "high").sum()),
        "unique_cell_days": int(d.union_cd.sum()),
        "estimated_events": n_events,
        "harmonized_activity": _f(d.harmonized.sum(), 1),
        "fai": _f(d.fai.sum(), 1),
        "frp_mean": _f(frp.mean(), 2) if len(frp) else None,
        "frp_max": _f(frp.max(), 2) if len(frp) else None,
        "pct_change_harmonized": pct(d.harmonized.sum(), prev.harmonized.sum()) if len(prev) else None,
        "pct_change_detections": pct(d.naive_sum.sum(), prev.naive_sum.sum()) if len(prev) else None,
        "prev_period": [str(prev.date.min().date()), str(prev.date.max().date())] if len(prev) else None,
        "share_calibrated_days": _f(d.calibrated.mean(), 3) if len(d) else None,
    }
    # series
    daily = d[["date", "modis_det", "viirs_det", "harmonized", "harm_lo", "harm_hi", "fai", "high_conf_det",
               "union_cd", "calibrated"]].copy()
    if len(daily) > 1500:   # long ranges -> weekly to keep payload light
        daily = daily.set_index("date").resample("W").agg({
            "modis_det": "sum", "viirs_det": "sum", "harmonized": "sum", "harm_lo": "sum", "harm_hi": "sum",
            "fai": "sum", "high_conf_det": "sum", "union_cd": "sum", "calibrated": "max"}).reset_index()
        res = "weekly"
    else:
        res = "daily"
    daily["date"] = daily.date.dt.strftime("%Y-%m-%d")
    mon = hr.monthly
    if start:
        mon = mon[mon.date >= pd.Timestamp(start).to_period("M").to_timestamp()]
    if end:
        mon = mon[mon.date <= pd.Timestamp(end)]
    monthly = mon[["date", "modis_det", "viirs_det", "naive_sum", "modis_cd", "union_cd", "harmonized", "fai",
                   "calibrated"]].copy()
    monthly["date"] = monthly.date.dt.strftime("%Y-%m")

    annual = hr.monthly.groupby(hr.monthly.date.dt.year).agg(
        modis_det=("modis_det", "sum"), viirs_det=("viirs_det", "sum"), harmonized=("harmonized", "sum"),
        modis_cd=("modis_cd", "sum"), union_cd=("union_cd", "sum"), calibrated=("calibrated", "all")).reset_index(names="year")

    seas = hr.monthly.assign(m=hr.monthly.date.dt.month).groupby("m").harmonized.agg(["mean", "median", "max"]).reindex(range(1, 13)).fillna(0)
    seasonal = [{"month": MONTHS[m - 1], "mean": _f(r["mean"], 1), "median": _f(r["median"], 1), "max": _f(r["max"], 1)}
                for m, r in seas.iterrows()]

    # FRP distribution (log-spaced bins) by sensor
    bins = np.logspace(-1, 4, 26)
    frp_hist = []
    for s in ("MODIS", "VIIRS"):
        v = raw.loc[raw.sensor == s, "frp"].dropna()
        h, _ = np.histogram(v.clip(bins[0], bins[-1]), bins=bins)
        frp_hist.append(h)
    frp_hist = [{"bin": f"{bins[i]:.3g}-{bins[i + 1]:.3g}", "lo": _f(bins[i]), "MODIS": int(frp_hist[0][i]),
                 "VIIRS": int(frp_hist[1][i])} for i in range(len(bins) - 1)]

    conf = raw.groupby(["sensor", "confidence_class"]).size().unstack(fill_value=0).reindex(columns=["low", "nominal", "high"], fill_value=0)
    conf_rows = [{"sensor": s, **{c: int(conf.loc[s, c]) for c in conf.columns}} for s in conf.index]

    plat = raw.groupby("platform").size().to_dict()
    countries = (raw.groupby(["country", "sensor"]).size().unstack(fill_value=0)
                 .assign(total=lambda x: x.sum(axis=1)).sort_values("total", ascending=False).head(15))
    country_rows = [{"country": c, "MODIS": int(r.get("MODIS", 0)), "VIIRS": int(r.get("VIIRS", 0)), "total": int(r.total)}
                    for c, r in countries.iterrows()]
    return {"kpi": kpi, "series_resolution": res, "daily": daily.round(3).to_dict("records"),
            "monthly": monthly.round(3).to_dict("records"), "annual": annual.round(2).to_dict("records"),
            "seasonal": seasonal, "frp_hist": frp_hist, "confidence": conf_rows,
            "platforms": {k: int(v) for k, v in plat.items()}, "by_country": country_rows}


# =========================================================================== calendar
def calendar(hr: HarmonizationResult, start, end, metric: str = "harmonized") -> dict:
    daily, monthly = hr.daily, hr.monthly
    col = metric if metric in ("harmonized", "fai", "naive_sum", "modis_det", "viirs_det") else "harmonized"
    mth = monthly.assign(year=monthly.date.dt.year, m=monthly.date.dt.month)
    th_m = thresholds(mth[col])
    matrix = []
    base = mth.groupby("m")[col].agg(["median", "mean", lambda s: s.quantile(.25), lambda s: s.quantile(.75), "max"])
    base.columns = ["median", "mean", "p25", "p75", "max"]
    for _, r in mth.iterrows():
        b = base.loc[r.m]
        others = mth[(mth.m == r.m) & (mth.year != r.year)][col]
        med_o = others.median() if len(others) else np.nan
        matrix.append({"year": int(r.year), "month": int(r.m), "value": _f(r[col], 2),
                       "class": int(classify([r[col]], th_m)[0]), "calibrated": bool(r.calibrated),
                       "modis_det": int(r.modis_det), "viirs_det": int(r.viirs_det),
                       "pct_of_median": _f(r[col] / med_o * 100, 1) if med_o and med_o > 0 else None,
                       "baseline_median": _f(med_o, 2), "rank_in_month": int((others > r[col]).sum() + 1)})
    month_baseline = [{"month": MONTHS[m - 1], "m": int(m), **{k: _f(v, 2) for k, v in r.items()}} for m, r in base.iterrows()]

    # daily view for selected range (+ DOY baseline across other years)
    th_d = thresholds(daily[col])
    sel = _range(daily, start, end).copy()
    if len(sel) > 3700:
        sel = sel.tail(3700)
    doy = daily.assign(doy=daily.date.dt.dayofyear, y=daily.date.dt.year)
    clim = {}
    for dd in sel.date.dt.dayofyear.unique():
        win = doy[(np.abs(doy.doy - dd) <= 7) | (np.abs(doy.doy - dd) >= 358)]
        clim[dd] = win.groupby("y")[col].mean()
    days = []
    for _, r in sel.iterrows():
        series = clim[r.date.dayofyear]
        series = series.drop(r.date.year, errors="ignore")
        bmed = float(series.median()) if len(series) else None
        days.append({"date": r.date.strftime("%Y-%m-%d"), "value": _f(r[col], 2),
                     "class": int(classify([r[col]], th_d)[0]), "calibrated": bool(r.calibrated),
                     "modis_det": int(r.modis_det), "viirs_det": int(r.viirs_det),
                     "baseline": _f(bmed, 2),
                     "pct_vs_baseline": _f((r[col] - bmed) / bmed * 100, 1) if bmed else None})
    # weekly
    wk = sel.set_index("date")[[col, "modis_det", "viirs_det"]].resample("W-MON", label="left", closed="left").sum().reset_index()
    weekly = [{"week_start": r.date.strftime("%Y-%m-%d"), "value": _f(r[col], 2), "class": int(classify([r[col]], [t * 7 for t in th_d])[0]),
               "modis_det": int(r.modis_det), "viirs_det": int(r.viirs_det)} for _, r in wk.iterrows()]
    # seasonal (meteorological seasons; DJF assigned to the year of its December)
    s = monthly.assign(y=monthly.date.dt.year, m=monthly.date.dt.month)
    s["season"] = s.m.map({12: "DJF", 1: "DJF", 2: "DJF", 3: "MAM", 4: "MAM", 5: "MAM", 6: "JJA", 7: "JJA", 8: "JJA",
                           9: "SON", 10: "SON", 11: "SON"})
    s["sy"] = np.where(s.m <= 2, s.y - 1, s.y)
    seas = s.groupby(["sy", "season"])[col].sum().reset_index()
    th_s = thresholds(seas[col])
    seasonal = [{"year": int(r.sy), "season": r.season, "value": _f(r[col], 1), "class": int(classify([r[col]], th_s)[0])}
                for _, r in seas.iterrows()]
    annual = mth.groupby("year")[col].sum()
    th_a = thresholds(annual)
    yearly = [{"year": int(y), "value": _f(v, 1), "class": int(classify([v], th_a)[0]),
               "pct_of_median": _f(v / annual.drop(y).median() * 100, 1) if len(annual) > 1 and annual.drop(y).median() > 0 else None}
              for y, v in annual.items()]
    return {"metric": col, "classes": CLASS_NAMES,
            "thresholds": {"monthly": th_m, "daily": th_d, "seasonal": th_s, "annual": th_a},
            "matrix": matrix, "month_baseline": month_baseline, "daily": days, "weekly": weekly,
            "seasonal": seasonal, "yearly": yearly,
            "class_method": "Quantiles (P25, P50, P75, P90) of the AOI's own non-zero values at the same aggregation level"}


def day_detail(raw: pd.DataFrame, hr: HarmonizationResult, day: date) -> dict:
    daily = hr.daily.set_index("date")
    t = pd.Timestamp(day)
    if t not in daily.index:
        return {"date": str(day), "available": False}
    r = daily.loc[t]

    def ssum(a, b):
        return float(daily.loc[a:b].harmonized.sum())

    def pct(a, b):
        return _f((a - b) / b * 100, 1) if b else None

    prev_day = float(daily.harmonized.get(t - pd.Timedelta(days=1), np.nan))
    w_cur, w_prev = ssum(t - pd.Timedelta(days=6), t), ssum(t - pd.Timedelta(days=13), t - pd.Timedelta(days=7))
    m0 = t.to_period("M")
    m_cur = float(hr.monthly.set_index("month").harmonized.get(m0, 0))
    m_prev = float(hr.monthly.set_index("month").harmonized.get(m0 - 1, 0))
    ly = t - pd.DateOffset(years=1)
    y_cur, y_prev = ssum(t - pd.Timedelta(days=3), t + pd.Timedelta(days=3)), ssum(ly - pd.Timedelta(days=3), ly + pd.Timedelta(days=3))
    doy = hr.daily.assign(doy=hr.daily.date.dt.dayofyear, y=hr.daily.date.dt.year)
    win = doy[(np.abs(doy.doy - t.dayofyear) <= 7) & (doy.y != t.year)]
    hist = win.groupby("y").harmonized.mean()
    sub = raw[raw.acq_date == t]
    frp = sub.frp.dropna()
    by_c = sub.groupby("country").size().sort_values(ascending=False).head(8)
    return {
        "date": str(day), "available": True,
        "total_detections": int(len(sub)), "modis_detections": int((sub.sensor == "MODIS").sum()),
        "viirs_detections": int((sub.sensor == "VIIRS").sum()),
        "by_platform": {k: int(v) for k, v in sub.groupby("platform").size().items()},
        "harmonized": _f(r.harmonized, 2), "fai": _f(r.fai, 2), "calibrated": bool(r.calibrated),
        "union_cell_days": int(r.union_cd), "matched_modis_cd": int(r.matched_modis_cd),
        "frp_mean": _f(frp.mean(), 2) if len(frp) else None, "frp_max": _f(frp.max(), 2) if len(frp) else None,
        "high_conf": int((sub.confidence_class == "high").sum()),
        "bbox": [float(sub.lon.min()), float(sub.lat.min()), float(sub.lon.max()), float(sub.lat.max())] if len(sub) else None,
        "by_country": [{"country": c, "n": int(n)} for c, n in by_c.items()],
        "historical": {"window": "same day-of-year +/-7 days, other years", "n_years": int(len(hist)),
                       "median": _f(hist.median(), 2) if len(hist) else None, "mean": _f(hist.mean(), 2) if len(hist) else None,
                       "pct_vs_median": pct(float(r.harmonized), float(hist.median())) if len(hist) else None},
        "comparisons": {
            "day_over_day": {"current": _f(r.harmonized, 2), "previous": _f(prev_day, 2), "pct": pct(float(r.harmonized), prev_day)},
            "week_over_week": {"current": _f(w_cur, 2), "previous": _f(w_prev, 2), "pct": pct(w_cur, w_prev)},
            "month_over_month": {"current": _f(m_cur, 2), "previous": _f(m_prev, 2), "pct": pct(m_cur, m_prev)},
            "year_over_year": {"current": _f(y_cur, 2), "previous": _f(y_prev, 2), "pct": pct(y_cur, y_prev),
                               "note": "7-day window centred on the date vs same window one year earlier"},
        },
    }


# =========================================================================== history
def mann_kendall(x: np.ndarray) -> dict:
    x = np.asarray(x, float)
    n = len(x)
    if n < 4:
        return {}
    s = sum(np.sign(x[j] - x[i]) for i in range(n - 1) for j in range(i + 1, n))
    _, counts = np.unique(x, return_counts=True)
    var = (n * (n - 1) * (2 * n + 5) - sum(c * (c - 1) * (2 * c + 5) for c in counts)) / 18
    z = (s - np.sign(s)) / math.sqrt(var) if var > 0 else 0
    p = math.erfc(abs(z) / math.sqrt(2))
    slopes = [(x[j] - x[i]) / (j - i) for i in range(n - 1) for j in range(i + 1, n)]
    sen = float(np.median(slopes))
    return {"S": int(s), "z": _f(z), "p_value": _f(p, 4), "sen_slope_per_year": _f(sen, 2),
            "sen_slope_pct_of_mean": _f(sen / x.mean() * 100, 2) if x.mean() else None,
            "trend": "increasing" if (p < 0.05 and s > 0) else "decreasing" if (p < 0.05 and s < 0) else "no significant trend"}


def decompose(monthly: pd.DataFrame, col="harmonized") -> list[dict]:
    s = monthly.set_index("date")[col].asfreq("MS").fillna(0)
    y = np.log1p(s)
    if len(y) < 25:
        return []
    trend = y.rolling(12, center=True).mean().rolling(2, center=True).mean()
    det = y - trend
    seas = det.groupby(det.index.month).transform("mean")
    seas = seas - seas.groupby(seas.index.month).mean().mean()
    resid = y - trend - seas
    return [{"date": d.strftime("%Y-%m"), "observed": _f(o, 4), "trend": _f(t, 4), "seasonal": _f(se, 4), "residual": _f(r, 4)}
            for d, o, t, se, r in zip(y.index, y, trend, seas, resid)]


def history(raw_all: pd.DataFrame, hr: HarmonizationResult, compare: list[dict] | None = None) -> dict:
    mon = hr.monthly.assign(y=hr.monthly.date.dt.year, m=hr.monthly.date.dt.month)
    yrs = mon.groupby("y").m.nunique()
    full_years = yrs[yrs == 12].index
    ann = mon.groupby("y").agg(harmonized=("harmonized", "sum"), modis_cd=("modis_cd", "sum"), union_cd=("union_cd", "sum"),
                              naive=("naive_sum", "sum"), fai=("fai", "sum"), frp=("frp_harm", "sum"),
                              calibrated=("calibrated", "all"))
    ann_full = ann.loc[ann.index.isin(full_years)]
    mk = mann_kendall(ann_full.harmonized.to_numpy()) if len(ann_full) >= 4 else {}
    mk_modis = mann_kendall(ann_full.modis_cd.to_numpy()) if len(ann_full) >= 4 else {}
    box = []
    for m in range(1, 13):
        v = mon[mon.m == m].harmonized
        if len(v):
            box.append({"month": MONTHS[m - 1], "min": _f(v.min(), 1), "p25": _f(v.quantile(.25), 1), "median": _f(v.median(), 1),
                        "p75": _f(v.quantile(.75), 1), "max": _f(v.max(), 1), "mean": _f(v.mean(), 1)})
    # fire-season metrics per year
    season = []
    for y in full_years:
        v = mon[mon.y == y].sort_values("m").harmonized.to_numpy()
        tot = v.sum()
        if tot <= 0:
            continue
        c = np.cumsum(v) / tot
        s10, s90 = int(np.searchsorted(c, 0.1)) + 1, int(np.searchsorted(c, 0.9)) + 1
        season.append({"year": int(y), "peak_month": MONTHS[int(np.argmax(v))], "start_10pct": MONTHS[s10 - 1],
                       "end_90pct": MONTHS[min(s90, 12) - 1], "length_months": s90 - s10 + 1,
                       "peak_share_pct": _f(v.max() / tot * 100, 1)})
    # country ranking (raw detections and cell-days at grid)
    rank = []
    if len(raw_all):
        g = raw_all.assign(y=raw_all.acq_date.dt.year)
        tot = g.groupby("country").size().sort_values(ascending=False).head(20)
        frp = g.groupby("country").frp.agg(["mean", "max"])
        for c, n in tot.items():
            rank.append({"country": c, "detections": int(n), "frp_mean": _f(frp.loc[c, "mean"], 1), "frp_max": _f(frp.loc[c, "max"], 1)})
    # event-size structure (heuristic burn-type indicator)
    ev_struct = []
    if len(hr.events):
        e = hr.events.assign(y=hr.events.start.dt.year)
        e["type"] = np.where((e.cell_days <= 2) & (e.duration_days <= 1), "small / short (<=2 cell-days, 1 day)",
                             np.where((e.cell_days >= 20) | (e.duration_days >= 5), "large / persistent (>=20 cell-days or >=5 days)",
                                      "intermediate"))
        t = e.groupby(["y", "type"]).size().unstack(fill_value=0)
        ev_struct = [{"year": int(y), **{k: int(v) for k, v in r.items()}} for y, r in t.iterrows()]
    out = {"annual": [{"year": int(y), **{k: (_f(v, 1) if k != "calibrated" else bool(v)) for k, v in r.items()}} for y, r in ann.iterrows()],
           "full_years": [int(y) for y in full_years],
           "trend_test": {"harmonized": mk, "modis_only": mk_modis,
                          "method": "Mann-Kendall test with Sen's slope on complete calendar years"},
           "monthly_box": box, "decomposition": decompose(hr.monthly), "season": season,
           "country_ranking": rank, "event_structure": ev_struct}
    if compare:
        periods = []
        for c in compare:
            s, e = pd.Timestamp(c["start"]), pd.Timestamp(c["end"])
            d = hr.daily[(hr.daily.date >= s) & (hr.daily.date <= e)]
            prof = d.groupby(d.date.dt.month).harmonized.sum().reindex(range(1, 13), fill_value=0)
            periods.append({"label": c.get("label") or f"{s.date()} - {e.date()}", "start": str(s.date()), "end": str(e.date()),
                            "harmonized": _f(d.harmonized.sum(), 1), "detections": int(d.naive_sum.sum()),
                            "days": int(len(d)), "per_day": _f(d.harmonized.mean(), 2) if len(d) else None,
                            "peak_day": str(d.loc[d.harmonized.idxmax(), "date"].date()) if len(d) and d.harmonized.max() > 0 else None,
                            "monthly_profile": [_f(v, 1) for v in prof]})
        out["comparison"] = periods
    return out


def recurrence(raw_all: pd.DataFrame, cell_deg=0.25) -> dict:
    """Grid cells x number of distinct years with any detection (hotspot recurrence)."""
    if raw_all.empty:
        return {"type": "FeatureCollection", "features": [], "n_years": 0}
    g = raw_all.assign(ix=np.floor(raw_all.lon / cell_deg).astype(int), iy=np.floor(raw_all.lat / cell_deg).astype(int),
                       y=raw_all.acq_date.dt.year)
    ny = g.y.nunique()
    r = g.groupby(["ix", "iy"]).agg(years=("y", "nunique"), n=("y", "size")).reset_index()
    feats = []
    for row in r.itertuples():
        x0, y0 = row.ix * cell_deg, row.iy * cell_deg
        feats.append({"type": "Feature", "properties": {"years": int(row.years), "share": round(row.years / ny, 3), "n": int(row.n)},
                      "geometry": {"type": "Polygon", "coordinates": [[[x0, y0], [x0 + cell_deg, y0], [x0 + cell_deg, y0 + cell_deg],
                                                                         [x0, y0 + cell_deg], [x0, y0]]]}})
    return {"type": "FeatureCollection", "features": feats, "n_years": int(ny), "cell_deg": cell_deg}


# =========================================================================== anomalies
SEV = [(4.0, "extreme"), (3.0, "high"), (2.0, "moderate")]


def _sev(score: float) -> str | None:
    for t, n in SEV:
        if score >= t:
            return n
    return None


def anomalies(hr: HarmonizationResult, aoi_name: str, start, end, method="robust_z", threshold=2.0,
              min_value=5.0, ref_years: int | None = None) -> dict:
    mon = hr.monthly.assign(y=hr.monthly.date.dt.year, m=hr.monthly.date.dt.month)
    mon["frp_per_cd"] = np.where(mon.harmonized > 0, mon.frp_harm / mon.harmonized.replace(0, np.nan), np.nan)
    rows, alerts = [], []
    for i, r in mon.iterrows():
        ref = mon[(mon.m == r.m) & (mon.y != r.y)]
        if ref_years:
            ref = ref[(ref.y < r.y) & (ref.y >= r.y - ref_years)]
        x = float(r.harmonized)
        if len(ref) < 3:
            rows.append({"date": r.date.strftime("%Y-%m"), "value": _f(x, 1), "baseline": None}); continue
        v = ref.harmonized
        med, mean, sd = float(v.median()), float(v.mean()), float(v.std(ddof=1))
        mad = float(np.median(np.abs(v - med))) * 1.4826
        q1, q3 = float(v.quantile(.25)), float(v.quantile(.75))
        z = (x - mean) / sd if sd > 0 else 0.0
        rz = (x - med) / mad if mad > 0 else ((x - med) / (mean * 0.5 + 1e-9) if mean > 0 else 0.0)
        iqr_score = (x - q3) / (q3 - q1) if q3 > q1 else 0.0
        score = {"zscore": z, "robust_z": rz, "iqr": iqr_score * 2}.get(method, rz)  # iqr: 1.0*IQR above Q3 ~ score 2
        pct = (x - med) / med * 100 if med > 0 else None
        mon_max = float(mon.harmonized.max())
        out_of_season = (med <= max(1.0, 0.02 * mon_max) and x >= 3 * max(med, 1.0)
                         and x >= max(min_value * 2, 0.05 * mon_max))
        frp_ref = ref.frp_per_cd.dropna()
        frp_z = ((r.frp_per_cd - frp_ref.mean()) / frp_ref.std(ddof=1)) if len(frp_ref) >= 3 and frp_ref.std(ddof=1) > 0 and not np.isnan(r.frp_per_cd) else None
        flag = (score >= threshold and x >= min_value) or out_of_season
        rows.append({"date": r.date.strftime("%Y-%m"), "value": _f(x, 1), "baseline": _f(med, 1), "mean": _f(mean, 1),
                     "lo": _f(max(0, mean - 2 * sd), 1), "hi": _f(mean + 2 * sd, 1), "p25": _f(q1, 1), "p75": _f(q3, 1),
                     "score": _f(score, 2), "flag": bool(flag), "calibrated": bool(r.calibrated)})
        if flag:
            sev = "high" if out_of_season and _sev(score) is None else (_sev(score) or "moderate")
            kind = "out-of-season burning" if out_of_season else "unusually high activity"
            msg = (f"Harmonised fire activity in {aoi_name} during {MONTHS[r.m - 1]} {r.y} was "
                   + (f"{pct:.0f}% above" if pct is not None else "well above")
                   + f" its historical median for {MONTHS[r.m - 1]} ({x:.0f} vs {med:.0f} harmonised cell-days, n={len(ref)} reference years).")
            if out_of_season:
                msg += f" {MONTHS[r.m - 1]} is normally outside this area's burning season."
            if frp_z is not None and frp_z >= 2:
                msg += f" Mean fire intensity (FRP per cell-day) was also elevated (z={frp_z:.1f})."
            alerts.append({"id": f"M{r.y}{r.m:02d}", "level": "monthly", "type": kind, "area": aoi_name,
                           "period": f"{r.y}-{r.m:02d}", "date": r.date.strftime("%Y-%m-%d"), "observed": _f(x, 1),
                           "baseline_median": _f(med, 1), "baseline_mean": _f(mean, 1), "deviation_pct": _f(pct, 1),
                           "score": _f(score, 2), "method": method, "severity": sev, "frp_z": _f(frp_z, 2),
                           "n_reference_years": int(len(ref)), "calibrated_period": bool(r.calibrated), "message": msg})
    # daily early-warning style indicators (last 120 days of the selected range)
    daily = hr.daily
    sel = _range(daily, start, end).tail(120)
    doy = daily.assign(doy=daily.date.dt.dayofyear, y=daily.date.dt.year)
    roll = daily.set_index("date").harmonized.rolling(7, min_periods=1).sum()
    daily_alerts, daily_rows = [], []
    for _, r in sel.iterrows():
        dd = r.date.dayofyear
        win = doy[((np.abs(doy.doy - dd) <= 7) | (np.abs(doy.doy - dd) >= 358)) & (doy.y != r.date.year)]
        per_year = win.groupby("y").harmonized.mean() * 7
        x = float(roll.get(r.date, 0))
        if len(per_year) < 3:
            continue
        med = float(per_year.median()); mad = float(np.median(np.abs(per_year - med))) * 1.4826
        rz = (x - med) / mad if mad > 0 else 0.0
        daily_rows.append({"date": r.date.strftime("%Y-%m-%d"), "value7": _f(x, 1), "baseline7": _f(med, 1), "score": _f(rz, 2)})
        if rz >= threshold + 1 and x >= min_value:
            daily_alerts.append({"date": r.date.strftime("%Y-%m-%d"), "observed_7d": _f(x, 1), "baseline_7d": _f(med, 1),
                                 "deviation_pct": _f((x - med) / med * 100, 1) if med > 0 else None, "score": _f(rz, 2),
                                 "severity": _sev(rz - 1) or "moderate"})
    # change points on annual totals (binary segmentation on log values)
    ann = mon.groupby("y").harmonized.sum()
    full = mon.groupby("y").m.nunique()
    ann = ann[full == 12]
    cps = _change_points(np.log1p(ann.to_numpy()), list(ann.index))
    # isolation forest on monthly features (multivariate unusualness)
    iso = []
    try:
        from sklearn.ensemble import IsolationForest
        feat = mon[["harmonized", "frp_per_cd", "m"]].copy()
        feat["harmonized"] = np.log1p(feat.harmonized)
        feat["frp_per_cd"] = np.log1p(feat.frp_per_cd.fillna(0))
        feat["ms"], feat["mc"] = np.sin(2 * np.pi * feat.m / 12), np.cos(2 * np.pi * feat.m / 12)
        X = feat[["harmonized", "frp_per_cd", "ms", "mc"]].to_numpy()
        if len(X) >= 24:
            f = IsolationForest(n_estimators=200, contamination=0.03, random_state=0).fit(X)
            sc = -f.score_samples(X)
            pred = f.predict(X)
            iso = [{"date": mon.date.iloc[i].strftime("%Y-%m"), "score": _f(sc[i], 3)} for i in np.where(pred == -1)[0]]
    except Exception:  # noqa
        pass
    in_range = [a for a in alerts if (not start or a["date"] >= str(pd.Timestamp(start).to_period("M").to_timestamp().date()))
                and (not end or a["date"] <= str(end))]
    order = {"extreme": 0, "high": 1, "moderate": 2}
    in_range.sort(key=lambda a: (order.get(a["severity"], 3), -(a["score"] or 0)))
    return {"method": method, "threshold": threshold, "alerts": in_range, "all_alert_count": len(alerts),
            "series": rows, "daily_series": daily_rows, "daily_alerts": daily_alerts,
            "change_points": cps, "isolation_forest": iso,
            "disclaimer": "These are retrospective anomalies relative to this area's own satellite record. "
                          "They are not fire forecasts and do not predict future wildfire occurrence."}


def _change_points(y: np.ndarray, years: list, min_size=3, max_cp=3) -> list[dict]:
    """Binary segmentation minimising within-segment squared error with a BIC-like penalty."""
    n = len(y)
    if n < 2 * min_size + 1:
        return []
    pen = 2 * np.var(y) * np.log(n) if np.var(y) > 0 else 1
    segs, cps = [(0, n)], []

    def cost(a, b):
        s = y[a:b]
        return float(((s - s.mean()) ** 2).sum())

    for _ in range(max_cp):
        best = None
        for (a, b) in segs:
            for k in range(a + min_size, b - min_size + 1):
                gain = cost(a, b) - cost(a, k) - cost(k, b)
                if best is None or gain > best[0]:
                    best = (gain, a, b, k)
        if not best or best[0] < pen:
            break
        _, a, b, k = best
        segs.remove((a, b)); segs += [(a, k), (k, b)]
        cps.append({"year": int(years[k]), "mean_before": _f(np.expm1(y[a:k].mean()), 1), "mean_after": _f(np.expm1(y[k:b].mean()), 1)})
    return sorted(cps, key=lambda c: c["year"])
