import { PANEL_MAP, panelStats, type Panel } from "@hagel/calc";
import { t, tOr } from "../i18n";

/** Exploded top view of the car with the 14 tappable panels (geometry ported from v20). */
const CENTER = [
  { key: "haube", d: "M150,178 L230,178 L230,128 Q230,100 190,96 Q150,100 150,128 Z", cx: 190, cy: 142 },
  { key: "dach", d: "M144,234 Q132,234 132,248 L132,348 Q132,362 144,362 L236,362 Q248,362 248,348 L248,248 Q248,234 236,234 Z", cx: 190, cy: 300 },
  { key: "heck", d: "M154,412 L226,412 L224,452 L156,452 Z", cx: 190, cy: 434 },
  { key: "heck_u", d: "M156,456 L224,456 L222,470 Q220,488 190,488 Q160,488 158,470 Z", cx: 190, cy: 473 },
];
const SIDE: { key: string; x: number; y: number; w: number; h: number; hx: number | null }[] = [
  { key: "kfl_vl", x: 74, y: 152, w: 48, h: 60, hx: null }, { key: "tuer_vl", x: 56, y: 216, w: 66, h: 82, hx: 110 },
  { key: "tuer_hl", x: 56, y: 302, w: 66, h: 82, hx: 110 }, { key: "sw_hl", x: 76, y: 388, w: 46, h: 72, hx: null },
  { key: "kfl_vr", x: 258, y: 152, w: 48, h: 60, hx: null }, { key: "tuer_vr", x: 258, y: 216, w: 66, h: 82, hx: 262 },
  { key: "tuer_hr", x: 258, y: 302, w: 66, h: 82, hx: 262 }, { key: "sw_hr", x: 258, y: 388, w: 46, h: 72, hx: null },
];
const HOLM = [{ key: "dachholm_l", x: 112, y: 238, w: 20, h: 122 }, { key: "dachholm_r", x: 248, y: 238, w: 20, h: 122 }];

