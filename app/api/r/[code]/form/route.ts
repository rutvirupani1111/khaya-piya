import { NextResponse, type NextRequest } from "next/server";
import { deviceToken, joinRoom, loadRoom, resolveActor, runOps, setDeviceCookie } from "@/lib/server/room";
import { badOrigin, hostCookie, limited } from "@/lib/server/security";

export const runtime = "nodejs";

/** No-JavaScript fallback: join, claim and mark sent as plain HTML forms. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const code = (await ctx.params).code.toUpperCase();
  const res = NextResponse.redirect(new URL(`/r/${code}`, req.url), 303);
  if (badOrigin(req)) return res;
  const f = await req.formData();
  const action = String(f.get("action") || "");
  const dev = deviceToken(req);
  setDeviceCookie(res, dev.tok);
  const hostTok = req.cookies.get(hostCookie(code))?.value;
  if (action === "join") {
    const name = String(f.get("name") || "").trim().slice(0, 24);
    if (name && !(await limited(`room:join:${code}`, 20, 86400 * 30))) await joinRoom(code, dev.tok, hostTok, name, String(f.get("seat") || "") || null);
    return res;
  }
  const room = await loadRoom(null, code);
  if (!room) return res;
  const actor = await resolveActor(null, room, hostTok, dev.tok);
  if (!actor.memberId) return res;
  const opId = crypto.randomUUID();
  if (action === "claim" || action === "unclaim") await runOps(code, [{ opId, type: action, itemId: String(f.get("itemId")), memberId: actor.memberId }], hostTok, dev.tok);
  if (action === "sent") await runOps(code, [{ opId, type: "mark_sent", memberId: actor.memberId }], hostTok, dev.tok);
  return res;
}
