import React, { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import clsx from "clsx";
import {
  Activity, BookOpen, CalendarDays, Database, FileDown, FlaskConical, Globe2, History, LayoutDashboard, Map, Satellite, ShieldAlert, X,
} from "lucide-react";
import { useStore } from "../lib/store";
import { apiGet } from "../lib/api";
import { aoiLabel, parseLatLon } from "../lib/format";
import { useUploadQueue } from "../lib/uploadQueue";

const NAV = [
  { to: "/", label: "Global Fire Map", icon: Map },
  { to: "/overview", label: "Dashboard", icon: LayoutDashboard },
  { to: "/calendar", label: "Burning Calendar", icon: CalendarDays },
  { to: "/lab", label: "Harmonization Lab", icon: FlaskConical },
  { to: "/history", label: "Historical Analysis", icon: History },
  { to: "/anomalies", label: "Anomaly Detection", icon: ShieldAlert },
  { to: "/aoi", label: "AOI Explorer", icon: Globe2 },
  { to: "/reports", label: "Reports & Export", icon: FileDown },
  { to: "/sources", label: "Data Sources", icon: Database },
  { to: "/methodology", label: "Methodology", icon: BookOpen },
];

export function Sidebar() {
  const { status } = useStore();
  const firms = status?.firms;
  const queue = useUploadQueue();
  const pending = queue.filter((q) => q.state === "waiting" || q.state === "uploading").length;
  const doneN = queue.filter((q) => q.state === "done" || q.state === "failed").length;
  return (
    <aside className="flex h-full w-[218px] shrink-0 flex-col border-r border-ink-700 bg-ink-900">
      <NavLink to="/" title="FireScope home: Global Fire Map" className="flex items-center gap-2.5 rounded-lg px-4 pb-4 pt-5 transition hover:opacity-90">
        <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-harm to-[#7a1d0c] shadow-lg shadow-harm/20">
          <Satellite size={18} className="text-white" />
        </div>
        <div>
          <div className="text-[15px] font-bold tracking-tight text-white">FireScope</div>
          <div className="text-[10px] leading-tight text-slate-500">Burning Activity Intelligence</div>
        </div>
      </NavLink>
      <nav className="flex-1 space-y-0.5 px-2">
        {NAV.map(({ to, label, icon: I }) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => clsx(
            "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition",
            isActive ? "bg-ink-700 font-medium text-white" : "text-slate-400 hover:bg-ink-800 hover:text-slate-200")}>
            <I size={15} /> {label}
          </NavLink>
        ))}
      </nav>
      {pending > 0 && (
        <NavLink to="/sources" className="mx-2 mb-1 block rounded-lg border border-harm/40 bg-harm/10 p-2.5 text-[11px] text-slate-200">
          <div className="flex justify-between"><span className="animate-pulse">Uploading files…</span><span className="font-mono">{doneN}/{queue.length}</span></div>
          <div className="mt-1 h-1 rounded bg-ink-700"><div className="h-1 rounded bg-harm" style={{ width: `${(doneN / Math.max(1, queue.length)) * 100}%` }} /></div>
        </NavLink>
      )}
      <div className="m-2 space-y-1.5 rounded-lg border border-ink-700 bg-ink-850 p-2.5 text-[11px]">
        <Row ok={!!status && !status.error} label="API" val={status?.error ? "offline" : status ? "connected" : "…"} />
        <Row ok={firms?.configured && firms?.reachable !== false} warn={!firms?.configured} label="FIRMS key"
          val={!firms ? "…" : !firms.configured ? "not set" : firms.reachable === false ? "unreachable" : "configured"} />
        <Row ok={status?.live_freshness_hours != null && status.live_freshness_hours < 48} warn label="Live data"
          val={status?.live_last_observation ? `to ${String(status.live_last_observation).slice(0, 10)}` : "none synced"} />
        {status?.autosync?.enabled && (
          <div className="pl-3.5 text-[10px] leading-snug text-slate-500" title={`Newest MODIS + VIIRS detections are fetched from NASA FIRMS automatically.${status.autosync.last_run ? " Last run " + String(status.autosync.last_run).slice(0, 16).replace("T", " ") + " UTC" + (status.autosync.last_status ? " (" + status.autosync.last_status + ")" : "") : ""}`}>
            Auto-updates from NASA every {Number(status.autosync.every_hours)} h
          </div>
        )}
      </div>
      <div className="px-4 pb-3 text-[10px] leading-snug text-slate-600">Data: NASA FIRMS · MODIS C6.1 & VIIRS 375 m</div>
    </aside>
  );
}

function Row({ ok, warn, label, val }: { ok?: boolean; warn?: boolean; label: string; val: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-slate-400">
        <span className={clsx("h-1.5 w-1.5 rounded-full", ok ? "bg-emerald-400" : warn ? "bg-amber-400" : "bg-red-500")} />{label}
      </span>
      <span className="truncate text-slate-300">{val}</span>
    </div>
  );
}

const PRESETS: { l: string; days?: number; all?: boolean }[] = [
  { l: "30d", days: 30 }, { l: "90d", days: 90 }, { l: "1y", days: 365 }, { l: "5y", days: 5 * 365 }, { l: "All", all: true },
];

