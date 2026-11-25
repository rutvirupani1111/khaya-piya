// Khata props: steel tiffin carriers for the shelf, the string bookmark, the waiter's order pad spiral.
import { ink } from "../art";

/** Each tiffin keeps one band ink wherever it appears: shelf, ledger, table sheet, invite. */
export const tiffinInk = (id: string) => ([...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 6) + 1;

/** A three-tier steel tiffin carrier with a paper tag tied on. `n` picks the band ink. */
export function Tiffin({ n, tiers = 3, ghost, size = 96 }: { n: number; tiers?: number; ghost?: boolean; size?: number }) {
  const band = ink(n).fill;
  const h = 34 + tiers * 26;
  const id = `tf${n}${ghost ? "g" : ""}`;
  return (
    <svg width={size} height={(size * (h + 6)) / 100} viewBox={`0 0 100 ${h + 6}`} aria-hidden="true" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={id} x1="0" x2="1">
          <stop offset="0" stopColor="#7d898e" />
          <stop offset=".28" stopColor="#e6ecee" />
          <stop offset=".5" stopColor="#b8c2c6" />
          <stop offset=".78" stopColor="#dfe5e7" />
          <stop offset="1" stopColor="#7d898e" />
        </linearGradient>
      </defs>
      {/* handle */}
      <path d="M30 26V12q0-9 9-9h22q9 0 9 9v14" fill="none" stroke={ghost ? "currentColor" : "#5F6B70"} strokeWidth="4" strokeLinecap="round" strokeDasharray={ghost ? "5 5" : undefined} />
      {/* side clamps */}
      <path d={`M14 26V${h - 4}M86 26V${h - 4}`} stroke={ghost ? "currentColor" : "#5F6B70"} strokeWidth="3" strokeLinecap="round" strokeDasharray={ghost ? "5 5" : undefined} />
      {Array.from({ length: tiers }).map((_, i) => {
        const y = 28 + i * 26;
        return ghost ? (
          <rect key={i} x="18" y={y} width="64" height="24" rx="7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" />
        ) : (
          <g key={i}>
            <rect x="18" y={y} width="64" height="24" rx="7" fill={`url(#${id})`} stroke="#1B1A17" strokeWidth="1.5" />
            <path d={`M20 ${y + 5}h60`} stroke="#fff" strokeOpacity=".55" strokeWidth="1.5" strokeLinecap="round" />
          </g>
        );
      })}
      {/* lid with the group's ink band */}
      {!ghost && <rect x="16" y="22" width="68" height="9" rx="4.5" fill={band} stroke="#1B1A17" strokeWidth="1.5" />}
      {!ghost && <rect x="34" y={h - 2} width="32" height="6" rx="3" fill="rgba(0,0,0,.22)" />}
    </svg>
  );
}

/** Red string bookmark that hangs from the top of the ledger, short enough to clear the first written row. */
export function Bookmark({ className }: { className?: string }) {
  return (
    <svg width="18" height="46" viewBox="0 0 18 46" className={className} aria-hidden="true">
      <path d="M9 0q-3 16 1 26t-2 12" fill="none" stroke="#A61E1E" strokeWidth="3" strokeLinecap="round" />
      <path d="M8 37l-5 8M8 37l5 8" stroke="#A61E1E" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** The spiral wire on top of a waiter's order pad. */
export function Spiral() {
  return (
    <svg viewBox="0 0 300 26" className="h-6 w-full" preserveAspectRatio="none" aria-hidden="true">
      {Array.from({ length: 15 }).map((_, i) => (
        <g key={i} transform={`translate(${12 + i * 19.5} 0)`}>
          <circle cx="0" cy="18" r="3.2" fill="#1B1A17" opacity=".7" />
          <path d="M-3 18q0-16 6-16t4 16" fill="none" stroke="#8d969a" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}

/** One ink-line fingerprint for the passkey button. */
export function Thumb({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M6.5 19.5c1.5-2 2-4.2 2-7.5a3.5 3.5 0 0 1 7 0c0 1.4-.1 2.7-.4 3.9" />
      <path d="M4 15.5c.6-1.2.9-2.4.9-3.5a7.1 7.1 0 0 1 12.6-4.5" />
      <path d="M12 12c0 3.6-.8 6.4-2.6 8.6M19.3 10.4c.2.5.2 1 .2 1.6 0 2.5-.4 4.8-1.3 6.8M14.6 18.4c-.3.9-.7 1.8-1.2 2.6" />
    </svg>
  );
}

/** Ink-line marks for the three "Kaise chalta hai" steps: a tiffin (the group), a pencil (write it), a red thread (settle). */
export function StepIcon({ kind }: { kind: "tiffin" | "pencil" | "thread" }) {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="#1B1A17" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {kind === "tiffin" && (
        <>
          <path d="M14 11V7q0-3 3-3h6q3 0 3 3v4" />
          <path d="M9 12v22M31 12v22" />
          <rect x="11" y="11" width="18" height="5" rx="2.5" fill="#E8578B" />
          <rect x="12" y="16" width="16" height="8" rx="2.5" fill="#dfe5e7" />
          <rect x="12" y="25" width="16" height="8" rx="2.5" fill="#dfe5e7" />
        </>
      )}
      {kind === "pencil" && (
        <>
          <path d="M5 33q7-5 14-1t15-2" strokeDasharray="2 3" />
          <g transform="rotate(-38 24 18)">
            <rect x="12" y="15" width="22" height="6" rx="1.2" fill="#F4B400" />
            <path d="M12 15l-6 3 6 3z" fill="#e8c98a" />
            <rect x="31" y="15" width="3" height="6" fill="#D62828" />
          </g>
        </>
      )}
      {kind === "thread" && (
        <>
          <circle cx="7" cy="20" r="4" fill="#F4B400" />
          <circle cx="33" cy="20" r="4" fill="#2E9E5B" />
          <path d="M11 20q5-9 10 0t8 0" stroke="#C62020" strokeWidth="2" />
          <path d="M26 16.5l3.2 3.5-4.2 1.6" stroke="#C62020" strokeWidth="2" />
        </>
      )}
    </svg>
  );
}
