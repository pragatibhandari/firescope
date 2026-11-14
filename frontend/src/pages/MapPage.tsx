import React, { useEffect, useMemo, useState } from "react";
import { Clock, Layers, Pause, Play, Square, Spline, X } from "lucide-react";
import clsx from "clsx";
import FireMap, { DrawMode, MapMode } from "../components/FireMap";
import { useApi } from "../lib/api";
import { useStore } from "../lib/store";
import { addDays, aoiLabel, fmt } from "../lib/format";
import { InfoTip } from "../components/ui";

const MODES: { v: MapMode; l: string; d: string }[] = [
  { v: "modis", l: "Raw MODIS", d: "Individual MODIS detections (1 km pixels, blue rings)." },
  { v: "viirs", l: "Raw VIIRS", d: "Individual VIIRS detections (375 m pixels, gold dots)." },
  { v: "combined", l: "Combined", d: "Both sensors' raw detections, overlaid (not de-duplicated)." },
  { v: "harmonized", l: "Harmonised", d: "Gridded harmonised activity: de-duplicated union cell-days per cell (pre-VIIRS MODIS scaled by the calibration ratio)." },
  { v: "intensity", l: "Intensity (FRP)", d: "Detections coloured and sized by Fire Radiative Power (MW)." },
  { v: "density", l: "Historical density", d: "Hotspot recurrence: share of years in the full record in which each grid cell had any detection." },
];

export function aoiGeometry(aoi: any) {
  if (!aoi || aoi.kind === "world") return null;
  if (aoi.kind === "bbox") { const [w, s, e, n] = aoi.bbox; return { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }; }
  if (aoi.geometry) return aoi.geometry.type === "Feature" ? aoi.geometry.geometry : aoi.geometry;
  return null;
}

let REGIONS: any[] = [];
let regionsPromise: Promise<any[]> | null = null;
/** Country index (name + bbox), fetched once and shared; re-renders the caller when loaded. */
export function useRegions(): any[] {
  const [r, setR] = useState<any[]>(REGIONS);
  useEffect(() => {
    if (REGIONS.length) return;
    regionsPromise = regionsPromise || fetch("/api/regions").then((x) => x.json()).then((d) => (REGIONS = d));
    regionsPromise.then(setR).catch(() => {});
  }, []);
  return r;
}