export function CarSvg({ panels, glass, onPanel, onGlass, tint }: {
  panels: Record<string, Panel>; glass?: { ws?: { on?: boolean }; rs?: { on?: boolean } };
  onPanel: (key: string) => void; onGlass: (k: "ws" | "rs") => void;
  /** field view: colour of a panel by what is done to it (null = nothing, grey); without it the panel is green when it has dents */
  tint?: (key: string) => { fill: string; stroke: string } | null;
}) {
  const stat = (k: string) => panelStats(panels[k] ?? { key: k });
  const on = (k: string) => (tint ? !!tint(k) : stat(k).total > 0);
  const fillOf = (k: string) => (tint ? tint(k)?.fill ?? "#e7ebf1" : on(k) ? "#86b08a" : "#e7ebf1");
  const strokeOf = (k: string) => (tint ? tint(k)?.stroke ?? "#aab3c0" : on(k) ? "#5e8c63" : "#aab3c0");
  const sw = (a: boolean) => (a ? 2.4 : 1.3);
  const label = (k: string, cx: number, cy: number) => {
    const st = stat(k), a = on(k), counted = st.total > 0;
    return (
      <>
        <text x={cx} y={cy - (counted ? 6 : 0)} textAnchor="middle" fontSize="12" fontWeight="700" fill={a ? "#fff" : "#16233f"} style={{ pointerEvents: "none" }}>{tOr("ps." + k, PANEL_MAP[k].short)}</text>
        {counted && <text x={cx} y={cy + 13} textAnchor="middle" fontSize="12.5" fontWeight="800" fill="#fff" style={{ pointerEvents: "none" }}>{st.total} / {st.avgClass}</text>}
      </>
    );
  };
  const gl = (k: "ws" | "rs", pts: string, ty: number, lbl: string) => {
    const a = !!glass?.[k]?.on;
    return (
      <g key={k} style={{ cursor: "pointer" }} onClick={() => onGlass(k)} role="button" aria-label={lbl}>
        <polygon points={pts} fill={a ? "#f3d3cf" : "#dde3ec"} stroke={a ? "#a23b2e" : "#aab3c0"} strokeWidth={a ? 2.4 : 1} opacity={a ? 1 : 0.8} />
        <text x="190" y={ty} textAnchor="middle" fontSize="10.5" fontWeight="700" fill={a ? "#a23b2e" : "#6b7585"} style={{ pointerEvents: "none" }}>{a ? `✕ ${lbl}` : lbl}</text>
      </g>
    );
  };
  return (
    <svg viewBox="6 60 368 470" style={{ width: "100%", background: "#fff", borderRadius: 16, border: "1px solid #e6e9ee" }} role="group" aria-label={t("carView")}>
      {[[30, 158], [30, 446], [324, 158], [324, 446]].map(([x, y]) => <rect key={`${x}${y}`} x={x} y={y} width="26" height="64" rx="13" fill="#d4dae2" />)}
      <path d="M124,150 Q124,96 190,90 Q256,96 256,150 L256,452 Q256,500 190,504 Q124,500 124,452 Z" fill="#f1f4f8" stroke="#e6e9ee" />
      <path d="M150,96 Q190,78 230,96 L226,112 Q190,100 154,112 Z" fill="#dfe4ea" />
      <path d="M156,494 Q190,508 224,494 L224,486 L156,486 Z" fill="#dfe4ea" />
      <path d="M124,232 q-16,2 -18,15 q12,4 18,-4 Z" fill="#cfd6df" /><path d="M256,232 q16,2 18,15 q-12,4 -18,-4 Z" fill="#cfd6df" />
      {gl("ws", "150,182 230,182 246,230 134,230", 210, t("windscreen"))}
      {gl("rs", "134,364 246,364 230,410 150,410", 391, t("rearWindow"))}
      {SIDE.map((p) => {
        const a = on(p.key);
        return (
          <g key={p.key} style={{ cursor: "pointer" }} onClick={() => onPanel(p.key)} role="button" aria-label={tOr("pn." + p.key, PANEL_MAP[p.key].de)}>
            <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="15" fill={fillOf(p.key)} stroke={strokeOf(p.key)} strokeWidth={sw(a)} />
            {p.hx != null && <rect x={p.hx} y={p.y + p.h / 2 - 12} width="6" height="24" rx="3" fill={a ? "#fff" : "#aab3c0"} opacity=".85" />}
            {label(p.key, p.x + p.w / 2, p.y + p.h / 2)}
          </g>
        );
      })}
      {CENTER.map((p) => {
        const a = on(p.key);
        return (
          <g key={p.key} style={{ cursor: "pointer" }} onClick={() => onPanel(p.key)} role="button" aria-label={tOr("pn." + p.key, PANEL_MAP[p.key].de)}>
            <path d={p.d} fill={fillOf(p.key)} stroke={strokeOf(p.key)} strokeWidth={sw(a)} />
            {label(p.key, p.cx, p.cy)}
          </g>
        );
      })}
      {HOLM.map((p) => {
        const st = stat(p.key), a = on(p.key), cx = p.x + p.w / 2, cy = p.y + p.h / 2;
        return (
          <g key={p.key} style={{ cursor: "pointer" }} onClick={() => onPanel(p.key)} role="button" aria-label={tOr("pn." + p.key, PANEL_MAP[p.key].de)}>
            <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="9" fill={fillOf(p.key)} stroke={strokeOf(p.key)} strokeWidth={sw(a)} />
            <text x={cx} y={cy} transform={`rotate(-90 ${cx} ${cy})`} textAnchor="middle" fontSize="11" fontWeight="800" fill={a ? "#fff" : "#16233f"} style={{ pointerEvents: "none" }}>{tOr("ps." + p.key, "Holm")}{st.total > 0 ? ` ${st.total}/${st.avgClass}` : ""}</text>
          </g>
        );
      })}
    </svg>
  );
}
