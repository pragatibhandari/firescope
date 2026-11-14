"""PDF fire-intelligence reports (reportlab + matplotlib), fully parameterised for reproducibility."""
from __future__ import annotations

import io
import json
from datetime import datetime

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import ListedColormap  # noqa: E402
from reportlab.lib import colors  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet  # noqa: E402
from reportlab.lib.units import cm  # noqa: E402
from reportlab.platypus import (Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table,  # noqa: E402
                                TableStyle)

CAL_COLORS = ["#eceff3", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"]
LIMITATIONS = [
    "Hotspots are thermal anomalies detected at satellite overpass times; fires that start and end between "
    "overpasses, burn under cloud or thick smoke, or are too small/cool are missed.",
    "MODIS (1 km) and VIIRS (375 m) differ in pixel size, sensitivity and overpass schedule. The harmonised "
    "series is a statistical reconciliation, not a re-observation of the past.",
    "Pre-2012 harmonised values are MODIS observations calibrated with the AOI's own 2012+ overlap; their "
    "uncertainty is reported from leave-one-year-out cross-validation and grows for small AOIs.",
    "Estimated fire events are space-time clusters of detections, not confirmed individual fires.",
    "Anomalies are retrospective departures from this area's own record and are not fire forecasts.",
    "Fire Radiative Power is pixel-resolution dependent; VIIRS FRP is rescaled with an empirical, AOI-specific "
    "factor and should be treated as indicative.",
    "This harmonisation method has not been independently validated against reference fire inventories; the "
    "validation statistics shown are internal consistency checks.",
]


def _n(v):
    return float("nan") if v is None else float(v)


def _fig_to_img(fig, w=17 * cm, h=7 * cm):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    buf.seek(0)
    return Image(buf, width=w, height=h)


def build_pdf(ctx: dict) -> bytes:
    s = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=s["Heading1"], textColor=colors.HexColor("#b33a00"))
    h2 = ParagraphStyle("h2", parent=s["Heading2"], textColor=colors.HexColor("#1b2a41"))
    body = ParagraphStyle("b", parent=s["BodyText"], fontSize=9, leading=12)
    small = ParagraphStyle("s", parent=body, fontSize=7.5, leading=9.5, textColor=colors.HexColor("#444444"))
    out = io.BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=1.8 * cm, rightMargin=1.8 * cm, topMargin=1.5 * cm, bottomMargin=1.5 * cm,
                            title=f"FireScope report - {ctx['aoi_name']}")
    E = []
    k = ctx["summary"]["kpi"]
    E.append(Paragraph("FireScope - Burning Activity Intelligence Report", h1))
    if ctx["dataset"] == "demo":
        E.append(Paragraph("<b><font color='#b00020'>DEMONSTRATION DATA - SYNTHETIC, NOT SATELLITE OBSERVATIONS.</font></b> "
                           "Figures in this report illustrate the method only.", body))
    E.append(Paragraph(f"<b>Area of interest:</b> {ctx['aoi_name']} &nbsp; <b>Period:</b> {ctx['start']} to {ctx['end']} &nbsp; "
                       f"<b>Generated:</b> {datetime.utcnow():%Y-%m-%d %H:%M} UTC", body))
    E.append(Paragraph(f"<b>Data sources:</b> {ctx['sources']}", body))
    E.append(Spacer(1, 6))

    rows = [["Metric", "Value", "Definition"],
            ["Raw detections", f"{k['total_detections']:,}", "All MODIS + VIIRS hotspot pixels passing filters"],
            ["MODIS / VIIRS detections", f"{k['modis_detections']:,} / {k['viirs_detections']:,}", "Raw pixel counts per sensor"],
            ["Harmonised activity", f"{k['harmonized_activity'] or 0:,.0f}", "Harmonised active-fire cell-days (see methodology)"],
            ["Fire Activity Index", f"{k['fai'] or 0:,.0f}", "Confidence (+FRP) weighted harmonised cell-days"],
            ["Estimated fire events", f"{k['estimated_events']:,}" if k['estimated_events'] is not None else "n/a", "Space-time clusters (estimates)"],
            ["High-confidence detections", f"{k['high_conf_detections']:,}", "MODIS >= 80% or VIIRS 'high'"],
            ["FRP mean / max (MW)", f"{k['frp_mean'] or 0:.1f} / {k['frp_max'] or 0:.1f}", "Per-pixel Fire Radiative Power"],
            ["Change vs previous period", f"{k['pct_change_harmonized']:+.1f}%" if k['pct_change_harmonized'] is not None else "n/a",
             f"Harmonised activity vs {k['prev_period'][0]} - {k['prev_period'][1]}" if k['prev_period'] else ""]]
    t = Table(rows, colWidths=[4.5 * cm, 3.8 * cm, 8.6 * cm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1b2a41")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                           ("FONTSIZE", (0, 0), (-1, -1), 8), ("GRID", (0, 0), (-1, -1), 0.3, colors.grey),
                           ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f5f8")])]))
    E.append(t)

    # --- calendar heatmap (year x month)
    cal = ctx["calendar"]
    mat = cal["matrix"]
    if mat:
        years = sorted({m["year"] for m in mat})
        grid = np.full((len(years), 12), np.nan); cls = np.zeros((len(years), 12))
        for m in mat:
            grid[years.index(m["year"]), m["month"] - 1] = m["value"] or 0
            cls[years.index(m["year"]), m["month"] - 1] = m["class"]
        fig, ax = plt.subplots(figsize=(8, max(2.5, 0.22 * len(years) + 1)))
        ax.imshow(cls, cmap=ListedColormap(CAL_COLORS), vmin=0, vmax=5, aspect="auto")
        ax.set_yticks(range(len(years)), years, fontsize=7); ax.set_xticks(range(12), list("JFMAMJJASOND"), fontsize=8)
        for (i, j), v in np.ndenumerate(grid):
            if not np.isnan(v) and v > 0:
                ax.text(j, i, f"{v:.0f}", ha="center", va="center", fontsize=5, color="white" if 1 <= cls[i, j] <= 3 else "black")
        ax.set_title("Burning activity calendar - harmonised active-fire cell-days per month", fontsize=9)
        E.append(Spacer(1, 6)); E.append(Paragraph("Burning activity calendar", h2))
        E.append(_fig_to_img(fig, h=max(6, 0.4 * len(years) + 2) * cm))
        E.append(Paragraph("Colour classes: none / very low / low / moderate / high / extreme, defined by the P25, P50, P75 and "
                           "P90 of this AOI's own non-zero monthly values. Months before VIIRS coverage are calibrated MODIS.", small))

    E.append(PageBreak())
    # --- annual / sensor comparison chart
    ann = ctx["summary"]["annual"]
    if ann:
        y = [a["year"] for a in ann]
        fig, ax = plt.subplots(figsize=(8, 3))
        ax.bar(y, [a["harmonized"] for a in ann], color=["#9aa5b1" if a["calibrated"] else "#e4572e" for a in ann], label="Harmonised")
        ax.plot(y, [a["modis_det"] for a in ann], color="#2b6cb0", lw=1.4, label="Raw MODIS detections")
        ax.plot(y, [a["viirs_det"] for a in ann], color="#7b2cbf", lw=1.4, label="Raw VIIRS detections")
        ax.set_ylabel("count / year"); ax.legend(fontsize=7); ax.set_title("Annual activity: raw detections vs harmonised (grey = calibrated MODIS era)", fontsize=9)
        E.append(Paragraph("Historical comparison", h2)); E.append(_fig_to_img(fig))
    hist = ctx.get("history") or {}
    tt = (hist.get("trend_test") or {}).get("harmonized") or {}
    if tt:
        E.append(Paragraph(f"Mann-Kendall trend test on complete years: <b>{tt.get('trend')}</b> (z={tt.get('z')}, p={tt.get('p_value')}); "
                           f"Sen's slope {tt.get('sen_slope_per_year')} cell-days/yr ({tt.get('sen_slope_pct_of_mean')}% of mean).", body))

    # --- satellite contributions + harmonisation
    h = ctx["harmonization"]
    cal_ = h["calibration"]; val = h["validation"]
    E.append(Paragraph("Satellite contributions and harmonisation", h2))
    plat = ctx["summary"]["platforms"]
    E.append(Paragraph("Detections by platform: " + ", ".join(f"{p}: {n:,}" for p, n in plat.items()), body))
    cv = cal_.get("cv") or {}
    tr = val.get("transition") or {}
    lines = [
        f"Calibration method: <b>{cal_['method']}</b>; overlap months: {cal_['n_overlap_months']}; global ratio (union / MODIS cell-days): {cal_['ratio_global']:.3f}.",
        f"Leave-one-year-out CV: monthly MAPE {_n(cv.get('monthly_mape_pct')):.1f}%, annual MAPE {_n(cv.get('annual_mape_pct')):.1f}%, bias {_n(cv.get('bias_pct')):+.1f}%." if cv and cv.get('monthly_mape_pct') is not None else "Cross-validation not available (insufficient overlap).",
        f"Detection consistency in overlap: P(VIIRS | MODIS cell-day) = {val.get('p_viirs_given_modis') or 0:.2f}; P(MODIS | VIIRS cell-day) = {val.get('p_modis_given_viirs') or 0:.2f}.",
        f"Naive MODIS+VIIRS detection sum inflates activity by x{val.get('naive_sum_inflation') or 0:.2f} relative to de-duplicated union cell-days.",
    ]
    if tr:
        lines.append(f"Sensor-transition step (36 months either side): MODIS-only x{tr['modis_only_step']:.2f}, naive detections x{tr['naive_detection_step']:.2f}, "
                     f"harmonised x{tr['harmonized_step']:.2f}.")
    for l in lines:
        E.append(Paragraph("- " + l, body))

    # --- anomalies
    an = ctx["anomalies"]
    E.append(Paragraph("Detected anomalies (retrospective)", h2))
    if an["alerts"]:
        rows = [["Period", "Severity", "Observed", "Baseline median", "Deviation", "Type"]]
        for a in an["alerts"][:15]:
            rows.append([a["period"], a["severity"], f"{a['observed']:.0f}", f"{a['baseline_median']:.0f}",
                         f"{a['deviation_pct']:+.0f}%" if a["deviation_pct"] is not None else "n/a", a["type"]])
        t = Table(rows, colWidths=[2.2 * cm, 2 * cm, 2.2 * cm, 3 * cm, 2.2 * cm, 5.3 * cm])
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1b2a41")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                               ("FONTSIZE", (0, 0), (-1, -1), 7.5), ("GRID", (0, 0), (-1, -1), 0.3, colors.grey)]))
        E.append(t)
    else:
        E.append(Paragraph("No months exceeded the anomaly threshold in the selected period.", body))
    E.append(Paragraph(an["disclaimer"], small))

    E.append(Paragraph("Methodology summary", h2))
    E.append(Paragraph(
        "Detections are assigned to a common grid and day; repeated detections by one sensor in one cell-day collapse to one "
        "active-fire cell-day. MODIS and VIIRS cell-days within the matching radius are treated as the same observed activity, "
        "so the union of cell-days counts each burning location-day once. In the overlap era (2012+), a transfer function from "
        "MODIS cell-days to union cell-days is fitted for this AOI and used to express pre-VIIRS years in the same units. "
        "VIIRS 'reference' mode uses a single VIIRS platform per day so that additional satellites do not inflate activity.", body))
    E.append(Paragraph("Important limitations", h2))
    for l in LIMITATIONS:
        E.append(Paragraph("- " + l, small))
    E.append(Paragraph("Reproducibility - filters and harmonisation parameters", h2))
    E.append(Paragraph("<font face='Courier' size='6.5'>" + json.dumps(ctx["settings"], default=str, indent=1).replace("\n", "<br/>").replace(" ", "&nbsp;") + "</font>", small))
    E.append(Spacer(1, 6))
    E.append(Paragraph("Data: NASA FIRMS (https://firms.modaps.eosdis.nasa.gov/). We acknowledge the use of data from NASA's Fire "
                       "Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS).", small))
    doc.build(E)
    return out.getvalue()