export function FilterBar() {
  const { filters, setFilters, params, setParams, status } = useStore();
  const cov = status?.coverage?.[filters.dataset] || [];
  const lastDate = cov.length ? cov.map((c: any) => c.last_date).sort().slice(-1)[0]?.slice(0, 10) : null;
  const firstDate = cov.length ? cov.map((c: any) => c.first_date).sort()[0]?.slice(0, 10) : null;
  const preset = (p: typeof PRESETS[0]) => {
    const end = lastDate || filters.end;
    if (p.all) return setFilters({ start: firstDate || "2001-01-01", end });
    const d = new Date(end + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - (p.days! - 1));
    setFilters({ start: d.toISOString().slice(0, 10), end });
  };
  const toggleSensor = (s: string) => {
    const has = filters.sensors.includes(s);
    const next = has ? filters.sensors.filter((x) => x !== s) : [...filters.sensors, s];
    if (next.length) setFilters({ sensors: next });
  };
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b border-ink-700 bg-ink-900/80 px-3 py-2.5 backdrop-blur md:px-5">
      <Field label="Date range (UTC)">
        <div className="flex flex-wrap items-center gap-1">
          <input type="date" className="input w-[122px]" value={filters.start} onChange={(e) => e.target.value && setFilters({ start: e.target.value })} />
          <span className="text-slate-500">→</span>
          <input type="date" className="input w-[122px]" value={filters.end} onChange={(e) => e.target.value && setFilters({ end: e.target.value })} />
          <div className="seg ml-1">{PRESETS.map((p) => <button key={p.l} onClick={() => preset(p)}>{p.l}</button>)}</div>
        </div>
      </Field>
      <Field label="Satellites">
        <div className="seg">
          <button className={clsx(filters.sensors.includes("MODIS") && "on")} onClick={() => toggleSensor("MODIS")}><span className="mr-1 inline-block h-2 w-2 rounded-full bg-modis" />MODIS</button>
          <button className={clsx(filters.sensors.includes("VIIRS") && "on")} onClick={() => toggleSensor("VIIRS")}><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-viirs" />VIIRS</button>
        </div>
      </Field>
      <Field label="Geographic area">
        <div className="flex items-center gap-1">
          <span className="chip max-w-[180px] truncate border-harm/40 text-slate-100" title={aoiLabel(filters.aoi)}>{aoiLabel(filters.aoi)}
            {filters.aoi.kind !== "world" && <X size={12} className="cursor-pointer text-slate-400 hover:text-white" onClick={() => setFilters({ aoi: { kind: "world" } })} />}
          </span>
          <AreaSearch className="w-[170px]" />
        </div>
      </Field>
      <Field label="Product">
        <select className="input" value={filters.product} onChange={(e) => setFilters({ product: e.target.value as any })}>
          <option value="all">All (SP + NRT)</option><option value="SP">Standard (SP)</option><option value="NRT">Near real-time</option>
        </select>
      </Field>
      <Field label="Min. confidence">
        <select className="input" value={filters.min_conf} onChange={(e) => setFilters({ min_conf: e.target.value as any })}>
          <option value="low">Low +</option><option value="nominal">Nominal +</option><option value="high">High only</option>
        </select>
      </Field>
      <Field label="Aggregation grid">
        <select className="input" value={params.grid_deg} onChange={(e) => setParams({ grid_deg: Number(e.target.value) })}>
          {[0.005, 0.01, 0.025, 0.05, 0.1, 0.25].map((g) => <option key={g} value={g}>{g}° (~{Math.round(g * 111 * 10) / 10} km)</option>)}
        </select>
      </Field>
    </div>
  );
}

let COUNTRY_LIST: { name: string }[] = [];
/** Search box for the area of interest: a country name, "lat, lon" (1° box) or "lat1, lon1, lat2, lon2". */
export function AreaSearch({ className }: { className?: string }) {
  const { setFilters } = useStore();
  const [countries, setCountries] = useState<{ name: string }[]>(COUNTRY_LIST);
  const [q, setQ] = useState("");
  const [bad, setBad] = useState(false);
  useEffect(() => { if (!COUNTRY_LIST.length) apiGet("/api/regions").then((r) => { COUNTRY_LIST = r; setCountries(r); }).catch(() => {}); }, []);
  const submit = (v: string) => {
    const c = countries.find((x) => x.name.toLowerCase() === v.trim().toLowerCase());
    if (c) { setFilters({ aoi: { kind: "country", country: c.name } }); setQ(""); return; }
    const box = parseLatLon(v);
    if (box) { setFilters({ aoi: box }); setQ(""); return; }
    setBad(true);
  };
  return (
    <>
      <input list="area-countries" className={clsx("input", bad && "!border-red-500/60", className)} placeholder="Country or lat, lon" value={q}
        title="Type a country, or coordinates: 'lat, lon' (selects a 1° box around the point) or 'lat1, lon1, lat2, lon2'. Press Enter."
        onChange={(e) => { setBad(false); setQ(e.target.value); if (countries.some((c) => c.name === e.target.value)) submit(e.target.value); }}
        onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) submit(q); }} />
      <datalist id="area-countries">{countries.map((c) => <option key={c.name} value={c.name} />)}</datalist>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><span className="label">{label}</span>{children}</div>;
}

/** Shown only when the server has no satellite data at all (no simulated fallback). */
export function DataBanner() {
  const { status } = useStore();
  const hasLive = (status?.datasets || []).some((d: any) => d.dataset === "live");
  if (!status || status.error || hasLive) return null;
  return (
    <div className="flex items-center gap-2 border-b border-amber-900/50 bg-amber-950/40 px-5 py-1.5 text-[12px] text-amber-200">
      <Activity size={13} /> No satellite data has been loaded on this server yet. Go to <b>Data Sources</b> to sync from NASA FIRMS or upload FIRMS CSV/GeoJSON files.
    </div>
  );
}
