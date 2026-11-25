"use client";
import { AnimatePresence, m } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, fmtDate } from "@/lib/client";
import { Money } from "../art";
import { usePrefs } from "../Prefs";
import { Bookmark, StepIcon, Tiffin, tiffinInk } from "./art";

const snap = { type: "spring", stiffness: 520, damping: 34 } as const;
const soft = { type: "spring", stiffness: 380, damping: 38 } as const;
export type GroupKind = "flat" | "lunch" | "trip" | "other";
export const KIND_LABEL: Record<GroupKind, string> = { flat: "Flat", lunch: "Lunch gang", trip: "Trip", other: "Aur kuch" };

export interface GroupCard { id: string; name: string; kind: GroupKind; role: "owner" | "editor"; people: number; entries: number; myNet: number | null; lastAt: string | null; pending?: boolean }
interface HistRoom { code: string; restaurant: string; createdAt: string; status: string; total: number; dishes: string; demo: boolean }
interface HistBill { id: string; groupId: string; groupName: string; description: string; createdAt: string; total: number; dishes: string; roomCode: string | null }
export interface History { rooms: HistRoom[]; bills: HistBill[] }

export function KhataHome({ user, groups: initial, history: firstHistory }: { user: { name: string; vpa: string | null }; groups: GroupCard[]; history: History }) {
  const { t } = usePrefs();
  const [groups, setGroups] = useState(initial);
  const [making, setMaking] = useState(false);
  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 pb-24 pt-4">
      <header className="flex items-center justify-between">
        <Link href="/" className="tap press inline-flex items-center gap-1 text-sm font-semibold">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          Counter
        </Link>
        <Profile user={user} />
      </header>
      <h1 className="display mt-2 text-5xl">{t("khata.title")}</h1>
      <p className="mt-1 text-base leading-snug opacity-85">{t("khata.sub")}</p>

      <HowItWorks initiallyOpen={groups.length === 0} />

      {/* the shelf of tiffin carriers, one per recurring group */}
      <section aria-labelledby="kp-shelf" className="relative mt-6">
        <h2 id="kp-shelf" className="display text-2xl">{t("khata.shelf")}</h2>
        <ul className="flex gap-3 overflow-x-auto px-1 pb-1 pt-2">
          <AnimatePresence initial={false}>
            {groups.map((g) => (
              <m.li key={g.id} layout initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: g.pending ? 0.6 : 1 }} transition={{ type: "spring", stiffness: 420, damping: 32 }} className="shrink-0">
                <Link href={g.pending ? "#" : `/khata/${g.id}`} aria-disabled={g.pending} className="press group flex w-28 flex-col items-center">
                  <Tiffin n={tiffinInk(g.id)} tiers={g.kind === "trip" ? 2 : g.kind === "lunch" ? 4 : 3} />
                  {/* jute string and a paper tag */}
                  <span className="kot -mt-1 w-full -rotate-2 rounded-sm px-2 py-1 text-center shadow-md">
                    <span className="hand block truncate text-lg font-bold leading-tight">{g.name}</span>
                    <span className="block text-[11px] opacity-70">{KIND_LABEL[g.kind]} · {g.people} {t("khata.ppl")}</span>
                    {g.myNet != null && g.myNet !== 0 && (
                      <span className={`block text-sm font-semibold leading-tight ${g.myNet > 0 ? "text-[#1D6B3E]" : "text-[#A61E1E]"}`}>
                        <Money p={g.myNet} sign />
                        <span className="block text-[11px] font-normal">{g.myNet > 0 ? t("khata.youGet") : t("khata.youOwe")}</span>
                      </span>
                    )}
                    {g.myNet === 0 && g.entries > 0 && <span className="block text-sm font-semibold text-[#2C6B5E]">{t("khata.even")}</span>}
                  </span>
                </Link>
              </m.li>
            ))}
          </AnimatePresence>
          <li className="shrink-0">
            <button type="button" onClick={() => setMaking(true)} className="tap press flex w-28 flex-col items-center opacity-80">
              <Tiffin n={groups.length + 1} ghost />
              <span className="hand mt-1 text-lg font-bold">+ {t("khata.newTiffin")}</span>
            </button>
          </li>
        </ul>
        <div className="teak h-4 rounded shadow-md" />
        <div className="mx-3 h-2 rounded-b bg-[#5b3b22]" />
        {groups.length === 0 && (
          <div className="mt-3">
            <p className="text-base leading-snug">{t("khata.emptyShelf")}</p>
            <button type="button" onClick={() => setMaking(true)} className="tap press mt-3 w-full rounded-md bg-[var(--stamp-red-deep)] text-lg font-semibold text-[#F6EED9] shadow">{t("khata.firstGroup")}</button>
          </div>
        )}
      </section>

      <HistoryBook first={firstHistory} />

      <AnimatePresence>
        {making && (
          <NewTiffin
            n={groups.length + 1}
            onClose={() => setMaking(false)}
            onPending={(g) => setGroups((x) => [g, ...x])}
            onFailed={(id) => setGroups((x) => x.filter((g) => g.id !== id))}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

function Profile({ user }: { user: { name: string; vpa: string | null } }) {
  const { t } = usePrefs();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(user.name);
  const [vpa, setVpa] = useState(user.vpa ?? "");
  const [msg, setMsg] = useState("");
  const save = async () => {
    setMsg("");
    try {
      await api("/api/me", "PATCH", { name: name.trim() || undefined, vpa: vpa.trim() || null });
      setMsg("Likh liya.");
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const out = async () => {
    await api("/api/auth/logout", "POST", {}).catch(() => {});
    router.refresh();
  };
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="tap press hand rounded-full border border-current px-3 text-lg font-bold">{user.name}</button>
      <AnimatePresence>
        {open && (
          <m.div initial={{ y: -8, opacity: 0, rotate: 0 }} animate={{ y: 0, opacity: 1, rotate: 1.5 }} exit={{ opacity: 0, y: -8 }} transition={snap} className="kot absolute right-0 z-40 mt-2 w-72 rounded-sm p-3 shadow-xl">
            <label className="block text-sm font-semibold">{t("login.name")}
              <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="tap hand mt-1 w-full border-b-2 border-[#1B1A17] bg-transparent text-xl outline-none" />
            </label>
            <label className="mt-2 block text-sm font-semibold">{t("room.vpa")}
              <input value={vpa} onChange={(e) => setVpa(e.target.value.trim())} placeholder="naam@okicici" className="tap mono mt-1 w-full border-b-2 border-[#1B1A17] bg-transparent text-sm outline-none" />
            </label>
            <p className="mt-1 text-xs leading-snug opacity-75">UPI ID ho to dost seedha tujhe bhej payenge.</p>
            {msg && <p role="status" className="mt-1 text-sm">{msg}</p>}
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={save} className="tap press flex-1 rounded-md bg-[var(--chutney-deep)] font-semibold text-white">{t("khata.save")}</button>
              <button type="button" onClick={out} className="tap press rounded-md border border-[#1B1A17] px-3 text-sm font-semibold">{t("login.logout")}</button>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HistoryBook({ first }: { first: History }) {
  const { t } = usePrefs();
  const [q, setQ] = useState("");
  const [h, setH] = useState(first);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (!q.trim()) {
      setH(first);
      setLoading(false);
      return;
    }
    const n = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await api<History>(`/api/me/history?q=${encodeURIComponent(q.trim())}`);
        if (n === seq.current) setH(r);
      } catch {}
      if (n === seq.current) setLoading(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [q, first]);

  const rows = [
    ...h.rooms.map((r) => ({ key: `r${r.code}`, at: r.createdAt, title: r.restaurant || "Bill", sub: r.dishes, total: r.total, href: `/r/${r.code}`, tag: r.demo ? "demo" : r.status === "final" ? "pakka" : r.status === "closed" ? "band" : "khula" })),
    ...h.bills.filter((b) => !h.rooms.some((r) => r.code === b.roomCode)).map((b) => ({ key: `b${b.id}`, at: b.createdAt, title: b.description || "Kharcha", sub: b.dishes || b.groupName, total: b.total, href: `/khata/${b.groupId}`, tag: b.groupName })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section className="cloth relative mt-8 rounded-md p-2 pt-3 shadow-xl">
      <Bookmark className="absolute -top-1 right-8 z-10" />
      <div className="ledger rounded-sm pb-4 pt-2">
        <h2 className="display ledger-row pl-[60px] pr-3 text-2xl">{t("khata.history")}</h2>
        <div className="ledger-row pl-[60px] pr-3">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("khata.search")} aria-label={t("khata.search")} className="tap hand h-8 w-full border-b border-dashed border-[#1B1A1780] bg-transparent text-lg outline-none" />
        </div>
        {loading && rows.length === 0 ? (
          <ul aria-busy="true">{[0, 1, 2].map((i) => <li key={i} className="ledger-row flex items-center gap-3 pl-2 pr-3"><span className="ph h-3 w-8" /><span className="ph ml-4 h-3 flex-1" /><span className="ph h-3 w-14" /></li>)}</ul>
        ) : rows.length === 0 ? (
          <p className="hand px-3 pl-[60px] text-lg leading-8">{q ? t("khata.noMatch") : t("khata.noHistory")}</p>
        ) : (
          <ul className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {rows.map((r) => (
              <li key={r.key}>
                <Link href={r.href} className="flex items-start gap-2 pr-3 hover:bg-[#1B1A170a]">
                  <span className="mono ledger-row w-[46px] shrink-0 text-center text-[11px] text-[var(--stamp-red-deep)]">{fmtDate(r.at)}</span>
                  <span className="min-w-0 flex-1 pl-2">
                    <span className="hand ledger-row block truncate text-lg font-bold">{r.title}</span>
                    {r.sub && <span className="-mt-2 block truncate pb-1 text-xs opacity-70">{r.sub}</span>}
                  </span>
                  <span className="ledger-row shrink-0 text-right"><Money p={r.total} className="text-sm" /></span>
                  <span className="ledger-row hidden shrink-0 text-[10px] uppercase opacity-60 sm:block">{r.tag}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function NewTiffin({ n, onClose, onPending, onFailed }: { n: number; onClose: () => void; onPending: (g: GroupCard) => void; onFailed: (id: string) => void }) {
  const { t } = usePrefs();
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<GroupKind>("flat");
  const [people, setPeople] = useState<{ name: string; vpa: string }[]>([{ name: "", vpa: "" }]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => firstRef.current?.focus(), []);
  const save = async () => {
    if (!name.trim()) return setErr(`${t("khata.groupName")}? ${t("khata.groupHint")}.`);
    const list = people.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim().slice(0, 24), vpa: p.vpa.trim() || null }));
    setBusy(true);
    setErr("");
    const temp = `pending-${Date.now()}`;
    onPending({ id: temp, name: name.trim(), kind, role: "owner", people: list.length + 1, entries: 0, myNet: null, lastAt: null, pending: true });
    try {
      const r = await api<{ id: string }>("/api/groups", "POST", { name: name.trim(), kind, people: list });
      router.push(`/khata/${r.id}`);
    } catch (e) {
      onFailed(temp);
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <m.div className="fixed inset-0 z-50 flex items-end bg-[#0008]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <m.div role="dialog" aria-modal="true" aria-label={t("khata.newTiffin")} className="ledger mx-auto max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl pb-6 pr-4 pt-3" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={soft} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 pl-3">
          <Tiffin n={n} size={56} tiers={kind === "trip" ? 2 : kind === "lunch" ? 4 : 3} />
          <div className="flex-1 pl-2">
            <h2 className="display text-3xl">{t("khata.newTiffin")}</h2>
            <label htmlFor="kp-gname" className="mt-1 block text-sm font-semibold">{t("khata.groupName")}</label>
            <input id="kp-gname" ref={firstRef} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Flat 302" className="tap hand h-9 w-full border-b-2 border-[#1B1A17] bg-transparent text-2xl outline-none" />
            <p className="mt-1 text-xs opacity-70">{t("khata.groupHint")}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 pl-[60px]">
          {(Object.keys(KIND_LABEL) as GroupKind[]).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`tap press rounded-full border-2 px-3 text-sm font-semibold ${kind === k ? "border-[var(--stamp-red-deep)] bg-[var(--stamp-red-deep)] text-[#F6EED9]" : "border-[#1B1A17]"}`}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        <p className="ledger-row mt-3 pl-[60px] text-sm font-semibold">{t("khata.whoElse")}</p>
        <ul className="pl-[60px]">
          {people.map((p, i) => (
            <li key={i} className="flex gap-2">
              <input value={p.name} maxLength={24} placeholder={`Dost ${i + 1}`} aria-label={`Dost ${i + 1} ka naam`} onChange={(e) => setPeople((x) => x.map((y, k) => (k === i ? { ...y, name: e.target.value } : y)))} onKeyDown={(e) => { if (e.key === "Enter" && p.name.trim() && i === people.length - 1 && people.length < 19) setPeople((x) => [...x, { name: "", vpa: "" }]); }} className="tap hand h-10 min-w-0 flex-1 border-b border-[#1B1A1760] bg-transparent text-xl outline-none" />
              <input value={p.vpa} placeholder="UPI (optional)" aria-label={`Dost ${i + 1} ka UPI ID`} onChange={(e) => setPeople((x) => x.map((y, k) => (k === i ? { ...y, vpa: e.target.value } : y)))} className="tap mono h-10 w-32 border-b border-[#1B1A1760] bg-transparent text-xs outline-none" />
            </li>
          ))}
        </ul>
        {people.length < 19 && (
          <button type="button" onClick={() => setPeople((x) => [...x, { name: "", vpa: "" }])} className="tap press hand ml-[60px] mt-1 text-lg font-bold text-[var(--stamp-red-deep)]">{t("khata.addPerson")}</button>
        )}
        {err && <p role="alert" className="mt-2 pl-[60px] text-sm font-semibold text-[var(--stamp-red-deep)]">{err}</p>}
        <div className="mt-4 flex gap-2 pl-[60px]">
          <button type="button" onClick={onClose} className="tap press rounded-md border border-[#1B1A17] px-4 font-semibold">{t("pay.no")}</button>
          <button type="button" disabled={busy} onClick={save} className="tap press flex-1 rounded-md bg-[var(--stamp-red-deep)] text-lg font-semibold text-[#F6EED9] disabled:opacity-60">{busy ? "..." : t("khata.create")}</button>
        </div>
      </m.div>
    </m.div>
  );
}

/** Three plain steps for anyone opening the khata for the first time. Open when there is nothing on the shelf yet. */
export function HowItWorks({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const { t } = usePrefs();
  const [open, setOpen] = useState(initiallyOpen);
  const steps = [
    ["khata.step1", "tiffin"],
    ["khata.step2", "pencil"],
    ["khata.step3", "thread"],
  ] as const;
  return (
    <section className="kot mt-4 rounded-sm px-3 pb-1 pt-1 shadow-md" style={{ transform: "rotate(-0.4deg)" }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="tap flex w-full items-center justify-between gap-2 text-left">
        <span className="display text-xl">{t("khata.how")}</span>
        <m.svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" animate={{ rotate: open ? 180 : 0 }} transition={snap}>
          <path d="M4 7l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </m.svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.ol key="steps" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
            {steps.map(([k, icon], i) => (
              <m.li key={k} initial={{ x: -10, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.05 + i * 0.07, duration: 0.2 }} className="flex items-start gap-3 border-t border-dashed border-[#1B1A1733] py-2">
                <span className="relative grid size-11 shrink-0 place-items-center">
                  <StepIcon kind={icon} />
                  <span className="absolute -left-1 -top-1 grid size-5 place-items-center rounded-full bg-[#A61E1E] text-xs font-bold text-[#F6EED9]">{i + 1}</span>
                </span>
                <p className="pt-0.5 text-base leading-snug">{t(k)}</p>
              </m.li>
            ))}
          </m.ol>
        )}
      </AnimatePresence>
    </section>
  );
}
