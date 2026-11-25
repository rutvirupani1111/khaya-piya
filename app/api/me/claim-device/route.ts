import { NextResponse, type NextRequest } from "next/server";
import { claimDevice } from "@/lib/server/auth";
import { needUser } from "@/lib/server/api";
import { deviceToken, setDeviceCookie } from "@/lib/server/room";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const u = await needUser(req, true);
  if (u instanceof Response) return u;
  const dev = deviceToken(req);
  await claimDevice(u.id, dev.tok);
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  setDeviceCookie(res, dev.tok);
  return res;
}
