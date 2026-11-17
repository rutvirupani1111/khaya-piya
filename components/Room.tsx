"use client";
import { AnimatePresence, m } from "motion/react";
import qrcode from "qrcode-generator";
import { useCallback, useEffect, useRef, useState } from "react";
import { amountParam } from "@/lib/money";
import { applyOp, billOf, type Actor, type Op, type Snapshot } from "@/lib/room/ops";
import { Coin, Jar, Mishri, Money, Pattern, Seeds, Stamp, Thali, ink } from "./art";
import { usePrefs } from "./Prefs";

type Snap = Snapshot & { me: Actor };
const snap = { type: "spring", stiffness: 520, damping: 34 } as const;
const ease = [0.65, 0, 0.35, 1] as const;

function devHeader(): Record<string, string> {
  try {
    const t = localStorage.getItem("kp_dev");
    return t ? { "x-kp-dev": t } : {};
  } catch {
    return {};
  }
}

/** Server snapshot + optimistic outbox, polled with ETag/304. */
function useRoom(initial: Snap) {
  const [server, setServer] = useState(initial);
  const [outbox, setOutbox] = useState<Op[]>([]);
  const [failed, setFailed] = useState(false);
  const lastChange = useRef(Date.now());
  const sending = useRef(false);

  const view: Snap = (() => {
    let s = server as Snap;
    for (const op of outbox) {
      const r = applyOp(s, op, s.me);
      if (r.ok) s = { ...s, ...r.state };
    }
    return { ...s, bill: billOf(s) };
  })();

  const flush = useCallback(async () => {
    if (sending.current || !outbox.length) return;
    sending.current = true;
    const batch = outbox.slice(0, 20);
    let delay = 1000;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const r = await fetch(`/api/r/${server.code}/ops`, { method: "POST", headers: { "Content-Type": "application/json", ...devHeader() }, body: JSON.stringify({ baseVersion: server.version, ops: batch }) });
        if (r.ok) {
          const j = await r.json();
          setServer(j.snapshot);
          setOutbox((o) => o.filter((x) => !batch.some((b) => b.opId === x.opId)));
          setFailed(false);
          lastChange.current = Date.now();
          break;
        }
        if (r.status < 500 && r.status !== 429) {
          setOutbox((o) => o.filter((x) => !batch.some((b) => b.opId === x.opId)));
          break;
        }
      } catch {}
      if (attempt === 5) setFailed(true);
      await new Promise((res) => setTimeout(res, delay));
      delay = Math.min(delay * 2, 60000);
    }
    sending.current = false;
  }, [outbox, server.code, server.version]);

  useEffect(() => {
    flush();
  }, [flush]);
  useEffect(() => {
    const on = () => flush();
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [flush]);

  // polling: 2s for 30s after change, then 5s, 10s after 2 min; paused when hidden; stops when done
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stop = false;
    const done = () => server.status === "closed" || (server.status === "final" && server.members.every((mm) => mm.id === server.hostMemberId || ["received", "cash"].includes(server.payments[mm.id]?.state)));
    const tick = async () => {
      if (stop) return;
      if (!document.hidden && !done()) {
        try {
          const r = await fetch(`/api/r/${server.code}?v=${server.version}`, { headers: devHeader(), cache: "no-store" });
          if (r.status === 200) {
            setServer(await r.json());
            lastChange.current = Date.now();
          }
        } catch {}
      }
      const idle = Date.now() - lastChange.current;
      timer = setTimeout(tick, idle < 30000 ? 2000 : idle < 120000 ? 5000 : 10000);
    };
    timer = setTimeout(tick, 2000);
    const vis = () => { if (!document.hidden) { clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", vis);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener("visibilitychange", vis); };
  }, [server]);

  const send = (op: Omit<Op, "opId">) => {
    lastChange.current = Date.now();
    setOutbox((o) => [...o, { ...op, opId: crypto.randomUUID() } as Op]);
  };
  return { view, setServer, send, pending: outbox.length, failed, retry: flush };
}

export function Room({ initial }: { initial: Snap }) {
  const room = useRoom(initial);
  const v = room.view;
  if (v.me.isHost) return <Galla room={room} />;
  return <Folder room={room} />;
}

type RoomApi = ReturnType<typeof useRoom>;

