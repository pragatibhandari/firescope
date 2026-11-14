import React, { useEffect, useRef, useState } from "react";
import maplibregl, { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { apiGet } from "../lib/api";

export type MapMode = "modis" | "viirs" | "combined" | "harmonized" | "intensity" | "density";
export type DrawMode = "none" | "bbox" | "polygon";

export interface FireMapProps {
  points?: any;
  density?: any;
  recurrence?: any;
  aoiGeom?: any;
  mode?: MapMode;
  cluster?: boolean;
  heat?: boolean;
  showModis?: boolean;
  showViirs?: boolean;
  showBoundaries?: boolean;
  dRange?: [number, number] | null;
  fitTo?: [number, number, number, number] | null;
  drawMode?: DrawMode;
  onDraw?: (g: { kind: "bbox"; bbox: [number, number, number, number] } | { kind: "polygon"; geometry: any }) => void;
  onCountryClick?: (name: string) => void;
  height?: number | string;
  compact?: boolean;
}

// Basemap: OpenFreeMap "dark" vector style (free, no API key). If it cannot be reached, a plain dark
// background is used and the country boundaries from the backend still draw the map.
const BASEMAP_URL = "https://tiles.openfreemap.org/styles/dark";
const FALLBACK_STYLE: any = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b111c" } }],
};
let styleCache: any = null;
async function loadBaseStyle(): Promise<any> {
  if (styleCache) return styleCache;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(BASEMAP_URL, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(String(r.status));
    styleCache = await r.json();
  } catch {
    styleCache = FALLBACK_STYLE;
  }
  return styleCache;
}

const EMPTY = { type: "FeatureCollection", features: [] };
const INFERNO = ["#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"];

function popupHtml(p: any) {
  const row = (k: string, v: any) => (v === null || v === undefined || v === "" || v === "nan" ? "" : `<tr><td style="color:#94a3b8;padding-right:10px">${k}</td><td style="font-family:JetBrains Mono,monospace">${v}</td></tr>`);
  const col = p.sensor === "MODIS" ? "#2f8fd8" : "#d4b030";
  return `<div style="font-size:11.5px;min-width:230px">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;font-weight:600"><span style="width:8px;height:8px;border-radius:50%;background:${col}"></span>${p.sensor} · ${p.platform}</div>
    <table>${row("Lat / Lon", p._ll)}${row("Acquired (UTC)", p.t)}${row("Day/Night", p.dn)}${row("Confidence", `${p.conf} (${p.conf_raw})`)}
    ${row("FRP", p.frp != null ? p.frp + " MW" : null)}${row("Brightness", p.bright != null ? p.bright + " K" : null)}
    ${row("Scan × Track", p.scan != null ? `${p.scan} × ${p.track} km` : null)}${row("Product", p.product)}${row("Source", p.src)}
    ${row("Country", p.country)}${row("Harmonization", `<span style="color:#fdba74">${p.status}</span>`)}${row("Est. event id", p.event >= 0 ? p.event : "–")}</table>
    <div style="margin-top:6px;color:#64748b;font-size:10px">Estimated events are space-time clusters of detections, not confirmed fires.</div></div>`;
}