export function aoiBbox(aoi: any, regions: any[] = REGIONS): [number, number, number, number] | null {
  if (!aoi || aoi.kind === "world") return [-180, -60, 180, 75];
  if (aoi.kind === "bbox") return aoi.bbox;
  if (aoi.kind === "country") return regions?.find((r) => r.name === aoi.country)?.bbox || null;
  const g = aoiGeometry(aoi);
  if (!g) return null;
  const xs: number[] = [], ys: number[] = [];
  const walk = (c: any) => (typeof c[0] === "number" ? (xs.push(c[0]), ys.push(c[1])) : c.forEach(walk));
  walk(g.coordinates || []);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export default function MapPage() {
  const { body, filters, setFilters, selectedDate, setSelectedDate } = useStore();
  const [mode, setMode] = useState<MapMode>("combined");
  const [showM, setShowM] = useState(true);
  const [showV, setShowV] = useState(true);
  const [heat, setHeat] = useState(false);
  const [cluster, setCluster] = useState(false);
  const [bounds, setBounds] = useState(true);
  const [draw, setDraw] = useState<DrawMode>("none");
  const [gran, setGran] = useState<"day" | "week" | "month" | "year">("week");
  const [step, setStep] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const pts = useApi<any>(mode === "density" ? null : "/api/points", body());
  const dens = useApi<any>(mode === "harmonized" ? "/api/density" : null, body());
  const rec = useApi<any>(mode === "density" ? "/api/recurrence" : null, body());
  const countryIdx = useRegions();

  const nDays = Math.max(1, Math.round((Date.parse(filters.end) - Date.parse(filters.start)) / 864e5) + 1);
  const win = { day: 1, week: 7, month: 30, year: 365 }[gran];
  const nSteps = Math.max(1, Math.ceil(nDays / win));
  useEffect(() => { if (!playing) return; const t = setInterval(() => setStep((s) => ((s ?? -1) + 1) % nSteps), 750); return () => clearInterval(t); }, [playing, nSteps]);
  useEffect(() => { setStep(null); setPlaying(false); }, [filters.start, filters.end, gran]);

  let dRange: [number, number] | null = null;
  let timeLabel = `${filters.start} → ${filters.end}`;
  if (selectedDate && step === null) {
    const d = Math.round((Date.parse(selectedDate) - Date.parse(filters.start)) / 864e5);
    dRange = [d, d]; timeLabel = `Selected day ${selectedDate}`;
  } else if (step !== null) {
    dRange = [step * win, step * win + win - 1];
    timeLabel = `${addDays(filters.start, dRange[0])} → ${addDays(filters.start, Math.min(nDays - 1, dRange[1]))}`;
  }
  const hist = useMemo(() => {
    if (!pts.data?.features?.length || nSteps < 2 || nSteps > 400) return null;
    const counts = new Array(nSteps).fill(0);
    for (const f of pts.data.features) { const i = Math.floor(f.properties.d / win); if (i >= 0 && i < nSteps) counts[i]++; }
    return { counts, max: Math.max(1, ...counts) };
  }, [pts.data, nSteps, win]);
  const status = pts.loading || dens.loading || rec.loading ? <span className="text-harm">Loading…</span> : mode === "density" && rec.data ? <span>Recurrence over {rec.data.n_years} years · {rec.data.cell_deg}° cells</span> : pts.data ? (
    <span>{fmt(pts.data.total)} detections{pts.data.sampled && <> · sample of {fmt(pts.data.features.length)} shown <InfoTip text="Large selections are sampled server-side to keep the browser responsive; counts and analytics always use all records. Zoom into a smaller AOI or shorter period for every point." /></>}</span>
  ) : null;
  const fit = useMemo(() => aoiBbox(filters.aoi, countryIdx), [JSON.stringify(filters.aoi), countryIdx.length]);
  const aoiGeom = useMemo(() => aoiGeometry(filters.aoi), [JSON.stringify(filters.aoi)]);

  return (
    <div className="relative h-[calc(100vh-150px)] min-h-[560px]">
      <FireMap points={pts.data} density={dens.data} recurrence={rec.data} aoiGeom={aoiGeom} mode={mode} cluster={cluster} heat={heat}
        showModis={showM} showViirs={showV} showBoundaries={bounds} dRange={dRange} fitTo={fit} drawMode={draw}
        onCountryClick={(c) => setFilters({ aoi: { kind: "country", country: c } })}
        onDraw={(g) => { setDraw("none"); setFilters({ aoi: g.kind === "bbox" ? { kind: "bbox", bbox: g.bbox } : { kind: "polygon", geometry: g.geometry, name: "Drawn polygon" } }); }} />

      <div className="absolute left-3 top-3 w-[262px] space-y-3 rounded-xl border border-ink-600 bg-ink-900/92 p-3 shadow-2xl backdrop-blur">
        <div>
          <div className="label mb-1.5 flex items-center gap-1"><Layers size={11} /> View</div>
          <div className="grid grid-cols-2 gap-1">
            {MODES.map((m) => (
              <button key={m.v} title={m.d} onClick={() => setMode(m.v)}
                className={clsx("rounded-md border px-2 py-1.5 text-left text-[11.5px]", mode === m.v ? "border-harm bg-harm/15 text-white" : "border-ink-600 text-slate-300 hover:bg-ink-800")}>{m.l}</button>
            ))}
          </div>
          <div className="mt-1.5 text-[11px] leading-snug text-slate-400">{MODES.find((m) => m.v === mode)?.d}</div>
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[12px]">
          <Toggle on={showM} set={setShowM}><span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-modis" />MODIS layer</Toggle>
          <Toggle on={showV} set={setShowV}><span className="inline-block h-2 w-2 rounded-full bg-viirs" />VIIRS layer</Toggle>
          <Toggle on={heat} set={setHeat}>Heatmap</Toggle>
          <Toggle on={cluster} set={setCluster}>Clustering</Toggle>
          <Toggle on={bounds} set={setBounds}>Boundaries</Toggle>
        </div>
        <div>
          <div className="label mb-1.5">Area of interest</div>
          <div className="flex gap-1">
            <button className={clsx("btn flex-1 justify-center", draw === "bbox" && "!border-sky-400 !text-sky-300")} onClick={() => setDraw(draw === "bbox" ? "none" : "bbox")}><Square size={12} /> Box</button>
            <button className={clsx("btn flex-1 justify-center", draw === "polygon" && "!border-sky-400 !text-sky-300")} onClick={() => setDraw(draw === "polygon" ? "none" : "polygon")}><Spline size={12} /> Polygon</button>
            {filters.aoi.kind !== "world" && <button className="btn" title="Clear AOI" onClick={() => setFilters({ aoi: { kind: "world" } })}><X size={12} /></button>}
          </div>
          <div className="mt-1.5 text-[11px] text-slate-400">
            {draw === "bbox" ? "Click two opposite corners." : draw === "polygon" ? "Click vertices; double-click or Enter to finish, Esc to reset." : <>Current: <b className="text-slate-200">{aoiLabel(filters.aoi)}</b> · Shift-click a country to select it.</>}
          </div>
        </div>
      </div>

      {!showTime ? (
        <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-ink-600 bg-ink-900/92 py-1.5 pl-3.5 pr-1.5 text-[11.5px] text-slate-300 shadow-2xl backdrop-blur">
          <span className="font-mono text-slate-200">{timeLabel}</span>
          <span className="text-slate-500">·</span>
          {status}
          {selectedDate && <button className="btn !rounded-full !py-1" onClick={() => setSelectedDate(null)}><X size={12} /> Whole period</button>}
          <button className="btn !rounded-full !py-1" onClick={() => setShowTime(true)}><Clock size={12} /> Time playback</button>
        </div>
      ) : (
        <div className="absolute bottom-8 left-1/2 w-[min(760px,calc(100%-24px))] -translate-x-1/2 rounded-xl border border-ink-600 bg-ink-900/92 p-3 shadow-2xl backdrop-blur">
          {hist && (
            <div className="mb-1.5 flex h-10 items-end gap-px" title="Detections per step - click a bar to jump there">
              {hist.counts.map((c, i) => (
                <div key={i} onClick={() => { setSelectedDate(null); setPlaying(false); setStep(i); }}
                  className="flex-1 cursor-pointer rounded-t-sm transition-colors hover:bg-harm"
                  style={{ height: `${Math.max(4, (c / hist.max) * 100)}%`, background: step === i ? "#e0552f" : step !== null && i < step ? "#7c3a24" : "#3d4a63" }}
                  title={`${addDays(filters.start, i * win)}: ${fmt(c)} detections${pts.data?.sampled ? " (sample)" : ""}`} />
              ))}
            </div>
          )}
          <div className="flex items-center gap-3">
            <button className="btn !p-2" title={playing ? "Pause" : "Play"} onClick={() => { if (selectedDate) setSelectedDate(null); setPlaying((p) => !p); if (step === null) setStep(0); }}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
            <input type="range" min={0} max={nSteps - 1} value={step ?? 0} onChange={(e) => { setSelectedDate(null); setStep(Number(e.target.value)); }} className="flex-1 accent-[#e0552f]" />
            <div className="seg">{(["day", "week", "month", "year"] as const).map((g) => <button key={g} className={clsx(gran === g && "on")} onClick={() => setGran(g)}>{g}</button>)}</div>
            <button className="btn" title="Close playback and show the whole period" onClick={() => { setStep(null); setPlaying(false); setSelectedDate(null); setShowTime(false); }}><X size={13} /></button>
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-slate-400">
            <span className="font-mono text-slate-200">{timeLabel}</span>
            <span>{status}</span>
          </div>
        </div>
      )}

      <div className="absolute right-12 top-3 rounded-lg border border-ink-600 bg-ink-900/90 px-3 py-2 text-[11px] text-slate-300">
        {mode === "intensity" || mode === "density" || mode === "harmonized" ? (
          <div>
            <div className="mb-1 text-slate-400">{mode === "intensity" ? "FRP (MW)" : mode === "density" ? "Share of years with fire" : "Harmonised cell-days (relative)"}</div>
            <div className="h-2 w-40 rounded" style={{ background: "linear-gradient(90deg,#420a68,#932667,#dd513a,#fca50a,#fcffa4)" }} />
            <div className="mt-0.5 flex justify-between text-slate-500"><span>{mode === "intensity" ? "1" : "low"}</span><span>{mode === "intensity" ? "600+" : "high"}</span></div>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full border-2 border-modis bg-modis/25" /> MODIS (1 km)</div>
            <div className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full bg-viirs" /> VIIRS (375 m)</div>
          </div>
        )}
      </div>
      {pts.error && <div className="absolute right-3 top-20 max-w-sm rounded bg-red-950/90 p-2 text-xs text-red-200">{pts.error}</div>}
    </div>
  );
}

function Toggle({ on, set, children }: { on: boolean; set: (b: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-slate-300">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="accent-[#e0552f]" />{children}
    </label>
  );
}
