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
  if (a.kind === "bbox") return `Selected area ${a.bbox.map((v: number) => v.toFixed(1)).join(", ")}`;
  return "Custom area";
}

/**
 * Parse coordinates typed into a search box.
 * "lat, lon"               -> a 1° x 1° box centred on the point (about 110 km across)
 * "lat1, lon1, lat2, lon2" -> the box between two corners
 * Returns null if the text is not coordinates.
 */
export function parseLatLon(q: string): { kind: "bbox"; bbox: [number, number, number, number]; name: string } | null {
  if (!/^[\s\d.,;+\-°NSEWnsew]+$/.test(q) || !/\d/.test(q)) return null;
  const toks = q.match(/[+-]?\d+(?:\.\d+)?\s*°?\s*[NSEWnsew]?/g) || [];
  const vals = toks.map((t) => {
    const v = parseFloat(t);
    return /[SWsw]/.test(t) ? -Math.abs(v) : v;
  });
  const okLat = (v: number) => v >= -90 && v <= 90, okLon = (v: number) => v >= -180 && v <= 180;
  if (vals.length === 2) {
    const [lat, lon] = vals;
    if (!okLat(lat) || !okLon(lon)) return null;
    const d = 0.5;
    return { kind: "bbox", bbox: [Math.max(-180, lon - d), Math.max(-90, lat - d), Math.min(180, lon + d), Math.min(90, lat + d)], name: `${lat.toFixed(2)}, ${lon.toFixed(2)} (±0.5°)` };
  }
  if (vals.length === 4) {
    const [a, b, c, d] = vals;
    if (![a, c].every(okLat) || ![b, d].every(okLon) || a === c || b === d) return null;
    return { kind: "bbox", bbox: [Math.min(b, d), Math.min(a, c), Math.max(b, d), Math.max(a, c)], name: `${Math.min(a, c).toFixed(2)}…${Math.max(a, c).toFixed(2)}, ${Math.min(b, d).toFixed(2)}…${Math.max(b, d).toFixed(2)}` };
  }
  return null;
}

export function toCSV(rows: any[]): string {
  if (!rows?.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: any) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
