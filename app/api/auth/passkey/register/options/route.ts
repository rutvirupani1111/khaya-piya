import { generateRegistrationOptions } from "@simplewebauthn/server";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";
import { rp, saveChallenge, userFromReq } from "@/lib/server/auth";
import { badOrigin, fail, ipHash, limited, readJson, tooMany } from "@/lib/server/security";

export const runtime = "nodejs";
const Body = z.object({ name: z.string().trim().min(1).max(40).optional() });

/** New account (needs a name) or one more passkey for the signed-in user. */
export async function POST(req: NextRequest) {
  if (badOrigin(req)) return fail("bad_origin", 403);
  if (await limited(`auth:reg:ip:${ipHash(req).toString("hex")}`, 20, 3600)) return tooMany();
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await readJson(req));
  } catch {
    return fail("Naam 1 se 40 akshar ka ho.");
  }
  const user = await userFromReq(req);
  const name = user?.display_name ?? body.name;
  if (!name) return fail("Pehle apna naam likho.");
  const existing = user ? await sql<{ credential_id: string }>(`select credential_id from passkeys where user_id = $1`, [user.id]) : [];
  const { rpID, rpName } = rp(req);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: name,
    userDisplayName: name,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.credential_id })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  const res = NextResponse.json(options, { headers: { "Cache-Control": "no-store" } });
  await saveChallenge(res, options.challenge, "reg", user?.id ?? null, name);
  return res;
}
