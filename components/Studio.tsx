"use client";
// m (LazyMotion, domAnimation) everywhere; motion only where a finger drags something, since drag is not in domAnimation
import { AnimatePresence, m, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeBill, toPaise, type Charge, type ChargeKind, type Item } from "@/lib/money";
import { parseBill, parseQuick } from "@/lib/parse";
import { DEMO_TEXT, demoDraft, kvGet, kvSet, loadDraft, newDraft, saveDraft, uid, type Draft, type DraftMember } from "@/lib/draft";
import { Bell, Coin, Jar, Katori, Money, Pattern, Printer, Scale, Stamp, Thali, ink } from "./art";
import { Tiffin, tiffinInk } from "./khata/art";
import { LangSwitch, usePrefs } from "./Prefs";

const snap = { type: "spring", stiffness: 520, damping: 34 } as const;
const settle = { type: "spring", stiffness: 420, damping: 32 } as const;
const JAR_COLOR: Record<string, string> = { cgst: "#F4B400", sgst: "#F4B400", igst: "#F4B400", utgst: "#F4B400", vat: "#E8578B", service: "#2E9E5B", packing: "#8A5A34", delivery: "#1F8A8A", tip: "#B87333", discount: "#D62828", roundoff: "#B8C2C6", other: "#6B3E26" };

