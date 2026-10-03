/** What the user can do with a bill. Shared by /bills and the desktop app, so the rules are the same. */
import { dayStart } from "../google/calendar.js";
import type { Bill, BillStore } from "./store.js";

export type BillResult = { ok: true; bill: Bill } | { ok: false; reason: string };

/**
 * Starts tracking a bill that was waiting for review. Bills with warnings are never accepted in a
 * batch (`bulk`): each needs its own look.
 */
export function acceptBill(store: BillStore, id: number, bulk = false): BillResult {
  const b = store.get(id);
  if (!b) return { ok: false, reason: `no bill #${id}` };
  if (b.status !== "pending") return { ok: false, reason: `#${id} isn't waiting for review` };
  if (bulk && (b.flags.length || b.needsCheck)) return { ok: false, reason: `#${id} has warnings — check it on its own first` };
  const bill = store.update(b.id, { status: b.kind === "autopay" ? "autopay" : "tracked", needsCheck: false })!;
  store.confirmPayee(b.payee, b.senderDomain);
  return { ok: true, bill };
}

export function ignoreBill(store: BillStore, id: number): BillResult {
  const b = store.get(id);
  if (!b) return { ok: false, reason: `no bill #${id}` };
  if (b.status !== "pending") return { ok: false, reason: `#${id} isn't waiting for review` };
  return { ok: true, bill: store.update(b.id, { status: "dismissed" })! };
}

export function markPaid(store: BillStore, id: number): BillResult {
  const b = store.get(id);
  if (!b) return { ok: false, reason: `no bill #${id}` };
  return { ok: true, bill: store.update(b.id, { status: "paid" })! };
}

export type BillField = "amount" | "due" | "payee";

/** Corrects what was read from the email; fixing the amount or due date clears its warning. */
export function editBill(store: BillStore, id: number, field: BillField, value: string): BillResult {
  const b = store.get(id);
  if (!b) return { ok: false, reason: `no bill #${id}` };
  const dropFlag = (word: string) => b.flags.filter((f) => !f.includes(word));
  if (field === "amount") {
    const n = Number(value.replace(/[$,\s]/g, ""));
    if (!value || !Number.isFinite(n) || n <= 0) return { ok: false, reason: "the amount must be a number like 245.30" };
    store.update(b.id, { amountCents: Math.round(n * 100), flags: dropFlag("the amount"), needsCheck: b.flags.some((f) => f.includes("the due date")) });
  } else if (field === "due") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(dayStart(value).getTime())) return { ok: false, reason: "the due date must look like 2026-10-18" };
    store.update(b.id, { dueDate: value, flags: dropFlag("the due date"), needsCheck: b.flags.some((f) => f.includes("the amount")) });
  } else {
    if (!value.trim()) return { ok: false, reason: "the payee can't be empty" };
    store.update(b.id, { payee: value.trim() });
  }
  return { ok: true, bill: store.get(b.id)! };
}