export default function FireMap(props: FireMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const drawPts = useRef<[number, number][]>([]);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    let cancelled = false;
    let inst: MLMap | null = null;
    loadBaseStyle().then((style) => {
    if (cancelled || !el.current) return;
    const m = new maplibregl.Map({ container: el.current!, style, center: [10, 15], zoom: 1.3, maxZoom: 15, renderWorldCopies: false,
      attributionControl: { compact: true, customAttribution: "Fire data: NASA FIRMS" } } as any);
    map.current = m;
    inst = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    m.on("load", async () => {
      m.addSource("countries", { type: "geojson", data: EMPTY as any });
      m.addLayer({ id: "countries-hit", type: "fill", source: "countries", paint: { "fill-color": "#000", "fill-opacity": 0 } });
      m.addLayer({ id: "countries-line", type: "line", source: "countries", paint: { "line-color": "#64748b", "line-width": 0.6, "line-opacity": 0.55 } });
      m.addSource("recurrence", { type: "geojson", data: EMPTY as any });
      m.addLayer({ id: "recurrence", type: "fill", source: "recurrence", paint: {
        "fill-color": ["interpolate", ["linear"], ["get", "share"], 0, INFERNO[0], 0.25, INFERNO[1], 0.5, INFERNO[2], 0.75, INFERNO[3], 1, INFERNO[4]], "fill-opacity": 0.75 } });
      m.addSource("density", { type: "geojson", data: EMPTY as any });
      m.addLayer({ id: "density", type: "fill", source: "density", paint: { "fill-color": "#e0552f", "fill-opacity": 0.7 } });
      m.addSource("aoi", { type: "geojson", data: EMPTY as any });
      m.addLayer({ id: "aoi-fill", type: "fill", source: "aoi", paint: { "fill-color": "#e0552f", "fill-opacity": 0.05 } });
      m.addLayer({ id: "aoi-line", type: "line", source: "aoi", paint: { "line-color": "#ff8a5c", "line-width": 1.6, "line-dasharray": [2, 1] } });
      m.addSource("pts", { type: "geojson", data: EMPTY as any });
      m.addSource("ptsc", { type: "geojson", data: EMPTY as any, cluster: true, clusterRadius: 38, clusterMaxZoom: 9 } as any);
      m.addLayer({ id: "heat", type: "heatmap", source: "pts", maxzoom: 11, paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["coalesce", ["get", "frp"], 5], 0, 0.15, 50, 0.6, 500, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 9, 2.2],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 5, 6, 14, 10, 24],
        "heatmap-opacity": 0.85,
        "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.15, INFERNO[0], 0.35, INFERNO[1], 0.55, INFERNO[2], 0.8, INFERNO[3], 1, INFERNO[4]] } });
      // MODIS: larger blue rings (1 km footprint); VIIRS: small gold dots (375 m) - shape AND colour differ
      m.addLayer({ id: "pts-modis", type: "circle", source: "pts", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 2.4, 6, 4, 10, 7], "circle-color": "rgba(47,143,216,0.25)",
        "circle-stroke-color": "#2f8fd8", "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 1, 0.8, 8, 1.6] } });
      m.addLayer({ id: "pts-viirs", type: "circle", source: "pts", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 1.4, 6, 2.4, 10, 4.5], "circle-color": "#d4b030", "circle-opacity": 0.9 } });
      m.addLayer({ id: "pts-frp", type: "circle", source: "pts", paint: {
        "circle-radius": ["interpolate", ["linear"], ["coalesce", ["get", "frp"], 1], 1, 2, 30, 4, 200, 7, 1000, 11],
        "circle-color": ["interpolate", ["linear"], ["coalesce", ["get", "frp"], 1], 1, INFERNO[0], 10, INFERNO[1], 40, INFERNO[2], 150, INFERNO[3], 600, INFERNO[4]],
        "circle-opacity": 0.85, "circle-stroke-color": "#000", "circle-stroke-width": 0.3 } });
      m.addLayer({ id: "clusters", type: "circle", source: "ptsc", filter: ["has", "point_count"], paint: {
        "circle-color": ["step", ["get", "point_count"], "#932667", 50, "#dd513a", 500, "#fca50a"],
        "circle-radius": ["step", ["get", "point_count"], 12, 50, 17, 500, 24], "circle-opacity": 0.85, "circle-stroke-color": "#0b111c", "circle-stroke-width": 2 } });
      m.addLayer({ id: "cluster-count", type: "symbol", source: "ptsc", filter: ["has", "point_count"], layout: {
        "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Regular"], "text-size": 11 }, paint: { "text-color": "#0b111c" } });
      m.addLayer({ id: "cluster-pt", type: "circle", source: "ptsc", filter: ["!", ["has", "point_count"]], paint: {
        "circle-radius": 3, "circle-color": ["match", ["get", "sensor"], "MODIS", "#2f8fd8", "#d4b030"] } });
      m.addSource("draw", { type: "geojson", data: EMPTY as any });
      m.addLayer({ id: "draw-fill", type: "fill", source: "draw", filter: ["==", "$type", "Polygon"], paint: { "fill-color": "#38bdf8", "fill-opacity": 0.12 } });
      m.addLayer({ id: "draw-line", type: "line", source: "draw", paint: { "line-color": "#38bdf8", "line-width": 2 } });
      m.addLayer({ id: "draw-pt", type: "circle", source: "draw", filter: ["==", "$type", "Point"], paint: { "circle-radius": 4, "circle-color": "#38bdf8" } });

      for (const id of ["pts-modis", "pts-viirs", "pts-frp", "cluster-pt"]) {
        m.on("click", id, (e: any) => {
          if (propsRef.current.drawMode && propsRef.current.drawMode !== "none") return;
          const f = e.features[0];
          const [lon, lat] = f.geometry.coordinates;
          new maplibregl.Popup({ maxWidth: "340px" }).setLngLat([lon, lat]).setHTML(popupHtml({ ...f.properties, _ll: `${lat.toFixed(4)}, ${lon.toFixed(4)}` })).addTo(m);
        });
        m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", id, () => (m.getCanvas().style.cursor = ""));
      }
      m.on("click", "clusters", async (e: any) => {
        const f = e.features[0];
        const z = await (m.getSource("ptsc") as any).getClusterExpansionZoom(f.properties.cluster_id);
        m.easeTo({ center: f.geometry.coordinates, zoom: z });
      });
      for (const id of ["density", "recurrence"]) {
        m.on("click", id, (e: any) => {
          const p = e.features[0].properties;
          const html = id === "density"
            ? `<div style="font-size:11.5px"><b>Harmonised activity</b><br/>${p.harmonized} harmonised cell-days<br/>${p.cell_days} union cell-days · ${p.detections} raw detections<br/>FRP sum ${p.frp_sum} MW</div>`
            : `<div style="font-size:11.5px"><b>Hotspot recurrence</b><br/>Burned in ${p.years} distinct years (${Math.round(p.share * 100)}% of record)<br/>${p.n} detections</div>`;
          new maplibregl.Popup().setLngLat(e.lngLat).setHTML(html).addTo(m);
        });
      }
      m.on("click", "countries-hit", (e: any) => {
        const pr = propsRef.current;
        if (pr.onCountryClick && (!pr.drawMode || pr.drawMode === "none") && e.originalEvent.shiftKey) pr.onCountryClick(e.features[0].properties.name);
      });
      try { (m.getSource("countries") as GeoJSONSource).setData(await apiGet("/api/geo/countries")); } catch { /* offline */ }
      setReady(true);
    });
    });
    return () => { cancelled = true; inst?.remove(); map.current = null; };
  }, []);

  // drawing tools
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const src = m.getSource("draw") as GeoJSONSource;
    drawPts.current = [];
    src.setData(EMPTY as any);
    if (!props.drawMode || props.drawMode === "none") { m.getCanvas().style.cursor = ""; m.doubleClickZoom.enable(); return; }
    m.getCanvas().style.cursor = "crosshair";
    m.doubleClickZoom.disable();
    const render = (hover?: [number, number]) => {
      const pts = [...drawPts.current, ...(hover ? [hover] : [])];
      const feats: any[] = pts.map((c) => ({ type: "Feature", geometry: { type: "Point", coordinates: c } }));
      if (props.drawMode === "bbox" && pts.length === 2) {
        const [a, b] = pts;
        feats.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [a[0], a[1]]]] } });
      } else if (pts.length >= 2) {
        feats.push({ type: "Feature", geometry: pts.length >= 3 ? { type: "Polygon", coordinates: [[...pts, pts[0]]] } : { type: "LineString", coordinates: pts } });
      }
      src.setData({ type: "FeatureCollection", features: feats } as any);
    };
    const finishPoly = () => {
      if (drawPts.current.length >= 3) {
        props.onDraw?.({ kind: "polygon", geometry: { type: "Polygon", coordinates: [[...drawPts.current, drawPts.current[0]]] } });
        drawPts.current = []; render();
      }
    };
    const click = (e: any) => {
      const c: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      drawPts.current.push(c);
      if (props.drawMode === "bbox" && drawPts.current.length === 2) {
        const [a, b] = drawPts.current;
        props.onDraw?.({ kind: "bbox", bbox: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] });
        drawPts.current = [];
      }
      render();
    };
    const move = (e: any) => { if (drawPts.current.length) render([e.lngLat.lng, e.lngLat.lat]); };
    const dbl = (e: any) => { e.preventDefault(); drawPts.current.pop(); finishPoly(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Enter") finishPoly(); if (e.key === "Escape") { drawPts.current = []; render(); } };
    m.on("click", click); m.on("mousemove", move); m.on("dblclick", dbl); window.addEventListener("keydown", key);
    return () => { m.off("click", click); m.off("mousemove", move); m.off("dblclick", dbl); window.removeEventListener("keydown", key); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.drawMode, ready]);

  // data + visibility
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const mode = props.mode || "combined";
    (m.getSource("pts") as GeoJSONSource).setData(props.points || EMPTY);
    (m.getSource("ptsc") as GeoJSONSource).setData(props.cluster ? props.points || EMPTY : EMPTY);
    (m.getSource("density") as GeoJSONSource).setData(props.density || EMPTY);
    (m.getSource("recurrence") as GeoJSONSource).setData(props.recurrence || EMPTY);
    (m.getSource("aoi") as GeoJSONSource).setData(props.aoiGeom ? { type: "Feature", geometry: props.aoiGeom, properties: {} } as any : EMPTY);
    const mx = props.density?.max || 1;
    m.setPaintProperty("density", "fill-color", ["interpolate", ["linear"], ["/", ["get", "harmonized"], mx], 0, INFERNO[0], 0.05, INFERNO[1], 0.2, INFERNO[2], 0.5, INFERNO[3], 1, INFERNO[4]]);
    const vis = (id: string, on: boolean) => m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    const showM = (props.showModis ?? true) && ["modis", "combined", "harmonized"].includes(mode);
    const showV = (props.showViirs ?? true) && ["viirs", "combined", "harmonized"].includes(mode);
    const ptsMode = !props.cluster && mode !== "density";
    vis("pts-modis", ptsMode && showM && mode !== "intensity");
    vis("pts-viirs", ptsMode && showV && mode !== "intensity");
    vis("pts-frp", ptsMode && mode === "intensity");
    vis("heat", !!props.heat && mode !== "density");
    vis("density", mode === "harmonized" && !!props.density);
    vis("recurrence", mode === "density");
    for (const id of ["clusters", "cluster-count", "cluster-pt"]) vis(id, !!props.cluster && mode !== "density");
    vis("countries-line", props.showBoundaries ?? true);
    const sensorF: any = mode === "modis" ? ["==", ["get", "sensor"], "MODIS"] : mode === "viirs" ? ["==", ["get", "sensor"], "VIIRS"] : true;
    const tF: any = props.dRange ? ["all", [">=", ["get", "d"], props.dRange[0]], ["<=", ["get", "d"], props.dRange[1]]] : true;
    m.setFilter("pts-modis", ["all", ["==", ["get", "sensor"], "MODIS"], tF]);
    m.setFilter("pts-viirs", ["all", ["==", ["get", "sensor"], "VIIRS"], tF]);
    m.setFilter("pts-frp", ["all", sensorF, tF, ...(props.showModis === false ? [["!=", ["get", "sensor"], "MODIS"]] : []), ...(props.showViirs === false ? [["!=", ["get", "sensor"], "VIIRS"]] : [])] as any);
    m.setFilter("heat", ["all", sensorF, tF] as any);
  }, [ready, props.points, props.density, props.recurrence, props.aoiGeom, props.mode, props.cluster, props.heat, props.showModis, props.showViirs, props.showBoundaries, props.dRange]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !props.fitTo) return;
    const [w, s, e, n] = props.fitTo;
    if ([w, s, e, n].some((v) => !Number.isFinite(v))) return;
    if (e - w > 300) { m.easeTo({ center: [10, 15], zoom: 1.3 }); return; }
    m.fitBounds([[w, s], [e, n]], { padding: 40, maxZoom: 9, duration: 700 });
  }, [ready, JSON.stringify(props.fitTo)]);

  return <div ref={el} style={{ height: props.height ?? "100%", width: "100%" }} className="overflow-hidden rounded-xl border border-ink-700" />;
}
