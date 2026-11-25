// Indian bill text parser and Quick Type grammar. Pure, runs in the browser.
import type { ChargeKind, Kind } from "./money";

export interface ParsedLine {
  type: "item" | "charge" | "subtotal" | "total" | "ignore";
  name: string;
  qty: number;
  rate: number | null;
  amount: number; // paise
  kind?: Kind;
  chargeKind?: ChargeKind;
  percentBp?: number;
  conf?: number;
  /** index of the source line among the bill's non-empty lines, so a scan can find that line's photo crop */
  src?: number;
  raw: string;
}

const DEV = "०१२३४५६७८९";
export function normaliseDigits(s: string) {
  return s.replace(/[०-९]/g, (d) => String(DEV.indexOf(d)));
}

const DRINK = /\b(beer|whisky|whiskey|vodka|rum|wine|gin|pint|peg|\d+\s?ml|liit|bucket|kingfisher|bira|breezer)\b/i;
export function classify(name: string): Kind {
  return DRINK.test(name) ? "drink" : "food";
}

const CHARGE_RX: [RegExp, ChargeKind][] = [
  [/\bcgst\b/i, "cgst"],
  [/\bsgst\b/i, "sgst"],
  [/\butgst\b/i, "utgst"],
  [/\bigst\b/i, "igst"],
  [/\bvat\b/i, "vat"],
  [/service\s*charge|\bs\.?c\.?\b/i, "service"],
  [/\bdisc(ount)?\b/i, "discount"],
  [/\bpack(ing|aging)\b|\bcontainer\b/i, "packing"],
  [/\bdelivery\b/i, "delivery"],
  [/\btip\b/i, "tip"],
  [/round\s*off|\br\/o\b|roundoff/i, "roundoff"],
  [/\bgst\b/i, "cgst"],
];
const IGNORE = /gstin|fssai|table\s*(no)?|waiter|steward|date|time|thank|visit again|bill\s*no|invoice|cashier|ph[: ]|phone|mob|address|kot\b|covers|pax/i;
const AMOUNT = /(?:₹|Rs\.?|INR)?\s*(-?\d{1,3}(?:,\d{2,3})+|-?\d+)(?:\.(\d{1,2}))?\s*$/i;

function fixNumberish(s: string) {
  // common OCR mix-ups, only inside number-looking tokens
  return s.replace(/\b[\dOolISB.,]{2,}\b/g, (tok) => (/\d/.test(tok) ? tok.replace(/[Oo]/g, "0").replace(/[lI]/g, "1").replace(/S/g, "5").replace(/B/g, "8") : tok));
}

function paise(intPart: string, dec?: string) {
  const neg = intPart.startsWith("-");
  const v = Number(intPart.replace(/[-,]/g, "")) * 100 + Number((dec || "0").padEnd(2, "0"));
  return neg ? -v : v;
}

