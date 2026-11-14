import React from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { Flame, Satellite } from "lucide-react";
import { useApi } from "../lib/api";
import { useStore } from "../lib/store";
import { COLORS, fmt, pct } from "../lib/format";
import { ChartCard, Empty, ErrorBox, Kpi, Legend, Loading, PageHeader, axisProps, tooltipStyle } from "../components/ui";

export default function Overview() {
  const { body, selectedDate, filters } = useStore();
  const { data, loading, error } = useApi<any>("/api/summary", body());
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading h={400} label="Harmonising the AOI's full record… (first load of a large area can take ~10 s)" />;
  const k = data.kpi;
  const selKey = selectedDate && (data.series_resolution === "daily" ? selectedDate : null);
  return (
    <div className="space-y-4">
      <PageHeader title={`Fire intelligence · ${data.aoi.name}`}
        desc={<>Selected period {filters.start} → {filters.end}. Raw detections are satellite pixels; <b className="text-slate-200">harmonised activity</b> is
          de-duplicated, sensor-consistent active-fire cell-days (see Methodology). {loading && <span className="text-harm">Updating…</span>}</>} />
      {data.notes?.length > 0 && <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">{data.notes.join(" ")}</div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Total detections" value={fmt(k.total_detections)} color="#64748b" info="All MODIS and VIIRS hotspot pixels passing the filters (raw satellite detections, not fires)."
          sub={<>Δ prev. period {pct(k.pct_change_detections)}</>} />
        <Kpi label="MODIS detections" value={fmt(k.modis_detections)} color={COLORS.modis} info="Terra + Aqua MODIS Collection 6.1, 1 km pixels." sub={`${fmt((k.modis_detections / Math.max(1, k.total_detections)) * 100, 1)}% of raw`} />
        <Kpi label="VIIRS detections" value={fmt(k.viirs_detections)} color={COLORS.viirs} info="Suomi-NPP / NOAA-20 / NOAA-21 VIIRS 375 m pixels. VIIRS detects ~3x more pixels per fire than MODIS." sub={`${fmt((k.viirs_detections / Math.max(1, k.total_detections)) * 100, 1)}% of raw`} />
        <Kpi label="Harmonised activity" value={fmt(k.harmonized_activity)} color={COLORS.harm} icon={<Flame size={11} className="text-harm" />}
          info="Harmonised active-fire cell-days: each grid cell burning on a given day counts once regardless of how many satellites or pixels saw it; pre-VIIRS days are calibrated MODIS."
          sub={<>Δ prev. period <b className={k.pct_change_harmonized > 0 ? "text-orange-300" : "text-sky-300"}>{pct(k.pct_change_harmonized)}</b></>} />
        <Kpi label="Fire Activity Index" value={fmt(k.fai)} color={COLORS.harm} info="Confidence-weighted (and optionally FRP-weighted, see Harmonization Lab) harmonised cell-days." sub="weights configurable" />
        <Kpi label="Estimated fire events" value={fmt(k.estimated_events)} color="#a78bfa" info="Space-time clusters of adjacent burning cell-days (≤1 cell apart, ≤1 day gap). Estimates only — not confirmed individual fires." sub="clusters, not confirmed fires" />
        <Kpi label="Unique cell-days" value={fmt(k.unique_cell_days)} color="#64748b" info="Union of MODIS and VIIRS active-fire cell-days in the VIIRS era (co-detections counted once)." />
        <Kpi label="Mean FRP" value={<>{fmt(k.frp_mean, 1)}<span className="text-sm text-slate-400"> MW</span></>} color="#fca50a" info="Mean per-pixel Fire Radiative Power. Pixel FRP depends on pixel size, so MODIS and VIIRS values are not directly comparable." />
        <Kpi label="Max FRP" value={<>{fmt(k.frp_max, 0)}<span className="text-sm text-slate-400"> MW</span></>} color="#fca50a" />
        <Kpi label="High-confidence" value={fmt(k.high_conf_detections)} color="#5ad19a" info="MODIS confidence ≥ 80% or VIIRS class 'high'." sub={`${fmt((k.high_conf_detections / Math.max(1, k.total_detections)) * 100, 1)}% of raw`} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard title={`Harmonised fire activity (${data.series_resolution})`} subtitle="Active-fire cell-days · shaded band = uncertainty (CV for calibrated MODIS era, Poisson otherwise)" data={data.daily}
          info="Primary sensor-independent activity signal. Grey bars mark days in the pre-VIIRS era where values are calibrated from MODIS.">
          {data.daily.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={data.daily} margin={{ left: -10, right: 8 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="date" {...axisProps} minTickGap={40} />
                <YAxis {...axisProps} />
                <Tooltip {...tooltipStyle} formatter={(v: any) => fmt(v, 1)} />
                <Area dataKey="harm_hi" stroke="none" fill={COLORS.harm} fillOpacity={0.15} name="Upper bound" isAnimationActive={false} />
                <Area dataKey="harmonized" stroke={COLORS.harm} strokeWidth={2} fill={COLORS.harm} fillOpacity={0.25} name="Harmonised cell-days" isAnimationActive={false} />
                {selKey && <ReferenceLine x={selKey} stroke="#38bdf8" strokeDasharray="3 3" label={{ value: "selected", fill: "#38bdf8", fontSize: 10 }} />}
              </ComposedChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </ChartCard>
        <ChartCard title="MODIS vs VIIRS raw detections" subtitle={`Detections per ${data.series_resolution === "daily" ? "day" : "week"} · same unit, one axis`} data={data.daily}
          info="Raw pixel counts per sensor. The gap between the lines is the resolution/sensitivity difference that harmonisation removes. Do not compare these counts directly across sensors.">
          <Legend items={[{ color: COLORS.modis, label: "MODIS (Terra+Aqua)" }, { color: COLORS.viirs, label: "VIIRS (375 m)" }]} />
          <ResponsiveContainer width="100%" height={222}>
            <LineChart data={data.daily} margin={{ left: -10, right: 8, top: 6 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="date" {...axisProps} minTickGap={40} />
              <YAxis {...axisProps} />
              <Tooltip {...tooltipStyle} />
              <Line dataKey="modis_det" stroke={COLORS.modis} strokeWidth={2} dot={false} name="MODIS" isAnimationActive={false} />
              <Line dataKey="viirs_det" stroke={COLORS.viirs} strokeWidth={2} dot={false} name="VIIRS" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Annual harmonised activity — full record" subtitle="Cell-days per year · grey = calibrated MODIS era (pre-VIIRS), orange = observed MODIS∪VIIRS" data={data.annual}
          info="The continuous long-term series produced by harmonisation. Without calibration, 2012 would show an artificial jump when VIIRS begins.">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={data.annual} margin={{ left: -10, right: 8 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="year" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip {...tooltipStyle} formatter={(v: any) => fmt(v, 0)} />
              <Bar dataKey="harmonized" name="Harmonised cell-days" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {data.annual.map((a: any) => <Cell key={a.year} fill={a.calibrated ? "#64748b" : COLORS.harm} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Seasonal burning pattern" subtitle="Mean and median harmonised cell-days per calendar month, all years" data={data.seasonal}
          info="Climatology of the AOI: which months normally burn. Mean > median signals that a few extreme years dominate.">
          <Legend items={[{ color: COLORS.harm, label: "Mean" }, { color: "#e2e8f0", label: "Median", dash: true }]} />
          <ResponsiveContainer width="100%" height={212}>
            <ComposedChart data={data.seasonal} margin={{ left: -10, right: 8, top: 6 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="month" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip {...tooltipStyle} formatter={(v: any) => fmt(v, 1)} />
              <Bar dataKey="mean" fill={COLORS.harm} radius={[4, 4, 0, 0]} name="Mean" isAnimationActive={false} />
              <Line dataKey="median" stroke="#e2e8f0" strokeDasharray="4 3" strokeWidth={2} dot={{ r: 2.5 }} name="Median" isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Monthly activity in selected period" subtitle="Harmonised cell-days per month" data={data.monthly}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.monthly} margin={{ left: -10, right: 8 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="date" {...axisProps} minTickGap={20} />
              <YAxis {...axisProps} />
              <Tooltip {...tooltipStyle} formatter={(v: any) => fmt(v, 1)} />
              <Bar dataKey="harmonized" name="Harmonised" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {data.monthly.map((a: any) => <Cell key={a.date} fill={a.calibrated ? "#64748b" : COLORS.harm} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Fire Radiative Power distribution" subtitle="Detections per log-spaced FRP bin (MW)" data={data.frp_hist}
          info="VIIRS 375 m pixels see smaller fractions of a fire, so per-pixel FRP is lower than MODIS 1 km. The harmonisation rescales VIIRS FRP using co-located cell-days.">
          <Legend items={[{ color: COLORS.modis, label: "MODIS" }, { color: COLORS.viirs, label: "VIIRS" }]} />
          <ResponsiveContainer width="100%" height={212}>
            <BarChart data={data.frp_hist} margin={{ left: -10, right: 8, top: 6 }} barGap={2}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="lo" {...axisProps} tickFormatter={(v) => (v >= 1 ? String(Math.round(v)) : String(v))} label={{ value: "FRP (MW, bin start)", position: "insideBottom", offset: -2, fill: "#64748b", fontSize: 10 }} height={32} />
              <YAxis {...axisProps} />
              <Tooltip {...tooltipStyle} labelFormatter={(_, p: any) => (p?.[0]?.payload?.bin ?? "") + " MW"} />
              <Bar dataKey="MODIS" fill={COLORS.modis} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="VIIRS" fill={COLORS.viirs} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Fire activity by country / region" subtitle="Raw detections in selected period, top 15" data={data.by_country}>
          <Legend items={[{ color: COLORS.modis, label: "MODIS" }, { color: COLORS.viirs, label: "VIIRS" }]} />
          <ResponsiveContainer width="100%" height={Math.max(160, data.by_country.length * 20 + 20)}>
            <BarChart data={data.by_country} layout="vertical" margin={{ left: 30, right: 12, top: 6 }}>
              <CartesianGrid stroke={COLORS.grid} horizontal={false} />
              <XAxis type="number" {...axisProps} />
              <YAxis type="category" dataKey="country" {...axisProps} width={110} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="MODIS" stackId="a" fill={COLORS.modis} isAnimationActive={false} />
              <Bar dataKey="VIIRS" stackId="a" fill={COLORS.viirs} radius={[0, 4, 4, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Detection confidence by sensor" subtitle="Raw detections per standardised confidence class" data={data.confidence}
          info="MODIS confidence (0–100%) is mapped to low <30, nominal 30–79, high ≥80 (MODIS C6.1 user guide). VIIRS reports low/nominal/high directly. The classes are not strictly equivalent across sensors.">
          <Legend items={[{ color: "#5b6b86", label: "Low" }, { color: "#9aa9c2", label: "Nominal" }, { color: "#5ad19a", label: "High" }]} />
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={data.confidence} layout="vertical" margin={{ left: 0, right: 12, top: 6 }}>
              <XAxis type="number" {...axisProps} />
              <YAxis type="category" dataKey="sensor" {...axisProps} width={56} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="low" stackId="a" fill="#5b6b86" isAnimationActive={false} />
              <Bar dataKey="nominal" stackId="a" fill="#9aa9c2" isAnimationActive={false} />
              <Bar dataKey="high" stackId="a" fill="#5ad19a" radius={[0, 4, 4, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-400"><Satellite size={12} />
            {Object.entries(data.platforms).map(([p, n]: any) => <span key={p} className="chip">{p}: {fmt(n)}</span>)}</div>
        </ChartCard>
      </div>
    </div>
  );
}
