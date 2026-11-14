import React, { useRef, useState } from "react";
import { AlertTriangle, Download, Image as ImageIcon, Info, Loader2, Table2 } from "lucide-react";
import clsx from "clsx";
import { saveBlob } from "../lib/api";
import { toCSV } from "../lib/format";

export function InfoTip({ text }: { text: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <Info size={13} className="text-slate-500 hover:text-slate-300 cursor-help" aria-label="Explanation" />
      {open && (
        <span className="absolute z-50 left-5 top-0 w-72 rounded-lg border border-ink-600 bg-ink-900 p-2.5 text-[11.5px] leading-relaxed font-normal normal-case tracking-normal text-slate-300 shadow-xl">
          {text}
        </span>
      )}
    </span>
  );
}

export function Loading({ label = "Computing…", h = 200 }: { label?: string; h?: number }) {
  return (
    <div className="flex items-center justify-center gap-2 text-xs text-slate-400" style={{ height: h }}>
      <Loader2 size={16} className="animate-spin text-harm" /> {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-200">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" /> <span className="break-all">{error}</span>
    </div>
  );
}

export function Empty({ text = "No data for the current selection." }: { text?: string }) {
  return <div className="flex h-40 items-center justify-center text-xs text-slate-500">{text}</div>;
}

async function svgToPng(svg: SVGSVGElement, title: string): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const { width, height } = svg.getBoundingClientRect();
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.querySelectorAll("text").forEach((t) => { if (!t.getAttribute("fill")) t.setAttribute("fill", "#cbd5e1"); t.setAttribute("font-family", "Inter, Arial, sans-serif"); });
  const data = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([data], { type: "image/svg+xml;charset=utf-8" }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const scale = 2, pad = 36;
  const c = document.createElement("canvas");
  c.width = (width + 24) * scale; c.height = (height + pad + 24) * scale;
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#0f1623"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#f1f5f9"; ctx.font = "600 14px Inter, Arial"; ctx.fillText(title, 12, 24);
  ctx.drawImage(img, 12, pad);
  ctx.fillStyle = "#64748b"; ctx.font = "10px Inter, Arial";
  ctx.fillText("FireScope · data: NASA FIRMS (MODIS C6.1 / VIIRS 375 m)", 12, height + pad + 16);
  URL.revokeObjectURL(url);
  return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
}

/** Card wrapper for every chart: title, explanation, units, PNG + CSV download. */
export function ChartCard({ title, subtitle, info, data, children, className, actions, filename }: {
  title: string; subtitle?: React.ReactNode; info?: React.ReactNode; data?: any[]; children: React.ReactNode;
  className?: string; actions?: React.ReactNode; filename?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const name = filename || title.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const png = async () => {
    const svg = ref.current?.querySelector("svg.recharts-surface, svg[data-export]") as SVGSVGElement | null;
    if (svg) saveBlob(await svgToPng(svg, title), name + ".png");
  };
  return (
    <div className={clsx("card flex flex-col p-4", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="card-h flex items-center gap-1.5">{title} {info && <InfoTip text={info} />}</div>
          {subtitle && <div className="mt-0.5 text-[11px] text-slate-500">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-1.5">
          {actions}
          <button className="btn !px-1.5" title="Download PNG" onClick={png}><ImageIcon size={13} /></button>
          {data && <button className="btn !px-1.5" title="Download data (CSV)" onClick={() => saveBlob(new Blob([toCSV(data)], { type: "text/csv" }), name + ".csv")}><Table2 size={13} /></button>}
        </div>
      </div>
      <div ref={ref} className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

export function Kpi({ label, value, sub, color, info, icon }: { label: string; value: React.ReactNode; sub?: React.ReactNode; color?: string; info?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="card relative overflow-hidden p-3.5">
      {color && <div className="absolute left-0 top-0 h-full w-[3px]" style={{ background: color }} />}
      <div className="label flex items-center gap-1.5">{icon}{label}{info && <InfoTip text={info} />}</div>
      <div className="mt-1.5 font-mono text-[22px] font-semibold leading-none text-slate-50">{value}</div>
      {sub && <div className="mt-1.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

export function Seg<T extends string | number>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  return (
    <div className="seg">
      {options.map((o) => <button key={String(o.v)} className={clsx(o.v === value && "on")} onClick={() => onChange(o.v)}>{o.l}</button>)}
    </div>
  );
}

export function PageHeader({ title, desc, right }: { title: string; desc?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-50">{title}</h1>
        {desc && <p className="mt-1 max-w-3xl text-[13px] text-slate-400">{desc}</p>}
      </div>
      {right}
    </div>
  );
}

export function DownloadBtn({ onClick, label }: { onClick: () => Promise<any> | void; label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { await onClick(); } finally { setBusy(false); } }}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {label}
    </button>
  );
}

export function Legend({ items }: { items: { color: string; label: string; dash?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[3px] w-4 rounded" style={{ background: i.dash ? `repeating-linear-gradient(90deg, ${i.color} 0 4px, transparent 4px 7px)` : i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export const tooltipStyle = {
  contentStyle: { background: "#0b111c", border: "1px solid #2a364c", borderRadius: 8, fontSize: 11.5, color: "#e2e8f0" },
  labelStyle: { color: "#94a3b8", fontWeight: 600, marginBottom: 4 },
  itemStyle: { padding: 0 },
};
export const axisProps = { stroke: "#475569", tick: { fill: "#94a3b8", fontSize: 10.5 }, tickLine: false, axisLine: { stroke: "#2a364c" } };
