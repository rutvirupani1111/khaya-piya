"use client";
// One tiffin's khata: the red-cloth ledger. Balances in Kalam, red threads for settle-up, the bahi of entries.
// Every write shows on the page first and syncs behind it; deletes wait 5 s for "Wapas lo" before they go.
import { AnimatePresence, m } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GroupFull } from "@/lib/db/tenant";
import { api, fmtDate } from "@/lib/client";
import { amountParam, toPaise } from "@/lib/money";
import { applyEntry, ledgerPlan, splitExpense, type LedgerEntry, type Person, type SplitMode } from "@/lib/money/ledger";
import { Money, Pattern } from "../art";
import { usePrefs } from "../Prefs";
import { Bookmark, Tiffin, tiffinInk } from "./art";
import { KIND_LABEL } from "./Home";

const snap = { type: "spring", stiffness: 520, damping: 34 } as const;
const soft = { type: "spring", stiffness: 380, damping: 38 } as const;
/** Ink on cream paper stays dark in both themes, so the ledger reads the same at night. */
const PAPER_INK = ["#A61E1E", "#1B1A17", "#1D6B3E", "#B0306A", "#6B3E26", "#176B6B"];
const paperInk = (seat: number) => PAPER_INK[(seat - 1) % 6];
const PLUS = "#1D6B3E";
const MINUS = "#A61E1E";

type Row = LedgerEntry & { state?: "pending" | "failed" | "struck" };
type NewEntry = Pick<LedgerEntry, "kind" | "payerId" | "description" | "total" | "shares">;
type Toast = { key: number; text: string; undo?: () => void; error?: boolean } | null;

