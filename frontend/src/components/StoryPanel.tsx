import React, { useEffect, useState } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";

/**
 * Short wildfire facts shown beside the globe while the first satellite data loads.
 * All figures are historical (each states its year) and come from the named source; wording is our own summary.
 */
type Story = { big: string; text: string; source: string; url: string };
export const STORIES: Story[] = [
  { big: "≈750 million ha", text: "burn on Earth in a typical year, an area about the size of Australia.", source: "Global Fire Emissions Database (GFED)", url: "https://globalfiredata.org/" },
  { big: "1,940 Mt of carbon", text: "was released by fires worldwide in 2024.", source: "Copernicus Atmosphere Monitoring Service", url: "https://atmosphere.copernicus.eu/2025-sees-intense-wildfire-year-northern-hemisphere" },
  { big: "+1.44 °C", text: "Global temperature in 2025 above pre-industrial levels. The last 11 years were the 11 warmest on record.", source: "World Meteorological Organization", url: "https://wmo.int/news/media-centre/wmo-confirms-2025-was-one-of-warmest-years-record" },
  { big: "1.08 million ha", text: "burned in the EU in 2025, its worst fire season on record.", source: "EU Joint Research Centre · EFFIS", url: "https://joint-research-centre.ec.europa.eu/jrc-news-and-updates/2025-was-eus-most-destructive-wildfire-season-record-2026-03-31_en" },
  { big: "30 million ha", text: "of tree cover was lost in 2024, a record. Fire caused nearly half of all tropical primary forest loss.", source: "UMD GLAD Lab · WRI Global Forest Watch", url: "https://www.wri.org/news/release-global-forest-loss-shatters-records-2024-fueled-massive-fires" },
  { big: "17.2 million ha", text: "burned in Canada in 2023, more than double the previous national record.", source: "Parks Canada", url: "https://parks.canada.ca/pn-np/on/pukaskwa/info/bulletin/93" },
  { big: "−1.2 % a year", text: "Trend in global burned area 1997–2020, as savannas become farmland, while forest-fire emissions keep rising.", source: "GFED5 (Chen et al., 2023) · Carbon Brief", url: "https://www.carbonbrief.org/guest-post-why-carbon-emissions-from-fires-are-significantly-higher-than-thought/" },
  { big: "1 km → 375 m", text: "MODIS has watched for fire since 2000, VIIRS since 2012. FireScope merges both into one consistent record.", source: "NASA FIRMS", url: "https://firms.modaps.eosdis.nasa.gov/" },
];

/** One fact at a time, floating to the right of the globe; no card or border. */
type Globe = { cx: number; cy: number; r: number; W: number; H: number } | null;
const GAP = 44; // same breathing space between the globe and the text on both sides

/**
 * Floating wildfire facts beside the globe (no card or border).
 * Open: auto-advances every 9 s, with ‹ › to step through and » to tuck it away.
 * Closed: a small arrow tab on the right edge brings it back.
 */
