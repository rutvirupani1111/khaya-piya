// KhayaPiya money engine. Whole paise only, no floats in any calculation.
// Shared by the phone (instant feedback) and the API (source of truth).

export type Kind = "food" | "drink" | "other";
export type ChargeKind =
  | "cgst" | "sgst" | "utgst" | "igst" | "vat" | "service" | "packing"
  | "delivery" | "tip" | "discount" | "roundoff" | "other";

export interface Member { id: string; seat: number; name: string }
export interface Item { id: string; name: string; qty: number; amount: number; kind: Kind }
export interface Charge {
  id: string;
  kind: ChargeKind;
  label: string;
  mode: "amount" | "percent";
  value: number; // paise, or basis points in percent mode
  scope: string[] | null; // item ids, null = every item
  split: "proportional" | "equal";
  included: boolean;
  removed: boolean;
}
export interface Claim { itemId: string; memberId: string; weight: number }

export interface BillInput {
  members: Member[];
  items: Item[];
  charges: Charge[];
  claims: Claim[];
  printedTotal: number | null;
}

export interface Bonus { memberId: string; on: string; label: string }

export interface MemberBill {
  items: number;
  lines: { itemId: string; share: number; weight: number; of: number }[];
  charges: Record<string, number>;
  total: number;
}

export interface BillResult {
  perMember: Record<string, MemberBill>;
  chargeAmounts: Record<string, number>;
  itemsTotal: number;
  chargesTotal: number;
  computedTotal: number;
  unclaimed: string[];
  diff: number; // printed - computed (after auto round-off). 0 when no printed total.
  autoRoundoff: number;
  balanced: boolean;
  discountErrors: string[];
  bonuses: Bonus[];
}

const UNCLAIMED = "_";

/** Largest-remainder split. Ties on remainder go to the lower seat. */
export function allocate(total: number, weights: number[], seats: number[]): { shares: number[]; bonus: number[] } {
  const n = weights.length;
  const shares = new Array<number>(n).fill(0);
  const bonus = new Array<number>(n).fill(0);
  const W = weights.reduce((a, b) => a + b, 0);
  if (n === 0 || W <= 0 || total === 0) return { shares, bonus };
  const neg = total < 0;
  const T = BigInt(Math.abs(total));
  const BW = BigInt(W);
  const rem: { k: number; r: bigint }[] = [];
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const p = T * BigInt(weights[k]);
    shares[k] = Number(p / BW);
    sum += shares[k];
    rem.push({ k, r: p % BW });
  }
  let left = Math.abs(total) - sum;
  rem.sort((a, b) => (a.r === b.r ? seats[a.k] - seats[b.k] : a.r > b.r ? -1 : 1));
  for (let i = 0; i < rem.length && left > 0; i++) {
    if (weights[rem[i].k] === 0) continue;
    shares[rem[i].k] += 1;
    bonus[rem[i].k] = 1;
    left--;
  }
  if (neg) for (let k = 0; k < n; k++) shares[k] = -shares[k];
  return { shares, bonus };
}

function roundHalfEven(num: bigint, den: bigint): number {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den || (twice === den && q % 2n !== 0n)) return Number(q + 1n);
  return Number(q);
}

export function chargeIsNegative(kind: ChargeKind) {
  return kind === "discount";
}