export function Ledger({ initial }: { initial: GroupFull }) {
  const { t, calm } = usePrefs();
  const router = useRouter();
  const [g, setG] = useState(initial);
  const [rows, setRows] = useState<Row[]>(initial.entries);
  const [net, setNet] = useState<Record<string, number>>(initial.net);
  const [toast, setToast] = useState<Toast>(null);
  const [sheet, setSheet] = useState<null | "expense" | { person: Person | null }>(null);
  const [threads, setThreads] = useState(false);
  const [turning, setTurning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const deletes = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const trigger = useRef<HTMLElement | null>(null);
  const gid = g.id;

  const person = (id: string) => g.people.find((p) => p.id === id);
  const nameOf = (id: string) => person(id)?.name ?? "?";
  const plan = useMemo(() => ledgerPlan(net), [net]);
  const live = rows.filter((r) => r.state !== "struck" && r.state !== "failed");

  // toasts fade on their own; an undo that is not used simply lets the action stand
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast((cur) => (cur?.key === toast.key ? null : cur)), toast.error ? 6000 : 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  // the page turns to a fresh sheet the moment the last thread is settled
  const prevPlan = useRef(plan.length);
  useEffect(() => {
    if (prevPlan.current > 0 && plan.length === 0) {
      setTurning(true);
      setThreads(false);
      setTimeout(() => setTurning(false), calm ? 500 : 1150);
    }
    prevPlan.current = plan.length;
  }, [plan.length, calm]);

  // deletes still waiting for their undo window are sent when the page goes away
  useEffect(() => {
    const pending = deletes.current;
    const flush = () => {
      for (const [id, timer] of pending) {
        clearTimeout(timer);
        fetch(`/api/groups/${gid}/entries/${id}`, { method: "DELETE", keepalive: true }).catch(() => {});
      }
      pending.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [gid]);

  const bump = (e: Pick<LedgerEntry, "payerId" | "total" | "shares">, sign: 1 | -1) =>
    setNet((n) => {
      const x = { ...n };
      applyEntry(x, e, sign);
      return x;
    });

  const post = async (row: Row): Promise<boolean> => {
    try {
      const r = await api<{ entry: LedgerEntry }>(`/api/groups/${gid}/entries`, "POST", { id: row.id, kind: row.kind, payerId: row.payerId, description: row.description, total: row.total, shares: row.shares });
      setRows((rs) => rs.map((x): Row => (x.id === row.id ? (x.state === "struck" ? { ...r.entry, state: "struck" } : r.entry) : x)));
      return true;
    } catch (err) {
      setRows((rs) => rs.map((x): Row => (x.id === row.id ? { ...x, state: "failed" } : x)));
      bump(row, -1);
      setToast({ key: Date.now(), text: (err as Error).message, error: true });
      return false;
    }
  };

  /** Write an entry: it is on the page and in the balances at once, then saved. */
  const add = (e: NewEntry) => {
    const row: Row = { ...e, id: crypto.randomUUID(), createdAt: new Date().toISOString(), roomCode: null, dishes: null, state: "pending" };
    setRows((rs) => [row, ...rs]);
    bump(row, 1);
    return { row, saved: post(row) };
  };
  const retry = (row: Row) => {
    setRows((rs) => rs.map((x): Row => (x.id === row.id ? { ...x, state: "pending" } : x)));
    bump(row, 1);
    post(row);
  };

  const sendDelete = async (row: Row) => {
    deletes.current.delete(row.id);
    try {
      await api(`/api/groups/${gid}/entries/${row.id}`, "DELETE");
      setRows((rs) => rs.filter((x) => x.id !== row.id));
    } catch (err) {
      setRows((rs) => rs.map((x): Row => (x.id === row.id ? { ...x, state: undefined } : x)));
      bump(row, 1);
      setToast({ key: Date.now(), text: (err as Error).message, error: true });
    }
  };
  const unstrike = (row: Row) => {
    const timer = deletes.current.get(row.id);
    if (timer) clearTimeout(timer);
    deletes.current.delete(row.id);
    setRows((rs) => rs.map((x): Row => (x.id === row.id ? { ...x, state: undefined } : x)));
    bump(row, 1);
    setToast(null);
  };
  /** Strike an entry out. It stays on the page, crossed through, for 5 s; then the delete is sent. */
  const strike = (row: Row) => {
    if (row.state === "failed") return setRows((rs) => rs.filter((x) => x.id !== row.id));
    setRows((rs) => rs.map((x): Row => (x.id === row.id ? { ...x, state: "struck" } : x)));
    bump(row, -1);
    setOpen(null);
    deletes.current.set(row.id, setTimeout(() => sendDelete(row), 5000));
    setToast({ key: Date.now(), text: `${titleOf(row, nameOf)}: ${t("khata.deleted").toLowerCase()}`, undo: () => unstrike(row) });
  };

  const settle = (tr: { from: string; to: string; amount: number }) => {
    const { row, saved } = add({ kind: "settlement", payerId: tr.from, description: "Hisaab barabar", total: tr.amount, shares: [{ personId: tr.to, owed: tr.amount }] });
    setToast({
      key: Date.now(),
      text: `${nameOf(tr.from)} ne ${nameOf(tr.to)} ko ₹${amountParam(tr.amount)} diye`,
      undo: async () => {
        setToast(null);
        setRows((rs) => rs.map((x): Row => (x.id === row.id ? { ...x, state: "struck" } : x)));
        bump(row, -1);
        if (await saved) sendDelete(row);
      },
    });
  };

  const rename = async (name: string) => {
    const before = g.name;
    if (!name || name === before) return;
    setG((x) => ({ ...x, name }));
    try {
      await api(`/api/groups/${gid}`, "PATCH", { name });
    } catch (err) {
      setG((x) => ({ ...x, name: before }));
      setToast({ key: Date.now(), text: (err as Error).message, error: true });
    }
  };

  const savePerson = async (p: { id?: string; name: string; vpa: string | null }) => {
    const before = g.people;
    if (p.id) setG((x) => ({ ...x, people: x.people.map((y) => (y.id === p.id ? { ...y, name: p.name, vpa: p.vpa } : y)) }));
    try {
      const r = await api<{ people: Person[] }>(`/api/groups/${gid}/people`, "POST", { people: [p] });
      setG((x) => ({ ...x, people: r.people }));
      return null;
    } catch (err) {
      setG((x) => ({ ...x, people: before }));
      return (err as Error).message;
    }
  };

  const openSheet = (s: "expense" | { person: Person | null }) => {
    trigger.current = document.activeElement as HTMLElement | null;
    setSheet(s);
  };
  const closeSheet = () => {
    setSheet(null);
    setTimeout(() => trigger.current?.focus?.(), 60);
  };

  const people = [...g.people].sort((a, b) => a.seat - b.seat);
  const allEven = plan.length === 0;
  const tiers = g.kind === "trip" ? 2 : g.kind === "lunch" ? 4 : 3;

  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 pb-32 pt-4">
      <header className="flex items-center justify-between">
        <Link href="/khata" className="tap press inline-flex items-center gap-1 text-sm font-semibold">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          {t("khata.shelf")}
        </Link>
        <a href={`/api/groups/${gid}/export.csv`} download className="tap press inline-flex items-center gap-1.5 rounded-md border border-current px-3 text-sm font-semibold">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m-3-3 3 3 3-3M3 13h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {t("khata.export")}
        </a>
      </header>

      <section className="mt-3 flex items-end gap-3">
        <m.div initial={{ y: -30, rotate: -4, opacity: 0 }} animate={{ y: 0, rotate: 0, opacity: 1 }} transition={snap}>
          <Tiffin n={tiffinInk(g.id)} tiers={tiers} size={76} />
        </m.div>
        <div className="min-w-0 flex-1 pb-1">
          <Title name={g.name} onSave={rename} />
          <p className="text-sm opacity-80">{KIND_LABEL[g.kind]} · {people.length} log · {g.role === "owner" ? "tera tiffin" : "tu bhi likh sakta hai"}</p>
        </div>
      </section>

      {/* the ledger: red cloth binding, cream ruled pages, red double margin */}
      <section className="cloth relative mt-4 rounded-md p-2 pt-3 shadow-xl" aria-label={t("khata.title")}>
        <Bookmark className="absolute -top-1 right-8 z-10" />
        <div className="ledger relative overflow-hidden rounded-sm pb-3 pt-1">
          <h2 className="display ledger-row pl-[60px] pr-3 text-2xl">{t("khata.balances")}</h2>
          <AnimatePresence mode="wait" initial={false}>
            {allEven ? (
              <m.div key="even" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative pl-[60px] pr-3">
                <p className="hand ledger-row text-xl">{live.length ? t("khata.allEven") : t("khata.emptyBook")}</p>
                {live.length > 0 && (
                  <m.span initial={{ scale: 1.8, opacity: 0, rotate: -16 }} animate={{ scale: 1, opacity: 0.85, rotate: -8 }} transition={{ ...snap, delay: calm ? 0 : 0.5 }} className="display mt-1 inline-block rounded-md border-[3px] px-3 text-2xl uppercase" style={{ color: PLUS, borderColor: PLUS }}>
                    Barabar
                  </m.span>
                )}
              </m.div>
            ) : (
              <m.ul key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {people.map((p) => {
                  const n = net[p.id] ?? 0;
                  return (
                    <li key={p.id} className="ledger-row flex items-center gap-2 pr-3">
                      <span className="grid w-[46px] shrink-0 place-items-center"><Pattern seat={p.seat} size={16} /></span>
                      <span className="hand min-w-0 flex-1 truncate pl-2 text-xl font-bold" style={{ color: paperInk(p.seat) }}>{p.name}{p.id === g.me ? " (tu)" : ""}</span>
                      {n === 0 ? (
                        <span className="hand text-lg opacity-70">{t("khata.even")}</span>
                      ) : (
                        <m.span key={n} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="hand text-lg font-bold" style={{ color: n > 0 ? PLUS : MINUS }}>
                          <Money p={n} sign /> <span className="text-sm font-normal">{n > 0 ? "lena" : "dena"}</span>
                        </m.span>
                      )}
                    </li>
                  );
                })}
              </m.ul>
            )}
          </AnimatePresence>
          <p className="sr-only" aria-live="polite">{allEven ? t("khata.allEven") : people.map((p) => `${p.name} ${(net[p.id] ?? 0) >= 0 ? "plus" : "minus"} ${Math.abs((net[p.id] ?? 0) / 100).toFixed(2)}`).join(", ")}</p>

          {!allEven && (
            <div className="mt-2 pl-[60px] pr-3">
              {!threads ? (
                <button type="button" onClick={() => setThreads(true)} className="tap press flex w-full items-center justify-center gap-2 rounded-md bg-[#A61E1E] text-lg font-semibold text-[#F6EED9] shadow">
                  <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true"><path d="M1 7q5-6 10 0t10 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                  {t("settle.cta")}
                </button>
              ) : (
                <p className="hand ledger-row text-base">{plan.length} {plan.length === 1 ? "transfer" : "transfers"}, {t("khata.fewest")}</p>
              )}
            </div>
          )}
          <AnimatePresence initial={false}>
            {threads && !allEven && (
              <m.ul key="threads" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-1 pl-[54px] pr-2">
                <AnimatePresence initial={true}>
                  {plan.map((tr, i) => (
                    <Thread key={`${tr.from}>${tr.to}`} i={i} from={person(tr.from)} to={person(tr.to)} amount={tr.amount} groupName={g.name} onDone={() => settle(tr)} />
                  ))}
                </AnimatePresence>
              </m.ul>
            )}
          </AnimatePresence>

          <h2 className="display ledger-row mt-4 pl-[60px] pr-3 text-2xl">Bahi</h2>
          {rows.length === 0 ? (
            <div className="pl-[60px] pr-3">
              <p className="hand text-lg leading-8">{t("khata.emptyBook")}</p>
              <EmptyPencil />
            </div>
          ) : (
            <ul>
              <AnimatePresence initial={false}>
                {rows.map((r) => (
                  <EntryRow key={r.id} r={r} nameOf={nameOf} seatOf={(id) => person(id)?.seat ?? 1} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} onStrike={() => strike(r)} onRetry={() => retry(r)} />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
        <AnimatePresence>{turning && <PageTurn calm={calm} />}</AnimatePresence>
      </section>

      <People people={people} me={g.me} onEdit={(p) => openSheet({ person: p })} onAdd={() => openSheet({ person: null })} canAdd={people.length < 20} t={t} />

      {g.role === "owner" && g.inviteCode && <Invite gid={gid} code={g.inviteCode} name={g.name} onCode={(code) => setG((x) => ({ ...x, inviteCode: code }))} onError={(text) => setToast({ key: Date.now(), text, error: true })} />}

      {g.role === "owner" && <Danger gid={gid} onGone={() => { router.push("/khata"); router.refresh(); }} onError={(text) => setToast({ key: Date.now(), text, error: true })} />}

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-xl gap-2 px-4 pb-4 pt-6" style={{ background: "linear-gradient(transparent, var(--bg) 35%)" }}>
        <Link href={`/?tiffin=${gid}`} className="tap press kot grid place-items-center rounded-md px-3 text-sm font-semibold">Naya bill</Link>
        <button type="button" onClick={() => openSheet("expense")} className="tap press flex flex-1 items-center justify-center gap-2 rounded-md bg-[#A61E1E] text-lg font-semibold text-[#F6EED9] shadow-lg">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 15 13 5l2 2L5 17H3zM11 7l2 2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {t("khata.addExpense")}
        </button>
      </div>

      <AnimatePresence>
        {toast && (
          <m.div key={toast.key} role={toast.error ? "alert" : "status"} initial={{ y: 60, opacity: 0, rotate: -2 }} animate={{ y: 0, opacity: 1, rotate: -1 }} exit={{ y: 60, opacity: 0 }} transition={snap} className={`fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-md items-center gap-3 overflow-hidden rounded-sm px-3 py-2 shadow-2xl ${toast.error ? "bg-[#A61E1E] text-[#F6EED9]" : "kot"}`}>
            <span className="hand flex-1 text-lg font-bold leading-snug">{toast.text}</span>
            {toast.undo && <button type="button" onClick={toast.undo} className="tap press rounded-md bg-[#1B1A17] px-3 font-semibold text-[#F6EED9]">{t("undo")}</button>}
            {!toast.error && <m.span className="absolute inset-x-0 bottom-0 h-1 origin-left bg-[#A61E1E]" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: 5, ease: "linear" }} />}
          </m.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sheet === "expense" && <ExpenseSheet key="exp" people={people} me={g.me} onClose={closeSheet} onSave={(e) => { add(e); closeSheet(); }} />}
        {sheet && sheet !== "expense" && <PersonSheet key="person" person={sheet.person} onClose={closeSheet} onSave={savePerson} />}
      </AnimatePresence>
    </main>
  );
}

function titleOf(r: Row, nameOf: (id: string) => string) {
  if (r.kind === "settlement") return `${nameOf(r.payerId)} → ${nameOf(r.shares[0]?.personId ?? "")}`;
  return r.description || (r.kind === "bill" ? "Bill" : "Kharcha");
}

/** The group name, written by hand; tap to correct it. */
function Title({ name, onSave }: { name: string; onSave: (n: string) => void }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  const cancel = useRef(false);
  useEffect(() => setV(name), [name]);
  useEffect(() => {
    if (edit) ref.current?.select();
  }, [edit]);
  // Enter and Escape both just blur; the one blur handler decides, so a save never runs twice
  const done = () => {
    if (!edit) return;
    setEdit(false);
    if (cancel.current) {
      cancel.current = false;
      setV(name);
      return;
    }
    onSave(v.trim().slice(0, 40));
  };
  return edit ? (
    <input ref={ref} value={v} maxLength={40} aria-label="Tiffin ka naam" onChange={(e) => setV(e.target.value)} onBlur={done} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { cancel.current = true; e.currentTarget.blur(); } }} className="display tap w-full border-b-2 border-current bg-transparent text-4xl outline-none" />
  ) : (
    <button type="button" onClick={() => setEdit(true)} className="display block max-w-full truncate text-left text-4xl leading-tight" aria-label={`${name}: naam badlo`}>
      {name}
    </button>
  );
}

/** A red thread pulled from the one who owes to the one who is owed. "Ho gaya" snaps it. */
function Thread({ i, from, to, amount, groupName, onDone }: { i: number; from?: Person; to?: Person; amount: number; groupName: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!from || !to) return null;
  const upi = to.vpa ? `upi://pay?pa=${encodeURIComponent(to.vpa)}&pn=${encodeURIComponent(to.name)}&am=${amountParam(amount)}&cu=INR&tn=${encodeURIComponent(`KhayaPiya ${groupName}`.slice(0, 40))}` : null;
  const ask = async () => {
    const text = `${to.name}, ${groupName} ka hisaab: ${from.name} tujhe ₹${amountParam(amount)} bhejega. Apna UPI ID bhej de.`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };
  const half = { gone: { rotate: 0, y: 26, opacity: 0, transition: { duration: 0.3, ease: "easeIn" as const } } };
  return (
    <m.li
      initial="hidden"
      animate="shown"
      exit="gone"
      variants={{ hidden: { opacity: 0, height: 0 }, shown: { opacity: 1, height: "auto", transition: { duration: 0.25, delay: i * 0.08 } }, gone: { opacity: 0, height: 0, transition: { when: "afterChildren", duration: 0.22 } } }}
      className="overflow-hidden"
    >
      <div className="relative flex items-center justify-between gap-1 pt-2">
        <span className="hand z-10 min-w-0 max-w-[34%] truncate rounded-sm bg-[#f7f0dc] pr-1 text-lg font-bold" style={{ color: paperInk(from.seat) }}>{from.name}</span>
        <svg className="pointer-events-none absolute inset-x-0 top-3 h-10 w-full" viewBox="0 0 300 40" preserveAspectRatio="none" aria-hidden="true">
          <m.g variants={{ gone: { ...half.gone, rotate: -16 } }} style={{ originX: 0, originY: 0.5 }}>
            <m.path d="M10 14 Q 80 34 150 22" fill="none" stroke="#C62020" strokeWidth="2.4" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, delay: 0.1 + i * 0.08, ease: "easeOut" }} />
          </m.g>
          <m.g variants={{ gone: { ...half.gone, rotate: 16 } }} style={{ originX: 1, originY: 0.5 }}>
            <m.path d="M150 22 Q 220 10 290 14" fill="none" stroke="#C62020" strokeWidth="2.4" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3, delay: 0.4 + i * 0.08, ease: "easeOut" }} />
          </m.g>
        </svg>
        <m.span variants={{ gone: { scale: 0.6, opacity: 0, transition: { duration: 0.2 } } }} className="z-10 inline-flex min-h-11 items-center rounded-full border-2 border-[#C62020] bg-[#fffaf0] px-3 text-base font-bold text-[#1B1A17] shadow">
          <Money p={amount} />
        </m.span>
        <span className="hand z-10 min-w-0 max-w-[34%] truncate rounded-sm bg-[#f7f0dc] pl-1 text-right text-lg font-bold" style={{ color: paperInk(to.seat) }}>{to.name}</span>
      </div>
      <div className="mt-1 flex gap-2 pb-2 text-sm font-semibold">
        {upi ? (
          <a href={upi} className="tap press grid flex-1 place-items-center rounded-md border-2 border-[#1B1A17] px-2 text-[#1B1A17]">{from.name.split(" ")[0]}: UPI se bhejo</a>
        ) : (
          <button type="button" onClick={ask} className="tap press flex-1 rounded-md border-2 border-dashed border-[#1B1A17] px-2 text-[#1B1A17]">{copied ? "Copy ho gaya, WhatsApp pe bhejo" : "UPI ID maango"}</button>
        )}
        <button type="button" onClick={onDone} className="tap press rounded-md bg-[#1D6B3E] px-4 text-[#F6EED9]">Ho gaya</button>
      </div>
    </m.li>
  );
}

