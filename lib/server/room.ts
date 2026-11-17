import type { NextRequest, NextResponse } from "next/server";
import { sql, tx, type Q } from "../db";
import { applyOp, billOf, maskVpa, type Actor, type Op, type RoomState, type Snapshot } from "../room/ops";
import { DEV_COOKIE, hostCookie, sha256, token } from "./security";

export interface RoomRow {
  code: string;
  version: string | number;
  status: string;
  vpa: string | null;
  host_token_hash: Buffer;
  is_demo: boolean;
  snapshot: RoomState;
  group_id: string | null;
  expires_at: string;
}

export function deviceToken(req: NextRequest): { tok: string; fresh: boolean } {
  const c = req.cookies.get(DEV_COOKIE)?.value || req.headers.get("x-kp-dev") || "";
  if (/^[A-Za-z0-9_-]{40,60}$/.test(c)) return { tok: c, fresh: !req.cookies.get(DEV_COOKIE) };
  return { tok: token(32), fresh: true };
}

export function setDeviceCookie(res: NextResponse, tok: string) {
  res.cookies.set(DEV_COOKIE, tok, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 400 * 86400 });
}
export function setHostCookie(res: NextResponse, code: string, tok: string) {
  res.cookies.set(hostCookie(code), tok, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 86400 });
}

export async function loadRoom(q: Q | null, code: string, lock = false): Promise<RoomRow | null> {
  const text = `select code, version, status, vpa, host_token_hash, is_demo, snapshot, group_id, expires_at
                from rooms where code = $1 and expires_at > now()${lock ? " for update" : ""}`;
  const rows = q ? await q.query<RoomRow>(text, [code]) : await sql<RoomRow>(text, [code]);
  return rows[0] ?? null;
}

export async function resolveActor(q: Q | null, room: RoomRow, hostTok: string | undefined, devTok: string): Promise<Actor> {
  const isHost = !!hostTok && Buffer.compare(sha256(hostTok), Buffer.from(room.host_token_hash)) === 0;
  const text = `select id from members where room_code = $1 and device_hash = $2`;
  const rows = q ? await q.query<{ id: string }>(text, [room.code, sha256(devTok)]) : await sql<{ id: string }>(text, [room.code, sha256(devTok)]);
  let memberId = rows[0]?.id ?? null;
  if (isHost && !memberId) memberId = room.snapshot.hostMemberId;
  return { isHost, memberId };
}

export function toSnapshot(room: RoomRow, actor: Actor): Snapshot & { me: Actor } {
  const s = room.snapshot;
  const showVpa = actor.isHost || !!actor.memberId;
  return {
    ...s,
    code: room.code,
    version: Number(room.version),
    ...(showVpa && room.vpa ? { vpa: room.vpa } : {}),
    vpaMasked: showVpa ? maskVpa(room.vpa) : "",
    bill: billOf(s),
    me: actor,
  };
}

