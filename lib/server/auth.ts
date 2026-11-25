// Optional accounts: passkey sign-in, sessions in Postgres (only hashes stored), device claiming.
import type { NextRequest, NextResponse } from "next/server";
import { sql } from "../db";
import { sha256, token } from "./security";

export const SESS_COOKIE = "kp_sess";
export const CHAL_COOKIE = "kp_chal";
const SESSION_DAYS = 60;

export interface User { id: string; display_name: string; default_vpa: string | null }

export async function userFromToken(tok: string | undefined | null): Promise<User | null> {
  if (!tok || !/^[A-Za-z0-9_-]{40,60}$/.test(tok)) return null;
  const rows = await sql<User>(
    `select u.id, u.display_name, u.default_vpa from sessions s join users u on u.id = s.user_id
      where s.id_hash = decode($1, 'hex') and s.expires_at > now()`,
    [sha256(tok).toString("hex")],
  );
  return rows[0] ?? null;
}

export const userFromReq = (req: NextRequest) => userFromToken(req.cookies.get(SESS_COOKIE)?.value);

/** For server components: the signed-in user from the request cookies, or null. */
export async function currentUser(): Promise<User | null> {
  const { cookies } = await import("next/headers");
  return userFromToken((await cookies()).get(SESS_COOKIE)?.value);
}

export async function startSession(res: NextResponse, userId: string) {
  const tok = token(32);
  await sql(`insert into sessions (id_hash, user_id, expires_at) values (decode($1, 'hex'), $2, now() + interval '${SESSION_DAYS} days')`, [sha256(tok).toString("hex"), userId]);
  res.cookies.set(SESS_COOKIE, tok, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400 });
}

export async function endSession(req: NextRequest, res: NextResponse) {
  const tok = req.cookies.get(SESS_COOKIE)?.value;
  if (tok) await sql(`delete from sessions where id_hash = decode($1, 'hex')`, [sha256(tok).toString("hex")]);
  res.cookies.set(SESS_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
}

/** Signing in claims this device: its rooms show in the user's history. */
export async function claimDevice(userId: string, devTok: string) {
  const h = sha256(devTok).toString("hex");
  await sql(
    `insert into devices (id_hash, user_id) values (decode($1, 'hex'), $2)
     on conflict (id_hash) do update set user_id = excluded.user_id, last_seen = now()`,
    [h, userId],
  );
  await sql(
    `update rooms r set owner_user_id = $2
      where r.owner_user_id is null
        and exists (select 1 from members m where m.room_code = r.code and m.id = r.host_member_id and m.device_hash = decode($1, 'hex'))`,
    [h, userId],
  );
}

/** Relying party for WebAuthn, taken from the request host so previews and localhost work too. */
export function rp(req: NextRequest) {
  const host = req.headers.get("host") || "khaya-piya.vercel.app";
  const rpID = host.split(":")[0];
  const local = rpID === "localhost";
  return { rpID, origin: `${local ? "http" : "https"}://${host}`, rpName: "KhayaPiya" };
}

export async function saveChallenge(res: NextResponse, challenge: string, kind: "reg" | "auth", userId: string | null, displayName: string | null) {
  const id = token(24);
  await sql(
    `insert into auth_challenges (id_hash, challenge, kind, user_id, display_name, expires_at)
     values (decode($1, 'hex'), $2, $3, $4, $5, now() + interval '5 minutes')`,
    [sha256(id).toString("hex"), challenge, kind, userId, displayName],
  );
  res.cookies.set(CHAL_COOKIE, id, { httpOnly: true, secure: true, sameSite: "strict", path: "/api/auth", maxAge: 300 });
}

/** Single use: the row is deleted as it is read. */
export async function takeChallenge(req: NextRequest, kind: "reg" | "auth") {
  const id = req.cookies.get(CHAL_COOKIE)?.value;
  if (!id) return null;
  const rows = await sql<{ challenge: string; user_id: string | null; display_name: string | null }>(
    `delete from auth_challenges where id_hash = decode($1, 'hex') and kind = $2 and expires_at > now()
     returning challenge, user_id, display_name`,
    [sha256(id).toString("hex"), kind],
  );
  return rows[0] ?? null;
}