function EntryRow({ r, nameOf, seatOf, open, onToggle, onStrike, onRetry }: { r: Row; nameOf: (id: string) => string; seatOf: (id: string) => number; open: boolean; onToggle: () => void; onStrike: () => void; onRetry: () => void }) {
  const struck = r.state === "struck";
  const sub =
    r.kind === "settlement" ? "hisaab barabar" : r.kind === "bill" ? `${nameOf(r.payerId)} ne bill bhara · ${r.shares.length} log${r.roomCode ? ` · room ${r.roomCode}` : ""}` : `${nameOf(r.payerId)} ne diye · ${r.shares.length} log`;
  return (
    <m.li layout initial={{ opacity: 0, x: -14 }} animate={{ opacity: struck ? 0.55 : 1, x: 0 }} exit={{ opacity: 0, height: 0 }} transition={soft} className="overflow-hidden">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2 pr-3 text-left hover:bg-[#1B1A170a]">
        <span className="mono ledger-row w-[46px] shrink-0 text-center text-[11px] text-[#A61E1E]">{fmtDate(r.createdAt)}</span>
        <span className="relative min-w-0 flex-1 pl-2">
          <span className="hand ledger-row block truncate text-lg font-bold">
            {r.kind === "bill" && <ReceiptGlyph />}
            {titleOf(r, nameOf)}
          </span>
          <span className="-mt-2 block truncate pb-1 text-xs opacity-70">{sub}</span>
          {struck && <m.span aria-hidden="true" className="absolute left-1 right-0 top-4 h-[2px] origin-left bg-[#A61E1E]" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.28 }} />}
        </span>
        <span className="ledger-row shrink-0 text-right">
          <Money p={r.total} className={`text-sm ${r.kind === "settlement" ? "text-[#1D6B3E]" : ""}`} />
          <span className="ml-1 inline-block size-2 rounded-full align-middle" title={r.state === "pending" ? "bhej raha hai" : r.state === "failed" ? "nahi gaya" : "saved"} style={{ background: r.state === "pending" ? "#999" : r.state === "failed" ? "#D62828" : "transparent" }} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && !struck && (
          <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden pl-[60px] pr-3">
            <ul className="text-sm">
              {r.shares.map((s) => (
                <li key={s.personId} className="flex justify-between leading-7">
                  <span className="hand text-base" style={{ color: paperInk(seatOf(s.personId)) }}>{nameOf(s.personId)} {r.kind === "settlement" ? "ko mila" : "ka hissa"}</span>
                  <Money p={s.owed} />
                </li>
              ))}
            </ul>
            {r.dishes && <p className="mt-1 text-xs opacity-70">{r.dishes}</p>}
            <div className="mt-1 flex gap-2 pb-2">
              {r.state === "failed" && <button type="button" onClick={onRetry} className="tap press rounded-md bg-[#1B1A17] px-3 text-sm font-semibold text-[#F6EED9]">Phir bhejo</button>}
              <button type="button" onClick={onStrike} className="tap press rounded-md border-2 border-[#A61E1E] px-3 text-sm font-semibold text-[#A61E1E]">Kaat do</button>
            </div>
          </m.div>
        )}
      </AnimatePresence>
      {r.state === "failed" && !open && (
        <p className="pb-1 pl-[60px] text-xs font-semibold text-[#A61E1E]">
          Nahi gaya. <button type="button" onClick={onRetry} className="tap underline">Phir bhejo</button>
        </p>
      )}
    </m.li>
  );
}

