import { NextResponse, type NextRequest } from "next/server";
import { endSession } from "@/lib/server/auth";
import { badOrigin, fail } from "@/lib/server/security";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (badOrigin(req)) return fail("bad_origin", 403);
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  await endSession(req, res);
  return res;
}
