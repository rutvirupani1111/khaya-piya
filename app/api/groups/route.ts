import type { NextRequest } from "next/server";
import { z } from "zod";
import { createGroup, listGroups } from "@/lib/db/tenant";
import { body, needUser } from "@/lib/server/api";
import { fail, json, limited, tooMany, VPA_RX } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const u = await needUser(req);
  if (u instanceof Response) return u;
  return json({ groups: await listGroups(u.id) });
}

const Body = z.object({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(["flat", "lunch", "trip", "other"]),
  people: z.array(z.object({ name: z.string().trim().min(1).max(24), vpa: z.string().trim().max(320).nullable().optional() })).max(19).default([]),
});

export async function POST(req: NextRequest) {
  const u = await needUser(req, true);
  if (u instanceof Response) return u;
  if (await limited(`group:create:${u.id}`, 30, 86400)) return tooMany();
  const b = await body(req, (v) => Body.parse(v));
  if (b instanceof Response) return b;
  if (b.people.some((p) => p.vpa && !VPA_RX.test(p.vpa))) return fail("Ek UPI ID sahi nahi lag raha.");
  const id = await createGroup(u.id, b.name, b.kind, b.people.map((p) => ({ name: p.name, vpa: p.vpa || null })));
  return json({ id }, 201);
}