export function FloatingStory({ open, onToggle, globe, hidden }: { open: boolean; onToggle: (o: boolean) => void; globe: Globe; hidden?: boolean }) {
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(true);
  const [tick, setTick] = useState(0); // restarts the auto-advance timer after a manual step
  const go = (d: number) => { setShown(false); setTimeout(() => { setI((k) => (k + d + STORIES.length) % STORIES.length); setShown(true); }, 450); };
  useEffect(() => {
    if (!open) return;
    // ~9 s per fact so it can be read comfortably
    const t = setInterval(() => go(1), 9000);
    return () => clearInterval(t);
  }, [open, tick]);
  if (!globe || globe.W <= 900 || hidden) return null;
  const s = STORIES[i];
  const width = Math.max(270, Math.min(320, globe.W - (globe.cx + globe.r + GAP) - 24));
  const left = Math.min(globe.cx + globe.r + GAP, globe.W - width - 24);
  const btn = "pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white";
  return (
    <>
      {/* collapsed: arrow tab on the right edge */}
      <button onClick={() => onToggle(true)} title="Show wildfire facts"
        className={clsx("float-text absolute right-0 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 py-3 pl-2 pr-1.5 text-slate-300 transition-all duration-500 hover:text-white",
          open ? "pointer-events-none translate-x-6 opacity-0" : "translate-x-0 opacity-100")}>
        <ChevronLeft size={18} />
        <span className="text-[11px] tracking-[0.18em] [writing-mode:vertical-rl] rotate-180 uppercase">Wildfire facts</span>
      </button>

      {/* open: floating fact with controls */}
      <div className={clsx("float-text pointer-events-none absolute z-10 transition-all duration-700 ease-out", open ? "translate-x-0 opacity-100" : "translate-x-10 opacity-0")}
        style={{ left, top: globe.cy - globe.r * 0.42, width }}>
        <div className={clsx("text-[clamp(22px,2vw,30px)] font-semibold leading-tight tracking-tight text-amber-200 transition-all duration-[700ms] ease-out", shown ? "translate-y-0 opacity-100 blur-0" : "-translate-y-2 opacity-0 blur-[3px]")}>{s.big}</div>
        <p className={clsx("mt-2.5 text-[clamp(14px,1.1vw,16px)] font-light leading-relaxed text-slate-100 transition-all duration-[700ms] ease-out", shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0")}
          style={{ transitionDelay: shown ? "150ms" : "0ms" }}>{s.text}</p>
        <a href={s.url} target="_blank" rel="noreferrer"
          className={clsx("mt-3.5 inline-block text-[12px] tracking-wide text-slate-400 transition-opacity duration-[700ms] hover:text-slate-200", open && "pointer-events-auto", shown ? "opacity-100" : "opacity-0")}
          style={{ transitionDelay: shown ? "300ms" : "0ms" }}>Source: {s.source}</a>
        <div className={clsx("mt-4 flex items-center gap-1", !open && "invisible")}>
          <button className={btn} title="Previous fact" onClick={() => { go(-1); setTick((t) => t + 1); }}><ChevronLeft size={16} /></button>
          <span className="w-10 text-center font-mono text-[11px] text-slate-500">{i + 1} / {STORIES.length}</span>
          <button className={btn} title="Next fact" onClick={() => { go(1); setTick((t) => t + 1); }}><ChevronRight size={16} /></button>
          <button className={clsx(btn, "ml-2")} title="Hide facts" onClick={() => onToggle(false)}><ChevronsRight size={16} /></button>
        </div>
      </div>
    </>
  );
}

export type LoadStep = { label: string; detail?: string; done: boolean };

/**
 * Floating loading status (no box): the current step with a real progress bar,
 * plus the two steps completed just before it.
 */
export function LoadingText({ visible, steps, percent, error, onRetry, globe }: {
  visible: boolean; steps: LoadStep[]; percent: number; error: string | null; onRetry: () => void; globe: Globe;
}) {
  // mirror of the story: to the left of the globe with the same gap, in its lower half (below the View panel)
  const wide = !!globe && globe.W > 900;
  const right = wide ? globe!.cx - globe!.r - GAP : 0;
  const width = wide ? Math.max(180, Math.min(300, right - 24)) : 0;
  const pos: React.CSSProperties = wide
    ? { left: right - width, width, top: Math.max(410, globe!.cy + globe!.r * 0.12) }
    : { left: 16, right: 16, bottom: 24 };
  const cur = steps.findIndex((s) => !s.done);
  const ci = cur === -1 ? steps.length - 1 : cur;
  const shown = steps.slice(Math.max(0, ci - 2), ci + 1);
  return (
    <div className={clsx("float-text absolute z-10 transition-opacity duration-700", visible ? "opacity-100" : "pointer-events-none opacity-0")} style={pos}>
      <ul className="space-y-1.5">
        {shown.map((s) => {
          const active = !s.done && !error;
          return (
            <li key={s.label} className={clsx("flex items-start gap-2.5 transition-all duration-500", s.done ? "text-slate-500" : "text-slate-100")}>
              <span className="mt-[5px] flex h-2 w-2 shrink-0 items-center justify-center">
                {s.done ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
                  : error ? <span className="h-2 w-2 rounded-full bg-red-400" />
                  : <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-orange-400" /></span>}
              </span>
              <span className="min-w-0">
                <span className={clsx(active ? "text-[13.5px] font-normal" : "text-[12px] font-light")}>{s.label}{active && <span className="loading-dots inline-block w-4 text-left" />}</span>
                {s.detail && <span className={clsx("block font-mono text-[10.5px]", active ? "text-slate-400" : "text-slate-600")}>{s.detail}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {error ? (
        <div className="mt-2.5 pl-[18px] text-[12.5px] text-red-200">{error} <button className="ml-1 text-orange-300 underline decoration-orange-300/40 underline-offset-2 hover:text-orange-200" onClick={onRetry}>Retry</button></div>
      ) : (
        <div className="mt-3 flex items-center gap-3 pl-[18px]">
          <div className="h-[2px] flex-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-300 via-orange-500 to-red-500 shadow-[0_0_8px_rgba(255,120,40,0.8)]" style={{ width: `${Math.max(2, percent)}%`, transition: "width 250ms linear" }} />
          </div>
          <span className="w-9 text-right font-mono text-[11px] text-slate-400">{Math.floor(percent)}%</span>
        </div>
      )}
    </div>
  );
}
