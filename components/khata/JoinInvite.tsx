"use client";
import { m } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { Pattern } from "../art";

/** Signed in with an invite link: pick the name already written for you in the khata, or join as yourself. */
export function JoinInvite({ code, seats, me }: { code: string; seats: { id: string; name: string; seat: number }[]; me: string }) {
  const router = useRouter();
  const guess = seats.find((s) => s.name.trim().toLowerCase() === me.trim().toLowerCase())?.id ?? null;
  const [pick, setPick] = useState<string | null>(guess);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const join = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ id: string }>("/api/groups/join", "POST", { code, personId: pick });
      router.push(`/khata/${r.id}`);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <m.section initial={{ y: 24, opacity: 0, rotate: 0 }} animate={{ y: 0, opacity: 1, rotate: -0.8 }} transition={{ type: "spring", stiffness: 420, damping: 32 }} className="ledger mt-5 rounded-sm pb-5 pr-4 pt-2 shadow-xl">
      <p className="display ledger-row pl-[60px] text-2xl">Khate mein tera naam</p>
      {seats.length > 0 && <p className="ledger-row pl-[60px] text-sm">Kya inme se koi tu hai?</p>}
      <div className="flex flex-wrap gap-2 pl-[60px]" role="radiogroup" aria-label="Khate mein tera naam">
        {seats.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={pick === s.id} onClick={() => setPick(s.id)} className={`tap press flex items-center gap-1 rounded-full border-2 px-3 ${pick === s.id ? "border-[#1B1A17] bg-[#1B1A17] text-[#F6EED9]" : "border-[#1B1A1760]"}`}>
            <Pattern seat={s.seat} size={16} /> <span className="hand text-lg">{s.name}</span>
          </button>
        ))}
        <button type="button" role="radio" aria-checked={pick === null} onClick={() => setPick(null)} className={`tap press rounded-full border-2 px-3 ${pick === null ? "border-[#1B1A17] bg-[#1B1A17] text-[#F6EED9]" : "border-dashed border-[#1B1A1760]"}`}>
          <span className="hand text-lg">Naya naam: {me}</span>
        </button>
      </div>
      {err && <p role="alert" className="mt-2 pl-[60px] text-sm font-semibold text-[#A61E1E]">{err}</p>}
      <div className="mt-4 pl-[60px]">
        <button type="button" disabled={busy} onClick={join} className="tap press w-full rounded-md bg-[#A61E1E] text-lg font-semibold text-[#F6EED9] disabled:opacity-60">{busy ? "Likh raha hai..." : "Khate mein aao"}</button>
      </div>
    </m.section>
  );
}
