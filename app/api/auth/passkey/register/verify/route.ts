import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { claimDevice, rp, startSession, takeChallenge } from "@/lib/server/auth";
import { deviceToken, setDeviceCookie } from "@/lib/server/room";
import { badOrigin, fail, readJson } from "@/lib/server/security";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (badOrigin(req)) return fail("bad_origin", 403);
  const chal = await takeChallenge(req, "reg");
  if (!chal) return fail("Der ho gayi. Ek baar phir try karo.");
  const { rpID, origin } = rp(req);
  let info;
  try {
    const v = await verifyRegistrationResponse({ response: (await readJson(req)) as RegistrationResponseJSON, expectedChallenge: chal.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false });
    if (!v.verified || !v.registrationInfo) return fail("Passkey nahi bana.");
    info = v.registrationInfo;
  } catch {
    return fail("Passkey nahi bana.");
  }
  let userId = chal.user_id;
  if (!userId) {
    const u = await sql<{ id: string }>(`insert into users (display_name) values ($1) returning id`, [chal.display_name || "Dost"]);
    userId = u[0].id;
  }
  const c = info.credential;
  await sql(
    `insert into passkeys (credential_id, user_id, public_key, counter, transports) values ($1, $2, decode($3, 'hex'), $4, $5)
     on conflict (credential_id) do nothing`,
    [c.id, userId, Buffer.from(c.publicKey).toString("hex"), c.counter, c.transports ?? []],
  );
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  await startSession(res, userId);
  const dev = deviceToken(req);
  await claimDevice(userId, dev.tok);
  setDeviceCookie(res, dev.tok);
  return res;
}
