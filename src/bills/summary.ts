/** Monthly bill summary and CSV export (N5b). A bill belongs to the month it is due (or was found, if it has no due date). */
import { formatAmount, type Bill, type BillStore } from "./store.js";

export const monthOf = (b: Bill) => (b.dueDate ?? b.detectedAt).slice(0, 7);

/** Bills that count for a month: everything the user accepted (not pending, not dismissed). */
export function billsInMonth(store: BillStore, month: string): Bill[] {
  return store
    .list(["tracked", "paid", "autopay"])
    .filter((b) => monthOf(b) === month)
    .sort((a, b) => a.category.localeCompare(b.category) || a.payee.localeCompare(b.payee));
}

const STATUS: Record<string, string> = { tracked: "to pay", paid: "paid", autopay: "automatic" };

/** Header with totals per currency, then one line per bill grouped by category. */
export function monthSummary(store: BillStore, month: string): string[] {
  const bills = billsInMonth(store, month);
  if (!bills.length) return [`${month}: no bills`];
  const totals = new Map<string, number>();
  for (const b of bills) if (b.amountCents !== null) totals.set(b.currency, (totals.get(b.currency) ?? 0) + b.amountCents);
  const total = [...totals].map(([currency, amountCents]) => formatAmount({ amountCents, currency })).join(" + ") || "no amounts";
  const count = (s: string) => bills.filter((b) => b.status === s).length;
  const parts = [count("paid") && `${count("paid")} paid`, count("tracked") && `${count("tracked")} to pay`, count("autopay") && `${count("autopay")} automatic`].filter(Boolean);
  const unknown = bills.filter((b) => b.amountCents === null).length;
  const lines = [`${month} · ${total} across ${bills.length} bill${bills.length === 1 ? "" : "s"} (${parts.join(", ")})${unknown ? ` · ${unknown} without an amount` : ""}`];
  const width = Math.max(...bills.map((b) => b.category.length));
  for (const b of bills) lines.push(`  ${b.category.padEnd(width)}  ${formatAmount(b).padStart(11)}  ${b.payee} (${STATUS[b.status]})`);
  return lines;
}

// Spreadsheet apps run cells that start with = + - @ as formulas; a payee name must never do that.
const cell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function monthCsv(store: BillStore, month: string): string {
  const rows = billsInMonth(store, month).map((b) =>
    [b.payee, b.category, b.kind, b.amountCents === null ? null : (b.amountCents / 100).toFixed(2), b.currency, b.dueDate, STATUS[b.status]!, b.paidAt?.slice(0, 10) ?? null].map(cell).join(","),
  );
  return ["payee,category,kind,amount,currency,due_date,status,paid_on", ...rows].join("\r\n") + "\r\n";
}
