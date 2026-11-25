// Khata maths: whole paise only, shared by the phone (instant feedback) and the API (source of truth).
import { allocate, settlePlan } from "./index";

export type EntryKind = "bill" | "settlement" | "expense";
export interface LedgerShare { personId: string; owed: number }
export interface LedgerEntry {
  id: string;
  kind: EntryKind;
  payerId: string;
  description: string;
  total: number;
  shares: LedgerShare[];
  createdAt: string;
  roomCode: string | null;
  dishes: string | null;
}
export interface Person { id: string; name: string; seat: number; vpa: string | null; userId: string | null }

/** net > 0: the group owes this person. net < 0: this person owes the group. */
export function netBalances(people: Pick<Person, "id">[], entries: LedgerEntry[]): Record<string, number> {
  const net: Record<string, number> = Object.fromEntries(people.map((p) => [p.id, 0]));
  for (const e of entries) applyEntry(net, e, 1);
  return net;
}

export function applyEntry(net: Record<string, number>, e: Pick<LedgerEntry, "payerId" | "total" | "shares">, sign: 1 | -1) {
  net[e.payerId] = (net[e.payerId] ?? 0) + sign * e.total;
  for (const s of e.shares) net[s.personId] = (net[s.personId] ?? 0) - sign * s.owed;
}

export type SplitMode = "equal" | "shares" | "exact";

/**
 * Split an expense across people.
 * equal: everyone picked pays the same, leftover paise by seat order.
 * shares: weights 1 to 12 (2 shares for the couple, 1 for the single).
 * exact: typed amounts, which must add up to the total.
 */
export function splitExpense(
  total: number,
  picked: { id: string; seat: number; weight?: number; amount?: number }[],
  mode: SplitMode,
): { shares: LedgerShare[]; error: string | null } {
  if (!picked.length) return { shares: [], error: "Kiske liye? Kam se kam ek naam chuno." };
  if (!Number.isInteger(total) || total <= 0) return { shares: [], error: "Rakam likho." };
  if (mode === "exact") {
    const shares = picked.map((p) => ({ personId: p.id, owed: Math.max(0, Math.trunc(p.amount ?? 0)) }));
    const sum = shares.reduce((a, s) => a + s.owed, 0);
    if (sum !== total) return { shares, error: sum < total ? `₹${((total - sum) / 100).toFixed(2)} abhi kisi pe nahi` : `₹${((sum - total) / 100).toFixed(2)} zyada likha hai` };
    return { shares: shares.filter((s) => s.owed > 0), error: null };
  }
  const weights = picked.map((p) => (mode === "shares" ? Math.max(1, Math.min(12, Math.trunc(p.weight ?? 1))) : 1));
  const { shares } = allocate(total, weights, picked.map((p) => p.seat));
  return { shares: picked.map((p, k) => ({ personId: p.id, owed: shares[k] })).filter((s) => s.owed > 0), error: null };
}

export function ledgerPlan(net: Record<string, number>) {
  return settlePlan(Object.entries(net).map(([id, n]) => ({ id, net: n })));
}

/** Entries must balance: the shares add up to the total, every time. */
export function entryIsBalanced(e: Pick<LedgerEntry, "total" | "shares">) {
  return e.total > 0 && e.shares.length > 0 && e.shares.reduce((a, s) => a + s.owed, 0) === e.total && e.shares.every((s) => s.owed > 0);
}
