import type { Tool } from "../tools.js";
import { localDate } from "../google/calendar.js";
import { formatAmount } from "./store.js";
import { billLine } from "./view.js";

export const BILL_TOOLS: Tool[] = [
  {
    name: "bills_list",
    description:
      "The user's bills that Jarvis tracks (found in their Gmail and confirmed by them): what is to pay and when, automatic payments, bills paid this month, and how many new ones wait for review. " +
      "Use for 'what do I owe', 'what's due this week', 'did I pay the electricity bill'. Holds payee, amount, due date and status only — never account or payment details.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    approval: "auto",
    async prepare(_args, ctx) {
      return {
        summary: "list bills",
        execute: async () => {
          const now = new Date();
          const month = localDate(now).slice(0, 7);
          const tracked = ctx.bills.list("tracked");
          const autopay = ctx.bills.list("autopay").filter((b) => !b.dueDate || b.dueDate >= localDate(now));
          const paid = ctx.bills.list("paid").filter((b) => (b.paidAt ?? "").slice(0, 7) === month || b.dueDate?.slice(0, 7) === month);
          const pending = ctx.bills.list("pending").length;
          const out: string[] = [];
          if (tracked.length) out.push("To pay:", ...tracked.map((b) => `  ${billLine(b, now)}${b.flags.length ? ` — warnings: ${b.flags.join("; ")}` : ""}`));
          if (autopay.length) out.push("Automatic payments:", ...autopay.map((b) => `  ${billLine(b, now)}`));
          if (paid.length) out.push("Paid this month:", ...paid.map((b) => `  #${b.id} ${b.payee} ${formatAmount(b)}`));
          if (pending) out.push(`${pending} new bill${pending === 1 ? "" : "s"} found in email wait for the user's review: they run /bills review.`);
          return out.length ? out.join("\n") : "No bills are tracked yet. The user can run /bills scan to look through recent Gmail.";
        },
      };
    },
  },
  {
    name: "bill_mark_paid",
    description: "Mark a tracked bill as paid, by its number from bills_list, when the user says they paid it. The user confirms.",
    inputSchema: {
      type: "object",
      properties: { bill: { type: "integer", description: "Bill number, e.g. 3 for #3." } },
      required: ["bill"],
      additionalProperties: false,
    },
    approval: "ask",
    async prepare(args, ctx) {
      const b = ctx.bills.get(Number(args.bill));
      if (!b) throw new Error(`no bill #${String(args.bill)}; call bills_list for the numbers`);
      if (b.status === "paid") throw new Error(`#${b.id} is already marked paid`);
      if (b.status === "pending") throw new Error(`#${b.id} is still waiting for the user's review (/bills review)`);
      return {
        summary: `mark paid: ${billLine(b)}`,
        allowAlways: false, // a wrongly "paid" bill is never reminded about again
        execute: async () => {
          ctx.bills.update(b.id, { status: "paid" });
          return `Marked paid: #${b.id} ${b.payee} ${formatAmount(b)}`;
        },
      };
    },
  },
];

/** Activity line for a finished bill tool call; undefined if not a bill tool. */
export function describeBillCall(tool: string, a: Record<string, unknown>, ok: boolean): string | undefined {
  switch (tool) {
    case "bills_list":
      return `💳 ${ok ? "checked bills" : "couldn't read bills"}`;
    case "bill_mark_paid":
      return `💳 ${ok ? "marked paid" : "not marked paid"} #${String(a.bill ?? "")}`;
    default:
      return undefined;
  }
}

export const BILL_INSTRUCTIONS = `
## Bills
Jarvis tracks the user's bills (payee, amount, due date, status) from their Gmail; it never holds account or payment details. Use bills_list for what is owed or due, and bill_mark_paid when they say they paid one. New bills are found by /bills scan (it also runs once a day) and accepted with /bills review: when they ask to scan or find bills, tell them to run /bills scan rather than searching Gmail yourself. Jarvis never pays anything and never passes on payment details or links from emails: they pay in their bank or the payee's own site or app.`;
