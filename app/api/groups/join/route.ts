import type { NextRequest } from "next/server";
import { z } from "zod";
import { joinByInvite } from "@/lib/db/tenant";
import { body, needUser } from "@/lib/server/api";
import { fail, json, limited, tooMany } from "@/lib/server/security";

export const runtime = "nodejs";
const Body = z.object({ code: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{10}$/), personId: z.string().uuid().nullable().optional() });

export async function POST(req: NextRequest) {
  const u = await needUser(req, true);
  if (u instanceof Response) return u;
  if (await limited(`group:join:${u.id}`, 30, 3600)) return tooMany();
  const b = await body(req, (v) => Body.parse(v));
  if (b instanceof Response) return b;
  const id = await joinByInvite(u.id, b.code, b.personId ?? null);
  return id ? json({ id }) : fail("Ye invite link purana ho gaya. Naya maango.", 404);
}
