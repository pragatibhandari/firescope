import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, MapPin } from "lucide-react";
import clsx from "clsx";
import { useApi } from "../lib/api";
import { useStore } from "../lib/store";
import { CLASS_COLORS, CLASS_NAMES, COLORS, MONTHS, fmt, pct } from "../lib/format";
import { ChartCard, Empty, ErrorBox, Legend, Loading, PageHeader, Seg, axisProps, tooltipStyle } from "../components/ui";
import { ClassLegend, DailyGrid, MonthMatrix, StripCalendar } from "../components/Calendar";
import FireMap from "../components/FireMap";
import { aoiGeometry } from "./MapPage";

type View = "monthly" | "daily" | "weekly" | "yearly" | "seasonal" | "compare";
const YEAR_COLORS = [COLORS.harm, COLORS.modis, COLORS.viirs, COLORS.naive];

export default function CalendarPage() {
  const { body, filters, setFilters, selectedDate, setSelectedDate } = useStore();
  const [view, setView] = useState<View>("monthly");
  const [metric, setMetric] = useState<"harmonized" | "fai" | "naive_sum">("harmonized");
  const cal = useApi<any>("/api/calendar", body({ metric }));
  const nav = useNavigate();
  const [cmpYears, setCmpYears] = useState<number[]>([]);
  const [selMonth, setSelMonth] = useState<{ year: number; month: number } | null>(null);

  const years: number[] = useMemo(() => (cal.data ? Array.from(new Set<number>(cal.data.matrix.map((m: any) => m.year))).sort() : []), [cal.data]);
  const endYear = Number(filters.end.slice(0, 4));
  const cy = cmpYears.length ? cmpYears : years.length ? [years.includes(endYear) ? endYear : years[years.length - 1]] : [];
  const profile = useMemo(() => {
    if (!cal.data) return [];
    return cal.data.month_baseline.map((b: any) => {
      const row: any = { month: b.month, p25: b.p25, band: [b.p25, b.p75], median: b.median };
      cy.forEach((y) => { row[String(y)] = cal.data.matrix.find((m: any) => m.year === y && m.month === b.m)?.value ?? null; });
      return row;
    });
  }, [cal.data, cy.join(",")]);

  const selectMonth = (y: number, m: number) => {
    setSelMonth({ year: y, month: m });
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    setFilters({ start: `${y}-${String(m).padStart(2, "0")}-01`, end: `${y}-${String(m).padStart(2, "0")}-${last}` });
    setSelectedDate(null);
    setView("daily");
  };
  const unit = metric === "naive_sum" ? "raw detections (NOT harmonised)" : metric === "fai" ? "Fire Activity Index" : "harmonised cell-days";

  return (
    <div className="space-y-4">
      <PageHeader title="Burning Activity Calendar"
        desc="A sensor-independent calendar of hotspot activity from the start of the MODIS record to the present. Click a month to focus the whole platform on it; click a day to inspect it and update the map and statistics."
        right={<div className="flex items-center gap-2"><span className="label">Metric</span>
          <Seg value={metric} onChange={setMetric} options={[{ v: "harmonized", l: "Harmonised" }, { v: "fai", l: "FAI" }, { v: "naive_sum", l: "Raw detections" }]} /></div>} />
      {metric === "naive_sum" && <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">Raw MODIS + VIIRS detection counts are shown for comparison only: they jump in 2012 (VIIRS start), 2018 (NOAA-20) and 2023 (NOAA-21) for reasons unrelated to fire.</div>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Seg value={view} onChange={setView} options={[{ v: "monthly", l: "Monthly (multi-year)" }, { v: "daily", l: "Daily" }, { v: "weekly", l: "Weekly" }, { v: "yearly", l: "Yearly" }, { v: "seasonal", l: "Seasonal" }, { v: "compare", l: "Multi-year comparison" }]} />
        {cal.data && <ClassLegend thresholds={view === "monthly" ? cal.data.thresholds.monthly : view === "daily" ? cal.data.thresholds.daily : undefined} unit={unit} />}
      </div>
      {cal.error && <ErrorBox error={cal.error} />}
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4 min-w-0">
          {!cal.data ? <div className="card"><Loading h={420} /></div> : (
            <>
              {view === "monthly" && (
                <ChartCard title="Monthly burning calendar — full record" subtitle={<>Rows = years, columns = months. Dashed outline = pre-VIIRS months (calibrated MODIS). Class breaks = quantiles of this AOI's own record. {cal.data.class_method}</>}
                  data={cal.data.matrix} info="This is the core deliverable: a consistent time series where the sensor of origin no longer matters, so 2003 can be compared with 2023. Hover for baseline comparison and rank.">
                  <MonthMatrix matrix={cal.data.matrix} onSelect={selectMonth} selected={selMonth} />
                </ChartCard>
              )}
              {view === "daily" && (
                <ChartCard title="Daily burning calendar" subtitle={`${filters.start} → ${filters.end} · click a day to inspect`} data={cal.data.daily}>
                  {cal.data.daily.length ? <DailyGrid days={cal.data.daily} onSelect={setSelectedDate} selected={selectedDate} /> : <Empty />}
                </ChartCard>
              )}
              {view === "weekly" && (
                <ChartCard title="Weekly burning calendar" subtitle="ISO weeks (Monday start) in the selected period" data={cal.data.weekly}>
                  <StripCalendar items={cal.data.weekly.map((w: any) => ({ key: w.week_start, label: `Week of ${w.week_start}`, value: w.value, class: w.class, sub: `MODIS ${w.modis_det} · VIIRS ${w.viirs_det} detections` }))}
                    onSelect={(k) => setSelectedDate(k)} />
                </ChartCard>
              )}
              {view === "yearly" && (
                <ChartCard title="Yearly burning calendar" subtitle="Annual harmonised totals; classes relative to this AOI's annual distribution" data={cal.data.yearly}>
                  <StripCalendar items={cal.data.yearly.map((y: any) => ({ key: String(y.year), label: String(y.year), value: y.value, class: y.class, sub: y.pct_of_median != null ? `${fmt(y.pct_of_median, 0)}% of the median year` : undefined }))}
                    onSelect={(k) => setFilters({ start: `${k}-01-01`, end: `${k}-12-31` })} />
                  <div className="mt-2 flex flex-wrap gap-x-2 text-[10px] text-slate-500">{cal.data.yearly.map((y: any) => <span key={y.year} className="font-mono">{y.year}</span>)}</div>
                </ChartCard>
              )}
              {view === "seasonal" && <SeasonGrid rows={cal.data.seasonal} />}
              {(view === "compare" || view === "monthly") && (
                <ChartCard title="Year vs historical baseline" subtitle="Monthly profile of the chosen year(s) against the multi-year median and interquartile range (P25–P75)" data={profile}
                  info="Answers the emergency-manager question: is this month burning more than usual for this place?"
                  actions={<select className="input" value="" onChange={(e) => { const y = Number(e.target.value); if (y) setCmpYears((c) => (c.includes(y) ? c.filter((x) => x !== y) : [...(c.length ? c : cy), y].slice(-4))); }}>
                    <option value="">+ add/remove year…</option>{years.map((y) => <option key={y} value={y}>{y}{cy.includes(y) ? " ✓" : ""}</option>)}</select>}>
                  <Legend items={[{ color: "#64748b", label: "P25–P75 band" }, { color: "#e2e8f0", label: "Median", dash: true }, ...cy.map((y, i) => ({ color: YEAR_COLORS[i], label: String(y) }))]} />
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={profile} margin={{ left: -6, right: 8, top: 8 }}>
                      <CartesianGrid stroke={COLORS.grid} vertical={false} />
                      <XAxis dataKey="month" {...axisProps} />
                      <YAxis {...axisProps} label={{ value: unit, angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10, dx: 14, dy: 60 }} />
                      <Tooltip {...tooltipStyle} formatter={(v: any) => (Array.isArray(v) ? `${fmt(v[0], 1)} – ${fmt(v[1], 1)}` : fmt(v, 1))} />
                      <Area dataKey="band" stroke="none" fill="#64748b" fillOpacity={0.3} name="P25–P75" isAnimationActive={false} />
                      <Line dataKey="median" stroke="#e2e8f0" strokeDasharray="4 3" strokeWidth={2} dot={false} name="Median" isAnimationActive={false} />
                      {cy.map((y, i) => <Line key={y} dataKey={String(y)} stroke={YEAR_COLORS[i]} strokeWidth={2.2} dot={{ r: 3 }} name={String(y)} isAnimationActive={false} connectNulls={false} />)}
                    </ComposedChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}
            </>
          )}
        </div>
        <DayPanel onOpenMap={() => nav("/map")} />
      </div>
    </div>
  );
}

function SeasonGrid({ rows }: { rows: any[] }) {
  const years = Array.from(new Set(rows.map((r) => r.year))).sort();
  const seasons = ["DJF", "MAM", "JJA", "SON"];
  return (
    <ChartCard title="Seasonal burning calendar" subtitle="Meteorological seasons (DJF = Dec of the year + Jan–Feb of the next)" data={rows}>
      <div className="overflow-x-auto">
        <table className="text-[11px]">
          <thead><tr><th className="pr-3 text-left text-slate-500">Year</th>{seasons.map((s) => <th key={s} className="w-24 px-1 text-slate-400">{s}</th>)}</tr></thead>
          <tbody>
            {years.map((y) => (
              <tr key={y}>
                <td className="pr-3 font-mono text-slate-400">{y}</td>
                {seasons.map((s) => {
                  const r = rows.find((x) => x.year === y && x.season === s);
                  return <td key={s} className="px-[2px] py-[1px]"><div className="flex h-5 items-center justify-center rounded-[3px] font-mono text-[10px]"
                    style={{ background: r ? CLASS_COLORS[r.class] : "#0b111c", color: r && r.class >= 4 ? "#0b111c" : "#e2e8f0" }} title={r ? `${CLASS_NAMES[r.class]}` : ""}>{r ? fmt(r.value, 0) : ""}</div></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

function Cmp({ label, c }: { label: string; c: any }) {
  const up = c?.pct > 0;
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-2">
      <div className="label">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-mono text-sm text-slate-100">{fmt(c?.current, 1)}</span>
        <span className="text-[11px] text-slate-500">vs {fmt(c?.previous, 1)}</span>
      </div>
      <div className={clsx("mt-0.5 flex items-center text-[11px]", c?.pct == null ? "text-slate-500" : up ? "text-orange-300" : "text-sky-300")}>
        {c?.pct != null && (up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />)}{pct(c?.pct, 0)}
      </div>
    </div>
  );
}

function DayPanel({ onOpenMap }: { onOpenMap: () => void }) {
  const { body, filters, selectedDate } = useStore();
  const d = useApi<any>(selectedDate ? "/api/calendar/day" : null, body({ date: selectedDate }));
  const pts = useApi<any>(selectedDate ? "/api/points" : null, { ...body(), filters: { ...filters, start: selectedDate, end: selectedDate }, limit: 5000 });
  if (!selectedDate) return (
    <div className="card flex h-fit flex-col items-center gap-2 p-6 text-center text-xs text-slate-400">
      <MapPin size={20} className="text-slate-600" />Select a day in the Daily / Weekly view to inspect detections, sensor contributions, comparisons with previous periods and the historical baseline.
      <span className="text-slate-500">Tip: click a month in the multi-year calendar to zoom the whole platform to that month.</span>
    </div>
  );
  const x = d.data;
  return (
    <div className="card h-fit space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div><div className="label">Selected day</div><div className="font-mono text-lg text-white">{selectedDate}</div></div>
        <button className="btn" onClick={onOpenMap}><MapPin size={12} /> Open on map</button>
      </div>
      {d.error && <ErrorBox error={d.error} />}
      {!x ? <Loading h={120} /> : !x.available ? <Empty text="Outside the record for this AOI." /> : (
        <>
          {x.calibrated && <div className="rounded border border-slate-700 bg-slate-800/50 px-2 py-1 text-[11px] text-slate-300">Pre-VIIRS day: harmonised value is calibrated from MODIS.</div>}
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat l="Harmonised" v={fmt(x.harmonized, 1)} c={COLORS.harm} />
            <Stat l="MODIS det." v={fmt(x.modis_detections)} c={COLORS.modis} />
            <Stat l="VIIRS det." v={fmt(x.viirs_detections)} c={COLORS.viirs} />
            <Stat l="Mean FRP" v={`${fmt(x.frp_mean, 1)}`} u="MW" />
            <Stat l="Max FRP" v={`${fmt(x.frp_max, 0)}`} u="MW" />
            <Stat l="High conf." v={fmt(x.high_conf)} />
          </div>
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-2.5 text-[12px]">
            <div className="label mb-1">Historical baseline</div>
            Median for this time of year ({x.historical.window}, n={x.historical.n_years}): <b className="font-mono">{fmt(x.historical.median, 1)}</b> → today is
            <b className={clsx("ml-1", x.historical.pct_vs_median > 0 ? "text-orange-300" : "text-sky-300")}>{pct(x.historical.pct_vs_median, 0)}</b>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Cmp label="Day over day" c={x.comparisons.day_over_day} />
            <Cmp label="Week over week" c={x.comparisons.week_over_week} />
            <Cmp label="Month over month" c={x.comparisons.month_over_month} />
            <Cmp label="Year over year (±3 d)" c={x.comparisons.year_over_year} />
          </div>
          <FireMap height={250} points={pts.data} mode="combined" fitTo={x.bbox ? [x.bbox[0] - 0.5, x.bbox[1] - 0.5, x.bbox[2] + 0.5, x.bbox[3] + 0.5] : null} aoiGeom={aoiGeometry(filters.aoi)} />
          <div>
            <div className="label mb-1">Geographic distribution</div>
            <div className="flex flex-wrap gap-1">{x.by_country.map((c: any) => <span key={c.country} className="chip">{c.country} · {c.n}</span>)}{!x.by_country.length && <span className="text-xs text-slate-500">No detections</span>}</div>
            <div className="mt-2 text-[11px] text-slate-500">By platform: {Object.entries(x.by_platform).map(([k, v]) => `${k} ${v}`).join(" · ") || "–"}</div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ l, v, c, u }: { l: string; v: string; c?: string; u?: string }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 py-2">
      <div className="text-[10px] text-slate-500">{l}</div>
      <div className="font-mono text-[15px]" style={{ color: c || "#f1f5f9" }}>{v}{u && <span className="ml-0.5 text-[10px] text-slate-500">{u}</span>}</div>
    </div>
  );
}
