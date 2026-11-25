"use client";
import { LazyMotion, domAnimation, MotionConfig } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { LANGS, tr, type Key, type Lang } from "@/lib/i18n";

interface P { lang: Lang; t: (k: Key) => string; calm: boolean; setCalm: (v: boolean) => void; setLang: (l: Lang) => void; toggleTheme: () => void; lite: boolean; fast: boolean; sampleFrames: () => void }

/** Has this phone already finished a split? Then intros are skipped and scenes move quicker (the fast lane). */
function readFast() {
  try {
    return (JSON.parse(localStorage.getItem("kp_finals") || "[]") as string[]).length >= 1;
  } catch {
    return false;
  }
}
const Ctx = createContext<P | null>(null);
export const usePrefs = () => useContext(Ctx)!;

export function Prefs({ lang: initial, children }: { lang: Lang; children: React.ReactNode }) {
  const [lang, setL] = useState<Lang>(initial);
  const [calm, setC] = useState(false);
  const [lite, setLite] = useState(false);
  const [fast, setFast] = useState(false);
  useEffect(() => {
    // lite mode: a phone with 2 GB or less, or one that dropped frames on its first real animation
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("kp_lite");
    } catch {}
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    setLite(saved === "1" || (typeof mem === "number" && mem <= 2));
    const f = readFast();
    setFast(f);
    document.documentElement.toggleAttribute("data-fast", f);
  }, []);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("kp_calm");
    } catch {}
    setC(mq.matches || saved === "1");
  }, []);
  // the service worker keeps the Counter, Table and Shelf working offline and catches shared bill photos
  useEffect(() => {
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});
    // the install prompt is kept for the Counter's "Ghar pe rakh lo" chit, which only shows after two finalised splits
    const keep = (e: Event) => {
      e.preventDefault();
      (window as unknown as { __kpInstall?: Event }).__kpInstall = e;
      window.dispatchEvent(new Event("kp-install"));
    };
    window.addEventListener("beforeinstallprompt", keep);
    return () => window.removeEventListener("beforeinstallprompt", keep);
  }, []);
  const setLang = (l: Lang) => {
    document.cookie = `kp_lang=${l}; path=/; max-age=31536000; samesite=lax`;
    setL(l);
  };
  const setCalm = (v: boolean) => {
    try {
      localStorage.setItem("kp_calm", v ? "1" : "0");
    } catch {}
    setC(v);
  };
  /** Time the first 60 frames of a real animation; over 22 ms a frame means this phone gets lite mode from now on. */
  const sampleFrames = useCallback(() => {
    try {
      if (localStorage.getItem("kp_lite") != null) return;
    } catch {
      return;
    }
    let n = 0;
    let last = performance.now();
    let sum = 0;
    const tick = (now: number) => {
      sum += now - last;
      last = now;
      if (++n < 60) return requestAnimationFrame(tick);
      const slow = sum / n > 22;
      try {
        localStorage.setItem("kp_lite", slow ? "1" : "0");
      } catch {}
      if (slow) setLite(true);
    };
    requestAnimationFrame(tick);
  }, []);
  const toggleTheme = () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    root.dataset.theme = next;
    document.cookie = `kp_theme=${next}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <Ctx.Provider value={{ lang, t: (k) => tr(lang, k), calm, setCalm, setLang, toggleTheme, lite, fast, sampleFrames }}>
      <LazyMotion features={domAnimation}>
        <MotionConfig reducedMotion={calm ? "always" : "never"}>{children}</MotionConfig>
      </LazyMotion>
    </Ctx.Provider>
  );
}

export function LangSwitch() {
  const { lang, setLang, calm, setCalm, toggleTheme } = usePrefs();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {LANGS.map((l) => (
        <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l} className={`tap press rounded-full px-3 text-sm font-semibold ${lang === l ? "bg-[var(--haldi)] text-[#1B1A17]" : "border border-current opacity-80"}`}>
          {l === "hinglish" ? "Hinglish" : l === "en" ? "English" : "हिन्दी"}
        </button>
      ))}
      <button type="button" onClick={() => setCalm(!calm)} aria-pressed={calm} className={`tap press rounded-full px-3 text-sm font-semibold ${calm ? "bg-[var(--chutney)] text-white" : "border border-current opacity-80"}`}>
        {tr(lang, "calm")}
      </button>
      <button type="button" onClick={toggleTheme} aria-label="Tubelight switch" className="tap press grid place-items-center rounded-md border border-current">
        <svg width="18" height="26" viewBox="0 0 18 26" aria-hidden="true">
          <rect x="2" y="1" width="14" height="24" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="6" y="5" width="6" height="8" rx="1.5" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
