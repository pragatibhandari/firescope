import { useEffect, useRef, useState } from "react";

const BASE = (import.meta as any).env?.VITE_API_BASE || "";

// Admin password (only needed for sync / upload / delete on a locked server). Kept in this browser only.
export function getAdminToken(): string { try { return localStorage.getItem("firescope_admin") || ""; } catch { return ""; } }
export function setAdminToken(t: string) { try { t ? localStorage.setItem("firescope_admin", t) : localStorage.removeItem("firescope_admin"); } catch { /* storage blocked */ } }
function authHeaders(): Record<string, string> { const t = getAdminToken(); return t ? { "X-Admin-Token": t } : {}; }

export async function apiGet<T = any>(path: string): Promise<T> {
  const r = await fetch(BASE + path, { headers: authHeaders() });
  if (!r.ok) throw new Error(await errorMessage(r));
  return r.json();
}

export type Progress = { received: number; total: number | null; chunk?: string }; // chunk = newly received text

/** Turn an error response into a readable message (HTML error pages from the proxy become one line). */
async function errorMessage(r: Response): Promise<string> {
  let msg = await r.text();
  try { msg = JSON.parse(msg).detail || msg; } catch { /* plain text */ }
  msg = String(msg);
  if (/^\s*</.test(msg)) {
    msg = r.status === 502 || r.status === 503 || r.status === 504
      ? "The data service did not respond — it may be restarting or busy with a very large request. Please retry, or choose a shorter period."
      : "The server returned an error page.";
  }
  return `${r.status}: ${msg.slice(0, 300)}`;
}

export async function apiPost<T = any>(path: string, body: any, onProgress?: (p: Progress) => void): Promise<T> {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await errorMessage(r));
  if (!onProgress || !r.body) return r.json();
  // stream the body so the UI can show real download progress
  const hdr = Number(r.headers.get("X-Content-Bytes") || "");
  const total = Number.isFinite(hdr) && hdr > 0 ? hdr : null;
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  const dec = new TextDecoder();
  let received = 0;
  onProgress({ received, total });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress({ received, total, chunk: dec.decode(value, { stream: true }) });
  }
  const all = new Uint8Array(received);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return JSON.parse(new TextDecoder().decode(all));
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
export function useApi<T = any>(path: string | null, body: any, onProgress?: (p: Progress) => void): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const key = path ? path + JSON.stringify(body) : "";
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: memo.get(key) ?? null, loading: !!path && !memo.has(key), error: null });
  const [nonce, setNonce] = useState(0);
  const latest = useRef(key);
  useEffect(() => {
    latest.current = key;
    if (!path) { setState({ data: null, loading: false, error: null }); return; }
    if (memo.has(key) && nonce === 0) { setState({ data: memo.get(key), loading: false, error: null }); return; }
    setState((s) => ({ ...s, loading: true, error: null }));
    apiPost<T>(path, body, onProgress)
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
