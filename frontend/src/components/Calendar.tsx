import React, { useMemo, useState } from "react";
import { CLASS_COLORS, CLASS_NAMES, MONTHS, fmt, pct } from "../lib/format";

export function ClassLegend({ thresholds, unit = "harmonised cell-days" }: { thresholds?: number[]; unit?: string }) {
  const ranges = thresholds ? ["0", `< ${fmt(thresholds[0], 1)}`, `${fmt(thresholds[0], 1)}–${fmt(thresholds[1], 1)}`, `${fmt(thresholds[1], 1)}–${fmt(thresholds[2], 1)}`,
    `${fmt(thresholds[2], 1)}–${fmt(thresholds[3], 1)}`, `> ${fmt(thresholds[3], 1)}`] : [];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
      {CLASS_NAMES.map((n, i) => (
        <span key={n} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm border border-ink-600" style={{ background: CLASS_COLORS[i] }} />
          {n}{ranges[i] && <span className="text-slate-500">({ranges[i]})</span>}
        </span>
      ))}
      <span className="text-slate-500">· unit: {unit}</span>
    </div>
  );
}

const Tip = ({ tip }: { tip: { x: number; y: number; html: React.ReactNode } | null }) =>
  tip ? (
    <div className="pointer-events-none fixed z-50 rounded-lg border border-ink-600 bg-ink-950/95 px-2.5 py-2 text-[11.5px] text-slate-200 shadow-xl" style={{ left: tip.x + 14, top: tip.y + 10 }}>
      {tip.html}
    </div>
  ) : null;

