import type { NextRequest } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";
import { listGroups } from "@/lib/db/tenant";
import { userFromReq } from "@/lib/server/auth";
import { body, needUser } from "@/lib/server/api";
import { fail, json, VPA_RX } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const u = await userFromReq(req);
  if (!u) return json({ user: null, groups: [] });
  return json({ user: { id: u.id, name: u.display_name, vpa: u.default_vpa }, groups: await listGroups(u.id) });
}

const Patch = z.object({ name: z.string().trim().min(1).max(40).optional(), vpa: z.string().trim().max(320).nullable().optional() });

export async function PATCH(req: NextRequest) {
  const u = await needUser(req, true);
  if (u instanceof Response) return u;
  const b = await body(req, (v) => Patch.parse(v));
  if (b instanceof Response) return b;
  if (b.vpa && !VPA_RX.test(b.vpa)) return fail("UPI ID sahi nahi lag raha. Jaise: naam@okicici");
  await sql(
    `update users set display_name = coalesce($2, display_name), default_vpa = case when $4 then $3 else default_vpa end where id = $1`,
    [u.id, b.name ?? null, b.vpa || null, b.vpa !== undefined],
  );
  if (b.vpa !== undefined) await sql(`update group_people set vpa = $2 where user_id = $1`, [u.id, b.vpa || null]);
  return json({ ok: true });
}
