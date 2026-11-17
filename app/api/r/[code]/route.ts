import { NextResponse, type NextRequest } from "next/server";
import { deviceToken, loadRoom, resolveActor, toSnapshot } from "@/lib/server/room";
import { fail, hostCookie, ipHash, limited, tooMany } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const c = code.toUpperCase();
  const room = /^[0-9A-HJKMNP-TV-Z]{7}$/.test(c) ? await loadRoom(null, c) : null;
  if (!room) {
    if (await limited(`room:miss:ip:${ipHash(req).toString("hex")}`, 30, 60)) return tooMany();
    return fail("Ye room nahi mila. Link check karo.", 404);
  }
  const etag = `"v${room.version}"`;
  const v = req.nextUrl.searchParams.get("v");
  if (req.headers.get("if-none-match") === etag || v === String(room.version)) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-store" } });
  }
  const dev = deviceToken(req);
  const actor = await resolveActor(null, room, req.cookies.get(hostCookie(c))?.value, dev.tok);
  return NextResponse.json(toSnapshot(room, actor), { headers: { ETag: etag, "Cache-Control": "no-store" } });
}
