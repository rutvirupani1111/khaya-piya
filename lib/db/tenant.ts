// Every group, ledger and history query goes through here. Each function takes the signed-in userId first
// and checks group_memberships before it reads or writes anything. Rooms belong to no tenant (code + device).
import { randomInt } from "node:crypto";
import { sql, tx, type Q } from ".";
import { entryIsBalanced, ledgerPlan, netBalances, type LedgerEntry, type Person } from "../money/ledger";

export type Role = "owner" | "editor";
export type GroupKind = "flat" | "lunch" | "trip" | "other";
export interface GroupSummary { id: string; name: string; kind: GroupKind; role: Role; people: number; entries: number; myNet: number | null; lastAt: string | null }
export interface GroupFull {
  id: string;
  name: string;
  kind: GroupKind;
  role: Role;
  inviteCode: string | null;
  people: Person[];
  entries: LedgerEntry[];
  net: Record<string, number>;
  me: string | null;
}

const CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const inviteCode = () => Array.from({ length: 10 }, () => CROCK[randomInt(32)]).join("");

async function roleOf(q: Q | null, userId: string, groupId: string): Promise<Role | null> {
  if (!/^[0-9a-f-]{36}$/.test(groupId)) return null;
  const text = `select role from group_memberships where group_id = $1 and user_id = $2`;
  const rows = q ? await q.query<{ role: Role }>(text, [groupId, userId]) : await sql<{ role: Role }>(text, [groupId, userId]);
  return rows[0]?.role ?? null;
}

/** The caller's role in a group, or null when they are not a member. */
export const roleIn = (userId: string, groupId: string) => roleOf(null, userId, groupId);

export async function listGroups(userId: string): Promise<GroupSummary[]> {
  const rows = await sql<{ id: string; name: string; kind: GroupKind; role: Role; people: number; entries: number; last_at: string | null; my_net: string | null }>(
    `select g.id, g.name, g.kind, gm.role,
            (select count(*)::int from group_people p where p.group_id = g.id) as people,
            (select count(*)::int from ledger_entries e where e.group_id = g.id) as entries,
            (select max(created_at) from ledger_entries e where e.group_id = g.id) as last_at,
            (select coalesce((select sum(e.total_paise) from ledger_entries e where e.payer_person_id = p.id), 0)
                  - coalesce((select sum(s.owed_paise) from ledger_shares s where s.person_id = p.id), 0)
               from group_people p where p.group_id = g.id and p.user_id = $1 limit 1) as my_net
       from group_memberships gm join groups g on g.id = gm.group_id
      where gm.user_id = $1
      order by coalesce((select max(created_at) from ledger_entries e where e.group_id = g.id), g.created_at) desc`,
    [userId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, role: r.role, people: r.people, entries: r.entries, lastAt: r.last_at, myNet: r.my_net == null ? null : Number(r.my_net) }));
}

export async function createGroup(userId: string, name: string, kind: GroupKind, people: { name: string; vpa: string | null }[]): Promise<string> {
  return tx(async (q) => {
    const me = await q.query<{ display_name: string; default_vpa: string | null }>(`select display_name, default_vpa from users where id = $1`, [userId]);
    const g = await q.query<{ id: string }>(`insert into groups (owner_id, name, kind, invite_code) values ($1, $2, $3, $4) returning id`, [userId, name, kind, inviteCode()]);
    const id = g[0].id;
    await q.query(`insert into group_memberships (group_id, user_id, role) values ($1, $2, 'owner')`, [id, userId]);
    await q.query(`insert into group_people (group_id, name, user_id, vpa, seat) values ($1, $2, $3, $4, 1)`, [id, (me[0]?.display_name ?? "Main").slice(0, 24), userId, me[0]?.default_vpa ?? null]);
    let seat = 2;
    for (const p of people.slice(0, 19)) await q.query(`insert into group_people (group_id, name, vpa, seat) values ($1, $2, $3, $4)`, [id, p.name, p.vpa, seat++]);
    return id;
  });
}

async function peopleOf(q: Q | null, groupId: string): Promise<Person[]> {
  const text = `select id, name, seat, vpa, user_id from group_people where group_id = $1 order by seat`;
  const rows = q ? await q.query<{ id: string; name: string; seat: number; vpa: string | null; user_id: string | null }>(text, [groupId]) : await sql<{ id: string; name: string; seat: number; vpa: string | null; user_id: string | null }>(text, [groupId]);
  return rows.map((r) => ({ id: r.id, name: r.name, seat: Number(r.seat), vpa: r.vpa, userId: r.user_id }));
}