/** The draft id from the address bar. Offline, the service worker serves one cached /bill shell for every id. */
function idFromPath(fallback: string | null) {
  if (!fallback || typeof window === "undefined") return fallback;
  const m = window.location.pathname.match(/^\/bill\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : fallback;
}

function useDraft(localId: string | null, demo: boolean) {
  const [d, setD] = useState<Draft | null>(null);
  const hist = useRef<Draft[]>([]);
  const fut = useRef<Draft[]>([]);
  useEffect(() => {
    (async () => {
      const id = idFromPath(localId);
      if (id) {
        const x = await loadDraft(id).catch(() => undefined);
        setD(x ?? { ...newDraft(), id });
      } else setD(demo ? demoDraft() : newDraft());
    })();
  }, [localId, demo]);
  const update = useCallback((fn: (d: Draft) => Draft) => {
    setD((prev) => {
      if (!prev) return prev;
      hist.current = [...hist.current.slice(-19), prev];
      fut.current = [];
      const next = fn(structuredClone(prev));
      saveDraft(next).catch(() => {});
      return next;
    });
  }, []);
  const undo = () => setD((cur) => {
    const p = hist.current.pop();
    if (!p || !cur) return cur;
    fut.current.push(cur);
    saveDraft(p).catch(() => {});
    return p;
  });
  const redo = () => setD((cur) => {
    const n = fut.current.pop();
    if (!n || !cur) return cur;
    hist.current.push(cur);
    saveDraft(n).catch(() => {});
    return n;
  });
  return { d, update, undo, redo, canUndo: () => hist.current.length > 0 };
}

function applyParsed(d: Draft, text: string): Draft {
  const p = parseBill(text);
  const items: Item[] = p.lines.filter((l) => l.type === "item").map((l) => ({ id: uid(), name: l.name, qty: l.qty, amount: l.amount, kind: l.kind ?? "food" }));
  const drinkIds = items.filter((i) => i.kind === "drink").map((i) => i.id);
  const foodIds = items.filter((i) => i.kind !== "drink").map((i) => i.id);
  const hasVat = p.lines.some((l) => l.chargeKind === "vat");
  const charges: Charge[] = p.lines
    .filter((l) => l.type === "charge")
    .map((l) => {
      const k = l.chargeKind as ChargeKind;
      const gst = ["cgst", "sgst", "igst", "utgst"].includes(k);
      return {
        id: uid(),
        kind: k,
        label: l.name.slice(0, 30),
        mode: "amount" as const,
        value: k === "roundoff" ? l.amount : Math.abs(l.amount),
        scope: k === "vat" && drinkIds.length ? drinkIds : gst && hasVat && drinkIds.length && foodIds.length ? foodIds : null,
        split: "proportional" as const,
        included: false,
        removed: false,
      };
    });
  return { ...d, restaurant: d.restaurant || p.restaurant, printedTotal: p.total ?? p.subtotal ?? d.printedTotal, items: [...d.items, ...items], charges: [...d.charges, ...charges] };
}

/* ----------------------------- TIFFINS ----------------------------- */
interface GroupLite { id: string; name: string; me: string | null; people: { id: string; name: string; seat: number }[]; entries: { kind: string; shares: { personId: string }[] }[] }
interface TiffinRef { id: string; name: string; kind: string; people: number }

/**
 * Seat a tiffin's people at the table: the signed-in person keeps the host seat, people already at the
 * table keep their claims (matched by person, then by name), and the rest follow in the tiffin's seat order.
 * `onlyLast` is "Pichhli baar wali seating": just the people on the tiffin's last bill.
 */
function seatsFromGroup(d: Draft, g: GroupLite, onlyLast: boolean): Draft {
  let people = [...g.people].sort((a, b) => a.seat - b.seat);
  const last = g.entries.find((e) => e.kind === "bill");
  if (onlyLast && last) {
    const ids = new Set(last.shares.map((x) => x.personId));
    if (g.me) ids.add(g.me);
    people = people.filter((p) => ids.has(p.id));
  }
  const host = d.members[0];
  const mine = people.find((p) => p.id === g.me);
  const used = new Set<string>([host.id]);
  const members: DraftMember[] = [{ ...host, seat: 1, name: mine ? mine.name.slice(0, 24) : host.name, personId: mine?.id ?? null }];
  for (const p of people) {
    if (p === mine) continue;
    const ex = d.members.find((x) => !used.has(x.id) && (x.personId === p.id || x.name.trim().toLowerCase() === p.name.trim().toLowerCase()));
    const id = ex?.id ?? uid();
    used.add(id);
    members.push({ id, seat: members.length + 1, name: p.name.slice(0, 24), personId: p.id });
  }
  for (const x of d.members) if (!used.has(x.id)) members.push({ ...x, seat: members.length + 1, personId: null });
  const kept = members.slice(0, 20);
  const ids = new Set(kept.map((x) => x.id));
  return { ...d, members: kept, claims: d.claims.filter((c) => ids.has(c.memberId)), groupId: g.id, groupName: g.name };
}
const detachGroup = (d: Draft): Draft => ({ ...d, groupId: null, groupName: null, members: d.members.map((x) => ({ ...x, personId: null })) });

async function fetchGroup(id: string): Promise<GroupLite | null> {
  const r = await fetch(`/api/groups/${id}`, { cache: "no-store" });
  return r.ok ? ((await r.json()) as GroupLite) : null;
}

/** A small red cloth khata, the Counter's way into the ledger. */
function KhataBook() {
  return (
    <svg width="34" height="40" viewBox="0 0 34 40" aria-hidden="true">
      <rect x="4" y="3" width="26" height="34" rx="2" fill="#8e1c1c" stroke="#1B1A17" strokeWidth="1.5" />
      <path d="M8 3v34" stroke="#5e1010" strokeWidth="2" />
      <path d="M30 6h2v28h-2" fill="#f7f0dc" stroke="#1B1A17" strokeWidth="1" />
      <rect x="12" y="11" width="14" height="8" rx="1" fill="#f7f0dc" />
      <path d="M14 15h10" stroke="#A61E1E" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M24 37q1 2-1 3" fill="none" stroke="#F4B400" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

type InstallPrompt = { prompt: () => Promise<unknown> };

/* ----------------------------- COUNTER ----------------------------- */
export function Counter({ demo = false, localId = null }: { demo?: boolean; localId?: string | null }) {
  const { t, calm, fast } = usePrefs();
  const router = useRouter();
  const { d, update, undo, redo } = useDraft(localId, demo);
  const [printing, setPrinting] = useState<"idle" | "warm" | "reading">("idle");
  const [progress, setProgress] = useState(0);
  const [quick, setQuick] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [scrap, setScrap] = useState<{ item: Item; pos: number } | null>(null);
  const [err, setErr] = useState("");
  const [visible, setVisible] = useState(9999);
  const quickRef = useRef<HTMLTextAreaElement>(null);
  const startedDemo = useRef(false);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const ready = !!d;

  // "Ghar pe rakh lo": only after this phone has seen two finalised splits, and never again once refused
  useEffect(() => {
    const check = () => {
      try {
        const ev = (window as unknown as { __kpInstall?: InstallPrompt }).__kpInstall;
        if (!ev || localStorage.getItem("kp_install_no") === "1") return;
        const finals = JSON.parse(localStorage.getItem("kp_finals") || "[]") as string[];
        if (finals.length >= 2) setInstall(ev);
      } catch {}
    };
    check();
    window.addEventListener("kp-install", check);
    return () => window.removeEventListener("kp-install", check);
  }, []);

  // demo: print the cached sample bill line by line, no OCR download
  useEffect(() => {
    if (!d || !demo || startedDemo.current || d.items.length) return;
    startedDemo.current = true;
    const next = applyParsed(d, DEMO_TEXT);
    setVisible(0);
    update(() => next);
    const n = next.items.length + next.charges.length;
    // fast lane: a phone that has finished a split before skips the slow warm-up print
    for (let i = 1; i <= n; i++) setTimeout(() => setVisible(i), calm ? 0 : fast ? 40 + i * 40 : 260 + i * 140);
  }, [d, demo, update, calm, fast]);

  const scan = async (file: File) => {
    setErr("");
    setPrinting("warm");
    setProgress(0.05);
    try {
      await loadTesseract();
      setPrinting("reading");
      const T = (window as unknown as { Tesseract: TesseractNS }).Tesseract;
      const worker = await T.createWorker("eng", 1, { logger: (mm: { status: string; progress: number }) => setProgress(mm.status.includes("recogn") ? 0.5 + mm.progress / 2 : Math.min(0.5, mm.progress / 2)) });
      const timer = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 60000));
      const res = (await Promise.race([worker.recognize(file), timer])) as { data: { text: string } };
      await worker.terminate();
      update((x) => applyParsed(x, res.data.text));
    } catch {
      setErr(t("counter.fail"));
      quickRef.current?.focus();
    } finally {
      setPrinting("idle");
    }
  };

  // arrivals: "Naya bill" from a tiffin (?tiffin=id) and a photo shared into the app (?shared=1)
  useEffect(() => {
    if (!ready || demo || localId) return;
    const q = new URLSearchParams(window.location.search);
    const tiffin = q.get("tiffin");
    const shared = q.get("shared");
    if (tiffin || shared) window.history.replaceState(null, "", "/");
    if (tiffin && /^[0-9a-f-]{36}$/.test(tiffin)) {
      fetchGroup(tiffin)
        .then((g) => {
          if (g) update((x) => (x.groupId === g.id ? x : seatsFromGroup(x, g, false)));
        })
        .catch(() => {});
    }
    if (shared === "1" && "caches" in window) {
      (async () => {
        const c = await caches.open("kp-share");
        const r = await c.match("/__shared-bill");
        if (!r) return;
        const b = await r.blob();
        await c.delete("/__shared-bill");
        scan(new File([b], "bill", { type: b.type || "image/jpeg" }));
      })().catch(() => {});
    }
  }, [ready, demo, localId]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"));
      if (f) scan(f);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  if (!d) return <CounterSkeleton />;
  const bill = computeBill({ members: d.members, items: d.items, charges: d.charges, claims: [], printedTotal: null });
  const itemsTotal = d.items.reduce((a, i) => a + i.amount, 0);
  const chargeSum = Object.values(bill.chargeAmounts).reduce((a, b) => a + b, 0);
  const gap = d.printedTotal != null ? d.printedTotal - itemsTotal - chargeSum : 0;
  const lines = d.items;

  const addQuick = () => {
    const parsed = parseQuick(quick);
    if (!parsed.length) return;
    update((x) => ({ ...x, items: [...x.items, ...parsed.map((p) => ({ id: uid(), ...p }))] }));
    setQuick("");
  };
  const tear = (id: string) => {
    const pos = d.items.findIndex((i) => i.id === id);
    const item = d.items[pos];
    update((x) => ({ ...x, items: x.items.filter((i) => i.id !== id), claims: x.claims.filter((c) => c.itemId !== id) }));
    setScrap({ item, pos });
    setTimeout(() => setScrap((s) => (s?.item.id === id ? null : s)), 5000);
  };
  const tape = () => {
    if (!scrap) return;
    update((x) => {
      const items = [...x.items];
      items.splice(scrap.pos, 0, scrap.item);
      return { ...x, items };
    });
    setScrap(null);
  };
  const goTable = async () => {
    await saveDraft(d);
    router.push(`/bill/${d.id}`);
  };

  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 pb-40 pt-4">
      <header className="chalk relative rounded-xl px-4 pb-4 pt-3 shadow-[inset_0_0_0_6px_#5b3b22]">
        <div className="flex items-start justify-between gap-2">
          <h1 className="display text-4xl text-[#F4B400]">KhayaPiya</h1>
          <div className="flex items-start gap-1">
            <Link href="/khata" className="tap press -mt-1 flex flex-col items-center" aria-label="Khata: chalta hisaab">
              <KhataBook />
              <span className="hand -mt-0.5 text-xs leading-none">Khata</span>
            </Link>
            <Bell className="h-9 w-10" />
          </div>
        </div>
        <p className="hand text-lg">{t("counter.title")}</p>
        {d.groupId && (
          <p className="hand mt-1 flex items-center gap-2 text-base">
            <Tiffin n={tiffinInk(d.groupId)} size={22} />
            <span className="min-w-0 flex-1 truncate">{d.groupName} ka bill</span>
            <button type="button" onClick={() => update(detachGroup)} className="tap underline underline-offset-4">hatao</button>
          </p>
        )}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <label className="tap press hand grid cursor-pointer place-items-center rounded-lg border border-dashed border-[#f1ecdf80] px-1 py-2 text-center text-lg leading-tight">
            {t("counter.photo")}
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => e.target.files?.[0] && scan(e.target.files[0])} />
          </label>
          <label className="tap press hand grid cursor-pointer place-items-center rounded-lg border border-dashed border-[#f1ecdf80] px-1 py-2 text-center text-lg leading-tight">
            {t("counter.gallery")}
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && scan(e.target.files[0])} />
          </label>
          <button type="button" onClick={() => quickRef.current?.focus()} className="tap press hand rounded-lg border border-dashed border-[#f1ecdf80] px-1 py-2 text-lg leading-tight">
            {t("counter.type")}
          </button>
        </div>
        <div className="mt-3 text-[#f1ecdf]">
          <LangSwitch />
        </div>
      </header>

      <section className="teak relative mt-4 rounded-xl px-4 pb-5 pt-6 shadow-lg">
        <div className="relative mx-auto w-full max-w-[300px]">
          <Printer busy={printing !== "idle"} />
          {printing !== "idle" && (
            <div className="absolute inset-x-12 top-[22%]">
              <p className="mono text-center text-xs text-[#1B1A17]">{printing === "warm" ? t("counter.warm") : t("counter.reading")}</p>
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-[#1B1A1733]">
                <m.div className="h-full origin-left bg-[var(--chutney)]" animate={{ scaleX: progress }} transition={{ duration: 0.2 }} />
              </div>
            </div>
          )}
        </div>

        {/* the printed KOT strip */}
        <div className="kot torn-bottom relative mx-auto -mt-3 w-[92%] rounded-t px-3 pt-3 shadow-md">
          <input
            aria-label={t("counter.restaurant")}
            value={d.restaurant}
            onChange={(e) => update((x) => ({ ...x, restaurant: e.target.value.slice(0, 60) }))}
            placeholder={t("counter.restaurant")}
            className="mono tap w-full border-b border-dashed border-[#1B1A1755] bg-transparent text-center text-sm uppercase outline-none"
          />
          <ul className="mt-2">
            <AnimatePresence initial={false}>
              {lines.map((it, i) =>
                i < visible ? (
                  <motion.li key={it.id} layout layoutId={`line-${it.id}`} initial={{ y: -28, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ x: -120, opacity: 0, rotate: -4 }} transition={settle}
                    drag={calm ? false : "x"} dragConstraints={{ left: 0, right: 0 }} dragElastic={0.6}
                    onDragEnd={(_, info) => info.offset.x < -96 && tear(it.id)}
                  >
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => setEditing(it.id)} className="tap mono flex flex-1 items-center gap-2 text-left text-[13px]">
                        <span className="flex-1 truncate">{it.qty > 1 ? `${it.qty} x ` : ""}{it.name}</span>
                        <span className="opacity-40">.....</span>
                        <Money p={it.amount} />
                      </button>
                      <button type="button" aria-label={`Tear ${it.name}`} onClick={() => tear(it.id)} className="tap grid place-items-center text-lg opacity-60">×</button>
                    </div>
                  </motion.li>
                ) : null,
              )}
            </AnimatePresence>
          </ul>
          {d.charges.length > 0 && (
            <ul className="mt-2 border-t border-dashed border-[#1B1A1755] pt-2">
              {d.charges.map((c) => (
                <li key={c.id} className="mono flex justify-between text-[13px] opacity-80">
                  <span>{c.label}</span>
                  <Money p={bill.chargeAmounts[c.id] ?? 0} />
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex items-center justify-between border-t border-dashed border-[#1B1A1755] pt-2">
            <label className="mono text-xs" htmlFor="gt">{t("counter.total")}</label>
            <input
              id="gt"
              inputMode="decimal"
              defaultValue={d.printedTotal != null ? (d.printedTotal / 100).toFixed(2) : ""}
              key={d.printedTotal ?? "none"}
              onBlur={(e) => update((x) => ({ ...x, printedTotal: e.target.value ? toPaise(e.target.value) : null }))}
              className="mono tap w-28 border-b border-[#1B1A17] bg-transparent text-right text-sm outline-none"
              placeholder="0.00"
            />
          </div>
          {d.printedTotal != null && gap !== 0 && lines.length > 0 && (
            <div role="status" className="mt-2 rounded bg-[var(--haldi)] px-2 py-1.5 text-sm text-[#1B1A17]">
              <Money p={Math.abs(gap)} /> {gap > 0 ? t("reconcile.short") : t("reconcile.over")}
              {gap > 0 && (
                <button type="button" onClick={() => { const id = uid(); update((x) => ({ ...x, items: [...x.items, { id, name: "Chhooti line", qty: 1, amount: gap, kind: "food" }] })); setEditing(id); }} className="tap press ml-2 rounded bg-[#1B1A17] px-3 font-semibold text-[#F6EED9]">
                  {t("counter.addLine")} <Money p={gap} />
                </button>
              )}
            </div>
          )}
        </div>
        <AnimatePresence>
          {scrap && (
            <m.button type="button" onClick={tape} initial={{ y: -20, opacity: 0, rotate: -8 }} animate={{ y: 0, opacity: 1, rotate: -4 }} exit={{ opacity: 0 }} className="kot tap press mono absolute bottom-3 left-3 rounded px-3 py-2 text-xs shadow-lg">
              {scrap.item.name} · tape back (5s)
            </m.button>
          )}
        </AnimatePresence>
      </section>

      <section className="mt-4">
        <label htmlFor="qt" className="hand text-xl">{t("counter.type")}</label>
        <textarea
          id="qt"
          ref={quickRef}
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addQuick(); } }}
          rows={2}
          placeholder={t("counter.quickHint")}
          className="kot mono mt-1 w-full rounded-md p-3 text-sm outline-none"
        />
        <div className="mt-1 flex flex-wrap gap-2">
          {parseQuick(quick).map((p, i) => (
            <span key={i} className="kot mono inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs"><Katori size={18} />{p.qty > 1 ? `${p.qty}x ` : ""}{p.name} <Money p={p.amount} /></span>
          ))}
        </div>
        <button type="button" onClick={addQuick} className="tap press mt-2 rounded-md bg-[var(--ink-on-bg)] px-4 font-semibold text-[var(--bg)]">{t("counter.addLine")}</button>
        {err && <p role="alert" className="mt-2 font-semibold text-[var(--stamp-red)]">{err}</p>}
        {!demo && (
          <div className="mt-4 flex flex-wrap items-start gap-3">
            <a href="/demo" className="tap press inline-flex items-center gap-2 rounded-md border border-current px-3 py-2 text-sm">
              <svg width="18" height="22" viewBox="0 0 18 22" aria-hidden="true"><path d="M9 1v20M4 6h10v5H4z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              {t("counter.demo")}
            </a>
            <AnimatePresence>
              {install && (
                <m.div key="install" role="note" initial={{ y: -30, rotate: -10, opacity: 0 }} animate={{ y: 0, rotate: -3, opacity: 1 }} exit={{ y: 20, opacity: 0 }} transition={snap} className="kot relative rounded-sm px-3 pb-2 pt-3 text-[#1B1A17] shadow-lg">
                  <span className="absolute -top-2 left-1/2 h-4 w-1 -translate-x-1/2 rounded bg-[#c9a24a]" aria-hidden="true" />
                  <p className="hand text-lg font-bold">Ghar pe rakh lo</p>
                  <p className="text-xs">Home screen pe KhayaPiya, bina network ke bhi khulega.</p>
                  <div className="mt-1 flex gap-2 text-sm font-semibold">
                    <button type="button" className="tap press rounded-md bg-[#1B1A17] px-3 text-[#F6EED9]" onClick={async () => { await install.prompt().catch(() => {}); setInstall(null); }}>Rakh lo</button>
                    <button type="button" className="tap press rounded-md border border-[#1B1A17] px-3" onClick={() => { try { localStorage.setItem("kp_install_no", "1"); } catch {} setInstall(null); }}>Kabhi nahi</button>
                  </div>
                </m.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-xl gap-2 px-4 pb-4 pt-2" style={{ background: "linear-gradient(transparent, var(--bg) 35%)" }}>
        <button type="button" onClick={undo} onContextMenu={(e) => { e.preventDefault(); redo(); }} className="tap press kot rounded-md px-3 font-semibold">{t("undo")}</button>
        <button type="button" disabled={!d.items.length} onClick={goTable} className="tap press flex-1 rounded-md bg-[var(--stamp-red-deep)] px-4 text-lg font-semibold text-[#F6EED9] disabled:opacity-40">
          {t("counter.toTable")}
        </button>
      </div>

      <AnimatePresence>
        {editing && <LinePad key={editing} d={d} id={editing} onClose={() => setEditing(null)} update={update} />}
      </AnimatePresence>
    </main>
  );
}

function LinePad({ d, id, onClose, update }: { d: Draft; id: string; onClose: () => void; update: (fn: (d: Draft) => Draft) => void }) {
  const it = d.items.find((i) => i.id === id);
  const [val, setVal] = useState(it ? (it.amount / 100).toFixed(2) : "");
  const [name, setName] = useState(it?.name ?? "");
  const [qty, setQty] = useState(it?.qty ?? 1);
  if (!it) return null;
  const commit = () => {
    const p = toPaise(val);
    update((x) => ({ ...x, items: x.items.map((i) => (i.id === id ? { ...i, name: name.trim().slice(0, 60) || i.name, qty, amount: p ?? i.amount } : i)) }));
    onClose();
  };
  const key = (k: string) => setVal((v) => (k === "back" ? v.slice(0, -1) : k === "." && v.includes(".") ? v : (v + k).slice(0, 10)));
  return (
    <m.div className="fixed inset-0 z-50 flex items-end bg-[#0008]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <m.div role="dialog" aria-modal="true" aria-label="Line edit" className="teak mx-auto w-full max-w-xl rounded-t-2xl p-4" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={snap} onClick={(e) => e.stopPropagation()}>
        <m.div className="kot mono rounded p-3 text-sm" initial={{ rotateX: 180 }} animate={{ rotateX: 0 }} transition={snap}>
          <input aria-label="Naam" value={name} onChange={(e) => setName(e.target.value)} className="tap w-full bg-transparent outline-none" />
          <div className="mt-1 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button type="button" className="tap press rounded border" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <span className="w-8 text-center">{qty}x</span>
              <button type="button" className="tap press rounded border" onClick={() => setQty((q) => Math.min(99, q + 1))}>+</button>
            </div>
            <span className="text-2xl"><span className="rupee">₹</span>{val || "0"}</span>
          </div>
        </m.div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {["1", "2", "3", "back", "4", "5", "6", ".", "7", "8", "9", "0"].map((k) => (
            <button key={k} type="button" onClick={() => key(k)} className="tap press steel mono rounded-lg text-xl text-[#1B1A17]">{k === "back" ? "⌫" : k}</button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm font-semibold">
          <button type="button" className="tap press kot rounded-md" onClick={() => { update((x) => { const i = x.items.findIndex((y) => y.id === id); const a = x.items[i]; const half = Math.floor(a.amount / 2); x.items.splice(i, 1, { ...a, amount: a.amount - half }, { ...a, id: uid(), amount: half }); return x; }); onClose(); }}>Do mein todo</button>
          <button type="button" className="tap press kot rounded-md" onClick={() => { update((x) => { const i = x.items.findIndex((y) => y.id === id); const a = x.items[i], b = x.items[i + 1]; if (b) x.items.splice(i, 2, { ...a, name: `${a.name} ${b.name}`.slice(0, 60), amount: a.amount + b.amount }); return x; }); onClose(); }}>Agle se jodo</button>
          <button type="button" className="tap press rounded-md bg-[var(--chutney-deep)] text-white" onClick={commit}>Ho gaya</button>
        </div>
      </m.div>
    </m.div>
  );
}

function CounterSkeleton() {
  return (
    <main className="mx-auto max-w-xl px-4 pt-4" aria-busy="true">
      <div className="chalk h-44 rounded-xl" />
      <div className="teak mt-4 h-80 rounded-xl p-6"><div className="kot mx-auto h-full w-[92%] rounded opacity-70" /></div>
    </main>
  );
}

/* ----------------------------- TABLE ----------------------------- */
export function Table({ localId }: { localId: string }) {
  const { t, calm } = usePrefs();
  const router = useRouter();
  const { d, update, undo } = useDraft(localId, false);
  const [sel, setSel] = useState<string | null>(null);
  const [weights, setWeights] = useState<string | null>(null);
  const [friend, setFriend] = useState("");
  const [nag, setNag] = useState(false);
  const [tiffins, setTiffins] = useState<TiffinRef[] | null>(null);
  const [tiffinSheet, setTiffinSheet] = useState(false);
  // drag a katori onto a thali: the plate under (or within 64 px of) the finger grows to say it will take it
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [dropped, setDropped] = useState<{ id: string; k: number } | null>(null);
  const plates = useRef(new Map<string, HTMLElement>());
  const dragged = useRef(false);
  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { user: unknown; groups?: TiffinRef[] }) => {
        if (j.user && j.groups?.length) setTiffins(j.groups);
      })
      .catch(() => {});
  }, []);
  const bill = useMemo(() => (d ? computeBill({ members: d.members, items: d.items, charges: [], claims: d.claims, printedTotal: null }) : null), [d]);
  if (!d || !bill) return <TableSkeleton />;

  const toggle = (itemId: string, memberId: string) =>
    update((x) => {
      const has = x.claims.some((c) => c.itemId === itemId && c.memberId === memberId);
      x.claims = has ? x.claims.filter((c) => !(c.itemId === itemId && c.memberId === memberId)) : [...x.claims, { itemId, memberId, weight: 1 }];
      return x;
    });
  const assign = (itemId: string, memberId: string) =>
    update((x) => (x.claims.some((c) => c.itemId === itemId && c.memberId === memberId) ? x : { ...x, claims: [...x.claims, { itemId, memberId, weight: 1 }] }));
  /** The thali nearest the pointer, if the pointer is on it or within 64 px of its rim. */
  const nearest = (pt: { x: number; y: number }) => {
    const x = pt.x - window.scrollX;
    const y = pt.y - window.scrollY;
    let best: string | null = null;
    let bestD = Infinity;
    for (const [id, el] of plates.current) {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)) - r.width / 2;
      if (d <= 64 && d < bestD) {
        best = id;
        bestD = d;
      }
    }
    return best;
  };
  const everyone = () => {
    if (sel) update((x) => ({ ...x, claims: [...x.claims.filter((c) => c.itemId !== sel), ...x.members.map((mm) => ({ itemId: sel, memberId: mm.id, weight: 1 }))] }));
    else update((x) => ({ ...x, claims: [...x.claims, ...bill.unclaimed.flatMap((iid) => x.members.map((mm) => ({ itemId: iid, memberId: mm.id, weight: 1 })))] }));
  };
  const addFriend = () => {
    const n = friend.trim().slice(0, 24);
    if (!n || d.members.length >= 20) return;
    update((x) => ({ ...x, members: [...x.members, { id: uid(), seat: x.members.length + 1, name: n }] }));
    setFriend("");
  };
  const next = (to: string) => {
    if (to.endsWith("masala")) return router.push(to);
    if (bill.unclaimed.length) return setNag(true);
    router.push(to);
  };

  return (
    <main className="formica min-h-dvh pb-44">
      <div className="mx-auto max-w-xl px-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="display text-4xl text-[#1B1A17]">{t("table.title")}</h1>
          {tiffins && !d.demo && (
            <button type="button" onClick={() => setTiffinSheet(true)} className="tap press flex shrink-0 items-center gap-1.5 rounded-full bg-[#1B1A17] pl-2 pr-3 text-sm font-semibold text-[#F6EED9] shadow">
              <Tiffin n={2} size={20} /> {t("khata.fromTiffin")}
            </button>
          )}
        </div>
        <p className="text-sm font-semibold text-[#1B1A17]">{t("table.pick")}</p>
        {d.groupId && (
          <p className="hand mt-1 inline-flex -rotate-1 items-center gap-2 rounded-sm bg-[#8e1c1c] pl-2 text-base text-[#F6EED9] shadow">
            {d.groupName} ke log
            <button type="button" onClick={() => update(detachGroup)} aria-label="Tiffin hatao" className="tap grid place-items-center text-lg">×</button>
          </p>
        )}

        {/* thalis in a ring */}
        <div className="mt-3 grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4" style={{ transform: calm ? undefined : "perspective(900px) rotateX(6deg)" }}>
          {d.members.map((mm) => {
            const has = sel ? d.claims.some((c) => c.itemId === sel && c.memberId === mm.id) : false;
            const total = bill.perMember[mm.id]?.items ?? 0;
            const near = hover === mm.id;
            const plop = dropped?.id === mm.id;
            return (
              <m.button key={mm.id} ref={(el: HTMLButtonElement | null) => { if (el) plates.current.set(mm.id, el); else plates.current.delete(mm.id); }} type="button" disabled={!sel} onClick={() => sel && toggle(sel, mm.id)} aria-pressed={has} aria-label={`${mm.name}: ${total / 100}`} animate={{ scale: near ? 1.04 : has ? 1.04 : 1 }} transition={snap} className="tap flex flex-col items-center disabled:cursor-default">
                <m.span key={plop ? dropped?.k ?? 0 : 0} initial={plop ? { scale: 0.86 } : false} animate={{ scale: 1 }} transition={settle} className="block">
                  <Thali seat={mm.seat} name={mm.name} size={86} active={has || near} glow={!!sel || dragging} />
                </m.span>
                <span className="hand -mt-1 text-lg font-bold" style={{ color: ink(mm.seat).text }}>{mm.name}</span>
                <Money p={total} className="text-sm text-[#1B1A17]" />
              </m.button>
            );
          })}
          <div className="flex flex-col items-center justify-center gap-1">
            <input aria-label={t("table.friendName")} value={friend} onChange={(e) => setFriend(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addFriend()} placeholder={t("table.friendName")} className="kot tap hand w-24 rounded px-2 text-center" />
            <button type="button" onClick={addFriend} className="tap press rounded-full bg-[#1B1A17] px-3 font-semibold text-[#F6EED9]">{t("table.addFriend")}</button>
          </div>
        </div>
        <p className="sr-only" aria-live="polite">{d.members.map((mm) => `${mm.name}: ₹${((bill.perMember[mm.id]?.items ?? 0) / 100).toFixed(2)}`).join(", ")}</p>

        {/* the bill strip holding katoris; the torn paper is its own layer so a dragged katori is never clipped */}
        <section className="relative mt-5">
          <div aria-hidden="true" className="kot torn-bottom absolute inset-0 rounded-t-md shadow-lg" />
          <div className="relative px-3 pb-[18px] pt-3 text-[#1B1A17]">
          <ul className="flex flex-wrap gap-2">
            {d.items.map((it) => {
              const cl = d.claims.filter((c) => c.itemId === it.id);
              const un = cl.length === 0;
              const active = sel === it.id;
              return (
                <li key={it.id}>
                  <motion.button layoutId={`line-${it.id}`} type="button"
                    onClick={() => { if (dragged.current) return; setSel(active ? null : it.id); }}
                    drag={!calm} dragSnapToOrigin dragMomentum={false} dragElastic={1}
                    whileDrag={{ scale: 1.08, zIndex: 40, boxShadow: "6px 12px 18px rgba(27,26,23,.28)" }}
                    onDragStart={() => { dragged.current = true; setDragging(true); setSel(null); }}
                    onDrag={(_, info) => setHover(nearest(info.point))}
                    onDragEnd={(_, info) => {
                      const to = nearest(info.point);
                      setHover(null);
                      setDragging(false);
                      if (to) {
                        assign(it.id, to);
                        setDropped({ id: to, k: Date.now() });
                      }
                      setTimeout(() => (dragged.current = false), 0);
                    }}
                    aria-pressed={active} animate={{ scale: active ? 1.08 : 1, y: active ? -4 : 0 }} transition={snap}
                    className={`tap flex items-center gap-1.5 rounded-xl border-2 bg-[#fffaf0] px-2 py-1 text-left shadow ${active ? "border-[var(--haldi)]" : "border-transparent"} ${un && !calm && !active && !dragging ? "wobble" : ""}`}>
                    <Katori size={30} fill={un ? "#F4B400" : "#c6cfd2"} />
                    <span className="text-sm leading-tight">
                      <span className="block max-w-[9rem] truncate font-semibold">{it.qty > 1 ? `${it.qty} x ` : ""}{it.name}</span>
                      <Money p={it.amount} className="text-xs" />
                    </span>
                    <span className="flex">{cl.map((c) => { const mm = d.members.find((x) => x.id === c.memberId); return mm ? <Pattern key={c.memberId} seat={mm.seat} size={14} /> : null; })}</span>
                  </motion.button>
                </li>
              );
            })}
          </ul>
          {sel && (
            <div className="mt-3 flex flex-wrap gap-2 text-sm font-semibold">
              {(d.items.find((i) => i.id === sel)?.qty ?? 1) > 1 && (
                <button type="button" className="tap press rounded-md border border-[#1B1A17] px-3" onClick={() => update((x) => { const i = x.items.findIndex((y) => y.id === sel); const a = x.items[i]; const unit = Math.floor(a.amount / a.qty); const units = Array.from({ length: a.qty }, (_, k) => ({ ...a, id: k === 0 ? a.id : uid(), qty: 1, amount: k === 0 ? a.amount - unit * (a.qty - 1) : unit })); x.items.splice(i, 1, ...units); return x; })}>{t("table.units")}</button>
              )}
              {d.claims.filter((c) => c.itemId === sel).length > 1 && (
                <button type="button" className="tap press rounded-md border border-[#1B1A17] px-3" onClick={() => setWeights(sel)}>½ {t("table.weights")}</button>
              )}
            </div>
          )}
          </div>
        </section>
      </div>

      <AnimatePresence>
        {nag && (
          <m.div role="alert" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-x-4 bottom-36 z-40 mx-auto max-w-xl rounded-lg bg-[var(--haldi)] p-3 text-[#1B1A17] shadow-xl">
            <p className="font-semibold">{bill.unclaimed.length} {t("table.unclaimed")}</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className="tap press rounded-md bg-[#1B1A17] px-3 font-semibold text-[#F6EED9]" onClick={() => { update((x) => ({ ...x, claims: [...x.claims, ...bill.unclaimed.map((iid) => ({ itemId: iid, memberId: x.members[0].id, weight: 1 }))] })); setNag(false); }}>{t("table.mine")}</button>
              <button type="button" className="tap press rounded-md border border-[#1B1A17] px-3" onClick={() => { setSel(bill.unclaimed[0]); setNag(false); }}>OK</button>
            </div>
          </m.div>
        )}
      </AnimatePresence>

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-xl grid-cols-[auto_auto_1fr] gap-2 px-4 pb-4 pt-6" style={{ background: "linear-gradient(transparent, var(--formica) 30%)" }}>
        <button type="button" onClick={everyone} className="tap press rounded-md border-2 border-[var(--stamp-red-deep)] bg-[#fffaf0] px-3 font-bold text-[var(--stamp-red-deep)]" style={{ transform: "rotate(-3deg)" }}>{t("table.everyone")}</button>
        <button type="button" onClick={undo} className="tap press kot rounded-md px-3 font-semibold">{t("undo")}</button>
        <button type="button" onClick={() => next(`/bill/${d.id}/masala`)} className="tap press rounded-md bg-[var(--stamp-red-deep)] px-3 text-lg font-semibold text-[#F6EED9]">{t("table.masala")}</button>
      </div>

      <AnimatePresence>{weights && <Roti key={weights} d={d} itemId={weights} onClose={() => setWeights(null)} update={update} />}</AnimatePresence>
      <AnimatePresence>
        {tiffinSheet && tiffins && (
          <TiffinSheet
            tiffins={tiffins}
            onClose={() => setTiffinSheet(false)}
            onPick={(g, onlyLast) => {
              update((x) => seatsFromGroup(x, g, onlyLast));
              setTiffinSheet(false);
            }}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

/** Empty thalis in their final ring and a blank bill strip with dotted lines, while the draft loads. */
function TableSkeleton() {
  return (
    <main className="formica min-h-dvh" aria-busy="true" aria-label="Table lag raha hai">
      <div className="mx-auto max-w-xl px-4 pt-4">
        <div className="ph h-10 w-48" />
        <div className="ph mt-2 h-4 w-64" />
        <div className="mt-3 grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col items-center">
              <div className="size-[86px] rounded-full border-[3px] border-dashed border-[#1B1A1733]" />
              <div className="ph mt-1 h-4 w-14" />
            </div>
          ))}
        </div>
        <div className="kot torn-bottom mt-5 rounded-t-md px-3 pt-3">
          {[0, 1, 2].map((i) => <div key={i} className="my-3 border-b-2 border-dotted border-[#1B1A1733]" />)}
        </div>
      </div>
    </main>
  );
}

/** Pick a tiffin from the Khata shelf and seat its people. "Pichhli baar wali seating" is its last bill's people. */
function TiffinSheet({ tiffins, onClose, onPick }: { tiffins: TiffinRef[]; onClose: () => void; onPick: (g: GroupLite, onlyLast: boolean) => void }) {
  const { t } = usePrefs();
  const [loading, setLoading] = useState<string | null>(null);
  const [g, setG] = useState<GroupLite | null>(null);
  const [err, setErr] = useState("");
  const choose = async (id: string) => {
    setLoading(id);
    setErr("");
    try {
      const x = await fetchGroup(id);
      if (!x) throw new Error("gone");
      if (!x.entries.some((e) => e.kind === "bill")) return onPick(x, false);
      setG(x);
    } catch {
      setErr("Tiffin nahi khula. Network check karke phir try karo.");
    }
    setLoading(null);
  };
  const last = g?.entries.find((e) => e.kind === "bill");
  const lastNames = g && last ? g.people.filter((p) => p.id === g.me || last.shares.some((x) => x.personId === p.id)).map((p) => p.name) : [];
  return (
    <m.div className="fixed inset-0 z-50 flex items-end bg-[#0008]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <m.div role="dialog" aria-modal="true" aria-label={t("khata.fromTiffin")} className="teak mx-auto w-full max-w-xl rounded-t-2xl px-4 pb-6 pt-4 text-[#F6EED9]" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={snap} onClick={(e) => e.stopPropagation()}>
        <h2 className="display text-3xl">{g ? g.name : t("khata.fromTiffin")}</h2>
        {!g ? (
          <ul className="mt-3 flex gap-3 overflow-x-auto pb-2">
            {tiffins.map((x) => (
              <li key={x.id} className="shrink-0">
                <button type="button" disabled={!!loading} onClick={() => choose(x.id)} className="tap press flex w-24 flex-col items-center disabled:opacity-60">
                  <m.span animate={loading === x.id ? { y: [0, -6, 0] } : { y: 0 }} transition={{ repeat: loading === x.id ? Infinity : 0, duration: 0.6 }}>
                    <Tiffin n={tiffinInk(x.id)} size={64} tiers={x.kind === "trip" ? 2 : x.kind === "lunch" ? 4 : 3} />
                  </m.span>
                  <span className="kot hand -mt-1 w-full -rotate-2 truncate rounded-sm px-1 text-center text-base font-bold">{x.name}</span>
                  <span className="mt-0.5 text-xs opacity-80">{x.people} log</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 grid gap-2">
            <button type="button" onClick={() => onPick(g, true)} className="tap press kot rounded-md px-3 py-2 text-left text-[#1B1A17]">
              <span className="block text-lg font-bold">Pichhli baar wali seating</span>
              <span className="hand block truncate text-base">{lastNames.join(", ")}</span>
            </button>
            <button type="button" onClick={() => onPick(g, false)} className="tap press rounded-md border-2 border-[#F6EED9] px-3 py-2 text-left">
              <span className="block text-lg font-bold">Pura tiffin ({g.people.length} log)</span>
              <span className="hand block truncate text-base">{g.people.map((p) => p.name).join(", ")}</span>
            </button>
          </div>
        )}
        {err && <p role="alert" className="mt-2 font-semibold text-[#FFB4AC]">{err}</p>}
        <p className="mt-3 text-sm opacity-80">Room khulte hi bill is tiffin ke khate mein likha jayega.</p>
      </m.div>
    </m.div>
  );
}

function Roti({ d, itemId, onClose, update }: { d: Draft; itemId: string; onClose: () => void; update: (fn: (d: Draft) => Draft) => void }) {
  const cl = d.claims.filter((c) => c.itemId === itemId);
  const W = cl.reduce((a, c) => a + c.weight, 0);
  const set = (memberId: string, w: number) => update((x) => ({ ...x, claims: x.claims.map((c) => (c.itemId === itemId && c.memberId === memberId ? { ...c, weight: Math.max(1, Math.min(12, w)) } : c)) }));
  const preset = (ws: number[]) => update((x) => { let k = 0; x.claims = x.claims.map((c) => (c.itemId === itemId ? { ...c, weight: ws[k++] ?? 1 } : c)); return x; });
  let acc = 0;
  return (
    <m.div className="fixed inset-0 z-50 flex items-end bg-[#0008]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <m.div role="dialog" aria-modal="true" aria-label="Roti" className="kot mx-auto w-full max-w-xl rounded-t-2xl p-4" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={snap} onClick={(e) => e.stopPropagation()}>
        <svg viewBox="-60 -60 120 120" className="mx-auto h-40 w-40" aria-hidden="true">
          <circle r="54" fill="#e8c98a" stroke="#8a5a34" strokeWidth="1.5" />
          {cl.map((c) => {
            const a0 = (acc / W) * Math.PI * 2;
            acc += c.weight;
            const a1 = (acc / W) * Math.PI * 2;
            const mm = d.members.find((x) => x.id === c.memberId)!;
            return <path key={c.memberId} d={`M0 0L${54 * Math.sin(a0)} ${-54 * Math.cos(a0)}A54 54 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${54 * Math.sin(a1)} ${-54 * Math.cos(a1)}Z`} fill={ink(mm.seat).fill} fillOpacity=".55" stroke="#8a5a34" strokeWidth="1.5" />;
          })}
        </svg>
        <div className="mt-2 flex flex-wrap justify-center gap-2 text-sm font-semibold">
          <button type="button" className="tap press rounded-full border px-3" onClick={() => preset(cl.map(() => 1))}>Aadha aadha</button>
          {cl.length === 2 && <button type="button" className="tap press rounded-full border px-3" onClick={() => preset([2, 1])}>2 : 1</button>}
          {cl.length === 2 && <button type="button" className="tap press rounded-full border px-3" onClick={() => preset([1, 2])}>1 : 2</button>}
        </div>
        <ul className="mt-3 space-y-2">
          {cl.map((c) => {
            const mm = d.members.find((x) => x.id === c.memberId)!;
            return (
              <li key={c.memberId} className="flex items-center justify-between">
                <span className="hand text-lg" style={{ color: ink(mm.seat).text }}>{mm.name}</span>
                <span className="flex items-center gap-2">
                  <button type="button" className="tap press rounded border" onClick={() => set(c.memberId, c.weight - 1)}>−</button>
                  <span className="mono w-6 text-center">{c.weight}</span>
                  <button type="button" className="tap press rounded border" onClick={() => set(c.memberId, c.weight + 1)}>+</button>
                </span>
              </li>
            );
          })}
        </ul>
        <button type="button" className="tap press mt-3 w-full rounded-md bg-[var(--chutney-deep)] font-semibold text-white" onClick={onClose}>Ho gaya</button>
      </m.div>
    </m.div>
  );
}

/* ----------------------------- SHELF ----------------------------- */
const KINDS: ChargeKind[] = ["cgst", "sgst", "igst", "vat", "service", "packing", "tip", "discount"];
export function Shelf({ localId }: { localId: string }) {
  const { t, calm, lite } = usePrefs();
  const router = useRouter();
  const { d, update, undo } = useDraft(localId, false);
  const [open, setOpen] = useState<string | null>(null);
  // the jar being poured, kept for 2 s so every thali can show what landed in it
  const [poured, setPoured] = useState<{ id: string; k: number } | null>(null);
  const [vpa, setVpa] = useState("");
  const [payee, setPayee] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [noteShown, setNoteShown] = useState(false);
  useEffect(() => {
    kvGet<{ vpa: string; payee: string }>("host").then((h) => { if (h) { setVpa(h.vpa); setPayee(h.payee); } }).catch(() => {});
  }, []);
  const bill = useMemo(() => (d ? computeBill({ members: d.members, items: d.items, charges: d.charges, claims: d.claims, printedTotal: d.printedTotal }) : null), [d]);
  if (!d || !bill) return <ShelfSkeleton />;
  const sumShares = Object.values(bill.perMember).reduce((a, p) => a + p.total, 0);
  const diff = (d.printedTotal ?? bill.computedTotal) - sumShares;
  const tilt = Math.max(-12, Math.min(12, diff / 100));
  const setC = (id: string, patch: Partial<Charge>) => update((x) => ({ ...x, charges: x.charges.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const addJar = (kind: ChargeKind) => update((x) => ({ ...x, charges: [...x.charges, { id: uid(), kind, label: kind.toUpperCase(), mode: "percent", value: kind === "discount" ? 1000 : 500, scope: kind === "vat" ? x.items.filter((i) => i.kind === "drink").map((i) => i.id) : null, split: kind === "tip" ? "equal" : "proportional", included: false, removed: false }] }));

  const openRoom = async () => {
    setErr("");
    if (bill.unclaimed.length) return setErr(`${bill.unclaimed.length} ${t("table.unclaimed")}`);
    setBusy(true);
    try {
      await kvSet("host", { vpa, payee });
      const r = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurant: d.restaurant, payeeName: payee || "Host", vpa, printedTotal: d.printedTotal, members: d.members, items: d.items, charges: d.charges, claims: d.claims, demo: d.demo, groupId: d.demo ? null : d.groupId ?? null }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "error");
      try { localStorage.setItem("kp_dev", j.devToken); } catch {}
      update((x) => ({ ...x, roomCode: j.code }));
      router.push(`/r/${j.code}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="min-h-dvh pb-10">
      <div className="mx-auto max-w-xl px-4 pt-4">
        <h1 className="display text-4xl">{t("shelf.title")}</h1>
        {/* the plank of jars */}
        <section className="relative mt-3">
          <div className="flex gap-1 overflow-x-auto pb-2 pt-4">
            {d.charges.map((c) => (
              <button key={c.id} type="button" onClick={() => { setOpen(open === c.id ? null : c.id); const k = Date.now(); setPoured({ id: c.id, k }); setTimeout(() => setPoured((p) => (p?.k === k ? null : p)), 2000); if (c.kind === "service") setNoteShown(true); }} aria-expanded={open === c.id} className="tap shrink-0">
                <Jar label={c.label.slice(0, 10)} amount={`₹${((bill.chargeAmounts[c.id] ?? 0) / 100).toFixed(2)}`} color={JAR_COLOR[c.kind]} tipped={poured?.id === c.id && !c.removed && !c.included} closed={c.removed} outline={c.included} flipped={c.kind === "discount"} />
              </button>
            ))}
            {bill.autoRoundoff !== 0 && (
              <div className="grid shrink-0 place-items-center px-2 text-center"><Katori size={40} fill="#B8C2C6" /><span className="text-xs">Round off</span><Money p={bill.autoRoundoff} sign className="text-xs" /></div>
            )}
          </div>
          <div className="teak h-4 rounded shadow-md" />
        </section>

        {open && (() => {
          const c = d.charges.find((x) => x.id === open)!;
          if (!c) return null;
          return (
            <m.div initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="kot mt-3 rounded-md p-3 text-sm">
              <div className="flex flex-wrap gap-2">
                {c.kind === "service" && <button type="button" onClick={() => setC(c.id, { removed: !c.removed })} aria-pressed={c.removed} className="tap press rounded-md border border-[#1B1A17] px-3 font-semibold">{c.removed ? "Service wapas" : t("service.remove")}</button>}
                {c.kind !== "discount" && <button type="button" onClick={() => setC(c.id, { included: !c.included })} aria-pressed={c.included} className="tap press rounded-md border border-[#1B1A17] px-3">{t("shelf.included")} {c.included ? "✓" : ""}</button>}
                <button type="button" onClick={() => setC(c.id, { split: c.split === "equal" ? "proportional" : "equal" })} className="tap press rounded-md border border-[#1B1A17] px-3">{c.split === "equal" ? t("shelf.equal") : t("shelf.prop")}</button>
                <button type="button" onClick={() => update((x) => ({ ...x, charges: x.charges.filter((y) => y.id !== c.id) }))} className="tap press rounded-md border border-[var(--stamp-red-deep)] px-3 text-[var(--stamp-red-deep)]">Hatao</button>
              </div>
              <label className="mt-2 flex items-center gap-2">
                <span>{c.mode === "percent" ? "%" : "₹"}</span>
                <input inputMode="decimal" defaultValue={(Math.abs(c.value) / 100).toFixed(2)} onBlur={(e) => { const p = toPaise(e.target.value); if (p != null) setC(c.id, { value: c.kind === "roundoff" && c.value < 0 ? -p : p }); }} className="mono tap w-28 border-b border-[#1B1A17] bg-transparent outline-none" />
                <button type="button" className="tap press rounded border px-2 text-xs" onClick={() => setC(c.id, { mode: c.mode === "percent" ? "amount" : "percent" })}>{c.mode === "percent" ? "₹ mein" : "% mein"}</button>
              </label>
              <p className="mt-2 font-semibold">{t("shelf.scope")}</p>
              <ul className="mt-1 max-h-48 overflow-auto">
                {d.items.map((it) => {
                  const on = !c.scope || c.scope.includes(it.id);
                  return (
                    <li key={it.id}>
                      <label className="tap flex items-center gap-2">
                        <input type="checkbox" checked={on} onChange={() => { const cur = c.scope ?? d.items.map((i) => i.id); const nx = on ? cur.filter((x) => x !== it.id) : [...cur, it.id]; setC(c.id, { scope: nx.length === d.items.length ? null : nx }); }} className="size-5 accent-[#1D6B3E]" />
                        <span className="mono flex-1 truncate text-xs">{it.name}</span>
                        <Money p={it.amount} className="text-xs" />
                      </label>
                    </li>
                  );
                })}
              </ul>
              {bill.discountErrors.includes(c.id) && <p className="mt-1 text-[var(--stamp-red-deep)]">Discount bill se bada hai</p>}
            </m.div>
          );
        })()}
        {noteShown && <p className="mt-2 text-sm opacity-80">{t("service.note")}</p>}
        <div className="mt-2 flex flex-wrap gap-1">
          {KINDS.map((k) => (
            <button key={k} type="button" onClick={() => addJar(k)} className="tap press rounded-full border border-current px-3 text-xs font-semibold uppercase">{t("shelf.addJar")} {k}</button>
          ))}
        </div>

        {/* per-thali breakdown with pour amounts and copper coins */}
        <section className="formica mt-4 rounded-xl p-3 text-[#1B1A17]">
          <ul className="grid grid-cols-2 gap-2">
            {d.members.map((mm) => {
              const p = bill.perMember[mm.id];
              const coins = bill.bonuses.filter((b) => b.memberId === mm.id);
              const pc = poured ? d.charges.find((c) => c.id === poured.id) : null;
              const got = pc && !pc.removed && !pc.included ? p?.charges?.[pc.id] ?? 0 : 0;
              const most = pc ? Math.max(1, ...d.members.map((x) => Math.abs(bill.perMember[x.id]?.charges?.[pc.id] ?? 0))) : 1;
              const width = Math.max(2, Math.min(14, Math.round((14 * Math.abs(got)) / most)));
              return (
                <li key={mm.id} className="kot relative rounded-lg p-2 text-xs">
                  {pc && got !== 0 && (
                    <>
                      {/* the pour: a stream as wide as this thali's share drops in (a discount flows back up to its jar) */}
                      {!calm && (lite ? (
                        <m.span key={`dot${poured!.k}`} aria-hidden="true" className="pointer-events-none absolute -top-2 left-1/2 size-2 rounded-full" style={{ background: JAR_COLOR[pc.kind] }} initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: [0, 1, 0] }} transition={{ duration: 0.9 }} />
                      ) : (
                        <m.span key={`pour${poured!.k}`} aria-hidden="true" className="pointer-events-none absolute -top-9 left-1/2 h-12 -translate-x-1/2 rounded-full" style={{ width, background: JAR_COLOR[pc.kind], transformOrigin: pc.kind === "discount" ? "50% 0%" : "50% 100%" }} initial={{ scaleY: 0, opacity: 0.9 }} animate={{ scaleY: [0, 1, 1, 0], opacity: [0.9, 0.9, 0.9, 0] }} transition={{ duration: 1.1, times: [0, 0.35, 0.7, 1], ease: "easeOut" }} />
                      ))}
                      <m.span key={`lbl${poured!.k}`} className="mono absolute -top-3 right-1 z-10 rounded bg-[#1B1A17] px-1.5 py-0.5 text-[11px] text-[#F6EED9] shadow" initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: calm ? 0 : 0.35, duration: 0.2 }}>
                        <Money p={got} sign /> {pc.label.slice(0, 10)}
                      </m.span>
                    </>
                  )}
                  <div className="flex items-center gap-1"><Pattern seat={mm.seat} /><span className="hand text-base font-bold" style={{ color: ink(mm.seat).text }}>{mm.name}</span></div>
                  <div className="mono mt-1 flex justify-between"><span>Items</span><Money p={p?.items ?? 0} /></div>
                  {Object.entries(p?.charges ?? {}).map(([cid, a]) => (
                    <div key={cid} className="mono flex justify-between opacity-80"><span>{d.charges.find((c) => c.id === cid)?.label ?? "Round off"}</span><Money p={a} sign /></div>
                  ))}
                  {coins.length > 0 && (
                    <details className="hand mt-1 text-[var(--chai)]">
                      <summary className="tap flex cursor-pointer items-center gap-1"><Coin />+{coins.length} paisa {mm.name} ko</summary>
                      <span>uska remainder sabse bada tha ({coins.map((c) => c.label).join(", ")})</span>
                    </details>
                  )}
                  <div className="display mt-1 text-right text-xl"><Money p={p?.total ?? 0} /></div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="mt-4 grid grid-cols-[1fr_auto] items-center gap-3">
          <div>
            {diff === 0 && bill.unclaimed.length === 0 ? <Stamp text="₹0.00 baaki" color="var(--chutney-deep)" /> : <p className="font-semibold text-[var(--stamp-red)]"><Money p={Math.abs(diff)} /> {diff > 0 ? t("reconcile.short") : t("reconcile.over")}</p>}
            {diff === 0 && <p className="mt-1 text-sm">{t("scale.balanced")}</p>}
            <p className="mono mt-1 text-xs opacity-80">Bill <Money p={d.printedTotal ?? bill.computedTotal} /> · Shares <Money p={sumShares} /></p>
          </div>
          <Scale tilt={tilt} balanced={diff === 0} />
        </section>

        {/* room form */}
        <section className="leather stitch mt-5 rounded-xl p-4 text-[#F6EED9]">
          <h2 className="display text-2xl text-[var(--haldi)]">{t("room.open")}</h2>
          <label className="mt-2 block text-sm">{t("room.payee")}
            <input value={payee} onChange={(e) => setPayee(e.target.value.replace(/[^A-Za-z .]/g, "").slice(0, 40))} className="tap mt-1 w-full rounded bg-[#F6EED9] px-2 text-[#1B1A17]" autoComplete="name" />
          </label>
          {!d.demo && (
            <label className="mt-2 block text-sm">{t("room.vpa")}
              <input value={vpa} onChange={(e) => setVpa(e.target.value.trim())} placeholder="naam@okicici" className="tap mono mt-1 w-full rounded bg-[#F6EED9] px-2 text-[#1B1A17]" />
            </label>
          )}
          {d.demo && <p className="mt-2 text-sm">Demo room: UPI ID demo@upi. {t("pay.demo")}.</p>}
          {d.groupId && !d.demo && (
            <p className="mt-3 flex items-center gap-2 rounded-sm bg-[#8e1c1c] px-2 text-sm shadow-inner">
              <Tiffin n={tiffinInk(d.groupId)} size={22} />
              <span className="min-w-0 flex-1"><b className="hand text-base">{d.groupName}</b> {t("khata.writesTo")}</span>
              <button type="button" onClick={() => update(detachGroup)} className="tap underline underline-offset-4">Mat likho</button>
            </p>
          )}
          {err && <p role="alert" className="mt-2 font-semibold text-[#FF8F85]">{err}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={undo} className="tap press kot rounded-md px-3 font-semibold">{t("undo")}</button>
            <button type="button" disabled={busy} onClick={openRoom} className="tap press flex-1 rounded-md bg-[var(--stamp-red-deep)] text-lg font-semibold text-[#F6EED9] disabled:opacity-50">{busy ? "..." : t("room.open")}</button>
          </div>
          <a href={`/bill/${d.id}`} className="tap mt-2 inline-flex items-center text-sm underline">{t("table.title")}</a>
        </section>
      </div>
    </main>
  );
}

/** Jars on the plank and a resting scale, at their final sizes, while the draft loads. */
function ShelfSkeleton() {
  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 pt-4" aria-busy="true" aria-label="Shelf lag rahi hai">
      <div className="ph h-10 w-56" />
      <div className="mt-3 flex gap-1 pt-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-[108px] w-[78px] shrink-0 rounded-b-2xl rounded-t-md border-2 border-dashed border-current opacity-25" />)}
      </div>
      <div className="teak h-4 rounded shadow-md" />
      <div className="formica mt-4 grid grid-cols-2 gap-2 rounded-xl p-3">
        {[0, 1].map((i) => <div key={i} className="kot h-28 rounded-lg opacity-70" />)}
      </div>
    </main>
  );
}

/* tesseract.js v5 loaded only when the camera or gallery is first used */
type TesseractNS = { createWorker: (l: string, oem: number, o: { logger: (m: { status: string; progress: number }) => void }) => Promise<{ recognize: (f: File) => Promise<unknown>; terminate: () => Promise<void> }> };
function loadTesseract(): Promise<void> {
  if ((window as unknown as { Tesseract?: unknown }).Tesseract) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    s.onload = () => res();
    s.onerror = () => rej(new Error("ocr"));
    document.head.appendChild(s);
  });
}
