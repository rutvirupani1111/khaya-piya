import { NextResponse, type NextRequest } from "next/server";
import { sql, tx } from "@/lib/db";
import { deviceToken, loadRoom, setDeviceCookie, setHostCookie } from "@/lib/server/room";
import { badOrigin, fail, hostCookie, json, limited, sha256, token, tooMany } from "@/lib/server/security";

export const runtime = "nodejs";
const CODE = /^[0-9A-HJKMNP-TV-Z]{7}$/;

/**
 * "Galla doosre phone pe": the host asks for a one-time link (10 minutes). Opening it on another phone moves
 * the host controls there; this phone's host cookie stops working. The host seat, the UPI ID and every share
 * stay exactly as they were: only who can tap Mila changes.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  if (badOrigin(req)) return fail("bad_origin", 403);
  const code = (await ctx.params).code.toUpperCase();
  if (!CODE.test(code)) return fail("Ye room nahi mila.", 404);
  const room = await loadRoom(null, code);
  if (!room) return fail("Ye room nahi mila.", 404);
  const hostTok = req.cookies.get(hostCookie(code))?.value;
  if (!hostTok || sha256(hostTok).toString("hex") !== room.host_token_hash) return fail("Ye sirf galla wala phone kar sakta hai.", 403);
  if (room.status === "closed") return fail("Room band ho chuka hai.");
  if (await limited(`handover:${code}`, 10, 3600)) return tooMany();
  const key = token(24);
  const rows = await sql<{ expires: string }>(
    `update rooms set host_key_hash = $2, host_key_expires = now() + interval '10 minutes' where code = $1 returning host_key_expires as expires`,
    [code, sha256(key)],
  );
  return json({ path: `/api/r/${code}/handover?k=${key}`, expires: new Date(rows[0].expires).toISOString() });
}

/** The link itself: checks the key once, gives this phone a fresh host cookie and opens the galla. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const code = (await ctx.params).code.toUpperCase();
  const key = req.nextUrl.searchParams.get("k") || "";
  const back = (msg: string) => NextResponse.redirect(new URL(`/r/${CODE.test(code) ? code : ""}?handover=${msg}`, req.url), 303);
  if (!CODE.test(code) || !/^[A-Za-z0-9_-]{30,40}$/.test(key)) return back("bad");
  const newTok = token(32);
  const dev = deviceToken(req);
  const ok = await tx(async (q) => {
    const r = await q.query<{ host_member_id: string; version: string }>(
      `update rooms set host_token_hash = $3, host_key_hash = null, host_key_expires = null, version = version + 1, updated_at = now()
        where code = $1 and host_key_hash = $2 and host_key_expires > now() and status <> 'closed' and expires_at > now()
        returning host_member_id, version`,
      [code, sha256(key), sha256(newTok)],
    );
    if (!r[0]) return false;
    // the old phone stops being the host seat; this phone becomes it, unless it already sits at the table as a friend
    const mine = await q.query(`select 1 from members where room_code = $1 and device_hash = $2`, [code, sha256(dev.tok)]);
    await q.query(`update members set device_hash = null where room_code = $1 and id = $2`, [code, r[0].host_member_id]);
    if (!mine.length) await q.query(`update members set device_hash = $3 where room_code = $1 and id = $2`, [code, r[0].host_member_id, sha256(dev.tok)]);
    await q.query(`insert into devices (id_hash) values ($1) on conflict (id_hash) do update set last_seen = now()`, [sha256(dev.tok)]);
    // the version moves on, so the old phone's next poll fetches the room again and sees it is no longer the galla
    await q.query(`insert into ops (room_code, version, op_id, member_id, is_host, type, payload) values ($1, $2, gen_random_uuid(), null, true, 'handover', '{}'::jsonb)`, [code, r[0].version]);
    return true;
  });
  if (!ok) return back("expired");
  const res = NextResponse.redirect(new URL(`/r/${code}`, req.url), 303);
  setHostCookie(res, code, newTok);
  if (dev.fresh) setDeviceCookie(res, dev.tok);
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Cache-Control", "no-store");
  return res;
}
