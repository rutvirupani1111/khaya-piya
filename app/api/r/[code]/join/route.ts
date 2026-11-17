import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { deviceToken, joinRoom, setDeviceCookie, toSnapshot } from "@/lib/server/room";
import { badOrigin, fail, hostCookie, limited, readJson, tooMany } from "@/lib/server/security";

export const runtime = "nodejs";
const Body = z.object({ name: z.string().trim().min(1).max(24), seat: z.string().uuid().nullable().optional() });

export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  if (badOrigin(req)) return fail("bad_origin", 403);
  const code = (await ctx.params).code.toUpperCase();
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await readJson(req));
  } catch {
    return fail("Naam 1 se 24 akshar ka ho.");
  }
  if (await limited(`room:join:${code}`, 20, 86400 * 30)) return tooMany();
  const dev = deviceToken(req);
  const r = await joinRoom(code, dev.tok, req.cookies.get(hostCookie(code))?.value, body.name, body.seat ?? null);
  if ("error" in r) return fail(r.error === "full" ? "Room bhar gaya (20 log)." : "Ye room nahi mila.", r.error === "not_found" ? 404 : 409);
  const res = NextResponse.json({ ...toSnapshot(r.room, r.actor), memberId: r.actor.memberId, devToken: dev.tok }, { headers: { "Cache-Control": "no-store" } });
  setDeviceCookie(res, dev.tok);
  return res;
}