function ReceiptGlyph() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" className="mr-1 inline-block align-[-2px]" aria-label="restaurant bill">
      <path d="M2 1h10v14l-2-1.5L8 15l-1-1.5L6 15l-2-1.5L2 15z M4.5 5h5M4.5 8h5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function EmptyPencil() {
  return (
    <svg width="120" height="40" viewBox="0 0 120 40" className="mt-1 opacity-70" aria-hidden="true">
      <path d="M8 30q20-14 40-4t40-6" fill="none" stroke="#1B1A17" strokeWidth="1.5" strokeDasharray="3 4" strokeLinecap="round" />
      <g transform="rotate(-24 100 20)">
        <rect x="84" y="15" width="30" height="7" rx="1.5" fill="#F4B400" stroke="#1B1A17" strokeWidth="1.5" />
        <path d="M84 15l-7 3.5 7 3.5z" fill="#e8c98a" stroke="#1B1A17" strokeWidth="1.5" strokeLinejoin="round" />
        <rect x="110" y="15" width="4" height="7" fill="#D62828" stroke="#1B1A17" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

/** The last thread settled: the page lifts and turns over to a fresh ruled sheet (a fade in calm mode). */
function PageTurn({ calm }: { calm: boolean }) {
  return (
    <m.div className="pointer-events-none absolute inset-2 top-3 z-20" style={{ perspective: 1400 }} initial={{ opacity: 1 }} exit={{ opacity: 0 }} aria-hidden="true">
      {calm ? (
        <m.div className="ledger absolute inset-0 rounded-sm" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 0.5 }} />
      ) : (
        <m.div
          className="ledger absolute inset-0 rounded-sm shadow-2xl"
          style={{ transformOrigin: "left center", backfaceVisibility: "hidden" }}
          initial={{ rotateY: 0 }}
          animate={{ rotateY: -178, boxShadow: ["0 0 0 rgba(0,0,0,0)", "30px 0 60px rgba(0,0,0,.45)", "0 0 0 rgba(0,0,0,0)"] }}
          transition={{ duration: 1.05, ease: [0.65, 0, 0.35, 1] }}
        >
          <div className="absolute inset-0 bg-gradient-to-l from-black/25 to-transparent" />
        </m.div>
      )}
    </m.div>
  );
}

