import type { Tool } from "../tools.js";
import { truncate } from "../util.js";
import { describeRepeat, formatDue, fromLocal, isLocal, toLocal, type Repeat } from "./schedule.js";
import type { Reminder } from "./store.js";

const REPEAT_KINDS = ["none", "daily", "weekdays", "weekly", "monthly"] as const;

export const REMINDER_TOOLS: Tool[] = [
  {
    name: "reminder_create",
    description:
      "Set a reminder that pops up at a local date and time (even when Edward isn't open, once background reminders are on). " +
      "Use when the user asks to be reminded. Convert relative times ('明天早上', 'in 20 minutes') to an absolute local time using the current time you were given; " +
      "if only a day is given, use 09:00 and say so.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "What to remind about, short, in the user's language." },
        due: { type: "string", description: "First occurrence, local time YYYY-MM-DDTHH:MM." },
        repeat: { type: "string", enum: [...REPEAT_KINDS], description: "none (default), daily, weekdays (Mon–Fri), weekly, monthly (same day of month as due)." },
        weekly_days: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, description: "For weekly: 0=Sun … 6=Sat. Defaults to due's weekday." },
      },
      required: ["text", "due"],
      additionalProperties: false,
    },
    approval: "auto",
    async prepare(args, ctx) {
      const text = typeof args.text === "string" ? args.text.trim() : "";
      if (!text) throw new Error("`text` is required");
      if (!isLocal(args.due)) throw new Error("`due` must be local time YYYY-MM-DDTHH:MM");
      const due = args.due as string;
      if (fromLocal(due).getTime() < Date.now() - 60_000) throw new Error(`\`due\` ${due} is in the past (now ${toLocal(new Date())})`);
      const repeat = toRepeat(args.repeat, args.weekly_days, due);
      return {
        summary: `remind ${formatDue(due)}: ${text}`,
        execute: async () => {
          const r = ctx.reminders.add({ text, dueAt: due, repeat, threadId: ctx.threadId });
          return `Reminder #${r.id} set for ${formatDue(r.dueAt)}${r.repeat ? ` (${describeRepeat(r.repeat)})` : ""}: ${r.text}`;
        },
      };
    },
  },
  {
    name: "reminder_list",
    description: "List upcoming reminders (and ones that went off in the last day), with ids for reminder_cancel.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    approval: "auto",
    async prepare(_args, ctx) {
      return {
        summary: "list reminders",
        execute: async () => {
          const upcoming = ctx.reminders.upcoming();
          const fired = ctx.reminders.recentlyFired();
          if (!upcoming.length && !fired.length) return "No reminders.";
          return [...upcoming.map((r) => describeReminder(r)), ...fired.map((r) => `${describeReminder(r)} — went off`)].join("\n");
        },
      };
    },
  },
  {
    name: "reminder_cancel",
    description: "Cancel a reminder by id (stops a repeating one entirely). Find the id with reminder_list first.",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false },
    approval: "auto",
    async prepare(args, ctx) {
      const r = ctx.reminders.get(Number(args.id));
      if (!r || r.status === "cancelled" || r.status === "done") throw new Error(`no active reminder #${args.id}`);
      return {
        summary: `cancel reminder #${r.id}`,
        execute: async () => {
          ctx.reminders.setStatus(r.id, "cancelled");
          return `Cancelled reminder #${r.id}: ${r.text}`;
        },
      };
    },
  },
];

/** "#3 Thu 10-01 09:00 · 交报销 (every day)" — uses the snooze time when snoozed. */
export function describeReminder(r: Reminder): string {
  const when = r.snoozedUntil ? `${formatDue(r.snoozedUntil)} (snoozed)` : formatDue(r.dueAt);
  return `#${r.id} ${when} · ${r.text}${r.repeat ? ` (${describeRepeat(r.repeat)})` : ""}`;
}

/** Activity line for reminder tools, or undefined for other tools. */
export function describeReminderCall(tool: string, a: Record<string, unknown>, ok = true): string | undefined {
  switch (tool) {
    case "reminder_create": {
      if (!ok) return `⏰ reminder not set: ${truncate(String(a.text ?? ""), 60)}`;
      const due = isLocal(a.due) ? formatDue(a.due) : String(a.due);
      const rep = a.repeat && a.repeat !== "none" ? ` · ${a.repeat === "weekly" ? "weekly" : a.repeat}` : "";
      return `⏰ reminder set: ${due} · ${truncate(String(a.text ?? ""), 60)}${rep}`;
    }
    case "reminder_list":
      return "⏰ checked reminders";
    case "reminder_cancel":
      return ok ? `⏰ cancelled reminder #${a.id}` : `⏰ couldn't cancel #${a.id}`;
    default:
      return undefined;
  }
}

function toRepeat(kind: unknown, days: unknown, due: string): Repeat {
  if (kind === undefined || kind === "none") return null;
  const d = fromLocal(due);
  switch (kind) {
    case "daily":
      return { kind: "daily" };
    case "weekdays":
      return { kind: "weekdays" };
    case "weekly": {
      const list = Array.isArray(days) ? days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : [];
      return { kind: "weekly", days: list.length ? list : [d.getDay()] };
    }
    case "monthly":
      return { kind: "monthly", day: d.getDate() };
    default:
      throw new Error(`\`repeat\` must be one of ${REPEAT_KINDS.join(", ")}`);
  }
}
