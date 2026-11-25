"use client";
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { AnimatePresence, m } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { usePrefs } from "../Prefs";
import { Spiral, Thumb } from "./art";

const snap = { type: "spring", stiffness: 520, damping: 34 } as const;

/** The waiter's order pad: passkey sign-up and sign-in. Nothing here is required to split a bill. */
export function OrderPad({ next = "/khata", compact = false }: { next?: string; compact?: boolean }) {
  const { t } = usePrefs();
  const router = useRouter();
  const [tab, setTab] = useState<"new" | "back">("new");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(true);
  const [stamped, setStamped] = useState(false);
  useEffect(() => setOk(browserSupportsWebAuthn()), []);

  const finish = () => {
    setStamped(true);
    setTimeout(() => {
      router.replace(next);
      router.refresh();
    }, 520);
  };
  const explain = (e: unknown) => {
    const n = (e as { name?: string })?.name;
    if (n === "NotAllowedError" || n === "AbortError") return "Ruk gaya. Jab taiyaar ho, phir dabao.";
    if (n === "InvalidStateError") return "Is phone pe passkey pehle se hai. 'Wapas aaye?' se andar aao.";
    if (e instanceof ApiError) return e.message;
    return "Passkey nahi chala. Ek baar phir try karo.";
  };
  const create = async () => {
    if (!name.trim()) return setErr("Pehle apna naam likho.");
    setBusy(true);
    setErr("");
    try {
      const options = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/api/auth/passkey/register/options", "POST", { name: name.trim() });
      const resp = await startRegistration({ optionsJSON: options });
      await api("/api/auth/passkey/register/verify", "POST", resp);
      finish();
    } catch (e) {
      setErr(explain(e));
      setBusy(false);
    }
  };
  const signin = async () => {
    setBusy(true);
    setErr("");
    try {
      const options = await api<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/auth/passkey/login/options", "POST", {});
      const resp = await startAuthentication({ optionsJSON: options });
      await api("/api/auth/passkey/login/verify", "POST", resp);
      finish();
    } catch (e) {
      setErr(explain(e));
      setBusy(false);
    }
  };

  return (
    <div className={`relative mx-auto w-full max-w-sm ${compact ? "" : "mt-4"}`}>
      {/* the carbon copy peeking out underneath */}
      <div className="absolute inset-x-2 -bottom-2 top-3 rotate-[1.5deg] rounded-sm bg-[#cfd9e6] shadow" aria-hidden="true" />
      <div className="pad relative rounded-sm px-4 pb-5 shadow-xl">
        <div className="-mx-4 bg-[#e7e2d4] px-2 pt-1"><Spiral /></div>
        <div className="flex h-[58px] items-end justify-between pb-2">
          <p className="display text-2xl text-[var(--stamp-red-deep)]">{t("login.title")}</p>
          <p className="mono text-xs opacity-70">No. {String(new Date().getDate()).padStart(2, "0")}07</p>
        </div>
        <div role="tablist" className="mt-3 grid grid-cols-2 gap-2">
          {(["new", "back"] as const).map((k) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => { setTab(k); setErr(""); }} className={`tap press hand rounded-t-md border-b-4 text-lg font-bold ${tab === k ? "border-[var(--stamp-red-deep)] text-[var(--stamp-red-deep)]" : "border-transparent opacity-60"}`}>
              {k === "new" ? t("login.new") : t("login.back")}
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <m.div key={tab} initial={{ opacity: 0, x: tab === "new" ? -16 : 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            {tab === "new" ? (
              <div className="mt-3">
                <label htmlFor="kp-name" className="text-sm font-semibold">{t("login.name")}</label>
                <input id="kp-name" value={name} maxLength={40} autoComplete="nickname" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} className="tap hand mt-1 h-9 w-full border-b-2 border-[#1B1A17] bg-transparent text-2xl outline-none" />
                <button type="button" disabled={busy || !ok} onClick={create} className="tap press mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-[var(--stamp-red-deep)] text-lg font-semibold text-[#F6EED9] disabled:opacity-50">
                  <Thumb /> {busy ? "..." : t("login.create")}
                </button>
              </div>
            ) : (
              <div className="mt-3">
                <p className="hand text-lg leading-8">Isi phone pe jo passkey banaya tha, wahi kaam karega.</p>
                <button type="button" disabled={busy || !ok} onClick={signin} className="tap press mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-[#1B1A17] text-lg font-semibold text-[#F6EED9] disabled:opacity-50">
                  <Thumb /> {busy ? "..." : t("login.signin")}
                </button>
              </div>
            )}
          </m.div>
        </AnimatePresence>
        {!ok && <p role="alert" className="mt-3 text-sm font-semibold text-[var(--stamp-red-deep)]">Ye browser passkey nahi jaanta. Chrome ya Safari ka naya version try karo.</p>}
        {err && <p role="alert" className="mt-3 text-sm font-semibold text-[var(--stamp-red-deep)]">{err}</p>}
        <p className="mt-4 text-sm leading-snug">{t("login.what")}</p>
        {!compact && <p className="mt-2 text-sm leading-snug opacity-75">{t("login.why")}</p>}
        <AnimatePresence>
          {stamped && (
            <m.span initial={{ scale: 1.8, opacity: 0, rotate: -14 }} animate={{ scale: 1, opacity: 0.9, rotate: -8 }} transition={snap} className="display pointer-events-none absolute right-5 top-24 rounded-md border-[3px] border-[var(--chutney-deep)] px-3 text-2xl uppercase text-[var(--chutney-deep)]">
              Andar
            </m.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
