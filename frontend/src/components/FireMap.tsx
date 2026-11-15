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
  /** Start as a 3D globe (used by the cinematic intro); the caller morphs it with morphToFlat(). */
  startGlobe?: boolean;
  /** Ignore fitTo while the intro animation owns the camera. */
  holdCamera?: boolean;
  initialView?: { center: [number, number]; zoom: number };
  onMap?: (m: MLMap) => void;
  onReady?: () => void; // all FireScope layers have been added
  hideAttribution?: boolean; // the page shows its own data/attribution panel
}

/** Atmosphere + space colours for the globe view. */
export const SPACE_SKY: any = {
  "sky-color": "#070b13", "horizon-color": "#2a3f6b", "fog-color": "#0b111c",
  "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.8, "fog-ground-blend": 0.6,
  "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 4, 1, 6, 0],
};

/**
 * Smoothly unfold the globe into a flat world map (projection transition 0 -> 1),
 * zooming so the whole world fits the container. Resolves when finished.
 */
/** Newly loaded hotspots fade in (opacity 0 -> normal) instead of popping onto the map. */
function revealPoints(m: MLMap, ms = 1400) {
  const set = (k: number) => {
    try {
      m.setPaintProperty("pts-glow", "circle-opacity", ["interpolate", ["linear"], ["zoom"], 0, 0.55 * k, 6, 0.3 * k, 10, 0.12 * k]);
      m.setPaintProperty("pts-modis", "circle-opacity", k);
      m.setPaintProperty("pts-modis", "circle-stroke-opacity", k);
      m.setPaintProperty("pts-viirs", "circle-opacity", 0.9 * k);
      m.setPaintProperty("pts-frp", "circle-opacity", 0.85 * k);
    } catch { /* style not ready */ }
  };
  set(0);
  const t0 = performance.now();
  const step = (now: number) => {
    const e = Math.min(1, (now - t0) / ms);
    set(1 - Math.pow(1 - e, 3));
    if (e < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function fitWorld(m: MLMap, duration: number) {
  // whole world, leaving room for the floating control panel on the left
  const wide = m.getContainer().clientWidth > 900;
  m.fitBounds([[-168, -56], [180, 76]], { padding: { top: 70, bottom: 70, left: wide ? 290 : 20, right: 20 }, duration });
}

export function morphToFlat(m: MLMap, duration = 2600): Promise<void> {
  return new Promise((resolve) => {
    const c = m.getContainer();
    const fromZoom = m.getZoom();
    const toZoom = Math.max(0.6, Math.log2(c.clientWidth / 512) + 0.05);
    const fromCenter = m.getCenter();
    const toCenter = { lng: 12, lat: 18 };
    const pp = m.getPadding();
    const p0 = { top: pp.top ?? 0, bottom: pp.bottom ?? 0, left: pp.left ?? 0, right: pp.right ?? 0 };
    const t0 = performance.now();
    const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const step = (now: number) => {
      const x = Math.min(1, (now - t0) / duration);
      const e = ease(x);
      m.setProjection({ type: ["vertical-perspective", "mercator", e] as any });
      m.jumpTo({
        padding: { top: p0.top * (1 - e), bottom: p0.bottom * (1 - e), left: p0.left * (1 - e), right: p0.right * (1 - e) },
        zoom: fromZoom + (toZoom - fromZoom) * e,
        center: [fromCenter.lng + (toCenter.lng - fromCenter.lng) * e, fromCenter.lat + (toCenter.lat - fromCenter.lat) * e],
      });
      if (x < 1) requestAnimationFrame(step);
      else { m.setProjection({ type: "mercator" }); resolve(); }
    };
    requestAnimationFrame(step);
  });
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

/** Place names in English only (no second line in the local script) and in normal case, not ALL CAPS. */
function englishLabels(style: any): any {
  for (const l of style.layers || []) {
    if (l.type !== "symbol" || !l.layout?.["text-field"]) continue;
    if (!JSON.stringify(l.layout["text-field"]).includes("name")) continue; // keep road numbers etc.
    l.layout["text-field"] = ["coalesce", ["get", "name_en"], ["get", "name:en"], ["get", "name:latin"], ["get", "name"]];
    l.layout["text-transform"] = "none";
    // readable on any background: light text with a dark outline, sized by zoom (small at world view, larger when zoomed in)
    const country = l.id.startsWith("place_country");
    const big = country || l.id === "place_city_large" || l.id === "place_state";
    l.layout["text-size"] = country
      ? ["interpolate", ["linear"], ["zoom"], 1, 9, 3, 11, 5, 13, 8, 15]
      : big
        ? ["interpolate", ["linear"], ["zoom"], 2, 9, 5, 11, 8, 13, 12, 15]
        : ["interpolate", ["linear"], ["zoom"], 4, 9, 8, 11, 12, 13, 16, 14];
    l.layout["text-letter-spacing"] = country ? 0.04 : 0.02;
    l.layout["text-max-width"] = 6;
    // screen-facing labels stay crisp and steady while the globe turns (surface-aligned text shimmers);
    // compact, centred labels keep the part that can overhang the rim small
    l.layout["text-pitch-alignment"] = "viewport";
    l.layout["text-rotation-alignment"] = "viewport";
    l.layout["text-anchor"] = "center";
    l.layout["text-padding"] = 3;
    l.paint = { ...(l.paint || {}),
      "text-color": country ? "#f1f5f9" : "#e2e8f0",
      "text-halo-color": "rgba(3,10,25,0.9)",
      "text-halo-width": 1.4,
      "text-halo-blur": 0.4,
      "text-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.85, 4, 0.95] };
  }
  // declutter the world view: smaller places only appear as you zoom in
  const MINZOOM: Record<string, number> = { place_other: 9, place_suburb: 10, place_village: 9, place_town: 7, place_city: 5.5, place_city_large: 3.5, place_state: 4.5 };
  const layers: any[] = style.layers || [];
  for (const l of layers) if (MINZOOM[l.id] != null) l.minzoom = Math.max(l.minzoom ?? 0, MINZOOM[l.id]);
  // national capitals are labelled from the start (until regular city labels take over)
  const city = layers.find((l) => l.id === "place_city_large") || layers.find((l) => l.id === "place_city");
  const ci = layers.findIndex((l) => l.id.startsWith("place_country"));
  if (city && ci > 0 && !layers.some((l) => l.id === "place_capital")) {
    const cap = JSON.parse(JSON.stringify(city));
    cap.id = "place_capital";
    cap.minzoom = 1.5; cap.maxzoom = 5.5;
    cap.filter = ["all", ["==", ["get", "class"], "city"], ["==", ["get", "capital"], 2]];
    layers.splice(ci, 0, cap);
  }
  return style;
}

/**
 * Earth colours: "color" = natural colours (blue oceans, green land, white ice) used while data loads;
 * "dark" = the original dark basemap that makes the fire hotspots stand out. Changes fade smoothly.
 */
const EARTH_COLORS: Record<string, [string, string]> = {
  background: ["background-color", "#3d5c3a"],
  water: ["fill-color", "#0f4c81"],
  waterway: ["line-color", "#0f4c81"],
  landcover_wood: ["fill-color", "#2e5530"],
  landuse_park: ["fill-color", "#3f6a3c"],
  landuse_residential: ["fill-color", "#5a5a4a"],
  landcover_glacier: ["fill-color", "#e6eef3"],
  landcover_ice_shelf: ["fill-color", "#dce8f0"],
  "boundary_country_z0-4": ["line-color", "#c9d6e2"],
  "boundary_country_z5-": ["line-color", "#c9d6e2"],
};
const originalColors = new WeakMap<MLMap, Record<string, any>>();
export function setEarthTheme(m: MLMap, theme: "color" | "dark", ms = 1500) {
  const apply = () => {
    let orig = originalColors.get(m);
    if (!orig) { orig = {}; for (const [id, [prop]] of Object.entries(EARTH_COLORS)) if (m.getLayer(id)) orig[id] = m.getPaintProperty(id, prop as any); originalColors.set(m, orig); }
    for (const [id, [prop, col]] of Object.entries(EARTH_COLORS)) {
      if (!m.getLayer(id)) continue;
      try {
        m.setPaintProperty(id, `${prop}-transition` as any, { duration: ms, delay: 0 });
        m.setPaintProperty(id, prop as any, theme === "color" ? col : orig[id]);
      } catch { /* layer without this property */ }
    }
  };
  // note: isStyleLoaded() stays false until all tiles are in, so check for the layers themselves
  let has = false;
  try { has = !!m.getLayer("background") || !!m.getLayer("water"); } catch { /* style not parsed yet */ }
  if (has) apply(); else m.once("style.load", apply);
}
async function loadBaseStyle(): Promise<any> {
  if (styleCache) return styleCache;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(BASEMAP_URL, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(String(r.status));
    styleCache = englishLabels(await r.json());
  } catch {
    styleCache = FALLBACK_STYLE;
  }
  return styleCache;
}

// start fetching the basemap style as soon as the app loads, so the globe appears without delay
loadBaseStyle();

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
  const shownPts = useRef<any>(null);
  const worldFit = useRef(false); // true while showing the auto-fitted world view (re-fit on resize)
  const [ready, setReady] = useState(false);
  const drawPts = useRef<[number, number][]>([]);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    let cancelled = false;
    let inst: MLMap | null = null;
    let ro: ResizeObserver | null = null;
    loadBaseStyle().then((style) => {
    if (cancelled || !el.current) return;
    const iv = propsRef.current.initialView || { center: [10, 15] as [number, number], zoom: 1.3 };
    // with startGlobe the very first frame is already a globe (no flash of a flat map)
    const st = propsRef.current.startGlobe ? { ...style, projection: { type: "globe" } } : style;
    const m = new maplibregl.Map({ container: el.current!, style: st, center: iv.center, zoom: iv.zoom, maxZoom: 15, renderWorldCopies: false,
      attributionControl: propsRef.current.hideAttribution ? false : { compact: true, customAttribution: "Fire data: NASA FIRMS" } } as any);
    map.current = m;
    inst = m;
    propsRef.current.onMap?.(m); // camera can be framed and animated right away, before tiles/layers load
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    // keep the canvas sized correctly while the surrounding layout animates
    ro = new ResizeObserver(() => {
      try {
        m.resize();
        if (worldFit.current && !propsRef.current.holdCamera) fitWorld(m, 0);
      } catch { /* map removed */ }
    });
    // any user pan/zoom ends the "auto world view"
    m.on("movestart", (e: any) => { if (e.originalEvent) worldFit.current = false; });
    ro.observe(el.current!);
    m.on("style.load", () => {
      if (propsRef.current.startGlobe) {
        m.setProjection({ type: "globe" });
        try { m.setSky(SPACE_SKY); } catch { /* older style spec */ }
      }
    });
    m.once("style.load", async () => { // add layers as soon as the style is parsed (not after all tiles have loaded)
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
      // soft glow under detections: makes fires "burn" at global scale and on the globe
      m.addLayer({ id: "pts-glow", type: "circle", source: "pts", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 4, 3, 7, 8, 14],
        "circle-color": ["interpolate", ["linear"], ["coalesce", ["get", "frp"], 5], 0, "#ff8a3d", 50, "#ff5a1f", 300, "#ffd166"],
        "circle-blur": 1, "circle-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.55, 6, 0.3, 10, 0.12] } });
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
      propsRef.current.onReady?.();
    });
    });
    return () => { cancelled = true; ro?.disconnect(); inst?.remove(); map.current = null; };
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
    const ptsSrc = m.getSource("pts") as GeoJSONSource;
    // fade hotspots in when they first appear; later (streaming) updates just add to the map
    if (props.points?.features?.length && !shownPts.current?.features?.length) revealPoints(m);
    shownPts.current = props.points;
    ptsSrc.setData(props.points || EMPTY);
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
    vis("pts-glow", ptsMode && mode !== "intensity" && (showM || showV));
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
    m.setFilter("pts-glow", ["all", tF, ...(!showM ? [["!=", ["get", "sensor"], "MODIS"]] : []), ...(!showV ? [["!=", ["get", "sensor"], "VIIRS"]] : [])] as any);
  }, [ready, props.points, props.density, props.recurrence, props.aoiGeom, props.mode, props.cluster, props.heat, props.showModis, props.showViirs, props.showBoundaries, props.dRange]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !props.fitTo || props.holdCamera) return;
    const [w, s, e, n] = props.fitTo;
    if ([w, s, e, n].some((v) => !Number.isFinite(v))) return;
    if (e - w > 300) {
      // whole world, leaving room for the floating control panel on the left
      worldFit.current = true;
      fitWorld(m, 900);
      return;
    }
    worldFit.current = false;
    m.fitBounds([[w, s], [e, n]], { padding: 40, maxZoom: 9, duration: 700 });
  }, [ready, JSON.stringify(props.fitTo), props.holdCamera]);

  return <div ref={el} style={{ height: props.height ?? "100%", width: "100%" }} className="overflow-hidden rounded-xl border border-ink-700" />;
}
