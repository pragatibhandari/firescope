import React, { useEffect, useRef, useState } from "react";
import clsx from "clsx";

/** Twinkling, slowly drifting starfield drawn on a canvas (sits behind the transparent globe). */
export function Starfield({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const stars = Array.from({ length: 420 }, () => ({
      x: Math.random(), y: Math.random(), r: Math.random() * 1.2 + 0.2,
      a: Math.random() * 0.6 + 0.2, tw: Math.random() * 2 * Math.PI, sp: 0.4 + Math.random() * 1.6,
      hue: Math.random() < 0.12 ? 30 : Math.random() < 0.2 ? 210 : 0,
    }));
    const resize = () => { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; };
    resize();
    window.addEventListener("resize", resize);
    const draw = (t: number) => {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const s of stars) {
        const alpha = s.a * (0.65 + 0.35 * Math.sin(s.tw + (t / 1000) * s.sp));
        const x = ((s.x + t / 4_000_000) % 1) * c.width;
        ctx.beginPath();
        ctx.arc(x, s.y * c.height, s.r * dpr, 0, Math.PI * 2);
        ctx.fillStyle = s.hue ? `hsla(${s.hue}, 80%, 80%, ${alpha})` : `rgba(255,255,255,${alpha})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} className={clsx("pointer-events-none absolute inset-0 h-full w-full", className)} />;
}

export interface IntroStep { label: string; done: boolean }

/** Title card + live loading checklist shown over the spinning globe. */
export function CountUp({ value, duration = 1400, decimals = 0 }: { value: number | null | undefined; duration?: number; decimals?: number }) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (value == null) return;
    const start = performance.now(), a = from.current, b = value;
    let raf = 0, cur = a;
    const step = (now: number) => {
      const x = Math.min(1, Math.max(0, (now - start) / duration)); // rAF time can precede "start"
      const e = 1 - Math.pow(1 - x, 3);
      cur = a + (b - a) * e;
      setV(cur);
      if (x < 1) raf = requestAnimationFrame(step); else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = cur; };
  }, [value, duration]);
  if (value == null) return <span>–</span>;
  return <span>{v.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}</span>;
}
