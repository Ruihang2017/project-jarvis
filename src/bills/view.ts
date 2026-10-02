/** How bills are shown in the terminal, and the glue that runs a scan for a session. */
import { dayLabel, dayStart, localDate } from "../google/calendar.js";
import { GmailClient } from "../google/gmail.js";
import type { Session } from "../session.js";
import { loadSettings } from "../settings.js";
import { scanBills, type ScanResult } from "./scan.js";
import { formatAmount, type Bill } from "./store.js";

/** "in 3 days", "today", "2 days overdue". */
export function dueIn(dueDate: string, now = new Date()): string {
  const days = Math.round((dayStart(dueDate).getTime() - dayStart(localDate(now)).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return days > 0 ? `in ${days} days` : `${-days} day${days === -1 ? "" : "s"} overdue`;
}

/** "#3 Origin Energy · electricity · $245.30 · due Sun 10-18 (in 16 days)". */
export function billLine(b: Bill, now = new Date()): string {
  const due = b.dueDate ? `${b.kind === "autopay" ? "charged" : "due"} ${dayLabel(b.dueDate)} (${dueIn(b.dueDate, now)})` : "no due date in the email";
  return `#${b.id} ${b.payee} · ${b.category} · ${formatAmount(b)} · ${due}${b.kind === "autopay" ? " · automatic payment" : ""}`;
}

/** The bill line plus one "⚠ …" line per warning. */
export function billLines(b: Bill, now = new Date()): string[] {
  return [billLine(b, now), ...b.flags.map((f) => `   ⚠ ${f}`)];
}

export function runScan(session: Session): Promise<ScanResult> {
  return scanBills({
    gmail: new GmailClient(session.google),
    store: session.bills,
    classify: (instructions, input, schema) => session.runEphemeral(instructions, input, schema),
  });
}

/** One or two lines summarising a scan, for the notice shown to the user. */
export function scanSummary(r: ScanResult): string[] {
  const lines: string[] = [];
  const flagged = r.pending.filter((b) => b.flags.length).length;
  if (r.pending.length) lines.push(`💳 ${r.pending.length} new bill${r.pending.length === 1 ? "" : "s"} to check${flagged ? ` (${flagged} with ⚠ warnings)` : ""} — /bills review`);
  if (r.tracked.length) lines.push(`💳 now tracking ${r.tracked.map((b) => `${b.payee} ${formatAmount(b)}`).join(", ")}`);
  if (r.removed) lines.push(`⛔ removed ${r.removed} account/card/reference number${r.removed === 1 ? "" : "s"} from those emails before the model saw them`);
  if (r.remaining) lines.push(`${r.remaining} more email${r.remaining === 1 ? "" : "s"} to look at — /bills scan again`);
  return lines;
}

export function billSettings() {
  const s = loadSettings();
  return { scan: s.billsScan ?? "daily", confirm: s.billsConfirm ?? "always", remind: s.billsRemindDays ?? [3, 0] };
}
