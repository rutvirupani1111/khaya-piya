import type { NextRequest } from "next/server";
import { z } from "zod";
import { deleteGroup, getGroup, renameGroup } from "@/lib/db/tenant";
import { body, needUser } from "@/lib/server/api";
import { fail, json } from "@/lib/server/security";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const u = await needUser(req);
  if (u instanceof Response) return u;
  const g = await getGroup(u.id, (await ctx.params).id);
  return g ? json(g) : fail("Ye khata nahi mila.", 404);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const u = await needUser(req, true);
  if (u instanceof Response) return u;
  const b = await body(req, (v) => z.object({ name: z.string().trim().min(1).max(40) }).parse(v));
  if (b instanceof Response) return b;
  return (await renameGroup(u.id, (await ctx.params).id, b.name)) ? json({ ok: true }) : fail("Ye khata nahi mila.", 404);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const u = await needUser(req, true);
  if (u instanceof Response) return u;
  return (await deleteGroup(u.id, (await ctx.params).id)) ? json({ ok: true }) : fail("Sirf khata banane wala ise mita sakta hai.", 403);
}
