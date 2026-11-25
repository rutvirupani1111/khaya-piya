import type { NextRequest } from "next/server";
import { z } from "zod";
import { addEntry } from "@/lib/db/tenant";
import { body, needUser } from "@/lib/server/api";
import { fail, json, limited, tooMany } from "@/lib/server/security";

export const runtime = "nodejs";
const uuid = z.string().uuid();
const Body = z.object({
  id: uuid.optional(),
  kind: z.enum(["expense", "settlement"]),
  payerId: uuid,
  description: z.string().trim().max(80).default(""),
  total: z.number().int().min(1).max(100_000_000),
  shares: z.array(z.object({ personId: uuid, owed: z.number().int().min(1).max(100_000_000) })).min(1).max(20),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await needUser(req, true);
  if (u instanceof Response) return u;
  if (await limited(`entry:${u.id}`, 120, 3600)) return tooMany();
  const b = await body(req, (v) => Body.parse(v));
  if (b instanceof Response) return b;
  const r = await addEntry(u.id, (await ctx.params).id, { ...b, description: b.description || (b.kind === "settlement" ? "Hisaab barabar" : "Kharcha") });
  if (!r) return fail("Ye khata nahi mila.", 404);
  if ("error" in r) return fail(r.error);
  return json({ entry: r }, 201);
}
