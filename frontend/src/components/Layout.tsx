import React, { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import clsx from "clsx";
import {
  Activity, BookOpen, CalendarDays, Database, FileDown, FlaskConical, Globe2, History, LayoutDashboard, Map, Satellite, ShieldAlert, X,
} from "lucide-react";
import { useStore } from "../lib/store";
import { apiGet } from "../lib/api";
import { aoiLabel } from "../lib/format";
import { useUploadQueue } from "../lib/uploadQueue";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/map", label: "Global Fire Map", icon: Map },
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
    <aside className="flex w-[218px] shrink-0 flex-col border-r border-ink-700 bg-ink-900">
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-harm to-[#7a1d0c] shadow-lg shadow-harm/20">
          <Satellite size={18} className="text-white" />
        </div>
        <div>
          <div className="text-[15px] font-bold tracking-tight text-white">FireScope</div>
          <div className="text-[10px] leading-tight text-slate-500">Burning Activity Intelligence</div>
        </div>
      </div>
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
  const [countries, setCountries] = useState<{ name: string }[]>([]);
  const [cq, setCq] = useState("");
  useEffect(() => { apiGet("/api/regions").then(setCountries).catch(() => {}); }, []);
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
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b border-ink-700 bg-ink-900/80 px-5 py-2.5 backdrop-blur">
      <Field label="Dataset">
        <div className="seg">
          <button className={clsx(filters.dataset === "live" && "on")} onClick={() => setFilters({ dataset: "live" })}>Live FIRMS</button>
          {status?.demo !== "absent" && <button className={clsx(filters.dataset === "demo" && "on")} onClick={() => setFilters({ dataset: "demo" })}>Demo</button>}
        </div>
      </Field>
      <Field label="Date range (UTC)">
        <div className="flex items-center gap-1">
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
          <input list="countries" className="input w-[130px]" placeholder="Country…" value={cq}
            onChange={(e) => { setCq(e.target.value); if (countries.some((c) => c.name === e.target.value)) { setFilters({ aoi: { kind: "country", country: e.target.value } }); setCq(""); } }} />
          <datalist id="countries">{countries.map((c) => <option key={c.name} value={c.name} />)}</datalist>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><span className="label">{label}</span>{children}</div>;
}

export function DemoBanner() {
  const { filters, status, setFilters } = useStore();
  const hasLive = (status?.datasets || []).some((d: any) => d.dataset === "live");
  if (filters.dataset === "live" && hasLive) return null;
  if (filters.dataset === "live" && !hasLive)
    return (
      <div className="flex items-center gap-2 border-b border-amber-900/50 bg-amber-950/40 px-5 py-1.5 text-[12px] text-amber-200">
        <Activity size={13} /> No live satellite data has been synced or uploaded yet. Go to <b>Data Sources</b> to sync from NASA FIRMS or upload FIRMS CSV/GeoJSON files,
        or <button className="underline" onClick={() => setFilters({ dataset: "demo" })}>switch to the demo dataset</button>.
      </div>
    );
  return (
    <div className="flex items-center gap-2 border-b border-fuchsia-900/50 bg-fuchsia-950/40 px-5 py-1.5 text-[12px] text-fuchsia-200">
      <span className="rounded bg-fuchsia-500/20 px-1.5 py-px font-mono text-[10px] font-bold tracking-wider text-fuchsia-200">DEMO MODE</span>
      Synthetic demonstration dataset — simulated fires observed by simulated MODIS/VIIRS sensors. Not real satellite observations.
      {status?.demo === "building" && <span className="ml-2 animate-pulse text-fuchsia-300">Building demo dataset (≈30 s)…</span>}
    </div>
  );
}
