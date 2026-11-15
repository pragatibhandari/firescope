import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { ChevronUp, Globe2, Layers, Map as MapIcon, Square, X } from "lucide-react";
import clsx from "clsx";
import FireMap, { DrawMode, MapMode, setEarthTheme } from "../components/FireMap";
import { CountUp, Starfield } from "../components/IntroOverlay";
import { FloatingStory, LoadingText, LoadStep } from "../components/StoryPanel";
import { FeatureStream } from "../lib/streamFeatures";
import { DataInfo } from "../components/DataInfo";
import { useApi, Progress } from "../lib/api";
import { useStore } from "../lib/store";
import { aoiLabel, fmt } from "../lib/format";
import { AreaSearch } from "../components/Layout";

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

let STORY_SHOWN = false; // the wildfire facts accompany only the first load of a visit

export default function MapPage() {
  const { body, filters, setFilters, selectedDate, setSelectedDate, status } = useStore();
  const reduceMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [mapReady, setMapReady] = useState(false);
  const [dl, setDl] = useState<Progress | null>(null);
  const firstLoad = useRef(!STORY_SHOWN);
  const [storyOpen, setStoryOpen] = useState(false); // fire facts start tucked away in the side tab
  const mapRef = useRef<MLMap | null>(null);
  const userMoved = useRef(false); // user zoomed/panned away from the framed globe
  const baseZoom = useRef(1.5);
  const [mode, setMode] = useState<MapMode>("combined");
  const [showM, setShowM] = useState(true);
  const [showV, setShowV] = useState(true);
  const [heat, setHeat] = useState(false);
  const [cluster, setCluster] = useState(false);
  const [bounds, setBounds] = useState(true);
  const [draw, setDraw] = useState<DrawMode>("none");
  const [proj, setProj] = useState<"globe" | "flat">("globe");
  const fitRef = useRef<[number, number, number, number] | null>(null);
  const [panelOpen, setPanelOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 768);
  const gate = !!status && !status.error;
  const isWorld = filters.aoi.kind === "world";
  // hotspots are parsed while they download and drawn on the globe in real time
  const lastDl = useRef(0);
  const stream = useRef<FeatureStream | null>(null);
  const [partial, setPartial] = useState<any>(null);
  const onDl = (p: Progress) => {
    if (p.received === 0 || !stream.current) stream.current = new FeatureStream();
    if (p.chunk) stream.current.push(p.chunk);
    const now = performance.now(); // throttle UI updates: chunks arrive every few ms
    if (now - lastDl.current > 500 || (p.total && p.received >= p.total)) {
      lastDl.current = now;
      setDl(p);
      if (stream.current.features.length) setPartial({ type: "FeatureCollection", features: stream.current.features.slice() });
    }
  };
  const pts = useApi<any>(gate && mode !== "density" ? "/api/points" : null, body(), onDl);
  const summary = useApi<any>(gate && (pts.data || mode === "density") ? "/api/summary" : null, body());
  const dens = useApi<any>(gate && mode === "harmonized" ? "/api/density" : null, body());
  const rec = useApi<any>(gate && mode === "density" ? "/api/recurrence" : null, body());
  const loadErr = status?.error ? "Satellite data is temporarily unavailable." : pts.error ? "Satellite data is temporarily unavailable." : null;
  useEffect(() => { if (pts.loading) { setDl(null); setPartial(null); } else { setPartial(null); stream.current = null; } }, [pts.loading]);
  const shownPoints = pts.loading && partial?.features?.length ? partial : pts.data;

  // ---------------- globe framing: a perfect circle sized to the free space, recomputed on resize ----------------
  const boost = useRef(0); // extra zoom once the data is in: the globe grows a little after the intro spin
  const fastSpin = useRef(false);
  const [globe, setGlobe] = useState<{ cx: number; cy: number; r: number; W: number; H: number } | null>(null);
  const frame = (m: MLMap, animate: boolean) => {
    const c = m.getContainer(), W = c.clientWidth, H = c.clientHeight;
    const wide = W > 900;
    // a large, horizontally centred globe; the side columns keep room for the facts and loading text
    const side = wide ? Math.max(240, Math.min(300, W * 0.22)) : 12;
    const T = 78, B = 26;
    const D = Math.max(220, Math.min(W - 2 * side, H - T - B));
    const zoom = Math.log2((D * Math.PI) / 512) + boost.current;
    baseZoom.current = zoom;
    // padding top/bottom only: the globe sits centred horizontally, between the KPI row and the bottom edge
    setGlobe({ cx: W / 2, cy: T + (H - T - B) / 2, r: (D / 2) * Math.pow(2, boost.current), W, H });
    const opts = { zoom, padding: { top: T, bottom: B, left: 0, right: 0 }, center: [m.getCenter().lng, 12] as [number, number] };
    if (animate) m.easeTo({ ...opts, duration: 1100 }); else m.jumpTo(opts);
  };
  useEffect(() => {
    if (!mapReady) return;
    const m = mapRef.current!;
    const onMove = (e: any) => { if (e.originalEvent && (e.type === "zoomstart" || e.originalEvent.type === "wheel")) userMoved.current = true; };
    const onResize = () => { if (isWorld && proj === "globe" && !userMoved.current) frame(m, false); };
    m.on("zoomstart", onMove); m.on("resize", onResize);
    return () => { m.off("zoomstart", onMove); m.off("resize", onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, isWorld, proj]);
  // projection: globe for the whole world, flat map once an area is selected (users can switch with the icons)
  useEffect(() => { setProj(isWorld ? "globe" : "flat"); }, [isWorld]);
  useEffect(() => {
    if (!mapReady) return;
    const m = mapRef.current!;
    try { m.setProjection({ type: proj === "globe" ? "globe" : "mercator" }); } catch { /* style not ready */ }
    // back to the whole-world globe -> re-frame it (the flat map is fitted by FireMap)
    if (proj === "globe" && isWorld) { userMoved.current = false; frame(m, true); }
    // flat map: fit after the projection has changed (fitting under the globe gives the wrong zoom)
    else if (proj === "flat") {
      const wide = m.getContainer().clientWidth > 900;
      requestAnimationFrame(() => {
        if (isWorld) m.fitBounds([[-168, -56], [180, 76]], { padding: { top: 70, bottom: 40, left: wide ? 290 : 20, right: 20 }, duration: 800 });
        else if (fitRef.current) { const [w, so, e, n] = fitRef.current; m.fitBounds([[w, so], [e, n]], { padding: { top: 60, bottom: 40, left: wide ? 290 : 40, right: 40 }, maxZoom: 9, duration: 800 }); }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, proj, isWorld]);

  // slow rotation for the whole-world view; pauses while the user interacts or zooms in
  useEffect(() => {
    if (!mapReady || reduceMotion || !isWorld || proj !== "globe" || draw !== "none") return;
    const m = mapRef.current!;
    let raf = 0, last = performance.now(), holdUntil = 0;
    const hold = () => { holdUntil = performance.now() + 6000; };
    m.on("mousedown", hold); m.on("touchstart", hold); m.on("wheel", hold);
    const spin = (now: number) => {
      raf = requestAnimationFrame(spin);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (fastSpin.current || now < holdUntil || m.isMoving() || m.getZoom() > baseZoom.current + 0.35) return;
      const c = m.getCenter();
      m.jumpTo({ center: [(((c.lng + dt * 8) + 540) % 360) - 180, c.lat] }); // 8 degrees per second
    };
    raf = requestAnimationFrame(spin);
    return () => { cancelAnimationFrame(raf); m.off("mousedown", hold); m.off("touchstart", hold); m.off("wheel", hold); };
  }, [mapReady, reduceMotion, isWorld, proj, draw]);

  // natural-colour Earth (blue oceans, green land, white ice)
  useEffect(() => { if (mapReady) setEarthTheme(mapRef.current!, "color", 0); }, [mapReady]);

  // opening: keep the globe hidden until its coloured map tiles are in (no bare green ball),
  // then fade it in while it zooms and turns gently into place
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!mapReady || revealed) return;
    const m = mapRef.current!;
    let done = false;
    const t0 = performance.now();
    const go = () => {
      if (done) return;
      done = true;
      clearInterval(iv);
      const z = baseZoom.current, c = m.getCenter();
      if (reduceMotion || !isWorld) { setRevealed(true); return; }
      fastSpin.current = true;
      m.jumpTo({ zoom: z - 0.9, center: [c.lng - 50, c.lat] });
      requestAnimationFrame(() => setRevealed(true));
      m.easeTo({ zoom: z, center: [c.lng, c.lat], duration: 2600, easing: (t) => 1 - Math.pow(1 - t, 3) });
      setTimeout(() => { fastSpin.current = false; }, 2700);
    };
    const iv = setInterval(() => {
      let ready = false;
      try { ready = m.isStyleLoaded() !== undefined && (m as any).areTilesLoaded?.() && performance.now() - t0 > 300; } catch { /* */ }
      if (ready || performance.now() - t0 > 7000) go(); // never wait more than 7 s
    }, 120);
    return () => { done = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);


  // ---------------- loading steps (each ticks only when it has really happened) ----------------
  const [rendered, setRendered] = useState<any>(null); // the points object that the map has finished processing
  useEffect(() => {
    if (!mapReady || !pts.data) return;
    const m = mapRef.current!;
    const t = setInterval(() => { try { if (m.isSourceLoaded("pts")) { setRendered(pts.data); clearInterval(t); } } catch { /* */ } }, 120);
    return () => clearInterval(t);
  }, [mapReady, pts.data]);
  const counts = useMemo(() => {
    if (!pts.data?.features) return null;
    let mo = 0, vi = 0;
    for (const f of pts.data.features) (f.properties.sensor === "MODIS" ? mo++ : vi++);
    return { mo, vi };
  }, [pts.data]);
  const mb = (b: number) => (b / 1048576).toFixed(1);
  const needPts = mode !== "density";
  const ptsDone = !needPts || (!!pts.data && !pts.loading);
  const isRendered = !needPts || (ptsDone && rendered === pts.data);
  const statsDone = ptsDone && !!summary.data && !summary.loading && !dens.loading && !rec.loading;
  const steps: LoadStep[] = [
    { label: "3D globe ready", done: mapReady },
    { label: "Connected to NASA FIRMS archive", detail: status?.live_last_observation ? `observations up to ${status.live_last_observation}` : undefined, done: gate },
    { label: `Querying ${filters.sensors.join(" + ")} hotspots`, detail: `${filters.start} → ${filters.end} · ${aoiLabel(filters.aoi)}`, done: ptsDone || !!dl },
    { label: "Downloading fire detections", detail: dl ? `${mb(dl.received)}${dl.total ? " / " + mb(dl.total) : ""} MB${partial?.features?.length ? ` · ${fmt(partial.features.length)} on the globe` : ""}` : undefined, done: ptsDone },
    { label: "Processing geographic data", detail: counts && ptsDone ? `${fmt(counts.mo)} MODIS · ${fmt(counts.vi)} VIIRS detections` : undefined, done: ptsDone && (!needPts || !!counts) },
    { label: "Rendering fire hotspots on the globe", done: isRendered },
    { label: "Computing harmonised statistics", detail: summary.data?.kpi ? `${fmt(summary.data.kpi.total_detections)} detections in total` : undefined, done: statsDone },
  ];
  const W8 = [5, 10, 20, 35, 5, 10, 15];
  const percent = steps.reduce((acc, st, i) => acc + (st.done ? W8[i] : 0), 0)
    + (!ptsDone && dl?.total ? W8[3] * Math.min(0.99, dl.received / dl.total) : 0);
  const loadingVisible = !steps.every((x) => x.done) || !!loadErr;


  const countryIdx = useRegions();

  let dRange: [number, number] | null = null;
  if (selectedDate) {
    const d = Math.round((Date.parse(selectedDate) - Date.parse(filters.start)) / 864e5);
    dRange = [d, d];
  }
  const fit = useMemo(() => aoiBbox(filters.aoi, countryIdx), [JSON.stringify(filters.aoi), countryIdx.length]);
  fitRef.current = fit;
  const aoiGeom = useMemo(() => aoiGeometry(filters.aoi), [JSON.stringify(filters.aoi)]);

  return (
    <div className="relative h-full min-h-[560px] overflow-hidden bg-[#03060c]">
      <Starfield />
      <div className={clsx("absolute inset-0 transition-opacity duration-[1400ms] ease-out", revealed ? "opacity-100" : "opacity-0")}>
      <FireMap startGlobe hideAttribution holdCamera={isWorld && proj === "globe"} initialView={{ center: [-20, 12], zoom: 1.5 }}
        onMap={(m) => { mapRef.current = m; frame(m, false); setMapReady(true); }}
        points={shownPoints} density={dens.data} recurrence={rec.data} aoiGeom={aoiGeom} mode={mode} cluster={cluster} heat={heat}
        showModis={showM} showViirs={showV} showBoundaries={bounds} dRange={dRange} fitTo={fit} drawMode={draw}
        onCountryClick={(c) => setFilters({ aoi: { kind: "country", country: c } })}
        onDraw={(g) => { setDraw("none"); setFilters({ aoi: g.kind === "bbox" ? { kind: "bbox", bbox: g.bbox } : { kind: "polygon", geometry: g.geometry, name: "Drawn polygon" } }); }} />
      </div>

      <DataInfo />
      <FloatingStory open={storyOpen} onToggle={setStoryOpen} globe={globe} />
      <LoadingText globe={globe} visible={loadingVisible} steps={steps} percent={percent} error={loadErr}
        onRetry={() => { pts.reload(); summary.reload(); }} />

      <>
      {/* headline numbers for the current view */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-10 hidden -translate-x-1/2 gap-2 lg:flex">
        {[
          { l: "Fire detections", v: summary.data?.kpi?.total_detections, c: "#ffd166" },
          { l: "Harmonised activity", v: summary.data?.kpi?.harmonized_activity, c: "#ff7a3d", u: "cell-days" },
          { l: "Hottest fire", v: summary.data?.kpi?.frp_max, c: "#ff4d4f", u: "MW" },
        ].map((k, i) => (
          <div key={k.l} className="panel-in glass rounded-xl px-4 py-2 text-center" style={{ animationDelay: `${0.15 + i * 0.12}s` }}>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{k.l}</div>
            <div className="font-mono text-lg font-semibold" style={{ color: k.c }}>
              <CountUp value={k.v} />{k.u && <span className="ml-1 text-[10px] font-normal text-slate-500">{k.u}</span>}
            </div>
          </div>
        ))}
      </div>

      {!panelOpen && (
        <button onClick={() => setPanelOpen(true)} className="panel-in absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-900/92 px-3 py-2 text-[12px] text-slate-200 shadow-2xl backdrop-blur hover:text-white">
          <Layers size={13} /> View & area
        </button>
      )}
      <div className={clsx("panel-in absolute left-3 top-3 z-10 max-h-[calc(100%-24px)] w-[min(262px,calc(100%-24px))] space-y-3 overflow-y-auto rounded-xl border border-ink-600 bg-ink-900/92 p-3 shadow-2xl backdrop-blur", !panelOpen && "hidden")}>
        <div>
          <div className="label mb-1.5 flex items-center gap-1"><Layers size={11} /> View
            <button className="ml-auto rounded p-0.5 text-slate-400 hover:bg-ink-800 hover:text-white" title="Fold this panel away" onClick={() => setPanelOpen(false)}><ChevronUp size={14} /></button>
          </div>
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
            <button className={clsx("btn flex-1 justify-center", draw === "bbox" && "!border-sky-400 !text-sky-300")} onClick={() => setDraw(draw === "bbox" ? "none" : "bbox")}><Square size={12} /> {draw === "bbox" ? "Cancel" : "Select area"}</button>
            {filters.aoi.kind !== "world" && <button className="btn" title="Back to the whole world" onClick={() => setFilters({ aoi: { kind: "world" } })}><X size={12} /></button>}
          </div>
          <div className="mt-1.5 flex"><AreaSearch className="w-full !text-[12px]" /></div>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400">
            <span className="min-w-0 flex-1 truncate">{draw === "bbox" ? "Click two opposite corners on the map." : <>Current: <b className="text-slate-200">{aoiLabel(filters.aoi)}</b></>}</span>
            <div className="flex shrink-0 overflow-hidden rounded-md border border-ink-600" role="group" aria-label="Map view">
              {([["globe", Globe2, "3D globe"], ["flat", MapIcon, "Flat map"]] as const).map(([v, I, label]) => (
                <button key={v} title={label} aria-label={label} aria-pressed={proj === v} onClick={() => setProj(v)}
                  className={clsx("flex h-7 w-8 items-center justify-center transition", proj === v ? "bg-ink-700 text-white" : "text-slate-400 hover:bg-ink-800 hover:text-slate-200")}>
                  <I size={15} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {selectedDate && (
        <button className="float-text absolute bottom-8 left-1/2 z-10 -translate-x-1/2 text-[12px] text-slate-200 hover:text-white" onClick={() => setSelectedDate(null)}>
          Showing {selectedDate} only · <span className="text-orange-300 underline underline-offset-2">show whole period</span>
        </button>
      )}

      <div className={clsx("panel-in absolute right-12 top-3 z-10 rounded-lg border border-ink-600 bg-ink-900/90 px-3 py-2 text-[11px] text-slate-300", panelOpen && "hidden sm:block")}>
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
            </>
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
