import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { tx } from "@/lib/db";
import type { RoomState } from "@/lib/room/ops";
import { deviceToken, setDeviceCookie, setHostCookie, syncTables } from "@/lib/server/room";
import { badOrigin, fail, ipHash, limited, readJson, roomCode, sha256, token, tooMany, VPA_RX } from "@/lib/server/security";

export const runtime = "nodejs";

const uuid = z.string().uuid();
const Body = z.object({
  restaurant: z.string().max(60).default(""),
  payeeName: z.string().regex(/^[A-Za-z .]{1,40}$/),
  vpa: z.string().max(320),
  printedTotal: z.number().int().min(0).max(100_000_000).nullable(),
  members: z.array(z.object({ id: uuid, seat: z.number().int().min(1).max(20), name: z.string().min(1).max(24) })).min(1).max(20),
  items: z.array(z.object({ id: uuid, name: z.string().min(1).max(60), qty: z.number().int().min(1).max(99), amount: z.number().int().min(0).max(100_000_000), kind: z.enum(["food", "drink", "other"]) })).max(80),
  charges: z
    .array(
      z.object({
        id: uuid,
        kind: z.enum(["cgst", "sgst", "utgst", "igst", "vat", "service", "packing", "delivery", "tip", "discount", "roundoff", "other"]),
        label: z.string().max(30),
        mode: z.enum(["amount", "percent"]),
        value: z.number().int().min(-100_000_000).max(100_000_000),
        scope: z.array(uuid).nullable(),
        split: z.enum(["proportional", "equal"]),
        included: z.boolean(),
        removed: z.boolean(),
      }),
    )
    .max(12),
  claims: z.array(z.object({ itemId: uuid, memberId: uuid, weight: z.number().int().min(1).max(12) })).max(1600),
  demo: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  if (badOrigin(req)) return fail("bad_origin", 403);
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await readJson(req));
  } catch {
    return fail("Bill ki details theek nahi hain.");
  }
  const demo = !!body.demo;
  const vpa = demo ? "demo@upi" : body.vpa.trim();
  if (!demo && !VPA_RX.test(vpa)) return fail("UPI ID sahi nahi lag raha. Jaise: naam@okicici");
  if (body.items.reduce((a, i) => a + i.amount, 0) > 100_000_000) return fail("Bill ₹10,00,000 se bada hai.");
  const ids = new Set(body.items.map((i) => i.id));
  const mids = new Set(body.members.map((m) => m.id));
  if (body.claims.some((c) => !ids.has(c.itemId) || !mids.has(c.memberId))) return fail("Claim galat item pe hai.");
  if (body.charges.some((c) => c.scope?.some((s) => !ids.has(s)))) return fail("Charge galat item pe hai.");

  const ip = ipHash(req).toString("hex");
  const dev = deviceToken(req);
  const devH = sha256(dev.tok).toString("hex");
  if ((await limited(`room:create:ip:${ip}:h`, 10, 3600)) || (await limited(`room:create:ip:${ip}:d`, 40, 86400)) || (await limited(`room:create:dev:${devH}`, 20, 86400)))
    return tooMany();

  const members = [...body.members].sort((a, b) => a.seat - b.seat).map((m, i) => ({ ...m, seat: i + 1, joined: i === 0 }));
  const state: RoomState = {
    status: "open",
    restaurant: body.restaurant.trim(),
    payeeName: body.payeeName.trim(),
    printedTotal: body.printedTotal,
    hostMemberId: members[0].id,
    isDemo: demo,
    members,
    items: body.items,
    charges: body.charges,
    claims: body.claims,
    payments: Object.fromEntries(members.map((m) => [m.id, { state: "unpaid" as const, amount: null, sentAt: null, confirmedAt: null }])),
  };
  const hostTok = token(32);
  let code = "";
  await tx(async (q) => {
    for (let tries = 0; tries < 5; tries++) {
      code = roomCode();
      const r = await q.query(
        `insert into rooms (code, status, restaurant, vpa, payee_name, host_token_hash, host_member_id, printed_total_paise, is_demo, snapshot, created_ip_hash, expires_at)
         values ($1, 'open', $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + ($11)::interval) on conflict (code) do nothing returning code`,
        [code, state.restaurant || null, vpa, state.payeeName, sha256(hostTok), state.hostMemberId, state.printedTotal, demo, JSON.stringify(state), ipHash(req), demo ? "24 hours" : "30 days"],
      );
      if (r.length) break;
    }
    await syncTables(q, code, state);
    await q.query(`update members set device_hash = $1 where id = $2`, [sha256(dev.tok), state.hostMemberId]);
    await q.query(`insert into devices (id_hash) values ($1) on conflict (id_hash) do update set last_seen = now()`, [sha256(dev.tok)]);
  });
  const res = NextResponse.json({ code, version: 1, devToken: dev.tok }, { headers: { "Cache-Control": "no-store" } });
  setHostCookie(res, code, hostTok);
  setDeviceCookie(res, dev.tok);
  return res;
}
