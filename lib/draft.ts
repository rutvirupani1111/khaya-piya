"use client";
// Local bill draft, kept in IndexedDB on this phone until the room opens.
import type { Charge, Claim, Item, Member } from "./money";

/** A seat on this phone's draft. personId is set when the seat came from a Khata tiffin. */
export type DraftMember = Member & { personId?: string | null };

export interface Draft {
  id: string;
  restaurant: string;
  printedTotal: number | null;
  members: DraftMember[];
  items: Item[];
  charges: Charge[];
  claims: Claim[];
  demo: boolean;
  roomCode?: string;
  /** the Khata tiffin this bill will be written to when the room opens */
  groupId?: string | null;
  groupName?: string | null;
  updatedAt: number;
}

const DB = "khayapiya";
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("drafts", { keyPath: "id" });
      r.result.createObjectStore("kv");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => res(req.result as T);
    req.onerror = () => rej(req.error);
  });
}
export const saveDraft = (d: Draft) => run<IDBValidKey>("drafts", "readwrite", (s) => s.put({ ...d, updatedAt: Date.now() }));
export const loadDraft = (id: string) => run<Draft | undefined>("drafts", "readonly", (s) => s.get(id));
export const kvGet = <T,>(k: string) => run<T | undefined>("kv", "readonly", (s) => s.get(k));
export const kvSet = (k: string, v: unknown) => run<IDBValidKey>("kv", "readwrite", (s) => s.put(v, k));

export const uid = () => crypto.randomUUID();

export function newDraft(): Draft {
  return { id: uid().slice(0, 8), restaurant: "", printedTotal: null, members: [{ id: uid(), seat: 1, name: "Main" }], items: [], charges: [], claims: [], demo: false, updatedAt: Date.now() };
}

export const DEMO_TEXT = `KYANI & CO., FORT
GSTIN 27AAAAA0000A1Z5
Table 7   Steward: R
Bun Maska 2 60.00 120.00
Irani Chai 3 x 40 = 120.00
Keema Pav 1 240.00 240.00
Berry Pulao 2 380.00 760.00
Kingfisher 650 ml 1 290.00 290.00
Sub Total 1530.00
CGST @2.5% 31.00
SGST @2.5% 31.00
VAT 5% 14.50
Service Charge 5% 76.50
Grand Total 1683.00
Thank you, visit again`;

export function demoDraft(): Draft {
  const m = ["Main", "Zoya", "Kabir", "Tanvi"].map((name, i) => ({ id: uid(), seat: i + 1, name }));
  return { ...newDraft(), id: "demo-" + uid().slice(0, 4), members: m, demo: true };
}
