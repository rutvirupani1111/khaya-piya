import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Room } from "@/components/Room";
import { Money } from "@/components/art";
import { loadRoom, resolveActor, toSnapshot } from "@/lib/server/room";
import { DEV_COOKIE, hostCookie } from "@/lib/server/security";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer", title: "KhayaPiya bill" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  if (!/^[0-9A-HJKMNP-TV-Z]{7}$/.test(code)) notFound();
  const room = await loadRoom(null, code);
  if (!room) notFound();
  const c = await cookies();
  const actor = await resolveActor(null, room, c.get(hostCookie(code))?.value, c.get(DEV_COOKIE)?.value || "none");
  const snap = toSnapshot(room, actor);
  const me = actor.memberId;
  return (
    <>
      <noscript>
        <style>{`.kp-folder{display:none}`}</style>
        <main style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
          <h1 className="display" style={{ fontSize: 28 }}>{snap.restaurant || "Bill"}</h1>
          {!me && (
            <form method="post" action={`/api/r/${code}/form`}>
              <input type="hidden" name="action" value="join" />
              <label>Tera naam? <input name="name" maxLength={24} required className="kot" style={{ minHeight: 44 }} /></label>
              <button type="submit" style={{ minHeight: 44, marginLeft: 8 }}>Andar aao</button>
            </form>
          )}
          <ul>
            {snap.items.map((it) => {
              const mine = snap.claims.some((cl) => cl.itemId === it.id && cl.memberId === me);
              return (
                <li key={it.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0" }}>
                  <span className="mono">{it.name}</span>
                  <Money p={it.amount} />
                  {me && (
                    <form method="post" action={`/api/r/${code}/form`}>
                      <input type="hidden" name="action" value={mine ? "unclaim" : "claim"} />
                      <input type="hidden" name="itemId" value={it.id} />
                      <button type="submit" style={{ minHeight: 44 }}>{mine ? "Mera nahi" : "Maine khaya"}</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
          {me && (
            <>
              <p>Tera hissa: <Money p={snap.bill.perMember[me]?.total ?? 0} /></p>
              <form method="post" action={`/api/r/${code}/form`}>
                <input type="hidden" name="action" value="sent" />
                <button type="submit" style={{ minHeight: 44 }}>Bhej diya</button>
              </form>
            </>
          )}
        </main>
      </noscript>
      <Room initial={snap} />
    </>
  );
}
