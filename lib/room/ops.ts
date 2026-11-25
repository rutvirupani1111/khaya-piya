// Room state and repeat-safe operations. Pure, shared by phone and server, so both produce the same snapshot.
import { computeBill, type BillResult, type Charge, type Claim, type Item, type Member } from "../money";

export type PayState = "unpaid" | "sent" | "received" | "cash";
export type RoomStatus = "open" | "locked" | "final" | "closed";

export interface RoomMember extends Member {
  joined: boolean;
  /** set when the room was opened from a Khata group: this seat's person in that group */
  personId?: string | null;
}
export interface Payment { state: PayState; amount: number | null; sentAt: string | null; confirmedAt: string | null }

export interface RoomState {
  status: RoomStatus;
  restaurant: string;
  payeeName: string;
  printedTotal: number | null;
  hostMemberId: string;
  isDemo: boolean;
  members: RoomMember[];
  items: Item[];
  charges: Charge[];
  claims: Claim[];
  payments: Record<string, Payment>;
}

export interface Snapshot extends RoomState {
  code: string;
  groupName?: string | null;
  version: number;
  vpa?: string;
  vpaMasked: string;
  bill: BillResult;
}

export type Op = { opId: string; type: string; [k: string]: unknown };
export interface Actor { isHost: boolean; memberId: string | null }

export function billOf(s: Pick<RoomState, "members" | "items" | "charges" | "claims" | "printedTotal">): BillResult {
  return computeBill({ members: s.members, items: s.items, charges: s.charges, claims: s.claims, printedTotal: s.printedTotal });
}

