import { useCallback, useEffect, useRef } from "react";
import { SIGNATURE_H, SIGNATURE_W } from "@hagel/shared";

export type Strokes = [number, number][][];

/**
 * A box to sign in with the finger (or a mouse). The drawing is kept as vectors (strokes of points in a 600 x 200 box): a few KB, it travels
 * inside the offline operation and is drawn into the receipt PDF without any image. `value` is controlled so the parent can clear it.
 */
export function SignaturePad({ value, onChange, label }: { value: Strokes; onChange: (s: Strokes) => void; label: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<[number, number][] | null>(null);
  const strokes = useRef<Strokes>(value);
  strokes.current = value;

  const paint = useCallback((list: Strokes) => {
    const c = cv.current;
    if (!c) return;
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = Math.round(c.clientWidth * ratio) || SIGNATURE_W;
    if (c.width !== w) { c.width = w; c.height = Math.round((w * SIGNATURE_H) / SIGNATURE_W); }
    const g = c.getContext("2d");
    if (!g) return;
    const k = c.width / SIGNATURE_W;
    g.clearRect(0, 0, c.width, c.height);
    g.lineWidth = 2.4 * k; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#14233B"; g.fillStyle = "#14233B";
    for (const s of list) {
      if (s.length === 1) { g.beginPath(); g.arc(s[0][0] * k, s[0][1] * k, 1.6 * k, 0, Math.PI * 2); g.fill(); continue; }
      g.beginPath();
      s.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)));
      g.stroke();
    }
  }, []);
  useEffect(() => { paint(value); }, [value, paint]);
  useEffect(() => { const r = () => paint(strokes.current); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, [paint]);

  const at = (e: React.PointerEvent): [number, number] => {
    const r = cv.current!.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * SIGNATURE_W * 10) / 10, Math.round(((e.clientY - r.top) / r.height) * SIGNATURE_H * 10) / 10];
  };
  const total = () => strokes.current.reduce((n, s) => n + s.length, 0);
  const down = (e: React.PointerEvent) => {
    if (strokes.current.length >= 60 || total() >= 5800) return;
    e.preventDefault();
    cv.current!.setPointerCapture(e.pointerId);
    drawing.current = [at(e)];
    paint([...strokes.current, drawing.current]);
  };
  const move = (e: React.PointerEvent) => {
    const s = drawing.current;
    if (!s || total() + s.length >= 5900 || s.length >= 1900) return;
    const p = at(e), last = s[s.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5) return; // fewer points, same line
    s.push(p);
    paint([...strokes.current, s]);
  };
  const up = () => {
    const s = drawing.current;
    drawing.current = null;
    if (s) onChange([...strokes.current, s]);
  };

  return (
    <canvas ref={cv} aria-label={label} role="img"
      style={{ width: "100%", aspectRatio: `${SIGNATURE_W} / ${SIGNATURE_H}`, border: "1px dashed #8A96AB", borderRadius: 12, background: "#fff", touchAction: "none", display: "block" }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
  );
}