type EntryRow = { id: string; kind: LedgerEntry["kind"]; payer_person_id: string; description: string | null; total_paise: string; created_at: string; room_code: string | null; dishes: string | null; shares: { p: string; o: number }[] | null };
const toEntry = (r: EntryRow): LedgerEntry => ({
  id: r.id,
  kind: r.kind,
  payerId: r.payer_person_id,
  description: r.description ?? "",
  total: Number(r.total_paise),
  createdAt: new Date(r.created_at).toISOString(),
  roomCode: r.room_code?.trim() ?? null,
  dishes: r.dishes,
  shares: (r.shares ?? []).map((s) => ({ personId: s.p, owed: Number(s.o) })),
});
const ENTRY_SELECT = `select e.id, e.kind, e.payer_person_id, e.description, e.total_paise, e.created_at, e.room_code, e.dishes,
    (select json_agg(json_build_object('p', s.person_id, 'o', s.owed_paise)) from ledger_shares s where s.entry_id = e.id) as shares
  from ledger_entries e`;

export async function getGroup(userId: string, groupId: string): Promise<GroupFull | null> {
  const role = await roleOf(null, userId, groupId);
  if (!role) return null;
  const [g, people, entries] = await Promise.all([
    sql<{ name: string; kind: GroupKind; invite_code: string | null }>(`select name, kind, invite_code from groups where id = $1`, [groupId]),
    peopleOf(null, groupId),
    sql<EntryRow>(`${ENTRY_SELECT} where e.group_id = $1 order by e.created_at desc limit 400`, [groupId]),
  ]);
  if (!g[0]) return null;
  // balances come from every entry, not only the 400 shown
  const sums = await sql<{ id: string; net: string }>(
    `select p.id, coalesce((select sum(e.total_paise) from ledger_entries e where e.payer_person_id = p.id), 0)
                 - coalesce((select sum(s.owed_paise) from ledger_shares s where s.person_id = p.id), 0) as net
       from group_people p where p.group_id = $1`,
    [groupId],
  );
  const net = Object.fromEntries(sums.map((s) => [s.id, Number(s.net)]));
  return {
    id: groupId,
    name: g[0].name,
    kind: g[0].kind,
    role,
    inviteCode: role === "owner" ? g[0].invite_code : null,
    people,
    entries: entries.map(toEntry),
    net,
    me: people.find((p) => p.userId === userId)?.id ?? null,
  };
}

export async function balances(userId: string, groupId: string) {
  const g = await getGroup(userId, groupId);
  if (!g) return null;
  return { net: g.net, plan: ledgerPlan(g.net), people: g.people };
}

export async function renameGroup(userId: string, groupId: string, name: string) {
  const role = await roleOf(null, userId, groupId);
  if (!role) return false;
  await sql(`update groups set name = $2 where id = $1`, [groupId, name]);
  return true;
}

export async function deleteGroup(userId: string, groupId: string) {
  if ((await roleOf(null, userId, groupId)) !== "owner") return false;
  await sql(`delete from groups where id = $1`, [groupId]);
  return true;
}

/** Add people, or edit a name / UPI ID. Seats are kept, so "same seating as last time" stays stable. */
export async function upsertPeople(userId: string, groupId: string, people: { id?: string; name: string; vpa: string | null }[]) {
  return tx(async (q) => {
    if (!(await roleOf(q, userId, groupId))) return null;
    for (const p of people) {
      if (p.id) await q.query(`update group_people set name = $3, vpa = $4 where id = $1 and group_id = $2`, [p.id, groupId, p.name, p.vpa]);
      else {
        const n = await q.query<{ c: number; s: number }>(`select count(*)::int as c, coalesce(max(seat), 0)::int as s from group_people where group_id = $1`, [groupId]);
        if (n[0].c >= 20) break;
        await q.query(`insert into group_people (group_id, name, vpa, seat) values ($1, $2, $3, $4)`, [groupId, p.name, p.vpa, n[0].s + 1]);
      }
    }
    return peopleOf(q, groupId);
  });
}

export async function rotateInvite(userId: string, groupId: string) {
  if ((await roleOf(null, userId, groupId)) !== "owner") return null;
  const code = inviteCode();
  await sql(`update groups set invite_code = $2 where id = $1`, [groupId, code]);
  return code;
}

/** What an invite link shows before joining: the code itself is the permission to see the group name. */
export async function inviteInfo(code: string) {
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(code)) return null;
  const g = await sql<{ id: string; name: string; kind: GroupKind; owner: string }>(
    `select g.id, g.name, g.kind, u.display_name as owner from groups g join users u on u.id = g.owner_id where g.invite_code = $1`,
    [code],
  );
  if (!g[0]) return null;
  const open = await sql<{ id: string; name: string; seat: number }>(`select id, name, seat from group_people where group_id = $1 and user_id is null order by seat`, [g[0].id]);
  return { ...g[0], openSeats: open.map((p) => ({ ...p, seat: Number(p.seat) })) };
}

