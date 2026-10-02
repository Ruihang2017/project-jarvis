/**
 * Due reminders for tracked bills (N5b). Computed from the bills themselves and the user's
 * billsRemindDays setting each time, so paying a bill, changing its due date or changing the
 * setting takes effect at once — there are no stored reminders to go stale.
 */
import { dayLabel, dayStart, localDate } from "../google/calendar.js";
import type { Toast } from "../background/notify.js";
import { loadSettings } from "../settings.js";
import { formatAmount, type Bill, type BillStore } from "./store.js";

/** Bill reminders appear from this local time on the day. */
export const REMIND_AT = "09:00";
export const DEFAULT_REMIND_DAYS = [3, 0];

export interface DueNotice {
  bill: Bill;
  /** Days until the due date today; negative when overdue. */
  daysLeft: number;
}

export const daysUntil = (dueDate: string, now = new Date()) => Math.round((dayStart(dueDate).getTime() - dayStart(localDate(now)).getTime()) / 86_400_000);

/**
 * Bills whose reminder is due now, each claimed so it shows once (whether the REPL or the
 * background tick gets there first). If the computer was off on a reminder day, the next check
 * sends one late notice instead of none.
 */
export function claimDueNotices(store: BillStore, now = new Date()): DueNotice[] {
  const days = loadSettings().billsRemindDays ?? DEFAULT_REMIND_DAYS;
  if (days === "off" || !days.length) return [];
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (hhmm < REMIND_AT) return [];
  const out: DueNotice[] = [];
  for (const bill of store.list("tracked")) {
    if (!bill.dueDate || bill.needsCheck) continue; // unverified bills never remind on their own
    const daysLeft = daysUntil(bill.dueDate, now);
    // Remind when a lead time has been reached that is closer to the due date than the last notice
    // was. So: one notice per lead time; one late notice if the computer was off on the day; and
    // changing the setting never re-sends notices for lead times that have already passed.
    const last = store.lastReminder(bill.id, bill.dueDate) ?? Infinity;
    if (!days.some((d) => daysLeft <= d && d < last)) continue;
    if (store.claimReminder(bill.id, bill.dueDate, daysLeft)) out.push({ bill, daysLeft });
  }
  return out;
}

const when = (daysLeft: number) => (daysLeft === 0 ? "due today" : daysLeft === 1 ? "due tomorrow" : daysLeft > 0 ? `due in ${daysLeft} days` : `${-daysLeft} day${daysLeft === -1 ? "" : "s"} overdue`);

/** "💳 Origin Energy $245.30 — due in 3 days (Sun 10-18)". */
export const noticeLine = ({ bill, daysLeft }: DueNotice) => `💳 ${bill.payee} ${formatAmount(bill)} — ${when(daysLeft)} (${dayLabel(bill.dueDate!)}) · /bills paid ${bill.id}`;

export function noticeToast({ bill, daysLeft }: DueNotice): Toast {
  return {
    title: `💳 ${bill.payee} ${formatAmount(bill)} — ${when(daysLeft)}`,
    // Jarvis reminds; it never pays or passes on payment details (D24).
    body: `${dayLabel(bill.dueDate!)} · pay in your bank or ${bill.payee}'s own site or app`,
    tag: `bill-${bill.id}`,
    kind: "reminder",
  };
}

const BRIEF_DAYS = 7;

/** Bills for the daily brief: due within a week or overdue, and a count of new ones to review. */
export function briefBills(store: BillStore, now = new Date()): { lines: string[]; count: number } {
  const due = store
    .list("tracked")
    .filter((b) => b.dueDate && daysUntil(b.dueDate, now) <= BRIEF_DAYS)
    .map((b) => `💳 ${b.payee} ${formatAmount(b)} — ${when(daysUntil(b.dueDate!, now))}`);
  const pending = store.list("pending").length;
  const review = pending ? [`💳 ${pending} new bill${pending === 1 ? "" : "s"} to review — /bills review`] : [];
  return { lines: [...due, ...review], count: due.length + (pending ? 1 : 0) };
}
