import { useEffect, useMemo, useRef } from "react";

// The landing-page ambient: soft colored glows scattered at random, gently drifting,
// plus a glow that trails the cursor. Fixed behind the content so it works on any page.
export default function AmbientGlow() {
  const ref = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const cur = useRef({ x: 0, y: 0 });

  const blobs = useMemo(() => {
    const colors = ["rgba(249,115,22,0.30)", "rgba(139,111,199,0.28)", "rgba(236,72,153,0.22)", "rgba(249,115,22,0.22)", "rgba(139,111,199,0.20)"];
    return Array.from({ length: 10 }).map((_, i) => ({
      left: Math.random() * 100, top: Math.random() * 100,
      size: 260 + Math.random() * 280, color: colors[i % colors.length],
      dur: 16 + Math.random() * 14, delay: -Math.random() * 12,
    }));
  }, []);

  useEffect(() => {
    target.current = cur.current = { x: window.innerWidth * 0.8, y: window.innerHeight * 0.28 };
    const onMove = (e: MouseEvent) => { target.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("mousemove", onMove);
    let raf = 0;
    const ease = 0.045;
    const tick = () => {
      cur.current.x += (target.current.x - cur.current.x) * ease;
      cur.current.y += (target.current.y - cur.current.y) * ease;
      const el = ref.current;
      if (el) { el.style.setProperty("--mx", `${cur.current.x}px`); el.style.setProperty("--my", `${cur.current.y}px`); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { window.removeEventListener("mousemove", onMove); cancelAnimationFrame(raf); };
  }, []);

  return (
    <div className="ambient" ref={ref} aria-hidden="true">
      {blobs.map((b, i) => (
        <span key={i} className="blob" style={{
          left: `${b.left}%`, top: `${b.top}%`, width: b.size, height: b.size,
          background: `radial-gradient(circle, ${b.color}, transparent 70%)`,
          animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s`,
        }} />
      ))}
    </div>
  );
}
