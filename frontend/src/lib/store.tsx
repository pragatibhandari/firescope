import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiGet, clearApiCache } from "./api";

export type AOI =
  | { kind: "world"; name?: string }
  | { kind: "bbox"; bbox: [number, number, number, number]; name?: string }
  | { kind: "country"; country: string; name?: string }
  | { kind: "polygon" | "geojson"; geometry: any; name?: string };

export interface Filters {
  dataset: "demo" | "live";
  start: string;
  end: string;
  sensors: string[];
  product: "all" | "SP" | "NRT";
  min_conf: "low" | "nominal" | "high";
  aoi: AOI;
  exclude_static: boolean;
}

export interface HParams {
  grid_deg: number;
  day_basis: "utc" | "solar";
  match_km: number;
  match_days: number;
  viirs_mode: "reference" | "all";
  modis_mode: "all" | "aqua" | "terra";
  calibration: "seasonal_ratio" | "loglinear" | "none";
  target: "viirs" | "modis";
  frp_beta: number;
  shrinkage: number;
  conf_weights: { low: number; nominal: number; high: number };
}

export const DEFAULT_PARAMS: HParams = {
  grid_deg: 0.01, day_basis: "utc", match_km: 2, match_days: 0, viirs_mode: "reference", modis_mode: "all",
  calibration: "seasonal_ratio", target: "viirs", frp_beta: 0, shrinkage: 3, conf_weights: { low: 0.5, nominal: 1, high: 1 },
};

interface Ctx {
  filters: Filters;
  setFilters: (f: Partial<Filters>) => void;
  params: HParams;
  setParams: (p: Partial<HParams>) => void;
  selectedDate: string | null;
  setSelectedDate: (d: string | null) => void;
  status: any;
  refreshStatus: () => void;
  body: (extra?: any) => any;
}

const C = createContext<Ctx>(null as any);

function readUrl(): { f?: Partial<Filters>; p?: Partial<HParams> } {
  try {
    const s = new URLSearchParams(window.location.hash.split("?")[1] || "");
    const st = s.get("state");
    return st ? JSON.parse(atob(st)) : {};
  } catch { return {}; }
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const init = readUrl();
  const [filters, setF] = useState<Filters>({
    dataset: "demo", start: "2024-01-01", end: "2024-12-31", sensors: ["MODIS", "VIIRS"], product: "all",
    min_conf: "nominal", aoi: { kind: "world" }, exclude_static: true, ...(init.f || {}),
  });
  const [params, setP] = useState<HParams>({ ...DEFAULT_PARAMS, ...(init.p || {}) });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [datasetChosen, setDatasetChosen] = useState(!!init.f?.dataset);

  const refreshStatus = useCallback(() => {
    apiGet("/api/status").then((s) => {
      setStatus(s);
      if (!datasetChosen && s.default_dataset) { setF((f) => ({ ...f, dataset: s.default_dataset })); setDatasetChosen(true); }
    }).catch((e) => setStatus({ error: String(e) }));
  }, [datasetChosen]);

  useEffect(() => { refreshStatus(); const t = setInterval(refreshStatus, 30000); return () => clearInterval(t); }, [refreshStatus]);
  // poll faster while the demo dataset is being built
  useEffect(() => {
    if (status?.demo === "building") { const t = setTimeout(() => { clearApiCache(); refreshStatus(); }, 4000); return () => clearTimeout(t); }
  }, [status, refreshStatus]);

  const setFilters = (f: Partial<Filters>) => { setF((o) => ({ ...o, ...f })); if (f.dataset) setDatasetChosen(true); };
  const setParams = (p: Partial<HParams>) => setP((o) => ({ ...o, ...p }));

  const value = useMemo<Ctx>(() => ({
    filters, setFilters, params, setParams, selectedDate, setSelectedDate, status, refreshStatus,
    body: (extra = {}) => ({ filters, params, ...extra }),
  }), [filters, params, selectedDate, status, refreshStatus]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export const useStore = () => useContext(C);

export function shareableState(f: Filters, p: HParams) {
  return btoa(JSON.stringify({ f, p }));
}
