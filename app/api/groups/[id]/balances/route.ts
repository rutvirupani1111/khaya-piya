import type { NextRequest } from "next/server";
import { balances } from "@/lib/db/tenant";
import { needUser } from "@/lib/server/api";
import { fail, json } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await needUser(req);
  if (u instanceof Response) return u;
  const b = await balances(u.id, (await ctx.params).id);
  return b ? json(b) : fail("Ye khata nahi mila.", 404);
}
