/**
 * Incremental reader for a GeoJSON FeatureCollection arriving as text chunks.
 * Each complete feature object is parsed as soon as its last byte has been received,
 * so hotspots can be drawn while the download is still in progress.
 */
export class FeatureStream {
  features: any[] = [];
  private buf = "";
  private pos = 0;
  private started = false;
  private done = false;
  private depth = 0;
  private inStr = false;
  private esc = false;
  private objStart = -1;

  push(text: string) {
    if (this.done || !text) return;
    this.buf += text;
    if (!this.started) {
      const i = this.buf.indexOf('"features":[');
      if (i < 0) return;
      this.started = true;
      this.pos = i + 12;
    }
    const b = this.buf;
    let i = this.pos;
    for (; i < b.length; i++) {
      const c = b.charCodeAt(i);
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (c === 92) this.esc = true; // backslash
        else if (c === 34) this.inStr = false; // quote
        continue;
      }
      if (c === 34) { this.inStr = true; continue; }
      if (c === 123) { if (this.depth++ === 0) this.objStart = i; continue; } // {
      if (c === 125) { // }
        if (--this.depth === 0 && this.objStart >= 0) {
          try { this.features.push(JSON.parse(b.slice(this.objStart, i + 1))); } catch { /* skip malformed */ }
          this.objStart = -1;
        }
        continue;
      }
      if (c === 93 && this.depth === 0) { this.done = true; break; } // ] closes the features array
    }
    // keep only the unfinished object (if any) to bound memory
    if (this.depth > 0 && this.objStart >= 0) { this.buf = b.slice(this.objStart); this.pos = this.buf.length; this.objStart = 0; }
    else { this.buf = ""; this.pos = 0; }
  }
}