export function maskVpa(v: string | null | undefined) {
  if (!v) return "";
  const [u, h] = v.split("@");
  return `${u.slice(0, 2)}****@${h ?? ""}`;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const int = (v: unknown, lo: number, hi: number) => {
  const n = typeof v === "number" ? Math.trunc(v) : NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

type R = { ok: true; state: RoomState } | { ok: false; reason: string };

function clone(s: RoomState): RoomState {
  return JSON.parse(JSON.stringify(s)) as RoomState;
}

export function applyOp(prev: RoomState, op: Op, actor: Actor, now = new Date().toISOString()): R {
  const s = clone(prev);
  const host = actor.isHost;
  const guestBlocked = !host && (s.status === "locked" || s.status === "final" || s.status === "closed");
  if (s.status === "closed" && op.type !== "reopen") return { ok: false, reason: "closed" };
  const own = (memberId: string) => host || (actor.memberId != null && actor.memberId === memberId);
  const itemById = (id: string) => s.items.find((i) => i.id === id);
  const memberById = (id: string) => s.members.find((m) => m.id === id);
  const hostOnly = () => (host ? null : "host_only");

  switch (op.type) {
    case "claim":
    case "set_weight": {
      const itemId = str(op.itemId);
      const memberId = str(op.memberId);
      if (!itemById(itemId) || !memberById(memberId)) return { ok: false, reason: "not_found" };
      if (!own(memberId)) return { ok: false, reason: "not_your_seat" };
      if (guestBlocked || s.status === "final") return { ok: false, reason: "locked" };
      const weight = op.weight == null ? 1 : int(op.weight, 1, 12);
      if (weight == null) return { ok: false, reason: "bad_weight" };
      const ex = s.claims.find((c) => c.itemId === itemId && c.memberId === memberId);
      if (ex) ex.weight = op.type === "claim" && op.weight == null ? ex.weight : weight;
      else if (op.type === "claim") s.claims.push({ itemId, memberId, weight });
      else return { ok: false, reason: "not_claimed" };
      return { ok: true, state: s };
    }
    case "unclaim": {
      const itemId = str(op.itemId);
      const memberId = str(op.memberId);
      if (!own(memberId)) return { ok: false, reason: "not_your_seat" };
      if (guestBlocked || s.status === "final") return { ok: false, reason: "locked" };
      s.claims = s.claims.filter((c) => !(c.itemId === itemId && c.memberId === memberId));
      return { ok: true, state: s };
    }
    case "split_units": {
      const e = hostOnly();
      if (e) return { ok: false, reason: e };
      const it = itemById(str(op.itemId));
      if (!it || it.qty < 2) return { ok: false, reason: "not_splittable" };
      if (s.items.length + it.qty - 1 > 80) return { ok: false, reason: "too_many_items" };
      const ids = Array.isArray(op.newIds) ? (op.newIds as unknown[]).map(str) : [];
      if (ids.length !== it.qty - 1 || ids.some((x) => !/^[0-9a-f-]{36}$/.test(x))) return { ok: false, reason: "bad_ids" };
      const unit = Math.floor(it.amount / it.qty);
      const extra = it.amount - unit * it.qty;
      const idx = s.items.indexOf(it);
      const name = it.name;
      const units: Item[] = [{ ...it, qty: 1, amount: unit + extra, name }];
      ids.forEach((id) => units.push({ id, name, qty: 1, amount: unit, kind: it.kind }));
      s.items.splice(idx, 1, ...units);
      for (const c of s.charges) if (c.scope && c.scope.includes(it.id)) c.scope.push(...ids);
      return { ok: true, state: s };
    }
    case "add_item":
    case "edit_item": {
      const e = hostOnly();
      if (e) return { ok: false, reason: e };
      const id = str(op.id);
      const name = str(op.name).trim().slice(0, 60);
      const qty = int(op.qty ?? 1, 1, 99);
      const amount = int(op.amount, 0, 100_000_000);
      const kind = op.kind === "drink" || op.kind === "other" ? op.kind : "food";
      if (!name || qty == null || amount == null) return { ok: false, reason: "bad_item" };
      const ex = itemById(id);
      if (op.type === "add_item") {
        if (ex) return { ok: true, state: s };
        if (s.items.length >= 80) return { ok: false, reason: "too_many_items" };
        if (!/^[0-9a-f-]{36}$/.test(id)) return { ok: false, reason: "bad_id" };
        s.items.push({ id, name, qty, amount, kind });
      } else {
        if (!ex) return { ok: false, reason: "not_found" };
        Object.assign(ex, { name, qty, amount, kind });
      }
      return { ok: true, state: s };
    }
    case "delete_item": {
      const e = hostOnly();
      if (e) return { ok: false, reason: e };
      const id = str(op.itemId);
      s.items = s.items.filter((i) => i.id !== id);
      s.claims = s.claims.filter((c) => c.itemId !== id);
      return { ok: true, state: s };
    }
    case "set_charge": {
      const e = hostOnly();
      if (e) return { ok: false, reason: e };
      const c = op.charge as Charge | undefined;
      if (!c || typeof c !== "object") return { ok: false, reason: "bad_charge" };
      if (c.scope && c.scope.some((id) => !itemById(id))) return { ok: false, reason: "scope_not_in_room" };
      const ex = s.charges.findIndex((x) => x.id === c.id);
      const clean: Charge = {
        id: str(c.id),
        kind: c.kind,
        label: str(c.label).slice(0, 30),
        mode: c.mode === "percent" ? "percent" : "amount",
        value: int(c.value, -100_000_000, 100_000_000) ?? 0,
        scope: c.scope ?? null,
        split: c.split === "equal" ? "equal" : "proportional",
        included: !!c.included,
        removed: !!c.removed,
      };
      if (ex >= 0) s.charges[ex] = clean;
      else if (s.charges.length < 12) s.charges.push(clean);
      else return { ok: false, reason: "too_many_charges" };
      return { ok: true, state: s };
    }
    case "remove_charge": {
      const e = hostOnly();
      if (e) return { ok: false, reason: e };
      s.charges = s.charges.filter((c) => c.id !== str(op.chargeId));
      return { ok: true, state: s };
    }
    case "add_seat": {
      const e = hostOnly();
      if (e) return { ok: false, reason: e };
      if (s.members.length >= 20) return { ok: false, reason: "too_many_seats" };
      const id = str(op.id);
      if (memberById(id)) return { ok: true, state: s };
      const name = str(op.name).trim().slice(0, 24);
      if (!name || !/^[0-9a-f-]{36}$/.test(id)) return { ok: false, reason: "bad_seat" };
      const seat = Math.max(0, ...s.members.map((m) => m.seat)) + 1;
      s.members.push({ id, seat, name, joined: false });
      s.payments[id] = { state: "unpaid", amount: null, sentAt: null, confirmedAt: null };
      return { ok: true, state: s };
    }
    case "rename_seat": {
      const m = memberById(str(op.memberId));
      if (!m) return { ok: false, reason: "not_found" };
      if (!own(m.id)) return { ok: false, reason: "not_your_seat" };
      const name = str(op.name).trim().slice(0, 24);
      if (!name) return { ok: false, reason: "bad_name" };
      m.name = name;
      return { ok: true, state: s };
    }
    case "reset_seat_device": {
      const e = hostOnly();
      if (e) return { ok: false, reason: e };
      const m = memberById(str(op.memberId));
      if (!m) return { ok: false, reason: "not_found" };
      m.joined = false;
      return { ok: true, state: s };
    }
    case "mark_sent":
    case "unmark_sent": {
      const memberId = str(op.memberId);
      const m = memberById(memberId);
      if (!m) return { ok: false, reason: "not_found" };
      if (!(actor.memberId === memberId || host)) return { ok: false, reason: "not_your_seat" };
      const p = s.payments[memberId] ?? { state: "unpaid", amount: null, sentAt: null, confirmedAt: null };
      if (p.state === "received" || p.state === "cash") return { ok: false, reason: "already_settled" };
      if (op.type === "mark_sent") {
        const bill = billOf(s);
        s.payments[memberId] = { ...p, state: "sent", amount: bill.perMember[memberId]?.total ?? 0, sentAt: now };
      } else s.payments[memberId] = { ...p, state: "unpaid", sentAt: null };
      return { ok: true, state: s };
    }
    case "confirm_received":
    case "reject_received":
    case "mark_cash": {
      const e = hostOnly();
      if (e) return { ok: false, reason: e };
      const memberId = str(op.memberId);
      if (!memberById(memberId)) return { ok: false, reason: "not_found" };
      const p = s.payments[memberId] ?? { state: "unpaid", amount: null, sentAt: null, confirmedAt: null };
      const amt = billOf(s).perMember[memberId]?.total ?? 0;
      if (op.type === "reject_received") s.payments[memberId] = { ...p, state: "unpaid", confirmedAt: null };
      else s.payments[memberId] = { ...p, state: op.type === "mark_cash" ? "cash" : "received", amount: p.amount ?? amt, confirmedAt: now };
      return { ok: true, state: s };
    }
    case "undo_confirm": {
      // the host takes back a Mila / Cash tapped by mistake: back to "sent" if the guest had sent, else unpaid
      const e = hostOnly();
      if (e) return { ok: false, reason: e };
      const memberId = str(op.memberId);
      const p = s.payments[memberId];
      if (!p || (p.state !== "received" && p.state !== "cash")) return { ok: false, reason: "not_settled" };
      s.payments[memberId] = p.sentAt ? { ...p, state: "sent", confirmedAt: null } : { ...p, state: "unpaid", amount: null, confirmedAt: null };
      return { ok: true, state: s };
    }
    case "lock":
    case "unlock":
    case "finalize":
    case "reopen":
    case "close":
    case "transfer_host": {
      const e = hostOnly();
      if (e) return { ok: false, reason: e };
      if (op.type === "lock") s.status = "locked";
      if (op.type === "unlock" || op.type === "reopen") s.status = "open";
      if (op.type === "finalize") {
        const b = billOf(s);
        if (b.unclaimed.length) return { ok: false, reason: "unclaimed_items" };
        if (b.diff !== 0) return { ok: false, reason: "not_balanced" };
        s.status = "final";
      }
      if (op.type === "close") {
        s.status = "closed";
        s.payeeName = "";
        s.members.forEach((m, i) => (m.name = `Seat ${i + 1}`));
      }
      if (op.type === "transfer_host") {
        const m = memberById(str(op.memberId));
        if (!m || !m.joined) return { ok: false, reason: "member_not_joined" };
        s.hostMemberId = m.id;
      }
      return { ok: true, state: s };
    }
  }
  return { ok: false, reason: "unknown_op" };
}

export function isSettled(s: RoomState) {
  return s.members.every((m) => m.id === s.hostMemberId || ["received", "cash"].includes(s.payments[m.id]?.state ?? "unpaid"));
}
