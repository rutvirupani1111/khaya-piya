// Inline SVG props for the eatery. One ink line style: 1.5px, round caps.
import type { CSSProperties } from "react";

export const INKS = [
  { fill: "var(--stamp-red)", text: "var(--stamp-red-deep)", on: "#F6EED9", pat: "solid" },
  { fill: "var(--haldi)", text: "var(--ink)", on: "#1B1A17", pat: "dots" },
  { fill: "var(--chutney)", text: "var(--chutney-deep)", on: "#F6EED9", pat: "stripes" },
  { fill: "var(--paan)", text: "var(--paan-deep)", on: "#1B1A17", pat: "hatch" },
  { fill: "var(--chai)", text: "var(--chai)", on: "#F6EED9", pat: "rings" },
  { fill: "var(--teal)", text: "var(--teal-deep)", on: "#F6EED9", pat: "zigzag" },
] as const;
export const ink = (seat: number) => INKS[(seat - 1) % 6];

export function Pattern({ seat, size = 18 }: { seat: number; size?: number }) {
  const i = ink(seat);
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="8" fill={i.fill} />
      {i.pat === "dots" && [5, 9, 13].flatMap((x) => [6, 12].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.2" fill="#1B1A17" />))}
      {i.pat === "stripes" && <path d="M3 13 13 3M6 16 16 6M2 9 9 2" stroke="#F6EED9" strokeWidth="1.5" strokeLinecap="round" />}
      {i.pat === "hatch" && <path d="M4 4l10 10M14 4 4 14" stroke="#1B1A17" strokeWidth="1.3" strokeLinecap="round" />}
      {i.pat === "rings" && <circle cx="9" cy="9" r="4" fill="none" stroke="#F6EED9" strokeWidth="1.5" />}
      {i.pat === "zigzag" && <path d="M3 10l2.5-3 2.5 3 2.5-3 2.5 3 2.5-3" fill="none" stroke="#F6EED9" strokeWidth="1.5" strokeLinecap="round" />}
      {seat > 6 && <circle cx="9" cy="9" r="8" fill="none" stroke="#1B1A17" strokeWidth="1.2" strokeDasharray="2 1.5" />}
    </svg>
  );
}

export function Thali({ seat, name, size = 92, active, glow }: { seat: number; name: string; size?: number; active?: boolean; glow?: boolean }) {
  const i = ink(seat);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ overflow: "visible" }}>
      <defs>
        <radialGradient id={`th${seat}`} cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#eef2f3" />
          <stop offset=".55" stopColor="#b8c2c6" />
          <stop offset="1" stopColor="#7d898e" />
        </radialGradient>
      </defs>
      <ellipse cx="52" cy="54" rx="46" ry="46" fill="rgba(0,0,0,.18)" />
      <circle cx="50" cy="50" r="46" fill={`url(#th${seat})`} stroke={glow ? "var(--haldi)" : "#5F6B70"} strokeWidth={glow ? 4 : 1.5} />
      <circle cx="50" cy="50" r="39" fill="none" stroke={i.fill} strokeWidth={active ? 5 : 3} strokeDasharray={i.pat === "solid" ? undefined : i.pat === "dots" ? "1 5" : i.pat === "rings" ? "8 4" : "4 3"} strokeLinecap="round" />
      <circle cx="50" cy="50" r="30" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="1.5" />
      <g transform="translate(50 50) rotate(-8)">
        <rect x="-14" y="-12" width="28" height="24" rx="4" fill="none" stroke={i.fill} strokeWidth="2.5" opacity=".9" />
        <text textAnchor="middle" y="7" fontSize="18" fontFamily="var(--f-rozha)" fill={i.fill}>
          {name.slice(0, seat > 6 ? 2 : 1).toUpperCase()}
        </text>
      </g>
    </svg>
  );
}