export function parseBill(text: string): { lines: ParsedLine[]; subtotal: number | null; total: number | null; restaurant: string } {
  const raw = normaliseDigits(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lines: ParsedLine[] = [];
  let subtotal: number | null = null;
  let total: number | null = null;
  let restaurant = "";
  let pendingName = "";
  let seenCharge = false;
  for (let i = 0; i < raw.length; i++) {
    const l = fixNumberish(raw[i]);
    const m = l.match(AMOUNT);
    if (!m) {
      if (!restaurant && i < 3 && /[a-z]/i.test(l) && !IGNORE.test(l)) restaurant = l.slice(0, 60);
      else if (!IGNORE.test(l) && /[a-z]/i.test(l) && i + 1 < raw.length && /^\d+\s/.test(raw[i + 1])) pendingName = l;
      continue;
    }
    const amount = paise(m[1], m[2]);
    let head = l.slice(0, m.index).trim().replace(/[.:=\-–]+$/, "").trim();
    if (/grand\s*total|net\s*amount|total\s*payable|amount\s*payable|net\s*payable/i.test(head)) {
      total = amount;
      lines.push({ type: "total", name: head, qty: 1, rate: null, amount, src: i, raw: l });
      continue;
    }
    if (/sub\s*-?\s*total/i.test(head) || (/^total\b/i.test(head) && !seenCharge)) {
      subtotal = amount;
      lines.push({ type: "subtotal", name: head, qty: 1, rate: null, amount, raw: l });
      continue;
    }
    if (/^total\b/i.test(head)) {
      if (total == null) total = amount;
      lines.push({ type: "total", name: head, qty: 1, rate: null, amount, raw: l });
      continue;
    }
    const ck = CHARGE_RX.find(([rx]) => rx.test(head));
    if (ck) {
      seenCharge = true;
      const pm = head.match(/@?\s*(\d+(?:\.\d+)?)\s*%/);
      lines.push({
        type: "charge",
        name: head.replace(/\s+/g, " ").slice(0, 30),
        qty: 1,
        rate: null,
        amount: ck[1] === "discount" ? -Math.abs(amount) : amount,
        chargeKind: ck[1],
        percentBp: pm ? Math.round(Number(pm[1]) * 100) : undefined,
        src: i,
        raw: l,
      });
      continue;
    }
    if (IGNORE.test(head) || !/[a-zऀ-ॿ]/i.test(head)) continue;
    if (pendingName) {
      head = `${pendingName} ${head}`;
      pendingName = "";
    }
    let name = head;
    let qty = 1;
    let rate: number | null = null;
    let mm = head.match(/^(.*?)\s+(\d{1,2})\s*[xX×*]\s*(\d+(?:\.\d{1,2})?)\s*=?$/);
    if (mm) {
      name = mm[1];
      qty = Number(mm[2]);
      rate = Math.round(Number(mm[3]) * 100);
    } else if ((mm = head.match(/^(.*?)\s+(\d{1,2})\s+(\d+(?:\.\d{1,2})?)$/))) {
      name = mm[1];
      qty = Number(mm[2]);
      rate = Math.round(Number(mm[3]) * 100);
    } else if ((mm = head.match(/^(\d{1,2})\s+(?:[xX]\s+)?(.+)$/))) {
      qty = Number(mm[1]);
      name = mm[2];
    } else if ((mm = head.match(/^(.*?)\s+(\d{1,2})$/))) {
      name = mm[1];
      qty = Number(mm[2]);
    }
    name = name.replace(/^\d+[.)]\s*/, "").replace(/\s{2,}/g, " ").trim().slice(0, 60);
    if (!name) continue;
    // a printed "qty x rate" must multiply to the amount. One stray or dropped digit in the amount is a far
    // likelier misread than a wrong rate, so the product wins; either way the line is flagged for a look.
    let amt = amount;
    let conf: number | undefined;
    if (rate != null && qty * rate !== amount) {
      const want = qty * rate;
      conf = 45;
      if (digitDistance(String(want), String(Math.abs(amount))) <= 1) amt = want;
    }
    lines.push({ type: "item", name, qty: Math.max(1, Math.min(99, qty)), rate, amount: amt, kind: classify(name), conf, src: i, raw: l });
  }
  return { lines, subtotal, total, restaurant };
}

/** Edit distance between two digit strings (insert, delete, change one digit). */
function digitDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** Quick Type: "[qty] name [rate|amount] [each]" per comma or new line. */
export function parseQuick(text: string): { name: string; qty: number; amount: number; kind: Kind }[] {
  const out: { name: string; qty: number; amount: number; kind: Kind }[] = [];
  for (const part of normaliseDigits(text).split(/[,\n]/)) {
    const s = part.trim();
    if (!s) continue;
    const m = s.match(/^(?:(\d{1,2})\s*[xX]?\s+)?(.+?)\s+(?:₹|rs\.?\s*)?(\d+(?:\.\d{1,2})?)\s*(each|ek|har)?$/i);
    if (!m) continue;
    const qty = m[1] ? Number(m[1]) : 1;
    const num = Math.round(Number(m[3]) * 100);
    const amount = m[4] ? num * qty : num;
    const name = m[2].trim().slice(0, 60);
    out.push({ name, qty, amount, kind: classify(name) });
  }
  return out;
}
