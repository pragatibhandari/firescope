import React, { useState } from "react";
import { Info, X } from "lucide-react";
import { useStore } from "../lib/store";
import { aoiLabel, fmt } from "../lib/format";

/**
 * Data sources & attribution for the map: a small button that expands into a description
 * of exactly which satellite data the map shows (also carries the basemap credits).
 */
export function DataInfo() {
  const [open, setOpen] = useState(false);
  const { status, filters } = useStore();
  const live = (status?.datasets || []).filter((d: any) => d.dataset === "live");
  const total = live.reduce((a: number, d: any) => a + (Number(d.n) || 0), 0);
  const first = live.map((d: any) => String(d.first_date).slice(0, 10)).sort()[0];
  const last = status?.live_last_observation;
  const A = ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">{children}</a>;

  if (!open)
    return (
      <button onClick={() => setOpen(true)} title="About the data on this map"
        className="absolute bottom-3 right-3 z-20 flex h-7 items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-2.5 text-[11px] text-slate-300 backdrop-blur hover:text-white">
        <Info size={13} /> Data
      </button>
    );

  return (
    <div className="glass absolute bottom-3 right-3 z-20 max-h-[calc(100%-24px)] w-[360px] overflow-y-auto rounded-xl p-4 text-[12px] leading-relaxed text-slate-300">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] font-semibold text-white">Data on this map</div>
        <button className="text-slate-400 hover:text-white" onClick={() => setOpen(false)} title="Close"><X size={15} /></button>
      </div>

      <p>Every dot is a real <b className="text-slate-100">active-fire detection</b>: a satellite pixel where the sensor measured a thermal anomaly from burning (wildfires, agricultural and other fires).</p>

      <div className="mt-3 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">Satellite sources</div>
      <ul className="mt-1 space-y-1.5">
        <li><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full border-2 border-modis align-middle" /><b className="text-slate-100">MODIS</b>, Collection 6.1 active fires on NASA's Terra (since 2000) and Aqua (since 2002) satellites. About 1 km pixels; the long historical record.</li>
        <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-viirs align-middle" /><b className="text-slate-100">VIIRS</b>, 375 m active fires on S-NPP (since 2012), NOAA-20 and NOAA-21. Finer pixels detect smaller and cooler fires.</li>
        <li>Products: <b className="text-slate-100">Standard (SP)</b>, the quality-controlled science archive, and <b className="text-slate-100">Near Real-Time (NRT)</b>, available within about 3 hours of the overpass.</li>
      </ul>

      <div className="mt-3 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">Distributed by</div>
      <p className="mt-1"><A href="https://firms.modaps.eosdis.nasa.gov/">NASA FIRMS</A> (Fire Information for Resource Management System), part of NASA's LANCE / Earthdata.</p>

      <div className="mt-3 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">In this view</div>
      <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-300">
        <li>Period: {filters.start} → {filters.end} (UTC)</li>
        <li>Area: {aoiLabel(filters.aoi)} · Sensors: {filters.sensors.join(" + ")}</li>
        <li>Confidence: {filters.min_conf} and above · Product: {filters.product === "all" ? "SP + NRT" : filters.product}</li>
        {total > 0 && <li>Archive: {fmt(total)} detections{first ? `, ${first} → ${last || "?"}` : ""}</li>}
      </ul>
      <p className="mt-2 text-[11px] text-slate-400">Large selections are drawn as a random sample to keep the globe fast; counts, the calendar and all analytics use every detection. MODIS and VIIRS are harmonised into one record. See <a href="#/methodology" className="text-sky-300 hover:underline">Methodology</a>.</p>

      <div className="mt-3 border-t border-white/10 pt-2 text-[10.5px] text-slate-500">
        Basemap: <A href="https://openfreemap.org">OpenFreeMap</A> · © <A href="https://openmaptiles.org">OpenMapTiles</A> · © <A href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</A>. Country borders: Natural Earth. Rendering: MapLibre.
      </div>
    </div>
  );
}
