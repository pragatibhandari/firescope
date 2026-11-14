import React, { useEffect, useState } from "react";
import { CloudDownload, Lock, LogOut, RefreshCw, Trash2, Upload } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiUpload, clearApiCache, getAdminToken, setAdminToken } from "../lib/api";
import { useStore } from "../lib/store";
import { addFiles, clearFinished, remove as removeQueued, retry as retryQueued, setOnBatchDone, useUploadQueue } from "../lib/uploadQueue";
import { fmt } from "../lib/format";
import { ErrorBox, PageHeader } from "../components/ui";
import { aoiBbox } from "./MapPage";

const PRODUCTS = [
  ["MODIS C6.1 (MCD14DL / MCD14ML)", "Terra, Aqua", "1 km at nadir (up to ~2 × 4.8 km at swath edge)", "Terra Nov 2000 – ; Aqua Jul 2002 –", "0–100 % (low < 30, nominal 30–79, high ≥ 80)", "Misses small/cool fires; pixel size grows off-nadir; satellites near end of life (orbit drift)."],
  ["VIIRS 375 m (VNP14IMG / VJ114IMG / VJ214IMG)", "Suomi-NPP, NOAA-20, NOAA-21", "375 m (I-band), ~0.8 km at swath edge", "S-NPP Jan 2012 – ; NOAA-20 2018 – ; NOAA-21 2023 –", "low / nominal / high", "I4 band saturates over large/hot fires (FRP from M13); bowtie-deletion; ~3× more pixels per fire than MODIS."],
];