function People({ people, me, onEdit, onAdd, canAdd, t }: { people: Person[]; me: string | null; onEdit: (p: Person) => void; onAdd: () => void; canAdd: boolean; t: (k: "khata.people" | "khata.addPerson") => string }) {
  return (
    <section className="kot mt-6 rounded-sm p-3 shadow-lg" style={{ transform: "rotate(-0.6deg)" }}>
      <h2 className="display text-2xl">{t("khata.people")}</h2>
      <ul className="mt-2 grid grid-cols-2 gap-2">
        {people.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onEdit(p)} className="tap press flex w-full items-center gap-2 rounded-md border border-[#1B1A1740] px-2 py-1 text-left">
              <Pattern seat={p.seat} size={20} />
              <span className="min-w-0 flex-1">
                <span className="hand block truncate text-lg font-bold leading-tight" style={{ color: paperInk(p.seat) }}>{p.name}{p.id === me ? " (tu)" : ""}</span>
                <span className="mono block truncate text-[10px] opacity-70">{p.vpa ?? "UPI ID nahi"}{p.userId && p.id !== me ? " · khate mein" : ""}</span>
              </span>
            </button>
          </li>
        ))}
        {canAdd && (
          <li>
            <button type="button" onClick={onAdd} className="tap press hand h-full w-full rounded-md border-2 border-dashed border-[#1B1A1760] text-lg font-bold text-[#A61E1E]">{t("khata.addPerson")}</button>
          </li>
        )}
      </ul>
    </section>
  );
}

