import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { NextResponse, type NextRequest } from "next/server";
import { rp, saveChallenge } from "@/lib/server/auth";
import { badOrigin, fail, ipHash, limited, tooMany } from "@/lib/server/security";

export const runtime = "nodejs";

/** Discoverable credentials: the phone offers whichever KhayaPiya passkey it holds. */
export async function POST(req: NextRequest) {
  if (badOrigin(req)) return fail("bad_origin", 403);
  if (await limited(`auth:login:ip:${ipHash(req).toString("hex")}`, 20, 3600)) return tooMany();
  const options = await generateAuthenticationOptions({ rpID: rp(req).rpID, userVerification: "preferred" });
  const res = NextResponse.json(options, { headers: { "Cache-Control": "no-store" } });
  await saveChallenge(res, options.challenge, "auth", null, null);
  return res;
}
