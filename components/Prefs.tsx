"use client";
import { LazyMotion, domAnimation, MotionConfig } from "motion/react";
import { createContext, useContext, useEffect, useState } from "react";
import { LANGS, tr, type Key, type Lang } from "@/lib/i18n";

interface P { lang: Lang; t: (k: Key) => string; calm: boolean; setCalm: (v: boolean) => void; setLang: (l: Lang) => void; toggleTheme: () => void }
const Ctx = createContext<P | null>(null);
export const usePrefs = () => useContext(Ctx)!;

export function Prefs({ lang: initial, children }: { lang: Lang; children: React.ReactNode }) {
  const [lang, setL] = useState<Lang>(initial);
  const [calm, setC] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("kp_calm");
    } catch {}
    setC(mq.matches || saved === "1");
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
  const toggleTheme = () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    root.dataset.theme = next;
    document.cookie = `kp_theme=${next}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <Ctx.Provider value={{ lang, t: (k) => tr(lang, k), calm, setCalm, setLang, toggleTheme }}>
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
