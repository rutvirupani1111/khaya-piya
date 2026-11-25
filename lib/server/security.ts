import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "../db";

export const sha256 = (s: string) => createHash("sha256").update(s).digest();
export const token = (n = 32) => randomBytes(n).toString("base64url");

const CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 7-char Crockford base32 code, uniform via crypto.randomInt (rejection sampling inside). */
export function roomCode(len = 7) {
  let s = "";
  for (let i = 0; i < len; i++) s += CROCK[randomInt(32)];
  return s;
}

export function ipHash(req: Pick<NextRequest, "headers"> | { headers: { get(name: string): string | null } }) {
  const ip = (req.headers.get("x-forwarded-for") || "0.0.0.0").split(",")[0].trim();
  const day = new Date().toISOString().slice(0, 10); // rotating salt: daily
  return sha256(`${process.env.IP_SALT || "kp"}:${day}:${ip}`);
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
export const fail = (msg: string, status = 400) => json({ error: msg }, status);

/** Same-origin check for every POST (CSRF). */
export function badOrigin(req: NextRequest) {
  const o = req.headers.get("origin");
  if (!o) return true;
  try {
    return new URL(o).host !== req.headers.get("host");
  } catch {
    return true;
  }
}

export async function readJson(req: NextRequest): Promise<unknown> {
  const t = await req.text();
  if (t.length > 32 * 1024) throw new Error("too_large");
  return JSON.parse(t || "{}");
}

/** Fixed-window counter in Postgres. Returns true when the caller is over the limit. */
export async function limited(bucket: string, max: number, windowSec: number): Promise<boolean> {
  const rows = await sql<{ count: number }>(
    `insert into rate_limits (bucket, window_start, count)
     values ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     on conflict (bucket, window_start) do update set count = rate_limits.count + 1
     returning count`,
    [bucket, windowSec],
  );
  return (rows[0]?.count ?? 0) > max;
}
export const tooMany = () => fail("Thoda ruk jao. Bahut jaldi jaldi ho raha hai, ek minute baad try karo.", 429);

export function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 32).toString("hex")}`;
}
export function checkPassword(pw: string, stored: string | null) {
  if (!stored) return false;
  const [s, h] = stored.split(":");
  const got = scryptSync(pw, Buffer.from(s, "hex"), 32);
  const want = Buffer.from(h, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

export const DEV_COOKIE = "kp_dev";
export const hostCookie = (code: string) => `kp_host_${code}`;
export const VPA_RX = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;
