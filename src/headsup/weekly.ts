/**
 * Weekly review (H3, D43): the coming seven days on one page, Sunday 19:00 by default. Events from
 * every calendar account, bills due, list items due, reminders. Code only, like the daily brief: no
 * model, so it also comes from the background task when Edward is closed. "Plan my week" in the app
 * hands it to the conversation; only then does the model see it.
 */
import type { Accounts } from "../accounts/accounts.js";
import type { Toast } from "../background/notify.js";
import { daysUntil } from "../bills/remind.js";
import { formatAmount, type BillStore } from "../bills/store.js";
import { CalendarClient, dayLabel, dayStart, localDate, nextDate, type CalendarEvent } from "../google/calendar.js";
import { TasksClient } from "../google/tasks.js";
import type { ReminderStore } from "../reminders/store.js";
import { toLocal } from "../reminders/schedule.js";
import { loadSettings } from "../settings.js";
import { truncate } from "../util.js";
import type { NoticeStore } from "./notices.js";

export const DEFAULT_WEEKLY = { day: 0, time: "19:00" };
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS = 7;
const PER_DAY = 3;
const GOOGLE_TIMEOUT_MS = 15_000;

/** When the review comes, or null when it's off. */
export function weeklySchedule(): { day: number; time: string } | null {
  const v = loadSettings().weeklyReview;
  if (v === "off") return null;
  const day = typeof v?.day === "number" && v.day >= 0 && v.day <= 6 ? v.day : DEFAULT_WEEKLY.day;
  const time = typeof v?.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.time) ? v.time : DEFAULT_WEEKLY.time;
  return { day, time };
}

const hhmm = (d: Date) => toLocal(d).slice(11);

/** On the review day after its time: the review is showing (the app's card). */
export function weeklyShowing(now = new Date()): boolean {
  const s = weeklySchedule();
  return Boolean(s && now.getDay() === s.day && hhmm(now) >= s.time);
}

/** True once per review day, from its time on (tick, REPL and app share the claim). */
export function weeklyDue(notices: NoticeStore, now = new Date()): boolean {
  return weeklyShowing(now) && notices.claim(`weekly:${localDate(now)}`, now);
}

export interface WeekDay {
  date: string;
  label: string;
  events: string[];
}

export interface Week {
  /** The seven days from tomorrow. */
  from: string;
  days: WeekDay[];
  bills: string[];
  todo: string[];
  reminders: string[];
  counts: { events: number; bills: number; todo: number; reminders: number };
  /** Parts that couldn't be read (offline, expired). */
  problems: string[];
}

async function timed<T>(p: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), GOOGLE_TIMEOUT_MS)))]);
  } finally {
    clearTimeout(timer);
  }
}

const eventShort = (e: CalendarEvent) => `${e.allDay ? "all day" : hhmm(e.start)} ${truncate(e.title, 40)}`;

export async function composeWeek(accounts: Accounts, reminders: ReminderStore, bills: BillStore | undefined, now = new Date()): Promise<Week> {
  const first = nextDate(localDate(now));
  const last = nextDate(first, DAYS); // exclusive
  const from = dayStart(first);
  const to = dayStart(last);
  const problems: string[] = [];

  const events = (
    await Promise.all(
      accounts.for("calendar").map(async (a) => {
        try {
          return await timed(new CalendarClient(accounts.auth(a)).events(from, to));
        } catch {
          problems.push(`calendar${accounts.for("calendar").length > 1 ? ` (${accounts.label(a)})` : ""}`);
          return [];
        }
      }),
    )
  )
    .flat()
    .filter((e) => !e.declined)
    .sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.allDay) - Number(a.allDay));
  const days: WeekDay[] = [];
  for (let d = first; d < last; d = nextDate(d)) {
    const on = events.filter((e) => (e.allDay ? localDate(e.start) <= d && localDate(e.end) > d : localDate(e.start) === d));
    days.push({ date: d, label: dayLabel(d), events: on.map(eventShort) });
  }

  const billLines = (bills?.list("tracked") ?? [])
    .filter((b) => b.dueDate && b.dueDate < last)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
    .map((b) => `${b.payee} ${formatAmount(b)} — ${b.dueDate! < localDate(now) ? `overdue since ${dayLabel(b.dueDate!)}` : daysUntil(b.dueDate!, now) === 0 ? "due today" : `due ${dayLabel(b.dueDate!)}`}`);

  let todo: string[] = [];
  const listsIn = accounts.primary("tasks");
  if (listsIn) {
    try {
      const c = new TasksClient(accounts.auth(listsIn));
      const items = await timed(Promise.all((await c.lists()).map(async (l) => (await c.tasks(l.id, now)).filter((t) => !t.done && t.due && t.due < last).map((t) => ({ t, list: l.title })))));
      todo = items
        .flat()
        .sort((a, b) => a.t.due!.localeCompare(b.t.due!))
        .map(({ t, list }) => `${truncate(t.title, 50)} · ${list} (${t.due! < localDate(now) ? "overdue" : `due ${dayLabel(t.due!)}`})`);
    } catch {
      problems.push("lists");
    }
  }

  const reminderLines = reminders
    .upcoming()
    .filter((r) => {
      const at = (r.snoozedUntil ?? r.dueAt).slice(0, 10);
      return at >= first && at < last;
    })
    .map((r) => {
      const at = r.snoozedUntil ?? r.dueAt;
      return `${dayLabel(at.slice(0, 10))} ${at.slice(11)} ${truncate(r.text, 60)}`;
    });

  return {
    from: first,
    days,
    bills: billLines,
    todo,
    reminders: reminderLines,
    counts: { events: events.length, bills: billLines.length, todo: todo.length, reminders: reminderLines.length },
    problems,
  };
}

const n = (k: number, what: string, plural = `${what}s`) => `${k} ${k === 1 ? what : plural}`;

/** "9 events, 2 bills, 3 to-dos" */
export function weekHeadline(w: Week): string {
  const c = w.counts;
  const parts = [c.events ? n(c.events, "event") : "", c.bills ? n(c.bills, "bill") : "", c.todo ? n(c.todo, "to-do") : "", c.reminders ? n(c.reminders, "reminder") : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : "nothing planned yet";
}

/** For the terminal and the notification. */
export function weekLines(w: Week): string[] {
  const lines = [`🗓 Next week · ${weekHeadline(w)}`];
  for (const d of w.days) {
    if (!d.events.length) continue;
    const shown = d.events.slice(0, PER_DAY).join(" · ");
    lines.push(`  ${d.label}  ${shown}${d.events.length > PER_DAY ? ` +${d.events.length - PER_DAY} more` : ""}`);
  }
  for (const b of w.bills) lines.push(`  💳 ${b}`);
  for (const t of w.todo) lines.push(`  ☐ ${t}`);
  for (const r of w.reminders) lines.push(`  ⏰ ${r}`);
  if (w.problems.length) lines.push(`  ⚠ couldn't read: ${w.problems.join(", ")}`);
  return lines;
}

export function weekToast(w: Week): Toast {
  const busiest = [...w.days].sort((a, b) => b.events.length - a.events.length)[0];
  const body = [
    busiest?.events.length ? `Busiest: ${busiest.label} (${n(busiest.events.length, "event")})` : "",
    w.bills[0] ? `💳 ${w.bills[0]}` : w.todo[0] ? `☐ ${w.todo[0]}` : "",
  ].filter(Boolean);
  return { title: `🗓 Next week · ${weekHeadline(w)}`, body: body.join("\n"), tag: "weekly", kind: "info" };
}
