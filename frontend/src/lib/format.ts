export const COLORS = {
  modis: "#2f8fd8",
  viirs: "#d4b030",
  harm: "#e0552f",
  naive: "#7a5af0",
  grid: "#1c2638",
  axis: "#64748b",
  text: "#cbd5e1",
};

// Calendar classes: none + 5-step inferno ramp (perceptually uniform, colour-vision-deficiency friendly)
export const CLASS_COLORS = ["#161d2b", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"];
export const CLASS_NAMES = ["No detected activity", "Very low", "Low", "Moderate", "High", "Extremely high"];
export const SEVERITY_COLORS: Record<string, string> = { extreme: "#ff4d4f", high: "#fa8c16", moderate: "#fadb14" };
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmt(v: any, d = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  const n = Number(v);
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + "k";
  return n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

export function pct(v: any, d = 1): string {
  if (v === null || v === undefined) return "–";
  return `${v > 0 ? "+" : ""}${Number(v).toFixed(d)}%`;
}

export function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function aoiLabel(a: any): string {
  if (!a) return "Global";
  if (a.name) return a.name;
  if (a.kind === "world") return "Global";
  if (a.kind === "country") return a.country;
  if (a.kind === "bbox") return `BBox ${a.bbox.map((v: number) => v.toFixed(1)).join(", ")}`;
  return "Custom area";
}

export function toCSV(rows: any[]): string {
  if (!rows?.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: any) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
