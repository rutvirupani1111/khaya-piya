import { type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { fail, json } from "@/lib/server/security";

export const runtime = "nodejs";

/** Daily 03:30 IST. Deletes expired rooms 500 at a time, each batch its own commit. */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return fail("unauthorized", 401);
  let rooms = 0;
  for (let i = 0; i < 200; i++) {
    const r = await sql(`delete from rooms where code in (select code from rooms where expires_at < now() limit 500) returning code`);
    rooms += r.length;
    if (r.length < 500) break;
  }
  await sql(`delete from rate_limits where window_start < now() - interval '2 days'`);
  await sql(`delete from magic_tokens where expires_at < now()`);
  await sql(`delete from sessions where expires_at < now()`);
  await sql(`delete from auth_challenges where expires_at < now()`);
  return json({ rooms });
}