/* --------------------------- BILL FOLDER (guest) --------------------------- */
function Folder({ room }: { room: RoomApi }) {
  const { t, calm } = usePrefs();
  const v = room.view;
  const joined = !!v.me.memberId;
  const [state, setState] = useState<"closed" | "opening" | "open">(joined ? "open" : "closed");
  const openedRef = useRef(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [burst, setBurst] = useState(false);

  const open = useCallback(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    setState("opening");
    if (!calm) setTimeout(() => { setBurst(true); setTimeout(() => setBurst(false), 900); }, 650);
    setTimeout(() => { setState("open"); setTimeout(() => nameRef.current?.focus(), 50); }, calm ? 250 : 1600);
  }, [calm]);

  useEffect(() => {
    if (state !== "closed") return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    btnRef.current?.focus({ preventScroll: true });
    let touchY = 0;
    const onWheel = (e: WheelEvent) => { if (e.deltaY > 4) open(); };
    const onKey = (e: KeyboardEvent) => { if (["ArrowDown", "PageDown", " ", "Enter", "End"].includes(e.key)) { e.preventDefault(); open(); } };
    const onTS = (e: TouchEvent) => (touchY = e.touches[0].clientY);
    const onTM = (e: TouchEvent) => { if (touchY - e.touches[0].clientY > 24) open(); };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchstart", onTS, { passive: true });
    window.addEventListener("touchmove", onTM, { passive: true });
    return () => {
      root.style.overflow = prev;
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchstart", onTS);
      window.removeEventListener("touchmove", onTM);
    };
  }, [state, open]);

  const host = v.members.find((mm) => mm.id === v.hostMemberId);
  const opening = state === "opening";

  return (
    <>
      <AnimatePresence>
        {state !== "open" && (
          <m.div key="folder" role="dialog" aria-modal="true" aria-label={t("folder.open")} className="kp-folder fixed inset-0 z-[70] grid place-items-center overflow-hidden bg-[var(--bg)]" style={{ perspective: 1800 }} exit={{ opacity: 0 }} transition={{ duration: calm ? 0.25 : 0.3 }}>
            <div className="relative h-[min(78vh,560px)] w-[min(88vw,360px)]">
              {/* inner page with the receipt sliding up */}
              <div className="kot absolute inset-0 rounded-md p-5 shadow-2xl">
                <m.div animate={opening ? { y: 0, opacity: 1 } : { y: 40, opacity: 0 }} transition={{ delay: calm ? 0 : 0.7, duration: 0.4 }}>
                  <p className="mono text-center text-sm uppercase">{v.restaurant || "Bill"}</p>
                  {v.items.slice(0, 8).map((it) => <p key={it.id} className="mono flex justify-between text-xs"><span className="truncate">{it.name}</span><Money p={it.amount} /></p>)}
                </m.div>
                <m.div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/40 to-transparent" animate={{ opacity: opening && !calm ? [0, 0.35, 0] : 0 }} transition={{ duration: 1.2, times: [0, 0.5, 1] }} />
              </div>
              {/* the leatherette cover */}
              <m.div
                className="leather stitch absolute inset-0 flex origin-left flex-col items-center justify-center rounded-md px-6 text-center text-[#F6EED9] shadow-[20px_0_60px_rgba(0,0,0,.45)]"
                animate={opening ? (calm ? { opacity: 0 } : { rotateY: -160, x: -24 }) : { rotateY: 0, scale: 1 }}
                transition={{ duration: calm ? 0.25 : 1.2, ease, delay: calm ? 0 : 0.12 }}
                style={{ transformStyle: "preserve-3d", backfaceVisibility: "hidden" }}
              >
                <p className="display foil text-3xl">{v.restaurant || "KhayaPiya"}</p>
                <p className="mt-3">{host?.name ?? "Host"} ne bill bhara</p>
                <p className="display mt-2 text-4xl text-[var(--haldi)]"><Money p={v.bill.computedTotal} /></p>
                <button ref={btnRef} type="button" onClick={open} className="tap press mt-6 min-h-12 rounded-full bg-[var(--haldi)] px-7 text-lg font-semibold text-[#1B1A17]">{t("folder.open")}</button>
                <p className="mt-2 text-xs opacity-70">Swipe up ya scroll karo</p>
              </m.div>
              {/* saunf bowl */}
              <div className="steel absolute -bottom-6 right-2 h-12 w-20 rounded-b-full" aria-hidden="true" />
              {burst && (
                <div className="pointer-events-none absolute -bottom-2 right-10" aria-hidden="true">
                  {Array.from({ length: 24 }).map((_, i) => (
                    <m.span key={i} className="absolute" initial={{ x: 0, y: 0, opacity: 1 }} animate={{ x: Math.cos(i * 0.9) * (60 + (i % 5) * 18), y: -80 - (i % 7) * 20, opacity: 0, rotate: i * 40 }} transition={{ duration: 0.9, ease: "easeOut" }}>
                      {i % 3 ? <Seeds /> : <Mishri />}
                    </m.span>
                  ))}
                </div>
              )}
            </div>
          </m.div>
        )}
      </AnimatePresence>
      <GuestPage room={room} nameRef={nameRef} />
    </>
  );
}

