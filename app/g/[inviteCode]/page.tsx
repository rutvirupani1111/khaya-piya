import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { JoinInvite } from "@/components/khata/JoinInvite";
import { OrderPad } from "@/components/khata/OrderPad";
import { Tiffin, tiffinInk } from "@/components/khata/art";
import { inviteInfo, roleIn } from "@/lib/db/tenant";
import { currentUser } from "@/lib/server/auth";
import { ipHash, limited } from "@/lib/server/security";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "KhayaPiya: khate ka nyota", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ inviteCode: string }> }) {
  const code = (await params).inviteCode.toUpperCase();
  const h = await headers();
  // unknown codes are rate-limited like room codes, so nobody can walk the code space
  const ip = ipHash({ headers: h }).toString("hex");
  const info = (await limited(`invite:look:${ip}`, 30, 60)) ? null : await inviteInfo(code);
  const user = await currentUser();
  if (info && user && (await roleIn(user.id, info.id))) redirect(`/khata/${info.id}`);
  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 pb-16 pt-4">
      <Link href="/" className="tap press inline-flex items-center gap-1 text-sm font-semibold">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        Counter
      </Link>
      {!info ? (
        <section className="kot mt-6 -rotate-1 rounded-sm p-5 shadow-xl">
          <h1 className="display text-3xl">Ye nyota purana ho gaya</h1>
          <p className="hand mt-2 text-lg leading-snug">Khate wale ne naya link bana diya hoga. Unse naya link maango.</p>
          <Link href="/khata" className="tap press mt-4 inline-grid place-items-center rounded-md bg-[#1B1A17] px-4 font-semibold text-[#F6EED9]">Apna khata dekho</Link>
        </section>
      ) : (
        <>
          <section className="cloth mt-3 flex items-end gap-3 rounded-md px-5 pb-4 pt-6 shadow-xl">
            <div className="min-w-0 flex-1">
              <p className="hand text-lg leading-snug">{info.owner} ne tujhe bulaya hai</p>
              <h1 className="display truncate text-4xl text-[var(--haldi)]">{info.name}</h1>
              <p className="mt-1 text-sm opacity-90">Chalta hisaab: kaun kitna dega, kam se kam transfers mein.</p>
            </div>
            <Tiffin n={tiffinInk(info.id)} size={70} />
          </section>
          {user ? <JoinInvite code={code} seats={info.openSeats} me={user.display_name} /> : <OrderPad next={`/g/${code}`} />}
        </>
      )}
    </main>
  );
}
