import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Mono, Kalam, Mukta, Rozha_One } from "next/font/google";
import { langFrom } from "@/lib/i18n";
import { Prefs } from "@/components/Prefs";
import "./globals.css";

const rozha = Rozha_One({ weight: "400", subsets: ["latin", "devanagari"], variable: "--f-rozha", display: "swap", preload: false });
const mukta = Mukta({ weight: ["400", "600", "800"], subsets: ["latin", "devanagari"], variable: "--f-mukta", display: "swap" });
const plex = IBM_Plex_Mono({ weight: "500", subsets: ["latin"], variable: "--f-plex", display: "swap" });
const kalam = Kalam({ weight: ["400", "700"], subsets: ["latin", "devanagari"], variable: "--f-kalam", display: "swap", preload: false });

export const metadata: Metadata = {
  metadataBase: new URL("https://khaya-piya.vercel.app"),
  title: "KhayaPiya",
  description: "Snap the restaurant bill, tap who ate what, and everyone pays their own exact share by UPI before leaving the table.",
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { themeColor: "#15211B", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const c = await cookies();
  const lang = langFrom(c.get("kp_lang")?.value);
  const theme = c.get("kp_theme")?.value;
  return (
    <html lang={lang === "hi" ? "hi" : "en-IN"} data-theme={theme === "dark" || theme === "light" ? theme : undefined} className={`${rozha.variable} ${mukta.variable} ${plex.variable} ${kalam.variable}`}>
      <body>
        <Prefs lang={lang}>{children}</Prefs>
      </body>
    </html>
  );
}