function GuestPage({ room, nameRef }: { room: RoomApi; nameRef: React.RefObject<HTMLInputElement | null> }) {
  const { t } = usePrefs();
  const v = room.view;
  const me = v.me.memberId;
  const [name, setName] = useState("");
  const [seat, setSeat] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const join = async () => {
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/r/${v.code}/join`, { method: "POST", headers: { "Content-Type": "application/json", ...devHeader() }, body: JSON.stringify({ name, seat }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error);
    try { localStorage.setItem("kp_dev", j.devToken); } catch {}
    room.setServer(j);
  };
  const placeholders = v.members.filter((mm) => !mm.joined && mm.id !== v.hostMemberId);
  const mine = me ? v.bill.perMember[me] : null;
  const locked = v.status !== "open";

  return (
    <main className="mx-auto max-w-xl px-4 pb-40 pt-3">
      <m.header layoutId="spine" className="leather sticky top-0 z-20 -mx-4 flex items-center justify-between px-4 py-2 text-[#F6EED9]">
        <span className="display foil text-xl">{v.restaurant || "KhayaPiya"}</span>
        {mine && <span className="text-sm">{t("share.mine")} <Money p={mine.total} className="display text-lg text-[var(--haldi)]" /></span>}
      </m.header>

      {!me && (
        <section className="kot mt-4 rounded-md p-4">
          <label htmlFor="nm" className="display text-2xl">{t("folder.name")}</label>
          <input id="nm" ref={nameRef} value={name} maxLength={24} onChange={(e) => setName(e.target.value)} className="tap hand mt-2 w-full rounded border border-[#1B1A17] bg-transparent px-2 text-xl" />
          {placeholders.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-semibold">{t("folder.iam")}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {placeholders.map((p) => (
                  <button key={p.id} type="button" aria-pressed={seat === p.id} onClick={() => { setSeat(p.id); setName(p.name); }} className={`tap press flex items-center gap-1 rounded-full border-2 px-3 ${seat === p.id ? "border-[var(--haldi)] bg-[#fff3c4]" : "border-[#1B1A17]"}`}>
                    <Pattern seat={p.seat} /> <span className="hand text-lg">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {err && <p role="alert" className="mt-2 text-[var(--stamp-red-deep)]">{err}</p>}
          <button type="button" disabled={!name.trim() || busy} onClick={join} className="tap press mt-3 w-full rounded-md bg-[var(--stamp-red-deep)] text-lg font-semibold text-[#F6EED9] disabled:opacity-50">{t("folder.join")}</button>
        </section>
      )}

      <ClaimList room={room} canClaim={!!me && !locked} />
      {me && mine && <Coupon room={room} memberId={me} />}
    </main>
  );
}

function ClaimList({ room, canClaim }: { room: RoomApi; canClaim: boolean }) {
  const { t } = usePrefs();
  const v = room.view;
  const me = v.me.memberId;
  return (
    <section className="kot torn-bottom mt-4 rounded-t-md px-3 pt-3">
      <h2 className="display text-2xl">{t("table.title")}</h2>
      <ul className="mt-2 divide-y divide-dashed divide-[#1B1A1740]">
        {v.items.map((it) => {
          const cl = v.claims.filter((c) => c.itemId === it.id);
          const mineC = cl.find((c) => c.memberId === me);
          const others = cl.filter((c) => c.memberId !== me);
          const pending = room.pending > 0;
          return (
            <li key={it.id} className="py-1.5">
              <button type="button" disabled={!canClaim} onClick={() => room.send(mineC ? { type: "unclaim", itemId: it.id, memberId: me } : { type: "claim", itemId: it.id, memberId: me })} aria-pressed={!!mineC} className="tap flex w-full items-center gap-2 text-left disabled:cursor-default">
                <span className="mono flex-1 text-[13px]">{it.qty > 1 ? `${it.qty} x ` : ""}{it.name}</span>
                <span className="flex items-center">
                  {cl.map((c) => {
                    const mm = v.members.find((x) => x.id === c.memberId);
                    if (!mm) return null;
                    return (
                      <m.span key={c.memberId} initial={{ scale: 1.4, rotate: -8, opacity: 0 }} animate={{ scale: 1, rotate: -3, opacity: c.memberId === me && pending ? 0.55 : 1 }} transition={snap} className="-ml-1 inline-grid size-7 place-items-center rounded border-2 bg-[#fffaf0] text-xs font-extrabold" style={{ borderColor: ink(mm.seat).fill, color: ink(mm.seat).text }} aria-label={`${mm.name} ne claim kiya`}>
                        {mm.name.slice(0, 1).toUpperCase()}
                      </m.span>
                    );
                  })}
                </span>
                <Money p={it.amount} className="text-[13px]" />
              </button>
              {mineC && others.length > 0 && it.qty === 1 && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-[var(--haldi)] px-2 py-1 font-semibold text-[#1B1A17]">{v.members.find((x) => x.id === others[0].memberId)?.name} {t("claim.shared")}</span>
                  <button type="button" className="tap press rounded border px-2" onClick={() => room.send({ type: "unclaim", itemId: it.id, memberId: me })}>{t("claim.notMine")}</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="inline-block size-2.5 rounded-full" style={{ background: room.failed ? "var(--stamp-red)" : room.pending ? "#999" : "var(--chutney)" }} />
        {room.failed ? <button type="button" className="tap underline" onClick={room.retry}>Phir bhejo</button> : room.pending ? "bhej raha hai..." : "saved"}
      </div>
    </section>
  );
}

function Coupon({ room, memberId }: { room: RoomApi; memberId: string }) {
  const { t } = usePrefs();
  const v = room.view;
  const mb = v.bill.perMember[memberId];
  const mm = v.members.find((x) => x.id === memberId)!;
  const pay = v.payments[memberId] ?? { state: "unpaid" };
  const [ask, setAsk] = useState(false);
  const [copied, setCopied] = useState(false);
  const [big, setBig] = useState(false);
  const tapped = useRef(0);
  const vpa = v.vpa ?? "";
  const url = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent((v.payeeName || "Host").slice(0, 40))}&am=${amountParam(mb.total)}&cu=INR&tn=${encodeURIComponent(`KhayaPiya ${v.code}`.slice(0, 40))}`;
  const qr = (() => {
    const q = qrcode(0, "M");
    q.addData(url);
    q.make();
    return q.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
  })();
  useEffect(() => {
    const on = () => { if (!document.hidden && tapped.current && Date.now() - tapped.current < 600000) setAsk(true); };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  const ios = typeof navigator !== "undefined" && /iPhone|iPad/.test(navigator.userAgent);
  const settled = pay.state === "received" || pay.state === "cash";

  return (
    <section className="relative mt-5">
      <div className="coupon-edge kot rounded-md p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <span className="hand text-2xl font-bold" style={{ color: ink(mm.seat).text }}>{mm.name}</span>
          <Pattern seat={mm.seat} size={22} />
        </div>
        <ul className="mono mt-2 text-[13px]">
          {mb.lines.map((l) => {
            const it = v.items.find((i) => i.id === l.itemId);
            return <li key={l.itemId} className="flex justify-between"><span className="truncate">{it?.name} {l.of > l.weight ? `${l.weight}/${l.of}` : ""}</span><Money p={l.share} /></li>;
          })}
          {Object.entries(mb.charges).map(([cid, a]) => <li key={cid} className="flex justify-between opacity-80"><span>{v.charges.find((c) => c.id === cid)?.label ?? "Round off"}</span><Money p={a} sign /></li>)}
          {v.bill.bonuses.filter((b) => b.memberId === memberId).map((b, i) => <li key={i} className="hand flex items-center gap-1 text-[var(--chai)]"><Coin size={14} /> +1 paisa ({b.label}): remainder sabse bada tha</li>)}
        </ul>
        <div className="mt-2 border-t-2 border-dashed border-[#1B1A1760] pt-2 text-right"><span className="display text-4xl"><Money p={mb.total} /></span></div>
        <div className={`mt-3 flex items-center gap-3 ${ios ? "flex-col-reverse" : ""}`}>
          <button type="button" onClick={() => setBig(!big)} aria-label={t("pay.scan")} className={`shrink-0 rounded bg-white p-1 transition-[width] ${big ? "w-full" : "w-28"}`} dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="text-xs">
            <p className="mono">{v.vpaMasked}</p>
            <button type="button" className="tap press mt-1 rounded border border-[#1B1A17] px-2 font-semibold" onClick={async () => { await navigator.clipboard.writeText(vpa).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : t("pay.copy")}</button>
          </div>
        </div>
        <div className="absolute right-6 top-10">
          {pay.state === "sent" && <Stamp text="PAID" color="var(--stamp-red)" />}
          {settled && <Stamp text={pay.state === "cash" ? "CASH" : "MILA"} color="var(--chutney-deep)" rotate={4} />}
        </div>
        {pay.state === "sent" && <p className="mt-2 text-sm font-semibold">{t("pay.waiting")}</p>}
      </div>
      {!settled && (
        <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-xl px-4 pb-4 pt-2" style={{ background: "linear-gradient(transparent, var(--bg) 35%)" }}>
          {pay.state === "sent" ? (
            <button type="button" onClick={() => room.send({ type: "unmark_sent", memberId })} className="tap press w-full rounded-md border-2 border-current text-lg font-semibold">{t("undo")}</button>
          ) : v.isDemo ? (
            <button type="button" onClick={() => setAsk(true)} className="tap press w-full rounded-md bg-[var(--stamp-red-deep)] text-lg font-semibold text-[#F6EED9]">{t("pay.demo")}</button>
          ) : (
            <a href={url} onClick={() => (tapped.current = Date.now())} className="tap press grid w-full place-items-center rounded-md bg-[var(--stamp-red-deep)] text-lg font-semibold text-[#F6EED9]">{t("pay.cta")} ₹{amountParam(mb.total)}</a>
          )}
        </div>
      )}
      <AnimatePresence>
        {ask && (
          <m.div role="dialog" aria-modal="true" className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-xl rounded-t-2xl bg-[var(--kot-paper)] p-4 text-[#1B1A17] shadow-2xl" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={snap}>
            <p className="display text-3xl">{t("pay.ask")}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" className="tap press rounded-md bg-[var(--chutney-deep)] font-semibold text-white" onClick={() => { room.send({ type: "mark_sent", memberId }); setAsk(false); }}>{t("pay.yes")}</button>
              <button type="button" className="tap press rounded-md border border-[#1B1A17]" onClick={() => setAsk(false)}>{t("pay.no")}</button>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/* --------------------------- GALLA (host) --------------------------- */
function Galla({ room }: { room: RoomApi }) {
  const { t } = usePrefs();
  const v = room.view;
  const link = typeof window !== "undefined" ? `${window.location.origin}/r/${v.code}` : `/r/${v.code}`;
  const got = v.members.reduce((a, mm) => a + (["received", "cash"].includes(v.payments[mm.id]?.state) && mm.id !== v.hostMemberId ? v.bill.perMember[mm.id]?.total ?? 0 : 0), 0);
  const due = v.members.reduce((a, mm) => a + (mm.id !== v.hostMemberId && !["received", "cash"].includes(v.payments[mm.id]?.state) ? v.bill.perMember[mm.id]?.total ?? 0 : 0), 0);
  const qr = (() => { const q = qrcode(0, "M"); q.addData(link); q.make(); return q.createSvgTag({ cellSize: 3, margin: 2, scalable: true }); })();
  const share = async () => {
    const text = `${v.restaurant || "Bill"} ka hisaab. Apna hissa dekh aur UPI se bhej: ${link}`;
    if (navigator.share) await navigator.share({ text, url: link }).catch(() => {});
    else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };
  return (
    <main className="mx-auto max-w-xl px-4 pb-16 pt-4">
      <header className="flex items-end justify-between">
        <div>
          <p className="mono text-xs opacity-70">ROOM</p>
          <h1 className="display text-4xl">{v.code.slice(0, 3)} {v.code.slice(3)}</h1>
        </div>
        <p className="text-right text-sm"><Money p={got} className="font-semibold text-[var(--chutney-deep)]" /> mila<br /><Money p={due} className="font-semibold text-[var(--stamp-red)]" /> baaki</p>
      </header>
      <section className="kot mt-3 flex items-center gap-3 rounded-md p-3">
        <div className="w-28 shrink-0 rounded bg-white p-1" dangerouslySetInnerHTML={{ __html: qr }} />
        <div className="flex flex-col gap-2">
          <button type="button" onClick={share} className="tap press rounded-md bg-[var(--stamp-red-deep)] px-3 font-semibold text-[#F6EED9]">{t("room.share")}</button>
          <a href={`/r/${v.code}?as=guest`} target="_blank" rel="noopener" className="tap press grid place-items-center rounded-md border border-[#1B1A17] px-3 text-sm">{t("room.friendView")}</a>
        </div>
      </section>

      {/* the cash drawer: one coin well per friend */}
      <section className="teak mt-4 rounded-xl p-3 shadow-inner">
        <ul className="grid grid-cols-2 gap-3">
          {v.members.map((mm) => {
            const p = v.payments[mm.id] ?? { state: "unpaid" };
            const total = v.bill.perMember[mm.id]?.total ?? 0;
            const isHost = mm.id === v.hostMemberId;
            return (
              <li key={mm.id} className="rounded-lg bg-[#3b2414] p-2 text-[#F6EED9] shadow-[inset_0_4px_10px_rgba(0,0,0,.6)]">
                <div className="flex items-center gap-1"><Pattern seat={mm.seat} /><span className="hand text-lg font-bold">{mm.name}</span>{!mm.joined && !isHost && <span className="text-[10px] opacity-60">(abhi nahi aaya)</span>}</div>
                <Money p={total} className="display text-2xl" />
                <AnimatePresence>
                  {(p.state === "sent" || p.state === "received" || p.state === "cash") && (
                    <m.div initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 32 }} className="flex gap-0.5 py-1" aria-label={p.state}>
                      {[0, 1, 2].map((i) => <Coin key={i} size={14} />)}
                      <span className="ml-1 text-xs font-semibold">{p.state === "sent" ? "Bheja" : p.state === "cash" ? "Cash" : "Mila"}</span>
                    </m.div>
                  )}
                </AnimatePresence>
                {isHost ? <p className="text-xs opacity-70">Tera hissa</p> : (
                  <div className="mt-1 flex flex-wrap gap-1 text-xs font-semibold">
                    {p.state === "sent" && <button type="button" className="tap press rounded bg-[var(--chutney)] px-2 text-white" onClick={() => room.send({ type: "confirm_received", memberId: mm.id })}>{t("host.received")}</button>}
                    {p.state === "sent" && <button type="button" className="tap press rounded border px-2" onClick={() => room.send({ type: "reject_received", memberId: mm.id })}>{t("host.notReceived")}</button>}
                    {p.state === "unpaid" && <button type="button" className="tap press rounded border px-2" onClick={() => room.send({ type: "mark_cash", memberId: mm.id })}>{t("host.cash")}</button>}
                    {p.state === "unpaid" && <a className="tap press grid place-items-center rounded border px-2" target="_blank" rel="noopener" href={`https://wa.me/?text=${encodeURIComponent(`${mm.name}, ${v.restaurant || "bill"} ka tera hissa ₹${amountParam(total)} hai. Yahan dekh aur bhej: ${link}`)}`}>{t("host.nudge")}</a>}
                    {(p.state === "received" || p.state === "cash") && <Stamp text="MILA" color="#5CC98A" rotate={4} />}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <ClaimList room={room} canClaim={false} />
      <section className="mt-4 flex flex-wrap gap-2 text-sm font-semibold">
        {v.status === "open" && <button type="button" className="tap press rounded-md border border-current px-3" onClick={() => room.send({ type: "lock" })}>{t("host.lock")}</button>}
        {v.status === "locked" && <button type="button" className="tap press rounded-md border border-current px-3" onClick={() => room.send({ type: "unlock" })}>Unlock</button>}
        {v.status !== "final" && v.status !== "closed" && <button type="button" disabled={v.bill.unclaimed.length > 0 || v.bill.diff !== 0} className="tap press rounded-md bg-[var(--chutney-deep)] px-3 text-white disabled:opacity-40" onClick={() => room.send({ type: "finalize" })}>{t("host.finalize")}</button>}
        {v.status === "final" && <button type="button" className="tap press rounded-md border border-current px-3" onClick={() => room.send({ type: "reopen" })}>Re-open</button>}
        {v.status !== "closed" && <button type="button" className="tap press rounded-md border border-[var(--stamp-red)] px-3 text-[var(--stamp-red)]" onClick={() => confirm("Room band? Naam aur UPI ID mit jayenge.") && room.send({ type: "close" })}>{t("host.close")}</button>}
        <span className="self-center opacity-70">Status: {v.status}</span>
      </section>
      <div className="mt-4 flex justify-center opacity-80"><Jar label="Galla" amount={`₹${amountParam(got)}`} color="#B87333" /></div>
      <div className="mt-2 flex justify-center"><Thali seat={1} name={v.members[0]?.name ?? "M"} size={56} /></div>
    </main>
  );
}