function Invite({ gid, code, name, onCode, onError }: { gid: string; code: string; name: string; onCode: (c: string) => void; onError: (t: string) => void }) {
  const { t } = usePrefs();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const link = `${origin}/g/${code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const rotate = async () => {
    setBusy(true);
    try {
      onCode((await api<{ code: string }>(`/api/groups/${gid}/invite`, "POST", {})).code);
    } catch (e) {
      onError((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <section className="mt-6 rounded-sm border-2 border-dashed border-current p-3">
      <h2 className="hand text-xl font-bold">{t("khata.invite")}</h2>
      <p className="text-sm opacity-80">Link se aane wala apna passkey banata hai aur is khate mein likh sakta hai.</p>
      <p className="mono mt-2 truncate rounded bg-[#00000010] px-2 py-2 text-xs">{origin ? link : `/g/${code}`}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-sm font-semibold">
        <button type="button" onClick={copy} className="tap press rounded-md border border-current px-3">{copied ? "Copy ho gaya" : "Link copy karo"}</button>
        <a href={`https://wa.me/?text=${encodeURIComponent(`${name} ke khate mein aa ja: ${link}`)}`} target="_blank" rel="noopener" className="tap press grid place-items-center rounded-md border border-current px-3">WhatsApp</a>
        <button type="button" disabled={busy} onClick={rotate} className="tap press rounded-md border border-current px-3 disabled:opacity-50" title="Purana link band ho jayega">{busy ? "..." : t("khata.newLink")}</button>
      </div>
    </section>
  );
}