/** Mirror the canonical state into the normalized tables. Rooms are small (<= 80 items, 20 seats). */
export async function syncTables(q: Q, code: string, s: RoomState) {
  for (const m of s.members) {
    await q.query(
      `insert into members (id, room_code, seat, name) values ($1, $2, $3, $4)
       on conflict (id) do update set name = excluded.name, seat = excluded.seat`,
      [m.id, code, m.seat, m.name],
    );
    const p = s.payments[m.id] ?? { state: "unpaid", amount: null, sentAt: null, confirmedAt: null };
    await q.query(
      `insert into payments (member_id, room_code, state, amount_paise, sent_at, confirmed_at) values ($1, $2, $3, $4, $5, $6)
       on conflict (member_id) do update set state = excluded.state, amount_paise = excluded.amount_paise, sent_at = excluded.sent_at, confirmed_at = excluded.confirmed_at`,
      [m.id, code, p.state, p.amount, p.sentAt, p.confirmedAt],
    );
  }
  await q.query(`delete from items where room_code = $1`, [code]);
  await q.query(`delete from charges where room_code = $1`, [code]);
  if (s.items.length) {
    await q.query(
      `insert into items (id, room_code, pos, name, qty, amount_paise, kind)
       select * from unnest($1::uuid[], $2::char(7)[], $3::smallint[], $4::text[], $5::smallint[], $6::bigint[], $7::text[])`,
      [s.items.map((i) => i.id), s.items.map(() => code), s.items.map((_, k) => k), s.items.map((i) => i.name), s.items.map((i) => i.qty), s.items.map((i) => i.amount), s.items.map((i) => i.kind)],
    );
  }
  if (s.claims.length) {
    await q.query(
      `insert into claims (item_id, member_id, weight) select * from unnest($1::uuid[], $2::uuid[], $3::smallint[])`,
      [s.claims.map((c) => c.itemId), s.claims.map((c) => c.memberId), s.claims.map((c) => c.weight)],
    );
  }
  for (const [k, c] of s.charges.entries()) {
    await q.query(
      `insert into charges (id, room_code, pos, kind, label, mode, value, scope_item_ids, split, included_in_prices, removed)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [c.id, code, k, c.kind, c.label || c.kind, c.mode, c.value, c.scope, c.split, c.included, c.removed],
    );
  }
}

export async function writeRoom(q: Q, room: RoomRow, s: RoomState, version: number) {
  const ttl = room.is_demo ? "24 hours" : "30 days";
  await q.query(
    `update rooms set snapshot = $2, version = $3, status = $4, payee_name = $5,
       vpa = case when $4 = 'closed' then null else vpa end,
       host_member_id = $6, updated_at = now(),
       expires_at = case when is_demo then expires_at else now() + interval '${ttl}' end
     where code = $1`,
    [room.code, JSON.stringify(s), version, s.status, s.payeeName || null, s.hostMemberId],
  );
  await syncTables(q, room.code, s);
}

export interface OpResult { version: number; rejected: { opId: string; reason: string }[]; room: RoomRow; actor: Actor }

export async function runOps(code: string, ops: Op[], hostTok: string | undefined, devTok: string): Promise<OpResult | null> {
  return tx(async (q) => {
    const room = await loadRoom(q, code, true);
    if (!room) return null;
    const actor = await resolveActor(q, room, hostTok, devTok);
    let state = room.snapshot;
    let version = Number(room.version);
    const rejected: { opId: string; reason: string }[] = [];
    let changed = false;
    for (const op of ops) {
      const seen = await q.query(`select 1 from ops where op_id = $1`, [op.opId]);
      if (seen.length) continue;
      if (!actor.isHost && !actor.memberId) {
        rejected.push({ opId: op.opId, reason: "join_first" });
        continue;
      }
      const r = applyOp(state, op, actor);
      if (!r.ok) {
        rejected.push({ opId: op.opId, reason: r.reason });
        continue;
      }
      state = r.state;
      version += 1;
      changed = true;
      const { opId, type, ...payload } = op;
      await q.query(`insert into ops (room_code, version, op_id, member_id, is_host, type, payload) values ($1, $2, $3, $4, $5, $6, $7)`, [
        code, version, opId, actor.memberId, actor.isHost, type, JSON.stringify(payload),
      ]);
      if (type === "reset_seat_device") await q.query(`update members set device_hash = null where id = $1 and room_code = $2`, [String(payload.memberId), code]);
    }
    if (changed) {
      await writeRoom(q, room, state, version);
      await ledgerHooks(q, room, state, ops);
    }
    return { version, rejected, room: { ...room, snapshot: state, version, status: state.status, vpa: state.status === "closed" ? null : room.vpa }, actor };
  });
}

/** Group rooms write ledger rows: a bill entry on finalize, a settlement on Mila / Cash. */
async function ledgerHooks(q: Q, room: RoomRow, s: RoomState, ops: Op[]) {
  if (!room.group_id) return;
  const people = await q.query<{ id: string; seat: number }>(`select id, seat from group_people where group_id = $1`, [room.group_id]);
  const owner = await q.query<{ owner_id: string }>(`select owner_id from groups where id = $1`, [room.group_id]);
  if (!owner[0]) return;
  const personFor = (memberId: string) => {
    const m = s.members.find((x) => x.id === memberId);
    return people.find((p) => p.seat === m?.seat)?.id;
  };
  const payer = personFor(s.hostMemberId);
  if (!payer) return;
  const bill = billOf(s);
  for (const op of ops) {
    if (op.type === "finalize") {
      const e = await q.query<{ id: string }>(
        `insert into ledger_entries (group_id, room_code, kind, payer_person_id, description, total_paise, created_by) values ($1, $2, 'bill', $3, $4, $5, $6) returning id`,
        [room.group_id, room.code, payer, (s.restaurant || "Bill").slice(0, 80), bill.computedTotal, owner[0].owner_id],
      );
      for (const m of s.members) {
        const pid = personFor(m.id);
        if (pid) await q.query(`insert into ledger_shares (entry_id, person_id, owed_paise) values ($1, $2, $3) on conflict do nothing`, [e[0].id, pid, bill.perMember[m.id]?.total ?? 0]);
      }
    }
    if (op.type === "confirm_received" || op.type === "mark_cash") {
      const from = personFor(String(op.memberId));
      if (!from || from === payer) continue;
      const amt = s.payments[String(op.memberId)]?.amount ?? 0;
      const e = await q.query<{ id: string }>(
        `insert into ledger_entries (group_id, room_code, kind, payer_person_id, description, total_paise, created_by) values ($1, $2, 'settlement', $3, $4, $5, $6) returning id`,
        [room.group_id, room.code, from, "Room settlement", amt, owner[0].owner_id],
      );
      await q.query(`insert into ledger_shares (entry_id, person_id, owed_paise) values ($1, $2, $3)`, [e[0].id, payer, amt]);
    }
  }
}

export async function joinRoom(code: string, devTok: string, hostTok: string | undefined, name: string, seatId: string | null) {
  return tx(async (q) => {
    const room = await loadRoom(q, code, true);
    if (!room) return { error: "not_found" as const };
    const actor = await resolveActor(q, room, hostTok, devTok);
    if (actor.memberId) return { room, actor };
    const s = room.snapshot;
    if (s.status === "closed") return { error: "closed" as const };
    const devHash = sha256(devTok);
    let memberId: string;
    const placeholder = seatId ? s.members.find((m) => m.id === seatId && !m.joined && m.id !== s.hostMemberId) : undefined;
    if (placeholder) {
      placeholder.joined = true;
      placeholder.name = name;
      memberId = placeholder.id;
    } else {
      if (s.members.length >= 20) return { error: "full" as const };
      memberId = crypto.randomUUID();
      const seat = Math.max(0, ...s.members.map((m) => m.seat)) + 1;
      s.members.push({ id: memberId, seat, name, joined: true });
      s.payments[memberId] = { state: "unpaid", amount: null, sentAt: null, confirmedAt: null };
    }
    const version = Number(room.version) + 1;
    await q.query(`insert into ops (room_code, version, op_id, member_id, is_host, type, payload) values ($1, $2, $3, $4, false, 'join', $5)`, [
      code, version, crypto.randomUUID(), memberId, JSON.stringify({ name }),
    ]);
    await writeRoom(q, room, s, version);
    await q.query(`update members set device_hash = $1, joined_at = now() where id = $2`, [devHash, memberId]);
    const fresh = { ...room, snapshot: s, version };
    return { room: fresh, actor: { isHost: false, memberId } };
  });
}
