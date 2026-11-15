import React from "react";
import { FileJson, FileSpreadsheet, FileText, Link2 } from "lucide-react";
import { apiDownload, useApi } from "../lib/api";
import { shareableState, useStore } from "../lib/store";
import { aoiLabel, fmt, pct } from "../lib/format";
import { DownloadBtn, ErrorBox, Loading, PageHeader } from "../components/ui";

export default function ReportsPage() {
  const { body, filters, params } = useStore();
  const s = useApi<any>("/api/summary", body());
  const tag = `${aoiLabel(filters.aoi).replace(/[^a-z0-9]+/gi, "_").slice(0, 30)}_${filters.start}_${filters.end}`;
  const link = `${window.location.origin}${window.location.pathname}#/?state=${shareableState(filters, params)}`;
  const k = s.data?.kpi;
  return (
    <div className="space-y-4">
      <PageHeader title="Reports & Data Export" desc="Every export embeds the dataset, AOI, period, filters and harmonisation parameters so the analysis can be reproduced exactly." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Box icon={<FileText className="text-harm" />} t="PDF intelligence report" d="AOI, period, data sources, satellite contributions, harmonisation method & validation, burning calendar, historical comparison and trend test, anomalies, limitations, full parameter set.">
          <DownloadBtn label="Generate PDF" onClick={() => apiDownload("/api/report/pdf", body(), `firescope_report_${tag}.pdf`)} />
        </Box>
        <Box icon={<FileSpreadsheet className="text-emerald-400" />} t="CSV datasets" d="Hotspot-level records with harmonisation status and estimated-event id; harmonised daily and monthly calendar series (raw, normalised, harmonised, uncertainty bounds).">
          <div className="flex flex-wrap gap-2">
            <DownloadBtn label="Hotspots" onClick={() => apiDownload("/api/export/csv", body({ kind: "detections" }), `firescope_hotspots_${tag}.csv`)} />
            <DownloadBtn label="Daily calendar" onClick={() => apiDownload("/api/export/csv", body({ kind: "calendar_daily" }), `firescope_daily_${tag}.csv`)} />
            <DownloadBtn label="Monthly (full record)" onClick={() => apiDownload("/api/export/csv", body({ kind: "calendar_monthly" }), `firescope_monthly_${tag}.csv`)} />
          </div>
        </Box>
        <Box icon={<FileJson className="text-sky-400" />} t="GeoJSON hotspots" d="Point features with every attribute (platform, time, confidence, FRP, brightness, scan/track, product, source, harmonisation status) plus a metadata block.">
          <DownloadBtn label="GeoJSON" onClick={() => apiDownload("/api/export/geojson", body(), `firescope_hotspots_${tag}.geojson`)} />
        </Box>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <div className="card-h mb-2">Summary statistics</div>
          {s.error && <ErrorBox error={s.error} />}
          {!k ? <Loading h={150} /> : (
            <table className="data"><tbody>
              {[["Area of interest", s.data.aoi.name], ["Period", `${filters.start} → ${filters.end}`], ["Total detections", fmt(k.total_detections)],
                ["MODIS / VIIRS", `${fmt(k.modis_detections)} / ${fmt(k.viirs_detections)}`], ["Harmonised activity (cell-days)", fmt(k.harmonized_activity, 1)],
                ["Fire Activity Index", fmt(k.fai, 1)], ["Estimated fire events (clusters)", fmt(k.estimated_events)], ["High-confidence detections", fmt(k.high_conf_detections)],
                ["FRP mean / max (MW)", `${fmt(k.frp_mean, 1)} / ${fmt(k.frp_max, 0)}`], ["Change vs previous period", pct(k.pct_change_harmonized)],
                ["Share of days calibrated (pre-VIIRS)", k.share_calibrated_days != null ? `${(k.share_calibrated_days * 100).toFixed(0)}%` : "–"]].map(([a, b]) => <tr key={a}><td className="text-slate-400">{a}</td><td className="text-right font-mono">{b}</td></tr>)}
            </tbody></table>
          )}
          <div className="mt-3 text-[11px] text-slate-500">PNG export: every chart in the platform has an image button in its header; its CSV button exports the exact data behind it.</div>
        </div>
        <div className="card p-4">
          <div className="card-h mb-2">Reproducibility</div>
          <p className="mb-2 text-[12px] text-slate-400">Current filters and harmonisation settings. The shareable link restores this exact state.</p>
          <pre className="max-h-72 overflow-auto rounded-lg border border-ink-700 bg-ink-950 p-3 font-mono text-[10.5px] text-slate-300">{JSON.stringify({ filters, harmonization: params }, null, 2)}</pre>
          <button className="btn mt-2" onClick={() => navigator.clipboard?.writeText(link)}><Link2 size={13} /> Copy shareable link</button>
        </div>
      </div>
    </div>
  );
}

function Box({ icon, t, d, children }: { icon: React.ReactNode; t: string; d: string; children: React.ReactNode }) {
  return <div className="card flex flex-col gap-2 p-4"><div className="flex items-center gap-2 text-sm font-semibold text-white">{icon}{t}</div><p className="flex-1 text-[12px] text-slate-400">{d}</p>{children}</div>;
}
