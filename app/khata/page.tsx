import type { Metadata } from "next";
import Link from "next/link";
import { KhataHome } from "@/components/khata/Home";
import { OrderPad } from "@/components/khata/OrderPad";
import { Tiffin } from "@/components/khata/art";
import { history, listGroups } from "@/lib/db/tenant";
import { currentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "KhayaPiya: khata", robots: { index: false } };

export default async function Page() {
  const user = await currentUser();
  if (!user) {
    return (
      <main className="mx-auto min-h-dvh max-w-xl px-4 pb-16 pt-4">
        <Link href="/" className="tap press inline-flex items-center gap-1 text-sm font-semibold">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          Counter
        </Link>
        <section className="cloth mt-3 flex items-end gap-3 rounded-md px-5 pb-4 pt-6 shadow-xl">
          <div className="flex-1">
            <h1 className="display text-5xl text-[var(--haldi)]">Khata</h1>
            <p className="hand mt-1 text-lg leading-snug">Flat, lunch gang aur trip ka chalta hisaab. Kaun kitna dega, kam se kam transfers mein.</p>
          </div>
          <Tiffin n={1} size={70} />
        </section>
        <OrderPad next="/khata" />
      </main>
    );
  }
  const [groups, hist] = await Promise.all([listGroups(user.id), history(user.id, "")]);
  return <KhataHome user={{ name: user.display_name, vpa: user.default_vpa }} groups={groups} history={hist} />;
}