function Danger({ gid, onGone, onError }: { gid: string; onGone: () => void; onError: (t: string) => void }) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await api(`/api/groups/${gid}`, "DELETE");
      onGone();
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <section className="mt-6 text-sm">
      {!sure ? (
        <button type="button" onClick={() => setSure(true)} className="tap press rounded-md px-1 font-semibold underline underline-offset-4 opacity-80">Tiffin shelf se hatao</button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Pakka? Saara hisaab mit jayega, wapas nahi aayega.</span>
          <button type="button" disabled={busy} onClick={go} className="tap press rounded-md bg-[#A61E1E] px-3 font-semibold text-[#F6EED9] disabled:opacity-50">{busy ? "..." : "Haan, hatao"}</button>
          <button type="button" onClick={() => setSure(false)} className="tap press rounded-md border border-current px-3">Nahi</button>
        </div>
      )}
    </section>
  );
}

/* --------------------------- Kharcha jodo --------------------------- */
function ExpenseSheet({ people, me, onClose, onSave }: { people: Person[]; me: string | null; onClose: () => void; onSave: (e: NewEntry) => void }) {
  const { t } = usePrefs();
  const [desc, setDesc] = useState("");
  const [amt, setAmt] = useState("");
  const [payer, setPayer] = useState(me ?? people[0]?.id ?? "");
  const [picked, setPicked] = useState<string[]>(people.map((p) => p.id));
  const [mode, setMode] = useState<SplitMode>("equal");
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [exact, setExact] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    first.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  const total = toPaise(amt) ?? 0;
  const chosen = people.filter((p) => picked.includes(p.id));
  const split = splitExpense(total, chosen.map((p) => ({ id: p.id, seat: p.seat, weight: weights[p.id] ?? 1, amount: toPaise(exact[p.id] ?? "") ?? 0 })), mode);
  const shareOf = (id: string) => split.shares.find((s) => s.personId === id)?.owed ?? 0;
  const problem = !total ? "Kitne diye? Rakam likho." : split.error;
  const save = () => {
    setTried(true);
    if (problem || !payer) return;
    onSave({ kind: "expense", payerId: payer, description: desc.trim().slice(0, 80) || "Kharcha", total, shares: split.shares });
  };
  const toggle = (id: string) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  return (
    <m.div className="fixed inset-0 z-50 flex items-end bg-[#0008]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <m.div role="dialog" aria-modal="true" aria-label={t("khata.addExpense")} className="ledger mx-auto max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl pb-6 pr-4 pt-3" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={soft} onClick={(e) => e.stopPropagation()}>
        <h2 className="display ledger-row pl-[60px] text-3xl">{t("khata.addExpense")}</h2>
        <label className="mt-2 block pl-[60px] text-sm font-semibold">{t("khata.what")}
          <input ref={first} value={desc} maxLength={80} placeholder="Kirana, bijli ka bill, cab..." onChange={(e) => setDesc(e.target.value)} className="tap hand block h-10 w-full border-b-2 border-[#1B1A17] bg-transparent text-xl outline-none" />
        </label>
        <label className="mt-2 block pl-[60px] text-sm font-semibold">{t("khata.amount")}
          <span className="flex items-center gap-1 border-b-2 border-[#1B1A17]">
            <span className="rupee text-2xl">₹</span>
            <input inputMode="decimal" value={amt} placeholder="0.00" onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, "").slice(0, 10))} onKeyDown={(e) => e.key === "Enter" && save()} className="tap mono h-11 w-full bg-transparent text-2xl outline-none" />
          </span>
        </label>

        <p className="ledger-row mt-3 pl-[60px] text-sm font-semibold">{t("khata.whoPaid")}</p>
        <div className="flex flex-wrap gap-2 pl-[60px]" role="radiogroup" aria-label={t("khata.whoPaid")}>
          {people.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={payer === p.id} onClick={() => setPayer(p.id)} className={`tap press flex items-center gap-1 rounded-full border-2 px-3 ${payer === p.id ? "border-[#1B1A17] bg-[#1B1A17] text-[#F6EED9]" : "border-[#1B1A1760]"}`}>
              <Pattern seat={p.seat} size={16} /> <span className="hand text-lg">{p.name}</span>
            </button>
          ))}
        </div>

        <p className="ledger-row mt-3 pl-[60px] text-sm font-semibold">{t("khata.forWhom")}</p>
        <div className="flex flex-wrap gap-2 pl-[60px]" role="tablist" aria-label="Kaise baante">
          {(["equal", "shares", "exact"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={`tap press rounded-md border-b-4 px-3 text-sm font-bold ${mode === k ? "border-[#A61E1E] text-[#A61E1E]" : "border-transparent opacity-70"}`}>
              {k === "equal" ? t("khata.equal") : k === "shares" ? t("khata.shares") : t("khata.exact")}
            </button>
          ))}
        </div>
        <ul className="mt-1 pl-[54px]">
          {people.map((p) => {
            const on = picked.includes(p.id);
            return (
              <li key={p.id} className="flex min-h-11 items-center gap-2">
                <label className="tap flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={on} onChange={() => toggle(p.id)} className="size-5 accent-[#A61E1E]" />
                  <span className="hand truncate text-lg" style={{ color: paperInk(p.seat) }}>{p.name}</span>
                </label>
                {on && mode === "shares" && (
                  <span className="flex items-center gap-1">
                    <button type="button" aria-label={`${p.name} ka hissa kam`} className="tap press rounded border border-[#1B1A17]" onClick={() => setWeights((w) => ({ ...w, [p.id]: Math.max(1, (w[p.id] ?? 1) - 1) }))}>−</button>
                    <span className="mono w-5 text-center">{weights[p.id] ?? 1}</span>
                    <button type="button" aria-label={`${p.name} ka hissa zyada`} className="tap press rounded border border-[#1B1A17]" onClick={() => setWeights((w) => ({ ...w, [p.id]: Math.min(12, (w[p.id] ?? 1) + 1) }))}>+</button>
                  </span>
                )}
                {on && mode === "exact" ? (
                  <span className="flex items-center border-b border-[#1B1A17]">
                    <span className="rupee">₹</span>
                    <input inputMode="decimal" aria-label={`${p.name} ki rakam`} value={exact[p.id] ?? ""} placeholder="0.00" onChange={(e) => setExact((x) => ({ ...x, [p.id]: e.target.value.replace(/[^\d.]/g, "").slice(0, 10) }))} className="tap mono w-20 bg-transparent text-right outline-none" />
                  </span>
                ) : (
                  on && <Money p={shareOf(p.id)} className="w-24 text-right text-sm" />
                )}
              </li>
            );
          })}
        </ul>
        {(tried || mode === "exact") && problem && total > 0 && <p role="alert" className="mt-2 pl-[60px] text-sm font-semibold text-[#A61E1E]">{problem}</p>}
        {tried && !total && <p role="alert" className="mt-2 pl-[60px] text-sm font-semibold text-[#A61E1E]">{problem}</p>}
        <div className="mt-4 flex gap-2 pl-[60px]">
          <button type="button" onClick={onClose} className="tap press rounded-md border border-[#1B1A17] px-4 font-semibold">{t("pay.no")}</button>
          <button type="button" onClick={save} className="tap press flex-1 rounded-md bg-[#A61E1E] text-lg font-semibold text-[#F6EED9]">{t("khata.save")}</button>
        </div>
      </m.div>
    </m.div>
  );
}