export function computeBill(input: BillInput): BillResult {
  const members = [...input.members].sort((a, b) => a.seat - b.seat);
  const per: Record<string, MemberBill> = {};
  for (const m of members) per[m.id] = { items: 0, lines: [], charges: {}, total: 0 };
  const bonuses: Bonus[] = [];
  const seatOf = (id: string) => (id === UNCLAIMED ? 9999 : members.find((m) => m.id === id)?.seat ?? 9998);
  const validIds = new Set(members.map((m) => m.id));

  // 1. item shares; unclaimed items go to a pseudo-member so charges are not inflated for claimers
  const itemShare: Record<string, Record<string, number>> = {};
  const unclaimed: string[] = [];
  let itemsTotal = 0;
  for (const it of input.items) {
    itemsTotal += it.amount;
    const cl = input.claims.filter((c) => c.itemId === it.id && validIds.has(c.memberId) && c.weight > 0);
    cl.sort((a, b) => seatOf(a.memberId) - seatOf(b.memberId));
    itemShare[it.id] = {};
    if (cl.length === 0) {
      unclaimed.push(it.id);
      itemShare[it.id][UNCLAIMED] = it.amount;
      continue;
    }
    const W = cl.reduce((a, c) => a + c.weight, 0);
    const { shares, bonus } = allocate(it.amount, cl.map((c) => c.weight), cl.map((c) => seatOf(c.memberId)));
    cl.forEach((c, k) => {
      itemShare[it.id][c.memberId] = shares[k];
      per[c.memberId].items += shares[k];
      per[c.memberId].lines.push({ itemId: it.id, share: shares[k], weight: c.weight, of: W });
      if (bonus[k] && cl.length > 1) bonuses.push({ memberId: c.memberId, on: it.id, label: it.name });
    });
  }

  // 2. charges
  const chargeAmounts: Record<string, number> = {};
  const discountErrors: string[] = [];
  let chargesTotal = 0;
  const holders = [...members.map((m) => m.id), UNCLAIMED];
  const splitCharge = (c: Charge, amount: number) => {
    const scope = c.scope ? new Set(c.scope) : null;
    const base: Record<string, number> = {};
    for (const h of holders) base[h] = 0;
    for (const it of input.items) {
      if (scope && !scope.has(it.id)) continue;
      for (const [h, s] of Object.entries(itemShare[it.id] || {})) base[h] = (base[h] || 0) + s;
    }
    const ids = holders.filter((h) => base[h] > 0);
    const weights = ids.map((h) => (c.split === "equal" ? (h === UNCLAIMED ? 0 : 1) : base[h]));
    if (c.split === "equal" && ids.includes(UNCLAIMED)) {
      // equal split among claimers only; the unclaimed part waits as a proportional slice
      const uncl = base[UNCLAIMED];
      const scopeTotal = Object.values(base).reduce((a, b) => a + b, 0);
      const reserved = scopeTotal > 0 ? Math.floor((amount * uncl) / scopeTotal) : 0;
      const real = ids.filter((h) => h !== UNCLAIMED);
      const { shares, bonus } = allocate(amount - reserved, real.map(() => 1), real.map(seatOf));
      real.forEach((h, k) => give(c, h, shares[k], bonus[k], real.length));
      return;
    }
    const { shares, bonus } = allocate(amount, weights, ids.map(seatOf));
    ids.forEach((h, k) => give(c, h, shares[k], bonus[k], ids.length));
  };
  const give = (c: Charge, h: string, amt: number, b: number, n: number) => {
    if (h === UNCLAIMED || !per[h]) return;
    per[h].charges[c.id] = (per[h].charges[c.id] || 0) + amt;
    if (b && n > 1) bonuses.push({ memberId: h, on: c.id, label: c.label });
  };

  const scopeTotalOf = (c: Charge) =>
    input.items.filter((it) => !c.scope || c.scope.includes(it.id)).reduce((a, it) => a + it.amount, 0);

  const amountOf = (c: Charge): number => {
    if (c.included || c.removed) return 0;
    let a: number;
    if (c.mode === "percent") a = roundHalfEven(BigInt(Math.abs(c.value)) * BigInt(scopeTotalOf(c)), 10000n);
    else a = Math.abs(c.value);
    if (chargeIsNegative(c.kind)) a = -a;
    else if (c.kind === "roundoff") a = c.value < 0 ? -a : a;
    return a;
  };

  for (const c of input.charges) {
    let a = amountOf(c);
    if (c.kind === "discount" && Math.abs(a) > scopeTotalOf(c)) {
      discountErrors.push(c.id);
      a = 0;
    }
    chargeAmounts[c.id] = a;
    chargesTotal += a;
    if (a !== 0) splitCharge(c, a);
  }

  // 3. auto round-off against the printed grand total
  let computed = itemsTotal + chargesTotal;
  let autoRoundoff = 0;
  const hasRoundoff = input.charges.some((c) => c.kind === "roundoff" && !c.removed);
  if (input.printedTotal != null && !hasRoundoff) {
    const d = input.printedTotal - computed;
    if (d !== 0 && Math.abs(d) <= 100) {
      autoRoundoff = d;
      const ro: Charge = { id: "auto-roundoff", kind: "roundoff", label: "Round off", mode: "amount", value: d, scope: null, split: "proportional", included: false, removed: false };
      chargeAmounts[ro.id] = d;
      chargesTotal += d;
      computed += d;
      splitCharge(ro, d);
    }
  }

  for (const m of members) {
    const p = per[m.id];
    p.total = p.items + Object.values(p.charges).reduce((a, b) => a + b, 0);
  }
  const diff = input.printedTotal == null ? 0 : input.printedTotal - computed;
  return {
    perMember: per,
    chargeAmounts,
    itemsTotal,
    chargesTotal,
    computedTotal: computed,
    unclaimed,
    diff,
    autoRoundoff,
    balanced: diff === 0 && unclaimed.length === 0,
    discountErrors,
    bonuses,
  };
}

/** Settle-up plan: equal-and-opposite pairs first, then largest debtor with largest creditor. At most n-1 transfers. */
export function settlePlan(balances: { id: string; net: number }[]): { from: string; to: string; amount: number }[] {
  const out: { from: string; to: string; amount: number }[] = [];
  const b = balances.filter((x) => x.net !== 0).map((x) => ({ ...x }));
  for (const d of b) {
    if (d.net >= 0) continue;
    const c = b.find((x) => x.net === -d.net && x.net > 0);
    if (c) {
      out.push({ from: d.id, to: c.id, amount: c.net });
      c.net = 0;
      d.net = 0;
    }
  }
  for (;;) {
    const debt = b.filter((x) => x.net < 0).sort((x, y) => x.net - y.net)[0];
    const cred = b.filter((x) => x.net > 0).sort((x, y) => y.net - x.net)[0];
    if (!debt || !cred) break;
    const amt = Math.min(-debt.net, cred.net);
    out.push({ from: debt.id, to: cred.id, amount: amt });
    debt.net += amt;
    cred.net -= amt;
  }
  return out;
}

const fmt = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function rupees(paise: number): string {
  return fmt.format(paise / 100);
}
export function amountParam(paise: number): string {
  const s = Math.abs(paise);
  return `${Math.floor(s / 100)}.${String(s % 100).padStart(2, "0")}`;
}
export function toPaise(s: string): number | null {
  const m = s.replace(/,/g, "").trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || "0").padEnd(2, "0"));
}
