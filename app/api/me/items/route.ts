import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { userFromReq } from "@/lib/server/auth";
import { json } from "@/lib/server/security";

export const runtime = "nodejs";

/**
 * Dish names for Quick Type's autocomplete: what the signed-in person's khatas have eaten, newest first,
 * plus the lines of rooms hosted on their devices. Signed out, the list is empty (the phone keeps its own).
 */
export async function GET(req: NextRequest) {
  const u = await userFromReq(req);
  if (!u) return json({ items: [] });
  const rows = await sql<{ name: string }>(
    `select name from (
       select trim(d) as name, max(e.created_at) as at
         from ledger_entries e
         join group_memberships gm on gm.group_id = e.group_id and gm.user_id = $1
         cross join lateral unnest(string_to_array(e.dishes, ', ')) as d
        where e.dishes is not null
        group by trim(d)
       union all
       select i.name, max(r.created_at) as at
         from rooms r join items i on i.room_code = r.code
        where r.owner_user_id = $1 and r.expires_at > now() and not r.is_demo
        group by i.name
     ) x
     where char_length(name) between 2 and 60
     group by name
     order by max(at) desc
     limit 300`,
    [u.id],
  );
  return json({ items: rows.map((r) => r.name) });
}
