import { useEffect, useRef, useState } from "react";

const BASE = (import.meta as any).env?.VITE_API_BASE || "";

// Admin password (only needed for sync / upload / delete on a locked server). Kept in this browser only.
export function getAdminToken(): string { try { return localStorage.getItem("firescope_admin") || ""; } catch { return ""; } }
export function setAdminToken(t: string) { try { t ? localStorage.setItem("firescope_admin", t) : localStorage.removeItem("firescope_admin"); } catch { /* storage blocked */ } }
function authHeaders(): Record<string, string> { const t = getAdminToken(); return t ? { "X-Admin-Token": t } : {}; }

export async function apiGet<T = any>(path: string): Promise<T> {
  const r = await fetch(BASE + path, { headers: authHeaders() });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

export async function apiPost<T = any>(path: string, body: any): Promise<T> {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body) });
  if (!r.ok) {
    let msg = await r.text();
    try { msg = JSON.parse(msg).detail || msg; } catch { /* plain text */ }
    throw new Error(`${r.status}: ${String(msg).slice(0, 300)}`);
  }
  return r.json();
}

export async function apiDownload(path: string, body: any, filename: string) {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  const blob = await r.blob();
  saveBlob(blob, filename);
}

export async function apiUpload(path: string, file: File, extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append("file", file);
  Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
  const r = await fetch(BASE + path, { method: "POST", body: fd, headers: authHeaders() });
  if (!r.ok) {
    let msg = await r.text();
    try { msg = JSON.parse(msg).detail || msg; } catch { /* plain text */ }
    if (r.status === 413) msg = "File too large for the upload limit (1 GB). Split the NASA request into shorter periods.";
    throw new Error(msg);
  }
  return r.json();
}

export function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

const memo = new Map<string, any>();

/** POST with in-memory memoisation, cancellation of stale responses and loading/error state. */
export function useApi<T = any>(path: string | null, body: any): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const key = path ? path + JSON.stringify(body) : "";
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: memo.get(key) ?? null, loading: !!path && !memo.has(key), error: null });
  const [nonce, setNonce] = useState(0);
  const latest = useRef(key);
  useEffect(() => {
    latest.current = key;
    if (!path) { setState({ data: null, loading: false, error: null }); return; }
    if (memo.has(key) && nonce === 0) { setState({ data: memo.get(key), loading: false, error: null }); return; }
    setState((s) => ({ ...s, loading: true, error: null }));
    apiPost<T>(path, body)
      .then((d) => { memo.set(key, d); if (memo.size > 80) memo.delete(memo.keys().next().value as string); if (latest.current === key) setState({ data: d, loading: false, error: null }); })
      .catch((e) => { if (latest.current === key) setState({ data: null, loading: false, error: String(e.message || e) }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);
  return { ...state, reload: () => { memo.delete(key); setNonce((n) => n + 1); } };
}

export function clearApiCache() { memo.clear(); }

export async function apiDelete(path: string) {
  const r = await fetch(BASE + path, { method: "DELETE", headers: authHeaders() });
  if (!r.ok) { let m = await r.text(); try { m = JSON.parse(m).detail || m; } catch { /* text */ } throw new Error(m); }
  return r.json();
}
