import type { NextRequest } from "next/server";
import { history } from "@/lib/db/tenant";
import { needUser } from "@/lib/server/api";
import { json } from "@/lib/server/security";

export const runtime = "nodejs";

/** Rooms hosted or joined on the user's devices, plus group bills. Search by restaurant, date or dish. */
export async function GET(req: NextRequest) {
  const u = await needUser(req);
  if (u instanceof Response) return u;
  return json(await history(u.id, req.nextUrl.searchParams.get("q") ?? ""));
}