export async function joinByInvite(userId: string, code: string, personId: string | null) {
  return tx(async (q) => {
    const g = await q.query<{ id: string }>(`select id from groups where invite_code = $1 for update`, [code]);
    if (!g[0]) return null;
    const groupId = g[0].id;
    await q.query(`insert into group_memberships (group_id, user_id, role) values ($1, $2, 'editor') on conflict do nothing`, [groupId, userId]);
    const already = await q.query(`select 1 from group_people where group_id = $1 and user_id = $2`, [groupId, userId]);
    if (!already.length) {
      const took = personId ? await q.query(`update group_people set user_id = $3 where id = $2 and group_id = $1 and user_id is null returning id`, [groupId, personId, userId]) : [];
      if (!took.length) {
        const u = await q.query<{ display_name: string; default_vpa: string | null }>(`select display_name, default_vpa from users where id = $1`, [userId]);
        const n = await q.query<{ c: number; s: number }>(`select count(*)::int as c, coalesce(max(seat), 0)::int as s from group_people where group_id = $1`, [groupId]);
        if (n[0].c < 20) await q.query(`insert into group_people (group_id, name, user_id, vpa, seat) values ($1, $2, $3, $4, $5)`, [groupId, (u[0]?.display_name ?? "Dost").slice(0, 24), userId, u[0]?.default_vpa ?? null, n[0].s + 1]);
      }
    }
    return groupId;
  });
}

export async function addEntry(
  userId: string,
  groupId: string,
  e: { id?: string; kind: "expense" | "settlement"; payerId: string; description: string; total: number; shares: { personId: string; owed: number }[] },
): Promise<LedgerEntry | { error: string } | null> {
  return tx(async (q) => {
    if (!(await roleOf(q, userId, groupId))) return null;
    if (!entryIsBalanced(e)) return { error: "Hisaab barabar nahi: hisse total se milne chahiye." };
    const ids = new Set((await peopleOf(q, groupId)).map((p) => p.id));
    if (!ids.has(e.payerId) || e.shares.some((s) => !ids.has(s.personId))) return { error: "Ye naam is khate mein nahi." };
    if (e.kind === "settlement" && (e.shares.length !== 1 || e.shares[0].personId === e.payerId)) return { error: "Settlement ek se doosre ko hota hai." };
    const row = await q.query<{ id: string }>(
      `insert into ledger_entries (id, group_id, kind, payer_person_id, description, total_paise, created_by)
       values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7) on conflict (id) do nothing returning id`,
      [e.id ?? null, groupId, e.kind, e.payerId, e.description.slice(0, 80), e.total, userId],
    );
    if (!row[0]) {
      // the same client id twice: repeat-safe, return what is stored
      const ex = await q.query<EntryRow>(`${ENTRY_SELECT} where e.id = $1 and e.group_id = $2`, [e.id, groupId]);
      return ex[0] ? toEntry(ex[0]) : { error: "Ye entry pehle se kisi aur khate mein hai." };
    }
    for (const s of e.shares) await q.query(`insert into ledger_shares (entry_id, person_id, owed_paise) values ($1, $2, $3)`, [row[0].id, s.personId, s.owed]);
    const out = await q.query<EntryRow>(`${ENTRY_SELECT} where e.id = $1`, [row[0].id]);
    return toEntry(out[0]);
  });
}

