import { useEffect, useState } from "react";
import { apiUpload, clearApiCache } from "./api";

/**
 * App-wide upload queue: files are uploaded one at a time, in the order they were added.
 * It lives outside React pages, so it keeps running while the user navigates the app.
 */
export type QState = "waiting" | "uploading" | "done" | "failed";
export interface QItem {
  id: number; name: string; size: number; state: QState;
  added?: number; valid?: number; rejected?: number; error?: string; notes?: string[];
}

let items: QItem[] = [];
const files = new Map<number, File>();
const listeners = new Set<() => void>();
let nextId = 1;
let running = false;
let onBatchDone: (() => void) | null = null;

function emit() { items = [...items]; listeners.forEach((l) => l()); }
function update(id: number, patch: Partial<QItem>) { items = items.map((x) => (x.id === id ? { ...x, ...patch } : x)); emit(); }

export function isActive() { return items.some((q) => q.state === "waiting" || q.state === "uploading"); }

/** Add files to the end of the queue (names already waiting or uploading are skipped). */
export function addFiles(list: File[]): number {
  const busy = new Set(items.filter((q) => q.state === "waiting" || q.state === "uploading").map((q) => `${q.name}|${q.size}`));
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
  let n = 0;
  for (const f of sorted) {
    if (busy.has(`${f.name}|${f.size}`)) continue;
    const id = nextId++;
    files.set(id, f);
    items.push({ id, name: f.name, size: f.size, state: "waiting" });
    n++;
  }
  emit();
  void pump();
  return n;
}

export function remove(id: number) {
  const it = items.find((x) => x.id === id);
  if (!it || it.state === "uploading") return;
  items = items.filter((x) => x.id !== id);
  files.delete(id);
  emit();
}

export function retry(id: number) {
  const it = items.find((x) => x.id === id);
  if (!it || it.state !== "failed" || !files.has(id)) return;
  update(id, { state: "waiting", error: undefined });
  void pump();
}

export function clearFinished() {
  items.filter((x) => x.state === "done").forEach((x) => files.delete(x.id));
  items = items.filter((x) => x.state !== "done");
  emit();
}

export function setOnBatchDone(fn: (() => void) | null) { onBatchDone = fn; }

async function pump() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const next = items.find((x) => x.state === "waiting");
      if (!next) break;
      const file = files.get(next.id);
      if (!file) { update(next.id, { state: "failed", error: "File no longer available - choose it again." }); continue; }
      update(next.id, { state: "uploading" });
      try {
        const r = await apiUpload("/api/ingest/upload", file);
        const v = r.validation || {};
        update(next.id, {
          state: "done", added: r.rows_added, valid: v.rows_valid,
          rejected: (v.dropped_invalid_coords || 0) + (v.dropped_missing_time || 0) + (v.dropped_unknown_platform || 0),
          notes: v.notes,
        });
      } catch (e: any) {
        update(next.id, { state: "failed", error: String(e?.message || e).slice(0, 300) });
      }
      clearApiCache();
      onBatchDone?.();
    }
  } finally {
    running = false;
  }
}

// Warn before closing the tab while uploads are pending
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (isActive()) { e.preventDefault(); e.returnValue = ""; }
  });
}

export function useUploadQueue(): QItem[] {
  const [, force] = useState(0);
  useEffect(() => { const l = () => force((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return items;
}
