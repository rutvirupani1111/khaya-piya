import { verifyAuthenticationResponse, type AuthenticationResponseJSON, type AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { claimDevice, rp, startSession, takeChallenge } from "@/lib/server/auth";
import { deviceToken, setDeviceCookie } from "@/lib/server/room";
import { badOrigin, fail, readJson } from "@/lib/server/security";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (badOrigin(req)) return fail("bad_origin", 403);
  const chal = await takeChallenge(req, "auth");
  if (!chal) return fail("Der ho gayi. Ek baar phir try karo.");
  let body: AuthenticationResponseJSON;
  try {
    body = (await readJson(req)) as AuthenticationResponseJSON;
  } catch {
    return fail("Passkey samajh nahi aaya.");
  }
  const rows = await sql<{ credential_id: string; user_id: string; pk: string; counter: string; transports: string[] }>(
    `select credential_id, user_id, encode(public_key, 'hex') as pk, counter, transports from passkeys where credential_id = $1`,
    [String(body?.id ?? "")],
  );
  const cred = rows[0];
  if (!cred) return fail("Ye passkey kisi khate ka nahi. Naya khata kholo?", 404);
  const { rpID, origin } = rp(req);
  try {
    const v = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: chal.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: { id: cred.credential_id, publicKey: new Uint8Array(Buffer.from(cred.pk, "hex")), counter: Number(cred.counter), transports: cred.transports as AuthenticatorTransportFuture[] },
    });
    if (!v.verified) return fail("Passkey match nahi hua.", 401);
    await sql(`update passkeys set counter = $2 where credential_id = $1`, [cred.credential_id, v.authenticationInfo.newCounter]);
  } catch {
    return fail("Passkey match nahi hua.", 401);
  }
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  await startSession(res, cred.user_id);
  const dev = deviceToken(req);
  await claimDevice(cred.user_id, dev.tok);
  setDeviceCookie(res, dev.tok);
  return res;
}
