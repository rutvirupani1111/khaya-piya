import type { NextRequest } from "next/server";
import { z } from "zod";
import { upsertPeople } from "@/lib/db/tenant";
import { body, needUser } from "@/lib/server/api";
import { fail, json, VPA_RX } from "@/lib/server/security";

export const runtime = "nodejs";
const Body = z.object({
  people: z.array(z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(24), vpa: z.string().trim().max(320).nullable().optional() })).min(1).max(20),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await needUser(req, true);
  if (u instanceof Response) return u;
  const b = await body(req, (v) => Body.parse(v));
  if (b instanceof Response) return b;
  if (b.people.some((p) => p.vpa && !VPA_RX.test(p.vpa))) return fail("UPI ID sahi nahi lag raha. Jaise: naam@okicici");
  const people = await upsertPeople(u.id, (await ctx.params).id, b.people.map((p) => ({ id: p.id, name: p.name, vpa: p.vpa || null })));
  return people ? json({ people }) : fail("Ye khata nahi mila.", 404);
}