export default function SourcesPage() {
  const { status, refreshStatus, filters } = useStore();
  const [job, setJob] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const queue = useUploadQueue();
  const [dragOver, setDragOver] = useState(false);
  useEffect(() => { setOnBatchDone(() => refreshStatus()); return () => setOnBatchDone(null); }, [refreshStatus]);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState<string | null>(null);
  const locked = !!status?.admin_required;
  useEffect(() => {
    if (!locked) { setIsAdmin(true); return; }
    if (!getAdminToken()) { setIsAdmin(false); return; }
    apiGet("/api/admin/check").then(() => setIsAdmin(true)).catch(() => setIsAdmin(false));
  }, [locked]);
  const login = async () => {
    setAdminToken(pw); setPwErr(null);
    try { await apiGet("/api/admin/check"); setIsAdmin(true); setPw(""); }
    catch { setAdminToken(""); setIsAdmin(false); setPwErr("Wrong password."); }
  };
  const [sync, setSync] = useState({ start: filters.start, end: filters.end, modis: true, viirs: true });
  const [cs, setCs] = useState({ country: filters.aoi.kind === "country" ? (filters.aoi as any).country : "Argentina", y0: 2012, y1: 2024 });

  useEffect(() => {
    if (!job || ["done", "failed"].includes(job.status)) return;
    const t = setTimeout(async () => { try { const j = await apiGet(`/api/jobs/${job.id}`); setJob(j); if (["done", "failed"].includes(j.status)) { clearApiCache(); refreshStatus(); } } catch (e: any) { setErr(String(e)); } }, 2000);
    return () => clearTimeout(t);
  }, [job]);

  const startArea = async () => {
    setErr(null);
    const bbox = aoiBbox(filters.aoi) || [-180, -90, 180, 90];
    try {
      const r = await apiPost("/api/sync/firms", { mode: "area", bbox, start: sync.start, end: sync.end, sensors: [sync.modis && "MODIS", sync.viirs && "VIIRS"].filter(Boolean) });
      setJob({ id: r.job_id, status: "queued", progress: 0 });
    } catch (e: any) { setErr(String(e.message || e)); }
  };
  const startCountry = async () => {
    setErr(null);
    const years = Array.from({ length: cs.y1 - cs.y0 + 1 }, (_, i) => cs.y0 + i);
    try {
      const r = await apiPost("/api/sync/firms", { mode: "country", country: cs.country, years, platforms: ["MODIS", "S-NPP", "NOAA-20"] });
      setJob({ id: r.job_id, status: "queued", progress: 0 });
    } catch (e: any) { setErr(String(e.message || e)); }
  };
  const f = status?.firms;
  return (
    <div className="space-y-4">
      <PageHeader title="Data Sources & Integration" desc="NASA FIRMS is the primary source. The MAP_KEY lives only in the backend environment and is never sent to the browser. Without live access the platform runs on uploaded files or the clearly labelled synthetic demo dataset — it never fabricates satellite observations."
        right={<button className="btn" onClick={refreshStatus}><RefreshCw size={13} /> Refresh status</button>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-4">
          <div className="card-h mb-2">Connection status</div>
          <table className="data"><tbody>
            <tr><td>Backend API</td><td>{status?.error ? <span className="text-red-300">offline</span> : <span className="text-emerald-300">connected</span>}</td></tr>
            <tr><td>FIRMS MAP_KEY</td><td>{!f ? "…" : !f.configured ? <span className="text-amber-300">not configured</span> : f.reachable === false ? <span className="text-red-300">unreachable</span> : <span className="text-emerald-300">configured{f.valid === false ? " (invalid?)" : ""}</span>}</td></tr>
            <tr><td>Key usage</td><td className="font-mono">{f?.details?.current_transactions != null ? `${f.details.current_transactions} / ${f.details.transaction_limit} per 10 min` : "–"}</td></tr>
            <tr><td>Last live observation</td><td className="font-mono">{status?.live_last_observation?.slice(0, 10) || "none"}</td></tr>
            <tr><td>Data freshness</td><td className="font-mono">{status?.live_freshness_hours != null ? `${fmt(status.live_freshness_hours, 1)} h old` : "–"}</td></tr>
            <tr><td>Last sync</td><td className="font-mono">{status?.sync_history?.[0]?.finished_at?.slice(0, 16) || "never"}</td></tr>
            <tr><td>Demo dataset</td><td>{status?.demo} ({fmt(status?.demo_rows)} rows)</td></tr>
          </tbody></table>
          {!f?.configured && <p className="mt-2 text-[11px] text-slate-400">Set <code className="text-slate-200">FIRMS_MAP_KEY</code> in <code>backend/.env</code> (free key: firms.modaps.eosdis.nasa.gov/api/map_key) and restart the backend.</p>}
        </div>
        {!isAdmin ? (
          <div className="card space-y-3 p-4 lg:col-span-2">
            <div className="card-h flex items-center gap-1.5"><Lock size={14} /> Admin tools are locked</div>
            <p className="text-[12px] text-slate-400">Syncing from NASA, uploading files and deleting data are restricted to the site administrator. Everything else in FireScope is public.</p>
            <div className="flex max-w-sm gap-2">
              <input type="password" className="input flex-1" placeholder="Admin password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} />
              <button className="btn-primary" onClick={login}>Unlock</button>
            </div>
            {pwErr && <div className="text-[11px] text-red-300">{pwErr}</div>}
          </div>
        ) : (<>
        <div className="card space-y-2 p-4">
          <div className="card-h flex items-center gap-1.5"><CloudDownload size={14} /> Sync from FIRMS API (area)</div>
          <p className="text-[11px] text-slate-400">Bounding box of the current AOI. Uses standard-quality (SP) archives where available and NRT afterwards; 5-day chunks, retries with back-off, rate-limited under 5000 transactions / 10 min.</p>
          <div className="flex gap-1"><input type="date" className="input flex-1" value={sync.start} onChange={(e) => setSync({ ...sync, start: e.target.value })} /><input type="date" className="input flex-1" value={sync.end} onChange={(e) => setSync({ ...sync, end: e.target.value })} /></div>
          <div className="flex gap-3 text-xs"><label><input type="checkbox" checked={sync.modis} onChange={(e) => setSync({ ...sync, modis: e.target.checked })} className="mr-1" />MODIS</label><label><input type="checkbox" checked={sync.viirs} onChange={(e) => setSync({ ...sync, viirs: e.target.checked })} className="mr-1" />VIIRS (S-NPP, NOAA-20, NOAA-21)</label></div>
          <button className="btn-primary w-full justify-center" disabled={!f?.configured} onClick={startArea}>Start area sync</button>
          <div className="card-h pt-2">Yearly country archives</div>
          <div className="flex gap-1"><input className="input flex-1" value={cs.country} onChange={(e) => setCs({ ...cs, country: e.target.value })} />
            <input type="number" className="input w-16" value={cs.y0} onChange={(e) => setCs({ ...cs, y0: Number(e.target.value) })} /><input type="number" className="input w-16" value={cs.y1} onChange={(e) => setCs({ ...cs, y1: Number(e.target.value) })} /></div>
          <button className="btn w-full justify-center" onClick={startCountry}>Fetch MODIS + VIIRS yearly country CSVs</button>
          {job && (
            <div className="rounded-lg border border-ink-700 bg-ink-900 p-2 text-[11px]">
              <div className="flex justify-between"><span>Job {job.id} · {job.status}</span><span className="font-mono">{fmt(job.rows_added)} rows</span></div>
              <div className="mt-1 h-1.5 rounded bg-ink-700"><div className="h-1.5 rounded bg-harm" style={{ width: `${(job.progress || 0) * 100}%` }} /></div>
              {job.errors?.length > 0 && <div className="mt-1 max-h-20 overflow-y-auto text-red-300">{job.errors.slice(-5).map((e: string, i: number) => <div key={i}>{e}</div>)}</div>}
            </div>
          )}
          {err && <ErrorBox error={err} />}
        </div>
        <div className="card space-y-2 p-4">
          <div className="card-h flex items-center gap-1.5"><Upload size={14} /> Upload FIRMS CSV / GeoJSON files</div>
          <p className="text-[11px] text-slate-400">Accepts FIRMS archive downloads (fire_archive_*.csv, fire_nrt_*.csv), API CSVs and point GeoJSON. Records are validated (coordinates, timestamps, platform), standardised (UTC, units, confidence classes), de-duplicated and keep their source file name as provenance.</p>
          <label
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(Array.from(e.dataTransfer.files)); }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-4 text-center text-[12px] transition ${dragOver ? "border-harm bg-harm/10 text-white" : "border-ink-600 text-slate-300 hover:border-harm/60"}`}>
            <Upload size={16} className="text-harm" />
            <span><b>Choose files</b> or drag &amp; drop them here</span>
            <span className="text-[10.5px] text-slate-500">Select several at once - you can keep adding files while others upload</span>
            <input type="file" multiple accept=".csv,.json,.geojson" className="hidden" onChange={(e) => { addFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
          </label>
          {queue.length > 0 && (() => {
            const done = queue.filter((q) => q.state === "done").length;
            const failed = queue.filter((q) => q.state === "failed").length;
            const pending = queue.filter((q) => q.state === "waiting" || q.state === "uploading").length;
            return (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>{done} of {queue.length} done{pending > 0 && <> · {pending} in queue</>}{failed > 0 && <span className="text-red-300"> · {failed} failed</span>}</span>
                  <span className="flex items-center gap-2"><span className="font-mono">+{fmt(queue.reduce((a, q) => a + (q.added || 0), 0))} rows</span>
                    {done > 0 && <button className="text-slate-400 underline hover:text-white" onClick={clearFinished}>clear finished</button>}</span>
                </div>
                <div className="h-1.5 rounded bg-ink-700"><div className="h-1.5 rounded bg-harm transition-all" style={{ width: `${((done + failed) / queue.length) * 100}%` }} /></div>
                <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                  {queue.map((q, i) => (
                    <div key={q.id} className="rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-slate-200" title={q.name}><span className="mr-1 text-slate-600">{i + 1}.</span>{q.name}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className={q.state === "done" ? "text-emerald-300" : q.state === "failed" ? "text-red-300" : q.state === "uploading" ? "animate-pulse text-harm" : "text-slate-500"}>
                            {q.state === "uploading" ? "uploading…" : q.state === "waiting" ? "in queue" : q.state}
                          </span>
                          {q.state === "waiting" && <button className="text-slate-500 hover:text-white" title="Remove from queue" onClick={() => removeQueued(q.id)}>✕</button>}
                          {q.state === "failed" && <button className="text-slate-300 underline hover:text-white" onClick={() => retryQueued(q.id)}>retry</button>}
                        </span>
                      </div>
                      <div className="text-slate-500">{(q.size / 1e6).toFixed(0)} MB{q.state === "done" && <> · {fmt(q.valid)} valid · <b className="text-slate-300">{fmt(q.added)} added</b>{q.added === 0 && q.valid ? " (already in the database)" : ""}{q.rejected ? ` · ${fmt(q.rejected)} rejected` : ""}</>}</div>
                      {q.error && <div className="text-red-300">{q.error}</div>}
                      {q.notes?.map((n) => <div key={n} className="text-amber-300">{n}</div>)}
                    </div>
                  ))}
                </div>
                {pending > 0 && <div className="text-[11px] text-amber-300">Uploads continue while you use other pages, but keep this browser tab open. Large files take a few minutes each.</div>}
              </div>
            );
          })()}
        </div>
        </>)}
      </div>

      <div className="card p-4">
        <div className="card-h mb-2">Data coverage in the platform</div>
        <div className="overflow-x-auto"><table className="data">
          <thead><tr><th>Dataset</th><th>Source</th><th>Sensor</th><th>Platform</th><th className="text-right">Records</th><th>First</th><th>Last</th><th>Last ingest (UTC)</th></tr></thead>
          <tbody>{(status?.datasets || []).map((d: any, i: number) => <tr key={i}><td>{d.dataset === "demo" ? <span className="text-fuchsia-300">demo (synthetic)</span> : "live"}</td><td>{d.source}</td><td>{d.sensor}</td><td>{d.platform}</td><td className="text-right font-mono">{fmt(d.n)}</td><td className="font-mono">{d.first_date}</td><td className="font-mono">{d.last_date}</td><td className="font-mono">{String(d.last_ingest).slice(0, 16)}</td></tr>)}</tbody>
        </table></div>
        {isAdmin && (
          <div className="mt-2 flex gap-2">
            <button className="btn" onClick={async () => { if (confirm("Delete all live (synced/uploaded) records? This cannot be undone.")) { try { await apiDelete("/api/dataset/live"); } catch (e: any) { alert(String(e.message || e)); } clearApiCache(); refreshStatus(); } }}><Trash2 size={12} /> Clear live dataset</button>
            {locked && <button className="btn" onClick={() => { setAdminToken(""); setIsAdmin(false); }}><LogOut size={12} /> Lock admin tools</button>}
          </div>
        )}
      </div>

      <div className="card p-4">
        <div className="card-h mb-2">Source products</div>
        <div className="overflow-x-auto"><table className="data">
          <thead><tr><th>Product</th><th>Platforms</th><th>Spatial resolution</th><th>Temporal coverage</th><th>Confidence field</th><th>Product-specific limitations</th></tr></thead>
          <tbody>{PRODUCTS.map((p) => <tr key={p[0]}>{p.map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
        </table></div>
        <p className="mt-3 text-[11px] text-slate-500">Both sensors observe each location ~2× per day per satellite (MODIS Terra ~10:30/22:30, Aqua ~13:30/01:30; VIIRS ~13:30/01:30 local). Standard (SP) products replace near-real-time (NRT) data after ~2–6 months. Attribution: We acknowledge the use of data and imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://www.earthdata.nasa.gov/firms), part of NASA's Earth Science Data and Information System (ESDIS). Basemap © OpenStreetMap contributors © CARTO. Boundaries: Natural Earth (public domain) via world-atlas.</p>
      </div>
    </div>
  );
}
