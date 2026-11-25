// Small helpers for the signed-in API routes.
import type { NextRequest } from "next/server";
import { userFromReq, type User } from "./auth";
import { badOrigin, fail, readJson } from "./security";

/** Returns the user, or a ready error response. Writes also pass the same-origin check. */
export async function needUser(req: NextRequest, write = false): Promise<User | Response> {
  if (write && badOrigin(req)) return fail("bad_origin", 403);
  const u = await userFromReq(req);
  if (!u) return fail("Pehle khate mein andar aao.", 401);
  return u;
}

export async function body<T>(req: NextRequest, parse: (v: unknown) => T): Promise<T | Response> {
  try {
    return parse(await readJson(req));
  } catch {
    return fail("Details theek nahi hain.");
  }
}
