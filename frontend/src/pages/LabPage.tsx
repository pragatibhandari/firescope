import React, { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, ReferenceLine, Area } from "recharts";
import { Play, RotateCcw } from "lucide-react";
import { useApi } from "../lib/api";
import { DEFAULT_PARAMS, HParams, useStore } from "../lib/store";
import { COLORS, MONTHS, fmt, pct } from "../lib/format";
import { ChartCard, ErrorBox, InfoTip, Legend, Loading, PageHeader, Seg, axisProps, tooltipStyle } from "../components/ui";

export default function LabPage() {
  const { params, setParams, body } = useStore();
  const [draft, setDraft] = useState<HParams>(params);
  useEffect(() => setDraft(params), [params]);
  const h = useApi<any>("/api/harmonization", body());
  const [sensBody, setSensBody] = useState<any>(null);
  const sens = useApi<any>(sensBody ? "/api/harmonization/sensitivity" : null, sensBody);
  const [series, setSeries] = useState<"raw" | "normalized" | "harmonized">("harmonized");
  const d = h.data;
  const dirty = JSON.stringify(draft) !== JSON.stringify(params);

  const annual = useMemo(() => {
    if (!d) return [];
    const by = new Map<string, any>();
    d.monthly.forEach((m: any) => {
      const y = m.date.slice(0, 4);
      const r = by.get(y) || { year: y, naive: 0, stitched: 0, harmonized: 0, modis: 0, n: 0, calibrated: false };
      r.naive += m.naive_sum; r.stitched += m.calibrated ? m.modis_cd : m.union_cd; r.harmonized += m.harmonized; r.modis += m.modis_cd; r.n++; r.calibrated ||= m.calibrated;
      by.set(y, r);
    });
    const rows = Array.from(by.values()).filter((r) => r.n === 12);
    const ref = rows.filter((r) => !r.calibrated).slice(0, 3);
    const base = (k: string) => ref.reduce((a, r) => a + r[k], 0) / Math.max(1, ref.length) || 1;
    const b = { naive: base("naive"), stitched: base("stitched"), harmonized: base("harmonized"), modis: base("modis") };
    return rows.map((r) => ({ year: r.year, "Raw detections (MODIS+VIIRS)": +(r.naive / b.naive * 100).toFixed(1), "Uncalibrated stitched cell-days": +(r.stitched / b.stitched * 100).toFixed(1),
      "Harmonised": +(r.harmonized / b.harmonized * 100).toFixed(1), "MODIS-only cell-days (reference)": +(r.modis / b.modis * 100).toFixed(1) }));
  }, [d]);

  const st = d?.stages;
  const funnel = st ? [
    { k: "Raw detections", v: st.raw_detections, c: "#94a3b8", t: "All MODIS and VIIRS pixels in the AOI's full record" },
    { k: "Excluded platform", v: st.excluded_platform, c: "#475569", t: "Non-reference VIIRS satellites (reference mode) or unselected MODIS platform" },
    { k: "MODIS cell-days", v: st.modis_cell_days, c: COLORS.modis, t: "MODIS detections collapsed to unique grid-cell × day" },
    { k: "VIIRS cell-days", v: st.viirs_cell_days, c: COLORS.viirs, t: "VIIRS detections collapsed to unique grid-cell × day" },
    { k: "Matched MODIS cell-days", v: st.matched_modis_cell_days, c: "#5ad19a", t: "MODIS cell-days co-detected by VIIRS within the match radius" },
    { k: "Union cell-days", v: st.union_cell_days, c: COLORS.harm, t: "VIIRS cell-days + unmatched MODIS cell-days (each burning cell-day counted once)" },
    { k: "Estimated events", v: st.estimated_events, c: "#a78bfa", t: "Space-time clusters of union cell-days — estimates, not confirmed fires" },
  ] : [];
  const cv = d?.calibration?.cv;
  const v = d?.validation;
  const tr = v?.transition;
  const ratios = d ? Object.entries(d.calibration.ratio_by_month).map(([m, r]: any) => ({ month: MONTHS[Number(m) - 1], ratio: r })) : [];
  const seriesKeys = series === "raw" ? [["modis_det", "MODIS detections", COLORS.modis], ["viirs_det", "VIIRS detections", COLORS.viirs]]
    : series === "normalized" ? [["modis_cd", "MODIS cell-days", COLORS.modis], ["viirs_cd", "VIIRS cell-days", COLORS.viirs]]
      : [["harmonized", "Harmonised", COLORS.harm]];

  return (
    <div className="space-y-4">
      <PageHeader title="MODIS–VIIRS Harmonization Lab" desc="Transparent, configurable pipeline. Every parameter below changes the whole platform (dashboard, calendar, anomalies, reports). Validation statistics are internal consistency checks on this AOI's own overlap period — not independent validation against fire inventories." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="card h-fit space-y-3 p-4">
          <div className="card-h">Parameters</div>
          <P l="Aggregation grid" i="Common grid for both sensors. 0.01° ≈ MODIS nadir pixel (1 km). Coarser grids merge nearby detections more aggressively.">
            <select className="input w-full" value={draft.grid_deg} onChange={(e) => setDraft({ ...draft, grid_deg: Number(e.target.value) })}>
              {[0.005, 0.01, 0.025, 0.05, 0.1, 0.25].map((g) => <option key={g} value={g}>{g}° (~{(g * 111).toFixed(1)} km)</option>)}</select></P>
          <P l={`Spatial match radius: ${draft.match_km} km`} i="MODIS and VIIRS cell-days closer than this are treated as the same burning location. Accounts for MODIS off-nadir pixel growth (up to ~2×4.8 km) and geolocation differences.">
            <input type="range" min={0} max={10} step={0.5} value={draft.match_km} onChange={(e) => setDraft({ ...draft, match_km: Number(e.target.value) })} className="w-full accent-[#e0552f]" /></P>
          <P l="Temporal match window" i="0 = same day only; 1 = ±1 day (useful with UTC days where night and day overpasses can fall on different dates).">
            <Seg value={draft.match_days} onChange={(x) => setDraft({ ...draft, match_days: x })} options={[{ v: 0, l: "same day" }, { v: 1, l: "±1 day" }]} /></P>
          <P l="Day definition" i="UTC day, or local solar day (UTC + longitude/15 h), which keeps each local afternoon/night overpass pair on one calendar day.">
            <Seg value={draft.day_basis} onChange={(x) => setDraft({ ...draft, day_basis: x })} options={[{ v: "utc", l: "UTC" }, { v: "solar", l: "Local solar" }]} /></P>
          <P l="VIIRS platforms" i="Reference: one VIIRS satellite per day (S-NPP, else NOAA-20, else NOAA-21) so that additional satellites launched in 2017/2022 do not inflate activity. All: union of every VIIRS satellite (more observation opportunities, inconsistent over time).">
            <Seg value={draft.viirs_mode} onChange={(x) => setDraft({ ...draft, viirs_mode: x })} options={[{ v: "reference", l: "Reference" }, { v: "all", l: "All" }]} /></P>
          <P l="MODIS platforms" i="Terra launched 2000, Aqua 2002. Aqua-only gives a constant observation schedule from mid-2002 that coincides with the S-NPP 13:30 overpass.">
            <Seg value={draft.modis_mode} onChange={(x) => setDraft({ ...draft, modis_mode: x })} options={[{ v: "all", l: "Terra+Aqua" }, { v: "aqua", l: "Aqua" }, { v: "terra", l: "Terra" }]} /></P>
          <P l="Calibration" i="Seasonal ratio: union/MODIS cell-day ratio per calendar month, shrunk toward the global ratio. Log-linear: robust Theil–Sen fit of log(union) on log(MODIS). None: no cross-sensor calibration (shows the raw step change).">
            <select className="input w-full" value={draft.calibration} onChange={(e) => setDraft({ ...draft, calibration: e.target.value as any })}>
              <option value="seasonal_ratio">Seasonal ratio (shrinkage)</option><option value="loglinear">Log-linear (Theil–Sen)</option><option value="none">None (naive)</option></select></P>
          {draft.calibration === "seasonal_ratio" && <P l={`Shrinkage: ${draft.shrinkage} pseudo-months`} i="Higher values pull month-specific ratios toward the global ratio — more stable for small AOIs with few fires per month.">
            <input type="range" min={0} max={24} step={1} value={draft.shrinkage} onChange={(e) => setDraft({ ...draft, shrinkage: Number(e.target.value) })} className="w-full accent-[#e0552f]" /></P>}
          <P l="Output units" i="VIIRS-era: the series is expressed in MODIS∪VIIRS cell-days, with pre-2012 back-cast. MODIS-equivalent: the series is in MODIS cell-days, and any period after MODIS ends is converted from VIIRS (continuity for MODIS decommissioning).">
            <Seg value={draft.target} onChange={(x) => setDraft({ ...draft, target: x })} options={[{ v: "viirs", l: "VIIRS-era" }, { v: "modis", l: "MODIS-equivalent" }]} /></P>
          <P l={`FAI intensity weight β = ${draft.frp_beta}`} i="FAI = Σ cell-days × w_conf × (1 + β·log10(1 + FRP/10)). β = 0 is detection-only; VIIRS FRP is rescaled to MODIS-equivalent first.">
            <input type="range" min={0} max={1} step={0.05} value={draft.frp_beta} onChange={(e) => setDraft({ ...draft, frp_beta: Number(e.target.value) })} className="w-full accent-[#e0552f]" /></P>
          <P l="Confidence weights (low / nominal / high)" i="Weight of a cell-day in the FAI according to the highest confidence class detected in it.">
            <div className="flex gap-1">{(["low", "nominal", "high"] as const).map((c) => (
              <input key={c} type="number" step={0.1} min={0} max={2} className="input w-full" value={draft.conf_weights[c]}
                onChange={(e) => setDraft({ ...draft, conf_weights: { ...draft.conf_weights, [c]: Number(e.target.value) } })} />))}</div></P>
          <div className="flex gap-2 pt-1">
            <button className="btn-primary flex-1 justify-center" disabled={!dirty} onClick={() => setParams(draft)}><Play size={13} /> Apply</button>
            <button className="btn" onClick={() => { setDraft(DEFAULT_PARAMS); setParams(DEFAULT_PARAMS); }}><RotateCcw size={13} /> Defaults</button>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          {h.error && <ErrorBox error={h.error} />}
          {!d ? <div className="card"><Loading h={400} /></div> : (
            <>
              {d.notes?.length > 0 && <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">{d.notes.join(" ")}</div>}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Metric l="Calibration ratio (global)" v={d.calibration.ratio_global?.toFixed(3)} s={`${d.calibration.n_overlap_months} overlap months`} i="Union cell-days ÷ MODIS cell-days over the overlap era. Multiplies pre-VIIRS MODIS activity into VIIRS-era units." />
                <Metric l="CV annual error (LOYO)" v={cv?.annual_mape_pct != null ? `${cv.annual_mape_pct.toFixed(1)}%` : "–"} s={cv ? `monthly MAPE ${cv.monthly_mape_pct?.toFixed(1)}% · bias ${pct(cv.bias_pct)}` : "insufficient overlap"} i="Leave-one-year-out: each overlap year is predicted from MODIS alone using a model fitted on the other years, then compared with the observed union. This is how wrong the back-cast is expected to be." />
                <Metric l="P(VIIRS | MODIS)" v={v?.p_viirs_given_modis?.toFixed(2) ?? "–"} s={`P(MODIS | VIIRS) ${v?.p_modis_given_viirs?.toFixed(2) ?? "–"}`} i="Detection consistency: fraction of MODIS cell-days that VIIRS also detected (and vice versa) within the match radius. VIIRS sees most MODIS fires; MODIS misses many small VIIRS fires." />
                <Metric l="Naive-sum inflation" v={v?.naive_sum_inflation ? `×${v.naive_sum_inflation.toFixed(2)}` : "–"} s={`VIIRS/MODIS raw pixel ratio ×${v?.raw_viirs_to_modis_detection_ratio?.toFixed(2) ?? "–"}`} i="How much simply adding MODIS and VIIRS detections over-counts activity relative to de-duplicated union cell-days." />
              </div>

              {tr && (
                <ChartCard title="Sensor-transition diagnostic (before vs after harmonisation)" subtitle="Annual totals indexed to the first 3 VIIRS-era years = 100 · complete years only" data={annual}
                  info={<>{tr.interpretation} Step across the VIIRS start ({tr.window}): MODIS-only ×{tr.modis_only_step.toFixed(2)}, raw detections ×{tr.naive_detection_step.toFixed(2)}, uncalibrated stitched ×{tr.stitched_uncalibrated_step.toFixed(2)}, harmonised ×{tr.harmonized_step.toFixed(2)}.</>}>
                  <div className="mb-2 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
                    <Step l="MODIS-only (reference)" v={tr.modis_only_step} c="#94a3b8" />
                    <Step l="Raw detections" v={tr.naive_detection_step} c={COLORS.naive} />
                    <Step l="Uncalibrated stitched" v={tr.stitched_uncalibrated_step} c={COLORS.viirs} />
                    <Step l="Harmonised" v={tr.harmonized_step} c={COLORS.harm} good={Math.abs(tr.harmonized_step / tr.modis_only_step - 1) < 0.15} />
                  </div>
                  <Legend items={[{ color: "#94a3b8", label: "MODIS-only cell-days (reference)", dash: true }, { color: COLORS.naive, label: "Raw detections" }, { color: COLORS.viirs, label: "Uncalibrated stitched" }, { color: COLORS.harm, label: "Harmonised" }]} />
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={annual} margin={{ left: -6, right: 8, top: 8 }}>
                      <CartesianGrid stroke={COLORS.grid} vertical={false} />
                      <XAxis dataKey="year" {...axisProps} />
                      <YAxis {...axisProps} label={{ value: "index", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10, dx: 16 }} />
                      <Tooltip {...tooltipStyle} />
                      <ReferenceLine y={100} stroke="#334155" />
                      <Line dataKey="MODIS-only cell-days (reference)" stroke="#94a3b8" strokeDasharray="5 3" strokeWidth={2} dot={false} isAnimationActive={false} />
                      <Line dataKey="Raw detections (MODIS+VIIRS)" stroke={COLORS.naive} strokeWidth={2} dot={false} isAnimationActive={false} />
                      <Line dataKey="Uncalibrated stitched cell-days" stroke={COLORS.viirs} strokeWidth={2} dot={false} isAnimationActive={false} />
                      <Line dataKey="Harmonised" stroke={COLORS.harm} strokeWidth={2.6} dot={{ r: 2.5 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ChartCard title="Pipeline stages" subtitle="From raw pixels to harmonised activity (full record of the AOI)" data={funnel.map(({ k, v }) => ({ stage: k, value: v }))}>
                  <div className="space-y-1.5">
                    {funnel.map((f) => (
                      <div key={f.k} title={f.t}>
                        <div className="flex justify-between text-[11.5px]"><span className="text-slate-300">{f.k}</span><span className="font-mono text-slate-200">{fmt(f.v)}</span></div>
                        <div className="h-2 rounded bg-ink-900"><div className="h-2 rounded" style={{ width: `${Math.max(0.5, (f.v / Math.max(1, funnel[0].v)) * 100)}%`, background: f.c }} /></div>
                      </div>
                    ))}
                  </div>
                </ChartCard>
                <ChartCard title="Overlap-era calibration fit" subtitle="Monthly MODIS cell-days vs MODIS∪VIIRS union cell-days (log–log)" data={d.overlap_scatter}
                  info="Each point is one overlap month. The dashed line is the fitted global ratio. Tight scatter around the line = reliable back-cast.">
                  <ResponsiveContainer width="100%" height={230}>
                    <ScatterChart margin={{ left: -6, right: 12, top: 6, bottom: 8 }}>
                      <CartesianGrid stroke={COLORS.grid} />
                      <XAxis type="number" dataKey="modis_cd" scale="log" domain={["auto", "auto"]} allowDataOverflow {...axisProps} name="MODIS cell-days" label={{ value: "MODIS cell-days / month", position: "insideBottom", offset: -4, fill: "#64748b", fontSize: 10 }} />
                      <YAxis type="number" dataKey="union_cd" scale="log" domain={["auto", "auto"]} allowDataOverflow {...axisProps} name="Union cell-days" />
                      <ZAxis range={[28, 28]} />
                      <Tooltip {...tooltipStyle} cursor={{ strokeDasharray: "3 3" }} />
                      <Scatter data={d.overlap_scatter.filter((p: any) => p.modis_cd > 0 && p.union_cd > 0)} fill={COLORS.harm} fillOpacity={0.7} isAnimationActive={false} />
                      {d.overlap_scatter.length > 0 && (() => {
                        const xs = d.overlap_scatter.map((p: any) => p.modis_cd).filter((x: number) => x > 0);
                        const lo = Math.min(...xs), hi = Math.max(...xs);
                        return <ReferenceLine segment={[{ x: lo, y: lo * d.calibration.ratio_global }, { x: hi, y: hi * d.calibration.ratio_global }]} stroke="#e2e8f0" strokeDasharray="5 4" ifOverflow="extendDomain" />;
                      })()}
                    </ScatterChart>
                  </ResponsiveContainer>
                </ChartCard>
                <ChartCard title="Calibration ratio by calendar month" subtitle="Union ÷ MODIS cell-days (after shrinkage)" data={ratios}
                  info="Seasonal variation in the ratio reflects fire-size regimes: seasons with many small fires (which MODIS misses) have higher ratios.">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={ratios} margin={{ left: -10, right: 8 }}>
                      <CartesianGrid stroke={COLORS.grid} vertical={false} />
                      <XAxis dataKey="month" {...axisProps} />
                      <YAxis {...axisProps} domain={[0, "auto"]} />
                      <Tooltip {...tooltipStyle} formatter={(x: any) => Number(x).toFixed(3)} />
                      <ReferenceLine y={d.calibration.ratio_global} stroke="#e2e8f0" strokeDasharray="4 3" />
                      <Bar dataKey="ratio" fill={COLORS.harm} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
                <ChartCard title="Leave-one-year-out validation" subtitle="Annual union cell-days: observed vs predicted from MODIS alone" data={cv?.annual || []}
                  info="Hold-out test of the back-cast: if the model can reproduce 2012+ years it has never seen, it is a reasonable estimate of 2000–2011 in the same units (assuming the MODIS/VIIRS relationship is stable).">
                  <Legend items={[{ color: "#94a3b8", label: "Observed (MODIS∪VIIRS)" }, { color: COLORS.harm, label: "Predicted from MODIS" }]} />
                  <ResponsiveContainer width="100%" height={190}>
                    <BarChart data={cv?.annual || []} margin={{ left: -6, right: 8, top: 6 }} barGap={2}>
                      <CartesianGrid stroke={COLORS.grid} vertical={false} />
                      <XAxis dataKey="year" {...axisProps} />
                      <YAxis {...axisProps} />
                      <Tooltip {...tooltipStyle} formatter={(x: any) => fmt(x, 0)} />
                      <Bar dataKey="observed" fill="#94a3b8" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                      <Bar dataKey="predicted" fill={COLORS.harm} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              <ChartCard title="Raw vs normalised vs harmonised" subtitle="Monthly series for the full record" data={d.monthly}
                actions={<Seg value={series} onChange={setSeries} options={[{ v: "raw", l: "Raw detections" }, { v: "normalized", l: "Normalised (cell-days)" }, { v: "harmonized", l: "Harmonised" }]} />}
                info="Raw = satellite pixels. Normalised = each sensor de-duplicated to cell-days (removes multi-pixel and repeat-overpass effects) but still sensor-specific. Harmonised = de-duplicated across sensors and calibrated into one continuous series.">
                <Legend items={seriesKeys.map(([, l, c]) => ({ color: c as string, label: l as string }))} />
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={d.monthly} margin={{ left: -6, right: 8, top: 6 }}>
                    <CartesianGrid stroke={COLORS.grid} vertical={false} />
                    <XAxis dataKey="date" {...axisProps} minTickGap={36} />
                    <YAxis {...axisProps} />
                    <Tooltip {...tooltipStyle} formatter={(x: any) => fmt(x, 1)} />
                    {series === "harmonized" && <Area dataKey="harm_hi" stroke="none" fill={COLORS.harm} fillOpacity={0.15} isAnimationActive={false} name="Upper bound" />}
                    {seriesKeys.map(([k, l, c]) => <Line key={k as string} dataKey={k as string} name={l as string} stroke={c as string} dot={false} strokeWidth={1.8} isAnimationActive={false} />)}
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ChartCard title="Harmonisation status of detections" subtitle="Every detection carries this label in the map popup and exports" data={Object.entries(d.status_counts).map(([k, n]) => ({ status: k, n }))}>
                  <table className="data"><tbody>{Object.entries(d.status_counts).map(([k, n]: any) => <tr key={k}><td>{k}</td><td className="text-right font-mono">{fmt(n)}</td></tr>)}</tbody></table>
                </ChartCard>
                <ChartCard title="Validation statistics" subtitle="Internal consistency checks — not independent ground truth" data={[{ ...v, ...(cv || {}) }]}>
                  <table className="data"><tbody>
                    <tr><td>Overlap months / days</td><td className="text-right font-mono">{d.calibration.n_overlap_months} / {v.overlap_days}</td></tr>
                    <tr><td>Pearson r (monthly MODIS vs union)</td><td className="text-right font-mono">{v.pearson_r_monthly?.toFixed(3) ?? "–"}</td></tr>
                    <tr><td>Spearman ρ</td><td className="text-right font-mono">{v.spearman_rho_monthly?.toFixed(3) ?? "–"}</td></tr>
                    <tr><td>LOYO R² (log monthly)</td><td className="text-right font-mono">{cv?.r2_log?.toFixed(3) ?? "–"}</td></tr>
                    <tr><td>LOYO median monthly error</td><td className="text-right font-mono">{cv?.monthly_median_ape_pct?.toFixed(1) ?? "–"}%</td></tr>
                    <tr><td>Uncertainty band (P10–P90 multiplicative)</td><td className="text-right font-mono">{d.calibration.cv_ratio_quantiles ? `×${d.calibration.cv_ratio_quantiles.p10.toFixed(2)} – ×${d.calibration.cv_ratio_quantiles.p90.toFixed(2)}` : "–"}</td></tr>
                    <tr><td>Detections per cell-day (MODIS / VIIRS)</td><td className="text-right font-mono">{v.detections_per_cell_day.MODIS?.toFixed(2) ?? "–"} / {v.detections_per_cell_day.VIIRS?.toFixed(2) ?? "–"}</td></tr>
                    <tr><td>FRP scale VIIRS→MODIS (median, IQR)</td><td className="text-right font-mono">×{d.calibration.frp_scale_viirs_to_modis.toFixed(2)} {d.calibration.frp_scale_iqr ? `(${d.calibration.frp_scale_iqr[0].toFixed(2)}–${d.calibration.frp_scale_iqr[1].toFixed(2)})` : ""}</td></tr>
                    <tr><td>Co-located cell-day pairs</td><td className="text-right font-mono">{fmt(d.calibration.n_colocated_cell_days)}</td></tr>
                  </tbody></table>
                </ChartCard>
              </div>

              <ChartCard title="Sensitivity analysis" subtitle="How grid size and match radius change detection consistency, calibration and hold-out error" data={sens.data?.runs}
                actions={<button className="btn" onClick={() => setSensBody(body())} disabled={sens.loading}>{sens.loading ? "Running 15 configurations…" : "Run sensitivity analysis"}</button>}>
                {sens.error && <ErrorBox error={sens.error} />}
                {!sens.data ? <div className="py-6 text-center text-xs text-slate-500">{sens.loading ? <Loading h={80} label="Re-running the pipeline 15 times…" /> : "Runs the full pipeline for grid ∈ {0.005, 0.01, 0.025, 0.05, 0.1}° × match radius ∈ {1, 2, 4} km."}</div> : (
                  <div className="overflow-x-auto"><table className="data">
                    <thead><tr><th>Grid (°)</th><th>Match (km)</th><th>P(VIIRS|MODIS)</th><th>Global ratio</th><th>LOYO monthly MAPE</th><th>LOYO annual MAPE</th><th>Transition step</th><th>Total harmonised</th></tr></thead>
                    <tbody>{sens.data.runs.map((r: any, i: number) => (
                      <tr key={i} className={r.grid_deg === params.grid_deg && r.match_km === params.match_km ? "bg-harm/10" : ""}>
                        <td className="font-mono">{r.grid_deg}</td><td className="font-mono">{r.match_km}</td><td className="font-mono">{r.p_viirs_given_modis?.toFixed(3) ?? "–"}</td>
                        <td className="font-mono">{r.ratio_global?.toFixed(3)}</td><td className="font-mono">{r.cv_monthly_mape_pct?.toFixed(1) ?? "–"}%</td>
                        <td className="font-mono">{r.cv_annual_mape_pct?.toFixed(1) ?? "–"}%</td><td className="font-mono">{r.harmonized_step ? `×${r.harmonized_step.toFixed(2)}` : "–"}</td>
                        <td className="font-mono">{fmt(r.total_harmonized)}</td></tr>))}</tbody>
                  </table></div>
                )}
              </ChartCard>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function P({ l, i, children }: { l: string; i: string; children: React.ReactNode }) {
  return <div className="space-y-1"><div className="label flex items-center gap-1">{l}<InfoTip text={i} /></div>{children}</div>;
}
function Metric({ l, v, s, i }: { l: string; v: any; s?: string; i: string }) {
  return <div className="card p-3"><div className="label flex items-center gap-1">{l}<InfoTip text={i} /></div><div className="mt-1 font-mono text-xl text-white">{v}</div>{s && <div className="mt-0.5 text-[11px] text-slate-400">{s}</div>}</div>;
}
function Step({ l, v, c, good }: { l: string; v: number; c: string; good?: boolean }) {
  return <div className="rounded-lg border border-ink-700 bg-ink-900 p-2"><div className="flex items-center gap-1.5 text-slate-400"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{l}</div>
    <div className="mt-0.5 font-mono text-base text-white">×{v.toFixed(2)} {good && <span className="text-[10px] text-emerald-400">✓ consistent</span>}</div></div>;
}