export function Katori({ size = 40, fill = "var(--haldi)" }: { size?: number; fill?: string }) {
  return (
    <svg width={size} height={size * 0.7} viewBox="0 0 40 28" aria-hidden="true">
      <ellipse cx="20" cy="8" rx="17" ry="5" fill={fill} stroke="#1B1A17" strokeWidth="1.5" />
      <path d="M3 8q2 16 17 17 15-1 17-17" fill="#c6cfd2" stroke="#1B1A17" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 13q4 6 10 7" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Printer({ busy, led = true }: { busy?: boolean; led?: boolean }) {
  return (
    <svg viewBox="0 0 220 120" className="w-full" aria-hidden="true">
      <rect x="18" y="36" width="184" height="76" rx="14" fill="#9aa5aa" stroke="#1B1A17" strokeWidth="1.5" />
      <rect x="18" y="36" width="184" height="30" rx="14" fill="#c7d0d3" stroke="#1B1A17" strokeWidth="1.5" />
      <rect x="44" y="30" width="132" height="12" rx="4" fill="#1B1A17" />
      <rect x="50" y="34" width="120" height="3" rx="1.5" fill="#444" />
      <circle cx="182" cy="88" r="5" fill={led ? (busy ? "#F4B400" : "#2E9E5B") : "#444"} stroke="#1B1A17" strokeWidth="1.5" />
      <rect x="36" y="80" width="80" height="6" rx="3" fill="#5F6B70" />
      <rect x="36" y="92" width="56" height="6" rx="3" fill="#5F6B70" />
      <path d="M30 112h160" stroke="#1B1A17" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Bell({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 40" className={className} aria-hidden="true">
      <ellipse cx="24" cy="36" rx="20" ry="3.5" fill="#5F6B70" stroke="#1B1A17" strokeWidth="1.5" />
      <path d="M8 34q0-22 16-22t16 22z" fill="#c9a24a" stroke="#1B1A17" strokeWidth="1.5" />
      <circle cx="24" cy="10" r="3" fill="#c9a24a" stroke="#1B1A17" strokeWidth="1.5" />
      <path d="M15 28q1-9 7-12" stroke="#fff6d0" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Jar({ label, amount, color, tipped, closed, outline, flipped }: { label: string; amount: string; color: string; tipped?: boolean; closed?: boolean; outline?: boolean; flipped?: boolean }) {
  const style: CSSProperties = { transform: `${flipped ? "rotate(180deg) " : ""}${tipped ? "rotate(35deg)" : ""}`, transition: "transform 380ms cubic-bezier(.3,1.4,.5,1)", transformOrigin: "50% 80%" };
  return (
    <svg viewBox="0 0 80 110" width="78" height="108" style={style} aria-hidden="true">
      <rect x="18" y={closed ? 6 : 2} width="44" height="12" rx="3" fill={closed ? "#c9a24a" : "#8a5a34"} stroke="#1B1A17" strokeWidth="1.5" />
      <path d="M14 20h52v74q0 10-10 10H24q-10 0-10-10z" fill={outline ? "none" : "rgba(255,255,255,.35)"} stroke="#1B1A17" strokeWidth="1.5" strokeDasharray={outline ? "4 3" : undefined} />
      {!outline && <path d="M16 54h48v40q0 8-8 8H24q-8 0-8-8z" fill={color} opacity=".9" />}
      <path d="M22 28v60" stroke="#fff" strokeOpacity=".6" strokeWidth="3" strokeLinecap="round" />
      <path d="M30 18l-8 14M50 18l8 14" stroke="#a37b45" strokeWidth="1.5" />
      <g transform={flipped ? "rotate(180 40 46)" : undefined}>
        <rect x="18" y="34" width="44" height="22" rx="2" fill="#F6EED9" stroke="#1B1A17" strokeWidth="1.2" transform="rotate(-3 40 45)" />
        <text x="40" y="44" textAnchor="middle" fontSize="8" fontFamily="var(--f-mukta)" fontWeight="800" fill="#1B1A17">{label}</text>
        <text x="40" y="53" textAnchor="middle" fontSize="7.5" fontFamily="var(--f-plex)" fill="#1B1A17">{amount}</text>
      </g>
    </svg>
  );
}

export function Scale({ tilt, balanced }: { tilt: number; balanced: boolean }) {
  return (
    <svg viewBox="0 0 160 120" className="w-full max-w-[200px]" aria-hidden="true">
      <path d="M80 30v74M56 110h48" stroke="#8a6a2a" strokeWidth="5" strokeLinecap="round" />
      <g style={{ transform: `rotate(${tilt}deg)`, transformOrigin: "80px 30px", transition: "transform 420ms cubic-bezier(.3,1.5,.5,1)" }}>
        <path d="M20 30h120" stroke="#c9a24a" strokeWidth="5" strokeLinecap="round" />
        <path d="M20 30l-12 34h24zM140 30l-12 34h24z" fill="none" stroke="#8a6a2a" strokeWidth="1.5" />
        <path d="M4 64h32q-4 10-16 10T4 64zM124 64h32q-4 10-16 10t-16-10z" fill="#c9a24a" stroke="#1B1A17" strokeWidth="1.5" />
      </g>
      <circle cx="80" cy="28" r="6" fill={balanced ? "#2E9E5B" : "#c9a24a"} stroke="#1B1A17" strokeWidth="1.5" />
    </svg>
  );
}

export function Coin({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="var(--copper)" stroke="#5a3415" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="4.5" fill="none" stroke="#f0b98a" strokeWidth="1" />
      <text x="8" y="10.5" textAnchor="middle" fontSize="6" fill="#3a2008" fontFamily="var(--f-mukta)" fontWeight="800">1</text>
    </svg>
  );
}

export function Seeds() {
  return (
    <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
      <ellipse cx="5" cy="3" rx="4.5" ry="2" fill="#8fbf5a" stroke="#4d6b2a" strokeWidth=".8" />
    </svg>
  );
}

export function Mishri() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <rect x="1" y="1" width="6" height="6" rx="1" fill="#fffaf0" stroke="#c9b48a" strokeWidth=".8" transform="rotate(12 4 4)" />
    </svg>
  );
}

export function Stamp({ text, color, rotate = -6 }: { text: string; color: string; rotate?: number }) {
  return (
    <span
      className="display inline-block rounded-md border-[3px] px-3 py-0.5 text-2xl uppercase tracking-wider"
      style={{ color, borderColor: color, transform: `rotate(${rotate}deg)`, opacity: 0.88 }}
    >
      {text}
    </span>
  );
}

export function Money({ p, sign, className }: { p: number; sign?: boolean; className?: string }) {
  const neg = p < 0;
  const v = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(p) / 100);
  return (
    <span className={className}>
      {neg ? "−" : sign ? "+" : ""}
      <span className="rupee">₹</span>
      <span className="mono">{v}</span>
    </span>
  );
}

/**
 * A running total that rolls like a shop counter: each digit column slides to its new number in 150 ms.
 * The figure is read out once as text; the rolling columns are hidden from screen readers.
 */
export function Odometer({ p, className }: { p: number; className?: string }) {
  const v = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(p) / 100);
  return (
    <span className={className}>
      <span className="sr-only">₹{v}</span>
      <span aria-hidden="true" className="inline-flex items-end">
        {p < 0 && "−"}
        <span className="rupee odo-col">₹</span>
        <span className="mono inline-flex">
          {[...v].map((ch, i) =>
            /\d/.test(ch) ? (
              <span key={`${v.length - i}`} className="odo-col">
                <span className="odo-strip" style={{ transform: `translateY(-${Number(ch) * 10}%)` }}>
                  {"0123456789".split("").map((n) => <span key={n}>{n}</span>)}
                </span>
              </span>
            ) : (
              <span key={`${v.length - i}`} className="odo-col">{ch}</span>
            ),
          )}
        </span>
      </span>
    </span>
  );
}