export async function deleteEntry(userId: string, groupId: string, entryId: string) {
  if (!(await roleOf(null, userId, groupId))) return false;
  if (!/^[0-9a-f-]{36}$/.test(entryId)) return false;
  const r = await sql(`delete from ledger_entries where id = $1 and group_id = $2 returning id`, [entryId, groupId]);
  return r.length > 0;
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  // a leading = + - @ would run as a formula in a spreadsheet
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function exportCsv(userId: string, groupId: string): Promise<{ name: string; csv: string } | null> {
  const role = await roleOf(null, userId, groupId);
  if (!role) return null;
  const g = await sql<{ name: string }>(`select name from groups where id = $1`, [groupId]);
  const people = await peopleOf(null, groupId);
  const rows = (await sql<EntryRow>(`${ENTRY_SELECT} where e.group_id = $1 order by e.created_at`, [groupId])).map(toEntry);
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "?";
  const head = ["date", "kind", "description", "paid_by", "total_inr", ...people.map((p) => `owes_${p.name}`)];
  const lines = rows.map((e) => [
    new Date(e.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
    e.kind,
    e.description,
    name(e.payerId),
    (e.total / 100).toFixed(2),
    ...people.map((p) => ((e.shares.find((s) => s.personId === p.id)?.owed ?? 0) / 100).toFixed(2)),
  ]);
  const net = netBalances(people, rows);
  lines.push([], ["balance", "", "", "", "", ...people.map((p) => ((net[p.id] ?? 0) / 100).toFixed(2))] as string[]);
  return { name: g[0]?.name ?? "khata", csv: [head, ...lines].map((r) => r.map(csvCell).join(",")).join("\n") + "\n" };
}

/** Rooms hosted on the user's devices plus group bills, searchable by restaurant, date or dish. */
export async function history(userId: string, query: string) {
  const q = query.trim().slice(0, 40);
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rooms = await sql<{ code: string; restaurant: string | null; created_at: string; status: string; total: number; dishes: string | null; is_demo: boolean }>(
    `select r.code, r.restaurant, r.created_at, r.status, r.is_demo,
            coalesce((select sum(i.amount_paise) from items i where i.room_code = r.code), 0)::bigint as total,
            (select string_agg(i.name, ', ' order by i.pos) from items i where i.room_code = r.code) as dishes
       from rooms r
      where r.expires_at > now()
        and (r.owner_user_id = $1
             or exists (select 1 from members m join devices d on d.id_hash = m.device_hash where m.room_code = r.code and d.user_id = $1))
        and ($2 = '' or r.restaurant ilike $3
             or exists (select 1 from items i where i.room_code = r.code and i.name ilike $3)
             or to_char(r.created_at at time zone 'Asia/Kolkata', 'DD Mon YYYY') ilike $3
             or to_char(r.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') ilike $3)
      order by r.created_at desc limit 60`,
    [userId, q, like],
  );
  const bills = await sql<{ id: string; group_id: string; group_name: string; description: string | null; created_at: string; total_paise: string; dishes: string | null; room_code: string | null }>(
    `select e.id, e.group_id, g.name as group_name, e.description, e.created_at, e.total_paise, e.dishes, e.room_code
       from ledger_entries e join groups g on g.id = e.group_id
       join group_memberships gm on gm.group_id = e.group_id and gm.user_id = $1
      where e.kind <> 'settlement'
        and ($2 = '' or e.description ilike $3 or e.dishes ilike $3
             or to_char(e.created_at at time zone 'Asia/Kolkata', 'DD Mon YYYY') ilike $3
             or to_char(e.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') ilike $3)
      order by e.created_at desc limit 60`,
    [userId, q, like],
  );
  return {
    rooms: rooms.map((r) => ({ code: r.code.trim(), restaurant: r.restaurant ?? "", createdAt: new Date(r.created_at).toISOString(), status: r.status, total: Number(r.total), dishes: r.dishes ?? "", demo: r.is_demo })),
    bills: bills.map((b) => ({ id: b.id, groupId: b.group_id, groupName: b.group_name, description: b.description ?? "", createdAt: new Date(b.created_at).toISOString(), total: Number(b.total_paise), dishes: b.dishes ?? "", roomCode: b.room_code?.trim() ?? null })),
  };
}

/**
 * A room opened from a group: map its seats onto the group's people. A seat that already carries a
 * personId keeps it, then names are matched, and anyone new is added to the group as a person.
 */
export async function seatsToPeople(q: Q, userId: string, groupId: string, members: { id: string; name: string; personId?: string | null }[]) {
  if (!(await roleOf(q, userId, groupId))) return null;
  const people = await peopleOf(q, groupId);
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const m of members) {
    const p = (m.personId && people.find((x) => x.id === m.personId && !used.has(x.id))) || people.find((x) => !used.has(x.id) && x.name.trim().toLowerCase() === m.name.trim().toLowerCase());
    if (p) {
      used.add(p.id);
      out[m.id] = p.id;
    }
  }
  // the host's own seat is the signed-in user's person when nothing else matched
  const mine = people.find((p) => p.userId === userId);
  if (mine && members[0] && !out[members[0].id] && !used.has(mine.id)) {
    out[members[0].id] = mine.id;
    used.add(mine.id);
  }
  let seat = Math.max(0, ...people.map((p) => p.seat));
  for (const m of members) {
    if (out[m.id]) continue;
    if (seat >= 20) break;
    const r = await q.query<{ id: string }>(`insert into group_people (group_id, name, seat) values ($1, $2, $3) returning id`, [groupId, m.name.slice(0, 24), ++seat]);
    out[m.id] = r[0].id;
  }
  return out;
}