/** Classic burning-activity calendar: rows = years, columns = months. */
export function MonthMatrix({ matrix, onSelect, selected, showValues = true }: {
  matrix: any[]; onSelect?: (year: number, month: number) => void; selected?: { year: number; month: number } | null; showValues?: boolean;
}) {
  const [tip, setTip] = useState<any>(null);
  const years = useMemo(() => Array.from(new Set(matrix.map((m) => m.year))).sort(), [matrix]);
  const byKey = useMemo(() => new Map(matrix.map((m) => [`${m.year}-${m.month}`, m])), [matrix]);
  const cw = 46, ch = 20, lx = 40, ty = 18, rx = 64;
  const W = lx + cw * 12 + rx, H = ty + ch * years.length + 4;
  const annual = useMemo(() => {
    const a = new Map<number, number>();
    matrix.forEach((m) => a.set(m.year, (a.get(m.year) || 0) + (m.value || 0)));
    return a;
  }, [matrix]);
  const amax = Math.max(1, ...Array.from(annual.values()));
  return (
    <div className="overflow-x-auto">
      <svg data-export width={W} height={H} className="select-none" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
        {MONTHS.map((m, i) => <text key={m} x={lx + i * cw + cw / 2} y={12} textAnchor="middle" fontSize={10.5} fill="#94a3b8">{m}</text>)}
        <text x={lx + 12 * cw + 8} y={12} fontSize={10} fill="#94a3b8">Year total</text>
        {years.map((y, yi) => (
          <g key={y}>
            <text x={lx - 6} y={ty + yi * ch + ch / 2 + 3.5} textAnchor="end" fontSize={10.5} fill="#94a3b8" fontFamily="JetBrains Mono, ui-monospace, monospace">{y}</text>
            {Array.from({ length: 12 }, (_, mi) => {
              const c = byKey.get(`${y}-${mi + 1}`);
              const sel = selected && selected.year === y && selected.month === mi + 1;
              const fill = c ? CLASS_COLORS[c.class] : "#0b111c";
              return (
                <g key={mi} onClick={() => c && onSelect?.(y, mi + 1)} className={c ? "cursor-pointer" : ""}
                  onMouseMove={(e) => c && setTip({ x: e.clientX, y: e.clientY, html: (
                    <div>
                      <div className="mb-1 font-semibold">{MONTHS[mi]} {y} {c.calibrated && <span className="ml-1 rounded bg-slate-700 px-1 text-[10px]">calibrated MODIS</span>}</div>
                      <div>Harmonised: <b className="font-mono">{fmt(c.value, 1)}</b> cell-days · class <b>{CLASS_NAMES[c.class]}</b></div>
                      <div className="text-slate-400">Raw detections: MODIS {fmt(c.modis_det)} · VIIRS {fmt(c.viirs_det)}</div>
                      <div className="text-slate-400">vs median of other years ({fmt(c.baseline_median, 1)}): <b className="text-slate-200">{c.pct_of_median != null ? `${fmt(c.pct_of_median, 0)}%` : "–"}</b> · rank {c.rank_in_month} of {years.length}</div>
                    </div>) })}
                  onMouseLeave={() => setTip(null)}>
                  <rect x={lx + mi * cw + 1} y={ty + yi * ch + 1} width={cw - 2} height={ch - 2} rx={3} fill={fill}
                    stroke={sel ? "#38bdf8" : c?.calibrated ? "#2a364c" : "none"} strokeWidth={sel ? 2 : 1} strokeDasharray={c?.calibrated && !sel ? "2 2" : undefined} />
                  {showValues && c && c.value > 0 && (
                    <text x={lx + mi * cw + cw / 2} y={ty + yi * ch + ch / 2 + 3.5} textAnchor="middle" fontSize={9.5} fontFamily="JetBrains Mono, ui-monospace, monospace"
                      fill={c.class >= 4 ? "#0b111c" : "#e2e8f0"} pointerEvents="none">{c.value >= 1000 ? `${(c.value / 1000).toFixed(1)}k` : Math.round(c.value)}</text>
                  )}
                </g>
              );
            })}
            <rect x={lx + 12 * cw + 8} y={ty + yi * ch + 5} height={ch - 10} rx={2} width={Math.max(1, ((annual.get(y) || 0) / amax) * (rx - 14))} fill="#e0552f" opacity={0.75} />
          </g>
        ))}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

/** Day-level calendar heatmap (weeks as columns, weekdays as rows), one band per year. */
export function DailyGrid({ days, onSelect, selected }: { days: any[]; onSelect?: (d: string) => void; selected?: string | null }) {
  const [tip, setTip] = useState<any>(null);
  const years = useMemo(() => {
    const g = new Map<number, any[]>();
    days.forEach((d) => { const y = Number(d.date.slice(0, 4)); if (!g.has(y)) g.set(y, []); g.get(y)!.push(d); });
    return Array.from(g.entries()).sort((a, b) => b[0] - a[0]);
  }, [days]);
  const cs = 12, gap = 2, lx = 30;
  return (
    <div className="space-y-3 overflow-x-auto">
      {years.map(([y, ds]) => {
        const jan1 = new Date(Date.UTC(y, 0, 1));
        const off = (jan1.getUTCDay() + 6) % 7; // Monday-first
        const W = lx + 54 * (cs + gap), H = 7 * (cs + gap) + 16;
        return (
          <svg key={y} data-export width={W} height={H}>
            <text x={0} y={H / 2 + 4} fontSize={11} fill="#94a3b8" fontFamily="JetBrains Mono, ui-monospace, monospace">{y}</text>
            {MONTHS.map((m, i) => {
              const doy = Math.floor((Date.UTC(y, i, 1) - jan1.getTime()) / 864e5);
              return <text key={m} x={lx + Math.floor((doy + off) / 7) * (cs + gap)} y={9} fontSize={9.5} fill="#64748b">{m}</text>;
            })}
            {ds.map((d) => {
              const doy = Math.floor((Date.parse(d.date + "T00:00:00Z") - jan1.getTime()) / 864e5);
              const col = Math.floor((doy + off) / 7), row = (doy + off) % 7;
              const sel = selected === d.date;
              return (
                <rect key={d.date} x={lx + col * (cs + gap)} y={14 + row * (cs + gap)} width={cs} height={cs} rx={2}
                  fill={CLASS_COLORS[d.class]} stroke={sel ? "#38bdf8" : d.calibrated ? "#2a364c" : "none"} strokeWidth={sel ? 2 : 0.8}
                  className="cursor-pointer" onClick={() => onSelect?.(d.date)}
                  onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, html: (
                    <div>
                      <div className="mb-1 font-semibold">{d.date}{d.calibrated && <span className="ml-1 rounded bg-slate-700 px-1 text-[10px]">calibrated</span>}</div>
                      <div>Harmonised: <b className="font-mono">{fmt(d.value, 1)}</b> · {CLASS_NAMES[d.class]}</div>
                      <div className="text-slate-400">MODIS {d.modis_det} · VIIRS {d.viirs_det} detections</div>
                      <div className="text-slate-400">±7-day historical median {fmt(d.baseline, 1)} ({pct(d.pct_vs_baseline, 0)})</div>
                    </div>) })}
                  onMouseLeave={() => setTip(null)} />
              );
            })}
          </svg>
        );
      })}
      <Tip tip={tip} />
    </div>
  );
}

export function StripCalendar({ items, label, onSelect }: { items: { key: string; label: string; value: number; class: number; sub?: string }[]; label?: string; onSelect?: (k: string) => void }) {
  const [tip, setTip] = useState<any>(null);
  return (
    <div>
      {label && <div className="label mb-1.5">{label}</div>}
      <div className="flex flex-wrap gap-[3px]">
        {items.map((i) => (
          <div key={i.key} className="h-7 min-w-[28px] flex-1 cursor-pointer rounded-[3px] border border-ink-700/60" style={{ background: CLASS_COLORS[i.class] }}
            onClick={() => onSelect?.(i.key)}
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, html: <div><b>{i.label}</b><br />{fmt(i.value, 1)} harmonised cell-days · {CLASS_NAMES[i.class]}{i.sub && <><br /><span className="text-slate-400">{i.sub}</span></>}</div> })}
            onMouseLeave={() => setTip(null)} />
        ))}
      </div>
      <Tip tip={tip} />
    </div>
  );
}
