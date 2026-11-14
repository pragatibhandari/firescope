import React, { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, Bar, BarChart, Cell, ReferenceLine } from "recharts";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import clsx from "clsx";
import { useApi } from "../lib/api";
import { useStore } from "../lib/store";
import { COLORS, MONTHS, SEVERITY_COLORS, fmt, pct } from "../lib/format";
import { ChartCard, Empty, ErrorBox, Legend, Loading, PageHeader, Seg, axisProps, tooltipStyle } from "../components/ui";
import FireMap from "../components/FireMap";
import { aoiBbox, aoiGeometry, useRegions } from "./MapPage";

export default function AnomaliesPage() {
  const { body, filters } = useStore();
  useRegions();
  const [method, setMethod] = useState<"robust_z" | "zscore" | "iqr">("robust_z");
  const [threshold, setThreshold] = useState(2);
  const [minValue, setMinValue] = useState(5);
  const [refYears, setRefYears] = useState<number | null>(null);
  const [sel, setSel] = useState<any>(null);
  const a = useApi<any>("/api/anomalies", body({ anomaly: { method, threshold, min_value: minValue, ref_years: refYears } }));
  const d = a.data;
  const alert = sel || d?.alerts?.[0];
  const m = alert ? Number(alert.period.slice(5, 7)) : null;
  const y = alert ? Number(alert.period.slice(0, 4)) : null;
  const sameMonth = useMemo(() => (d && m ? d.series.filter((s: any) => Number(s.date.slice(5, 7)) === m).map((s: any) => ({ ...s, year: s.date.slice(0, 4) })) : []), [d, m]);
  const last = alert ? new Date(Date.UTC(y!, m!, 0)).getUTCDate() : 0;
  const pts = useApi<any>(alert ? "/api/points" : null, { ...body(), filters: { ...filters, start: alert?.period + "-01", end: `${alert?.period}-${last}` }, limit: 8000 });
  const series = useMemo(() => (d ? d.series.filter((s: any) => s.date >= filters.start.slice(0, 7) && s.date <= filters.end.slice(0, 7)) : []), [d, filters.start, filters.end]);
  const longSeries = series.length < 18 && d ? d.series.filter((s: any) => s.date <= filters.end.slice(0, 7)).slice(-60) : series;

  return (
    <div className="space-y-4">
      <PageHeader title="Anomaly Detection & Early Warning" desc="Identifies months and days whose harmonised activity departs from this area's own historical baseline for the same time of year." />
      <div className="flex items-start gap-2 rounded-lg border border-sky-900/50 bg-sky-950/30 px-3 py-2 text-xs text-sky-200">
        <Info size={14} className="mt-0.5 shrink-0" />{d?.disclaimer || "Anomalies are retrospective and are not fire forecasts."}
      </div>
      <div className="card flex flex-wrap items-end gap-5 p-3">
        <div><div className="label mb-1">Method</div><Seg value={method} onChange={setMethod} options={[{ v: "robust_z", l: "Robust z (median/MAD)" }, { v: "zscore", l: "Z-score" }, { v: "iqr", l: "IQR" }]} /></div>
        <div><div className="label mb-1">Threshold: {threshold.toFixed(1)}</div><input type="range" min={1} max={5} step={0.5} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="w-36 accent-[#e0552f]" /></div>
        <div><div className="label mb-1">Min. activity (cell-days)</div><input type="number" className="input w-24" value={minValue} onChange={(e) => setMinValue(Number(e.target.value))} /></div>
        <div><div className="label mb-1">Baseline years</div><Seg value={refYears ?? 0} onChange={(v) => setRefYears(v || null)} options={[{ v: 0, l: "All other years" }, { v: 10, l: "Previous 10" }, { v: 5, l: "Previous 5" }]} /></div>
        <div className="text-[11px] text-slate-500">Severity: moderate ≥ 2, high ≥ 3, extreme ≥ 4 (score units). Out-of-season burning is flagged when the month normally has near-zero activity.</div>
      </div>
      {a.error && <ErrorBox error={a.error} />}
      {!d ? <div className="card"><Loading h={300} /></div> : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
          <div className="card flex max-h-[880px] flex-col p-3">
            <div className="card-h mb-2 flex items-center gap-1.5"><ShieldAlert size={14} className="text-harm" />Alerts in selected period ({d.alerts.length}) <span className="text-[11px] font-normal text-slate-500">· {d.all_alert_count} in full record</span></div>
            <div className="space-y-2 overflow-y-auto pr-1">
              {d.alerts.length === 0 && <Empty text="No anomalous months in the selected period. Widen the date range or lower the threshold." />}
              {d.alerts.map((x: any) => (
                <button key={x.id} onClick={() => setSel(x)} className={clsx("w-full rounded-lg border p-2.5 text-left transition", alert?.id === x.id ? "border-harm bg-harm/10" : "border-ink-700 bg-ink-900 hover:border-ink-500")}>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-100"><AlertTriangle size={12} style={{ color: SEVERITY_COLORS[x.severity] }} />{x.period} · {x.type}</span>
                    <span className="rounded px-1.5 py-px text-[10px] font-bold uppercase" style={{ background: SEVERITY_COLORS[x.severity] + "22", color: SEVERITY_COLORS[x.severity] }}>{x.severity}</span>
                  </div>
                  <div className="mt-1 text-[11.5px] leading-snug text-slate-300">{x.message}</div>
                  <div className="mt-1.5 grid grid-cols-4 gap-1 text-[10.5px] text-slate-400">
                    <span>Obs <b className="font-mono text-slate-200">{fmt(x.observed)}</b></span><span>Base <b className="font-mono text-slate-200">{fmt(x.baseline_median)}</b></span>
                    <span>Dev <b className="font-mono text-slate-200">{pct(x.deviation_pct, 0)}</b></span><span>Score <b className="font-mono text-slate-200">{x.score}</b></span>
                  </div>
                  {x.calibrated_period && <div className="mt-1 text-[10px] text-slate-500">Pre-VIIRS month (calibrated MODIS) — wider uncertainty.</div>}
                </button>
              ))}
            </div>
          </div>
          <div className="min-w-0 space-y-4">
            <ChartCard title="Monthly activity vs historical baseline" subtitle="Band = baseline mean ± 2σ for the same calendar month in reference years; red markers = flagged months" data={longSeries}>
              <Legend items={[{ color: COLORS.harm, label: "Observed (harmonised)" }, { color: "#e2e8f0", label: "Baseline median", dash: true }, { color: "#64748b", label: "Mean ± 2σ" }, { color: "#ff4d4f", label: "Flagged" }]} />
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={longSeries.map((s: any) => ({ ...s, band: s.lo != null ? [s.lo, s.hi] : null, flagged: s.flag ? s.value : null }))} margin={{ left: -6, right: 8, top: 6 }}>
                  <CartesianGrid stroke={COLORS.grid} vertical={false} />
                  <XAxis dataKey="date" {...axisProps} minTickGap={30} />
                  <YAxis {...axisProps} />
                  <Tooltip {...tooltipStyle} formatter={(v: any) => (Array.isArray(v) ? `${fmt(v[0], 1)}–${fmt(v[1], 1)}` : fmt(v, 1))} />
                  <Area dataKey="band" fill="#64748b" fillOpacity={0.25} stroke="none" name="Mean ± 2σ" isAnimationActive={false} />
                  <Line dataKey="baseline" stroke="#e2e8f0" strokeDasharray="4 3" dot={false} strokeWidth={1.5} name="Median" isAnimationActive={false} />
                  <Line dataKey="value" stroke={COLORS.harm} strokeWidth={2} dot={false} name="Observed" isAnimationActive={false} />
                  <Scatter dataKey="flagged" fill="#ff4d4f" name="Flagged" isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>
            {alert && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ChartCard title={`Supporting chart · ${MONTHS[m! - 1]} in every year`} subtitle="The flagged year against the same month in all other years" data={sameMonth}>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={sameMonth} margin={{ left: -6, right: 8, top: 6 }}>
                      <CartesianGrid stroke={COLORS.grid} vertical={false} />
                      <XAxis dataKey="year" {...axisProps} minTickGap={10} />
                      <YAxis {...axisProps} />
                      <Tooltip {...tooltipStyle} formatter={(v: any) => fmt(v, 1)} />
                      <ReferenceLine y={alert.baseline_median} stroke="#e2e8f0" strokeDasharray="4 3" label={{ value: "median", fill: "#94a3b8", fontSize: 10, position: "right" }} />
                      <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                        {sameMonth.map((s: any) => <Cell key={s.year} fill={Number(s.year) === y ? "#ff4d4f" : s.calibrated ? "#475569" : "#94a3b8"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
                <ChartCard title={`Supporting map · ${alert.period}`} subtitle={pts.data ? `${fmt(pts.data.total)} detections in ${alert.area}` : "Loading…"}>
                  <FireMap height={260} points={pts.data} mode="combined" heat aoiGeom={aoiGeometry(filters.aoi)} fitTo={aoiBbox(filters.aoi)} />
                </ChartCard>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ChartCard title="Daily early-warning indicator" subtitle="Rolling 7-day harmonised activity vs the same 7-day window in other years (last 120 days of range)" data={d.daily_series}
                info="A rising score while the season is under way means activity is outpacing the historical norm for this time of year. It is a monitoring indicator, not a prediction.">
                {d.daily_series.length ? (
                  <ResponsiveContainer width="100%" height={210}>
                    <ComposedChart data={d.daily_series} margin={{ left: -6, right: 8, top: 6 }}>
                      <CartesianGrid stroke={COLORS.grid} vertical={false} />
                      <XAxis dataKey="date" {...axisProps} minTickGap={30} />
                      <YAxis {...axisProps} />
                      <Tooltip {...tooltipStyle} />
                      <Area dataKey="baseline7" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.15} name="Baseline 7-day" isAnimationActive={false} />
                      <Line dataKey="value7" stroke={COLORS.harm} strokeWidth={2} dot={false} name="Observed 7-day" isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : <Empty />}
                {d.daily_alerts.length > 0 && <div className="mt-2 text-[11px] text-orange-300">{d.daily_alerts.length} days exceeded the daily threshold (latest {d.daily_alerts[d.daily_alerts.length - 1].date}, {pct(d.daily_alerts[d.daily_alerts.length - 1].deviation_pct, 0)} vs baseline).</div>}
              </ChartCard>
              <div className="card space-y-3 p-4">
                <div className="card-h">Structural changes & multivariate outliers</div>
                <div>
                  <div className="label mb-1">Change points (annual totals, binary segmentation)</div>
                  {d.change_points.length ? d.change_points.map((c: any) => <div key={c.year} className="text-[12px] text-slate-300">From <b className="font-mono">{c.year}</b>: mean level {fmt(c.mean_before)} → {fmt(c.mean_after)} cell-days/yr</div>) : <div className="text-xs text-slate-500">No significant shift in annual level detected.</div>}
                </div>
                <div>
                  <div className="label mb-1">Isolation Forest (activity, intensity, seasonality)</div>
                  <div className="flex flex-wrap gap-1">{d.isolation_forest.map((i: any) => <span key={i.date} className="chip font-mono">{i.date}</span>)}{!d.isolation_forest.length && <span className="text-xs text-slate-500">Not enough months.</span>}</div>
                  <div className="mt-1 text-[11px] text-slate-500">Months whose combination of activity level, mean FRP per cell-day and season is unusual (3% contamination). Useful to spot intense-but-not-numerous events.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
