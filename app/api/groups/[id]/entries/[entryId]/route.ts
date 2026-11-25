import type { NextRequest } from "next/server";
import { deleteEntry } from "@/lib/db/tenant";
import { needUser } from "@/lib/server/api";
import { fail, json } from "@/lib/server/security";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; entryId: string }> }) {
  const u = await needUser(req, true);
  if (u instanceof Response) return u;
  const p = await ctx.params;
  return (await deleteEntry(u.id, p.id, p.entryId)) ? json({ ok: true }) : fail("Ye entry nahi mili.", 404);
}
