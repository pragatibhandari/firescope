import React, { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Crosshair, FileUp, Search, Square, Spline } from "lucide-react";
import clsx from "clsx";
import { apiDownload, apiGet, apiUpload, useApi } from "../lib/api";
import { useStore } from "../lib/store";
import { COLORS, aoiLabel, fmt, pct } from "../lib/format";
import { ChartCard, DownloadBtn, ErrorBox, Kpi, Loading, PageHeader, axisProps, tooltipStyle } from "../components/ui";
import { ClassLegend, MonthMatrix } from "../components/Calendar";
import FireMap, { DrawMode } from "../components/FireMap";
import { aoiBbox, aoiGeometry } from "./MapPage";

export default function AoiPage() {
  const { filters, setFilters, body } = useStore();
  const [regions, setRegions] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [gErr, setGErr] = useState<string | null>(null);
  const [draw, setDraw] = useState<DrawMode>("none");
  const [ll, setLl] = useState({ lat: "-31.4", lon: "-64.2", r: "50" });
  const [bb, setBb] = useState({ w: "", s: "", e: "", n: "" });
  useEffect(() => { apiGet("/api/regions").then(setRegions).catch(() => {}); }, []);
  const has = filters.aoi.kind !== "world";
  const sum = useApi<any>(has ? "/api/summary" : null, body());
  const cal = useApi<any>(has ? "/api/calendar" : null, body());
  const an = useApi<any>(has ? "/api/anomalies" : null, body());
  const dens = useApi<any>(has ? "/api/density" : null, body());

  const search = async () => {
    setGErr(null); setResults(null);
    try { setResults(await apiGet(`/api/geocode?q=${encodeURIComponent(q)}`)); } catch (e: any) { setGErr(String(e.message || e)); }
  };
  const fromLatLon = () => {
    const lat = Number(ll.lat), lon = Number(ll.lon), r = Number(ll.r);
    const dLat = r / 111.32, dLon = r / (111.32 * Math.cos((lat * Math.PI) / 180));
    setFilters({ aoi: { kind: "bbox", bbox: [lon - dLon, lat - dLat, lon + dLon, lat + dLat], name: `${lat.toFixed(3)}, ${lon.toFixed(3)} ± ${r} km` } });
  };
  const k = sum.data?.kpi;
  return (
    <div className="space-y-4">
      <PageHeader title="Area of Interest Explorer" desc="Define an area by country, administrative region or place search, coordinates, drawing, or an uploaded GeoJSON boundary. A full fire-intelligence report is generated automatically for the current date range and full historical baseline." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="card h-fit space-y-4 p-4">
          <Sec t="Country">
            <select className="input w-full" value={filters.aoi.kind === "country" ? (filters.aoi as any).country : ""} onChange={(e) => e.target.value && setFilters({ aoi: { kind: "country", country: e.target.value } })}>
              <option value="">Select a country…</option>{regions.map((r) => <option key={r.name}>{r.name}</option>)}
            </select>
          </Sec>
          <Sec t="Administrative region, city or place">
            <div className="flex gap-1"><input className="input flex-1" placeholder="e.g. Córdoba Province, Argentina" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
              <button className="btn" onClick={search}><Search size={13} /></button></div>
            {gErr && <div className="mt-1 text-[11px] text-red-300">{gErr}</div>}
            {results && <div className="mt-1 max-h-48 space-y-1 overflow-y-auto">{results.length === 0 && <div className="text-[11px] text-slate-500">No matches.</div>}
              {results.map((r, i) => (
                <button key={i} className="w-full rounded border border-ink-700 bg-ink-900 p-1.5 text-left text-[11px] hover:border-harm"
                  onClick={() => setFilters({ aoi: r.geometry ? { kind: "geojson", geometry: r.geometry, name: r.name.split(",").slice(0, 2).join(",") } : { kind: "bbox", bbox: r.bbox, name: r.name.split(",")[0] } })}>
                  <div className="text-slate-200">{r.name}</div><div className="text-slate-500">{r.class}/{r.type} · {r.geometry ? "boundary polygon" : "bounding box"}</div>
                </button>))}</div>}
            <div className="mt-1 text-[10.5px] text-slate-500">Geocoding by OpenStreetMap Nominatim (via the backend).</div>
          </Sec>
          <Sec t="Latitude / longitude + radius">
            <div className="grid grid-cols-3 gap-1">
              <input className="input" value={ll.lat} onChange={(e) => setLl({ ...ll, lat: e.target.value })} placeholder="lat" />
              <input className="input" value={ll.lon} onChange={(e) => setLl({ ...ll, lon: e.target.value })} placeholder="lon" />
              <input className="input" value={ll.r} onChange={(e) => setLl({ ...ll, r: e.target.value })} placeholder="km" />
            </div>
            <button className="btn mt-1 w-full justify-center" onClick={fromLatLon}><Crosshair size={12} /> Use point ± radius (km)</button>
          </Sec>
          <Sec t="Bounding box (W, S, E, N)">
            <div className="grid grid-cols-4 gap-1">{(["w", "s", "e", "n"] as const).map((x) => <input key={x} className="input" placeholder={x.toUpperCase()} value={bb[x]} onChange={(e) => setBb({ ...bb, [x]: e.target.value })} />)}</div>
            <button className="btn mt-1 w-full justify-center" onClick={() => setFilters({ aoi: { kind: "bbox", bbox: [Number(bb.w), Number(bb.s), Number(bb.e), Number(bb.n)] } })}>Apply bounding box</button>
          </Sec>
          <Sec t="Draw on map / upload boundary">
            <div className="flex gap-1">
              <button className={clsx("btn flex-1 justify-center", draw === "bbox" && "!border-sky-400")} onClick={() => setDraw(draw === "bbox" ? "none" : "bbox")}><Square size={12} /> Box</button>
              <button className={clsx("btn flex-1 justify-center", draw === "polygon" && "!border-sky-400")} onClick={() => setDraw(draw === "polygon" ? "none" : "polygon")}><Spline size={12} /> Polygon</button>
              <label className="btn flex-1 cursor-pointer justify-center"><FileUp size={12} /> GeoJSON
                <input type="file" accept=".json,.geojson" className="hidden" onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  try { const r = await apiUpload("/api/upload/aoi", f); setFilters({ aoi: { kind: "geojson", geometry: r.geometry, name: r.name } }); } catch (err: any) { setGErr(String(err.message || err)); }
                }} /></label>
            </div>
          </Sec>
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-2.5 text-[12px]">Current AOI: <b className="text-white">{aoiLabel(filters.aoi)}</b>{has && <button className="ml-2 text-[11px] text-slate-400 underline" onClick={() => setFilters({ aoi: { kind: "world" } })}>clear</button>}</div>
        </div>

        <div className="min-w-0 space-y-4">
          <FireMap height={340} mode={has ? "harmonized" : "combined"} density={dens.data} aoiGeom={aoiGeometry(filters.aoi)} fitTo={aoiBbox(filters.aoi, regions)} drawMode={draw}
            onCountryClick={(c) => setFilters({ aoi: { kind: "country", country: c } })}
            onDraw={(g) => { setDraw("none"); setFilters({ aoi: g.kind === "bbox" ? { kind: "bbox", bbox: g.bbox } : { kind: "polygon", geometry: g.geometry, name: "Drawn polygon" } }); }} />
          {!has ? <div className="card p-8 text-center text-sm text-slate-400">Select an area to generate its fire-intelligence report. (Shift-click a country on the map works too.)</div> : (
            <>
              {(sum.error || cal.error) && <ErrorBox error={sum.error || cal.error!} />}
              {!k ? <div className="card"><Loading h={200} /></div> : (
                <>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-slate-300">Report for <b className="text-white">{sum.data.aoi.name}</b> · {filters.start} → {filters.end} · area ≈ {fmt(sum.data.aoi.area_km2)} km²</div>
                    <DownloadBtn label="Download PDF report" onClick={() => apiDownload("/api/report/pdf", body(), `firescope_${aoiLabel(filters.aoi).slice(0, 30)}.pdf`)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <Kpi label="Total detections" value={fmt(k.total_detections)} color="#64748b" sub={`Δ ${pct(k.pct_change_detections)}`} />
                    <Kpi label="MODIS" value={fmt(k.modis_detections)} color={COLORS.modis} />
                    <Kpi label="VIIRS" value={fmt(k.viirs_detections)} color={COLORS.viirs} />
                    <Kpi label="Harmonised" value={fmt(k.harmonized_activity)} color={COLORS.harm} sub={`Δ ${pct(k.pct_change_harmonized)} vs prev.`} />
                    <Kpi label="Max FRP" value={<>{fmt(k.frp_max, 0)}<span className="text-xs text-slate-400"> MW</span></>} color="#fca50a" />
                    <Kpi label="Anomalous months" value={an.data ? an.data.alerts.length : "…"} color="#ff4d4f" sub="in selected period" />
                  </div>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <ChartCard title="Monthly activity (selected period)" subtitle="Harmonised cell-days" data={sum.data.monthly}>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={sum.data.monthly} margin={{ left: -10, right: 8 }}>
                          <CartesianGrid stroke={COLORS.grid} vertical={false} />
                          <XAxis dataKey="date" {...axisProps} minTickGap={20} /><YAxis {...axisProps} />
                          <Tooltip {...tooltipStyle} formatter={(v: any) => fmt(v, 1)} />
                          <Bar dataKey="harmonized" radius={[4, 4, 0, 0]} isAnimationActive={false}>{sum.data.monthly.map((m: any) => <Cell key={m.date} fill={m.calibrated ? "#64748b" : COLORS.harm} />)}</Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartCard>
                    <ChartCard title="Historical seasonal pattern" subtitle="Mean harmonised cell-days per calendar month (all years)" data={sum.data.seasonal}>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={sum.data.seasonal} margin={{ left: -10, right: 8 }}>
                          <CartesianGrid stroke={COLORS.grid} vertical={false} />
                          <XAxis dataKey="month" {...axisProps} /><YAxis {...axisProps} />
                          <Tooltip {...tooltipStyle} formatter={(v: any) => fmt(v, 1)} />
                          <Bar dataKey="mean" fill={COLORS.harm} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartCard>
                  </div>
                  {cal.data && (
                    <ChartCard title="Burning activity calendar for this AOI" subtitle="Full record, harmonised" data={cal.data.matrix}>
                      <div className="mb-2"><ClassLegend thresholds={cal.data.thresholds.monthly} /></div>
                      <MonthMatrix matrix={cal.data.matrix} />
                    </ChartCard>
                  )}
                  {an.data && (
                    <ChartCard title="Anomalous periods & comparison with historical baseline" subtitle={an.data.disclaimer}>
                      {an.data.alerts.length ? <table className="data"><thead><tr><th>Period</th><th>Severity</th><th className="text-right">Observed</th><th className="text-right">Baseline median</th><th className="text-right">Deviation</th><th>Type</th></tr></thead>
                        <tbody>{an.data.alerts.slice(0, 12).map((a: any) => <tr key={a.id}><td className="font-mono">{a.period}</td><td>{a.severity}</td><td className="text-right font-mono">{fmt(a.observed)}</td><td className="text-right font-mono">{fmt(a.baseline_median)}</td><td className="text-right font-mono">{pct(a.deviation_pct, 0)}</td><td>{a.type}</td></tr>)}</tbody></table>
                        : <div className="text-xs text-slate-500">No anomalous months in the selected period.</div>}
                    </ChartCard>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Sec({ t, children }: { t: string; children: React.ReactNode }) {
  return <div><div className="label mb-1.5">{t}</div>{children}</div>;
}