function PersonSheet({ person, onClose, onSave }: { person: Person | null; onClose: () => void; onSave: (p: { id?: string; name: string; vpa: string | null }) => Promise<string | null> }) {
  const [name, setName] = useState(person?.name ?? "");
  const [vpa, setVpa] = useState(person?.vpa ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  const save = async () => {
    if (!name.trim()) return setErr("Naam likho.");
    setBusy(true);
    const e = await onSave({ id: person?.id, name: name.trim().slice(0, 24), vpa: vpa.trim() || null });
    setBusy(false);
    if (e) return setErr(e);
    onClose();
  };
  return (
    <m.div className="fixed inset-0 z-50 flex items-end bg-[#0008]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <m.div role="dialog" aria-modal="true" aria-label={person ? "Naam badlo" : "Naya naam"} className="pad mx-auto w-full max-w-xl rounded-t-2xl px-5 pb-6 pt-3" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={soft} onClick={(e) => e.stopPropagation()}>
        <p className="display flex h-[54px] items-end pb-2 text-2xl text-[#A61E1E]">{person ? person.name : "Naya naam"}</p>
        <label className="mt-4 block text-sm font-semibold">Naam
          <input ref={first} value={name} maxLength={24} onChange={(e) => setName(e.target.value)} className="tap hand block h-10 w-full border-b-2 border-[#1B1A17] bg-transparent text-2xl outline-none" />
        </label>
        <label className="mt-3 block text-sm font-semibold">UPI ID (optional)
          <input value={vpa} placeholder="naam@okicici" onChange={(e) => setVpa(e.target.value.trim())} onKeyDown={(e) => e.key === "Enter" && save()} className="tap mono block h-10 w-full border-b-2 border-[#1B1A17] bg-transparent text-sm outline-none" />
        </label>
        <p className="mt-1 text-xs opacity-70">UPI ID ho to hisaab barabar karte waqt seedha UPI app khulega.</p>
        {err && <p role="alert" className="mt-2 text-sm font-semibold text-[#A61E1E]">{err}</p>}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="tap press rounded-md border border-[#1B1A17] px-4 font-semibold">Abhi nahi</button>
          <button type="button" disabled={busy} onClick={save} className="tap press flex-1 rounded-md bg-[#1B1A17] text-lg font-semibold text-[#F6EED9] disabled:opacity-60">{busy ? "..." : "Likh do"}</button>
        </div>
      </m.div>
    </m.div>
  );
}
