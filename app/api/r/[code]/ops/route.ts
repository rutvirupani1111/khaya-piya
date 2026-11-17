import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { deviceToken, runOps, toSnapshot } from "@/lib/server/room";
import { badOrigin, fail, hostCookie, limited, readJson, sha256, tooMany } from "@/lib/server/security";
import type { Op } from "@/lib/room/ops";

export const runtime = "nodejs";
const Body = z.object({
  baseVersion: z.number().int().min(0),
  ops: z.array(z.object({ opId: z.string().uuid(), type: z.string().max(30) }).passthrough()).min(1).max(20),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  if (badOrigin(req)) return fail("bad_origin", 403);
  const code = (await ctx.params).code.toUpperCase();
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await readJson(req));
  } catch {
    return fail("bad_ops");
  }
  const dev = deviceToken(req);
  if (await limited(`ops:${code}:${sha256(dev.tok).toString("hex")}`, 120, 60)) return tooMany();
  const r = await runOps(code, body.ops as unknown as Op[], req.cookies.get(hostCookie(code))?.value, dev.tok);
  if (!r) return fail("Ye room nahi mila.", 404);
  return NextResponse.json({ version: r.version, snapshot: toSnapshot(r.room, r.actor), rejected: r.rejected }, { headers: { "Cache-Control": "no-store" } });
}
