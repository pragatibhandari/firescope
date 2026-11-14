import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { GitCompare, Plus, X } from "lucide-react";
import { useApi } from "../lib/api";
import { useStore } from "../lib/store";
import { COLORS, MONTHS, fmt } from "../lib/format";
import { ChartCard, ErrorBox, Legend, Loading, PageHeader, axisProps, tooltipStyle } from "../components/ui";
import FireMap from "../components/FireMap";
import { aoiBbox, aoiGeometry, useRegions } from "./MapPage";

const P_COLORS = [COLORS.harm, COLORS.modis, COLORS.viirs, COLORS.naive];

export default function HistoryPage() {
  const { body, filters } = useStore();
  useRegions();
  const [periods, setPeriods] = useState<{ start: string; end: string }[]>([
    { start: "2005-01-01", end: "2009-12-31" }, { start: "2020-01-01", end: "2024-12-31" }]);
  const [cmp, setCmp] = useState<any[] | null>(null);
  const h = useApi<any>("/api/history", body({ compare: cmp }));
  const rec = useApi<any>("/api/recurrence", body());
  const d = h.data;
  const box = useMemo(() => d?.monthly_box.map((b: any) => ({ ...b, base: b.p25, iqr: b.p75 - b.p25 })) || [], [d]);
  const evKeys = d?.event_structure?.length ? Object.keys(d.event_structure[0]).filter((k) => k !== "year") : [];
  const profile = d?.comparison ? MONTHS.map((m, i) => Object.fromEntries([["month", m], ...d.comparison.map((p: any) => [p.label, p.monthly_profile[i]])])) : [];

  if (h.error) return <ErrorBox error={h.error} />;
  if (!d) return <div className="card"><Loading h={400} /></div>;
  const mk = d.trend_test.harmonized, mkm = d.trend_test.modis_only;
  return (
    <div className="space-y-4">
      <PageHeader title="Historical Fire Pattern Analysis" desc="Long-term behaviour of burning in the selected area, computed on the harmonised record so that changes are not artefacts of the MODIS→VIIRS transition. Each panel explains how to read it." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartCard className="xl:col-span-2" title="Long-term annual trend" subtitle="Harmonised cell-days per complete year (grey = calibrated MODIS era) and MODIS-only cell-days" data={d.annual}
          info="Bars are the harmonised series. The MODIS-only line is a single-sensor record and serves as an independent check on the direction of the trend.">
          <Legend items={[{ color: COLORS.harm, label: "Harmonised" }, { color: COLORS.modis, label: "MODIS-only cell-days" }]} />
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={d.annual.filter((a: any) => d.full_years.includes(a.year))} margin={{ left: -6, right: 8, top: 6 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="year" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip {...tooltipStyle} formatter={(v: any) => fmt(v, 0)} />
              <Bar dataKey="harmonized" name="Harmonised" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {d.annual.filter((a: any) => d.full_years.includes(a.year)).map((a: any) => <Cell key={a.year} fill={a.calibrated ? "#64748b" : COLORS.harm} />)}
              </Bar>
              <Line dataKey="modis_cd" name="MODIS-only cell-days" stroke={COLORS.modis} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
        <div className="card space-y-3 p-4">
          <div className="card-h">Trend significance</div>
          <p className="text-[11.5px] text-slate-400">{d.trend_test.method}. p &lt; 0.05 indicates a monotonic trend unlikely to be due to chance; Sen's slope is the median year-to-year change.</p>
          {[["Harmonised series", mk], ["MODIS-only (check)", mkm]].map(([l, m]: any) => (
            <div key={l} className="rounded-lg border border-ink-700 bg-ink-900 p-3">
              <div className="label">{l}</div>
              {m?.trend ? <>
                <div className={`mt-1 text-base font-semibold ${m.trend === "increasing" ? "text-orange-300" : m.trend === "decreasing" ? "text-sky-300" : "text-slate-200"}`}>{m.trend}</div>
                <div className="mt-1 font-mono text-[11.5px] text-slate-300">z = {m.z} · p = {m.p_value}<br />Sen slope {fmt(m.sen_slope_per_year, 1)} /yr ({m.sen_slope_pct_of_mean}% of mean)</div>
              </> : <div className="text-xs text-slate-500">Needs ≥ 4 complete years.</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard title="Monthly distribution across years" subtitle="Box = P25–P75 of harmonised cell-days, white tick = median, dot = maximum year" data={d.monthly_box}
          info="Wide boxes mean that month varies a lot between years. A max dot far above the box marks an exceptional year for that month.">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={box} margin={{ left: -6, right: 8, top: 6 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="month" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip {...tooltipStyle} formatter={(v: any, n: any) => (n === "base" ? null : fmt(v, 1)) as any} />
              <Bar dataKey="base" stackId="b" fill="transparent" isAnimationActive={false} />
              <Bar dataKey="iqr" stackId="b" fill={COLORS.harm} fillOpacity={0.55} name="IQR (P75–P25)" radius={[3, 3, 3, 3]} isAnimationActive={false} />
              <Line dataKey="median" stroke="#fff" strokeWidth={0} dot={{ r: 0 }} activeDot={false} name="Median" isAnimationActive={false}
                label={({ x, y }: any) => <line x1={x - 9} x2={x + 9} y1={y} y2={y} stroke="#fff" strokeWidth={2} />} />
              <Scatter dataKey="max" fill="#fca50a" name="Max" isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Time-series decomposition" subtitle="log(1 + monthly harmonised) = trend + seasonal + residual (additive, 12-month centred moving average)" data={d.decomposition}
          info="Trend: slow multi-year change. Seasonal: the repeating annual cycle. Residual: what is left — large residuals are unusual months (see Anomaly Detection).">
          {(["trend", "seasonal", "residual"] as const).map((k, i) => (
            <div key={k}>
              <div className="label mt-1">{k}</div>
              <ResponsiveContainer width="100%" height={68}>
                <LineChart data={d.decomposition} margin={{ left: -6, right: 8, top: 2, bottom: 0 }}>
                  <XAxis dataKey="date" hide={i < 2} {...axisProps} minTickGap={50} />
                  <YAxis {...axisProps} width={40} tickFormatter={(v) => Number(v).toFixed(1)} />
                  <Tooltip {...tooltipStyle} formatter={(v: any) => Number(v).toFixed(3)} />
                  <Line dataKey={k} stroke={[COLORS.harm, COLORS.modis, COLORS.viirs][i]} dot={false} strokeWidth={1.6} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </ChartCard>

        <ChartCard title="Fire-season timing per year" subtitle="Season = months between 10% and 90% of the year's cumulative activity" data={d.season}
          info="Shifts in peak month or lengthening seasons are early signals of changing fire regimes (climate or land-use).">
          <div className="max-h-[260px] overflow-y-auto">
            <table className="data"><thead><tr><th>Year</th><th>Peak</th><th>Start (10%)</th><th>End (90%)</th><th>Length</th><th>Peak share</th></tr></thead>
              <tbody>{d.season.map((s: any) => <tr key={s.year}><td className="font-mono">{s.year}</td><td>{s.peak_month}</td><td>{s.start_10pct}</td><td>{s.end_90pct}</td><td className="font-mono">{s.length_months} mo</td><td className="font-mono">{s.peak_share_pct}%</td></tr>)}</tbody></table>
          </div>
        </ChartCard>
        <ChartCard title="Burn-event structure (agricultural vs wildfire indicator)" subtitle="Estimated events per year by size class — heuristic, not a land-cover classification" data={d.event_structure}
          info="Agricultural and management burns are typically small and short (1–2 cell-days); wildfires tend to be large or persistent. Hotspots alone cannot separate burn types reliably — combine with land-cover data for attribution.">
          <Legend items={evKeys.map((k, i) => ({ color: ["#5ad19a", COLORS.harm, COLORS.viirs][i % 3], label: k }))} />
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={d.event_structure} margin={{ left: -6, right: 8, top: 6 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="year" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip {...tooltipStyle} />
              {evKeys.map((k, i) => <Bar key={k} dataKey={k} stackId="e" fill={["#5ad19a", COLORS.harm, COLORS.viirs][i % 3]} isAnimationActive={false} />)}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Historical hotspot recurrence" subtitle={rec.data ? `Share of ${rec.data.n_years} years in which each ${rec.data.cell_deg}° cell had detections` : "…"}
          info="Cells burning almost every year are chronic burning areas (often agricultural or managed savanna); cells burning rarely indicate episodic wildfire.">
          <FireMap height={300} mode="density" recurrence={rec.data} aoiGeom={aoiGeometry(filters.aoi)} fitTo={aoiBbox(filters.aoi)} />
        </ChartCard>
        <ChartCard title="Geographic ranking" subtitle="Countries / regions by raw detections over the full record (top 20)" data={d.country_ranking}>
          <div className="max-h-[300px] overflow-y-auto">
            <table className="data"><thead><tr><th>#</th><th>Country</th><th className="text-right">Detections</th><th className="text-right">Mean FRP (MW)</th><th className="text-right">Max FRP</th></tr></thead>
              <tbody>{d.country_ranking.map((c: any, i: number) => <tr key={c.country}><td>{i + 1}</td><td>{c.country}</td><td className="text-right font-mono">{fmt(c.detections)}</td><td className="text-right font-mono">{c.frp_mean}</td><td className="text-right font-mono">{fmt(c.frp_max)}</td></tr>)}</tbody></table>
          </div>
        </ChartCard>
      </div>

      <ChartCard title="Period comparison" subtitle="Compare two or more periods side by side (harmonised units, so pre- and post-2012 periods are comparable)" data={d.comparison}
        actions={<button className="btn-primary" onClick={() => setCmp(periods.map((p) => ({ ...p, label: `${p.start.slice(0, 4)}–${p.end.slice(0, 4)}` })))}><GitCompare size={13} /> Compare</button>}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {periods.map((p, i) => (
            <div key={i} className="flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-900 px-2 py-1">
              <span className="h-2 w-2 rounded-full" style={{ background: P_COLORS[i] }} />
              <input type="date" className="input !py-0.5" value={p.start} onChange={(e) => setPeriods(periods.map((q, j) => (j === i ? { ...q, start: e.target.value } : q)))} />
              <span className="text-slate-500">→</span>
              <input type="date" className="input !py-0.5" value={p.end} onChange={(e) => setPeriods(periods.map((q, j) => (j === i ? { ...q, end: e.target.value } : q)))} />
              {periods.length > 2 && <X size={13} className="cursor-pointer text-slate-500" onClick={() => setPeriods(periods.filter((_, j) => j !== i))} />}
            </div>
          ))}
          {periods.length < 4 && <button className="btn" onClick={() => setPeriods([...periods, { start: filters.start, end: filters.end }])}><Plus size={12} /> Period</button>}
        </div>
        {d.comparison ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <table className="data"><thead><tr><th>Period</th><th className="text-right">Harmonised</th><th className="text-right">Per day</th><th className="text-right">Raw detections</th><th>Peak day</th></tr></thead>
              <tbody>{d.comparison.map((p: any, i: number) => <tr key={i}><td><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: P_COLORS[i] }} />{p.label}</td>
                <td className="text-right font-mono">{fmt(p.harmonized)}</td><td className="text-right font-mono">{fmt(p.per_day, 2)}</td><td className="text-right font-mono">{fmt(p.detections)}</td><td className="font-mono">{p.peak_day || "–"}</td></tr>)}</tbody></table>
            <div>
              <Legend items={d.comparison.map((p: any, i: number) => ({ color: P_COLORS[i], label: p.label }))} />
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={profile} margin={{ left: -6, right: 8, top: 6 }}>
                  <CartesianGrid stroke={COLORS.grid} vertical={false} />
                  <XAxis dataKey="month" {...axisProps} /><YAxis {...axisProps} />
                  <Tooltip {...tooltipStyle} formatter={(v: any) => fmt(v, 0)} />
                  {d.comparison.map((p: any, i: number) => <Line key={p.label} dataKey={p.label} stroke={P_COLORS[i]} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />)}
                </LineChart>
              </ResponsiveContainer>
              <div className="text-[11px] text-slate-500">Monthly profile: total harmonised cell-days per calendar month within each period.</div>
            </div>
          </div>
        ) : <div className="text-xs text-slate-500">Choose periods and press Compare.</div>}
      </ChartCard>
    </div>
  );
}
