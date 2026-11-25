import type { NextRequest } from "next/server";
import { rotateInvite } from "@/lib/db/tenant";
import { needUser } from "@/lib/server/api";
import { fail, json } from "@/lib/server/security";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await needUser(req, true);
  if (u instanceof Response) return u;
  const code = await rotateInvite(u.id, (await ctx.params).id);
  return code ? json({ code }) : fail("Sirf khata banane wala naya link bana sakta hai.", 403);
}
