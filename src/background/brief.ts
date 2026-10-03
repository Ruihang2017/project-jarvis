/**
 * Daily brief (N1c): what's on today, from local data only (no model call). Shown as a notification
 * by the background tick at the brief time, and as a block the first time Edward opens that day.
 * Today's calendar events (N3) and unread Primary mail (N4) come from Google when access is granted.
 */
import type { MemoryStore } from "../memory/store.js";
import { addDays, today } from "../memory/store.js";
import { formatDue, fromLocal } from "../reminders/schedule.js";
import type { ReminderStore } from "../reminders/store.js";
import { loadSettings } from "../settings.js";
import { truncate } from "../util.js";
import type { Account, Accounts } from "../accounts/accounts.js";
import type { BillStore } from "../bills/store.js";
import { briefBills } from "../bills/remind.js";
import { CalendarClient, hasCalendarAccess, todayLines } from "../google/calendar.js";
import { displayName, GmailClient, hasGmailAccess, UNREAD_QUERY } from "../google/gmail.js";

/** A Google section of the brief: undefined when not connected/granted, "unavailable" when offline or expired. */
export type BriefSection = { lines: string[]; count: number } | "unavailable" | undefined;
export interface BriefGoogle {
  calendar?: BriefSection;
  mail?: BriefSection;
}

const GOOGLE_TIMEOUT_MS = 15_000;
const MAIL_SHOWN = 3;

async function section(granted: boolean, invalid: boolean, load: () => Promise<{ lines: string[]; count: number }>): Promise<BriefSection> {
  if (!granted) return undefined;
  if (invalid) return "unavailable";
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([load(), new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), GOOGLE_TIMEOUT_MS)))]);
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timer);
  }
}

/** Today's events and unread Primary mail from the last day, from every account, fetched in parallel. */
export async function briefGoogle(accounts: Accounts, now = new Date()): Promise<BriefGoogle> {
  const connected = accounts.connected();
  if (!connected.length) return {};
  // Accounts that granted the feature (and have it switched on), and those of them still signed in.
  const granted = (f: "mail" | "calendar") => connected.filter((a) => a[f] && (f === "mail" ? hasGmailAccess : hasCalendarAccess)(accounts.state(a)!.scopes));
  const live = (list: Account[]) => list.filter((a) => !accounts.state(a)!.invalidAt);
  const cal = granted("calendar");
  const box = granted("mail");
  const [calendar, mail] = await Promise.all([
    section(cal.length > 0, live(cal).length === 0, async () => {
      const lines = await todayLines(live(cal).map((a) => new CalendarClient(accounts.auth(a))), now);
      return { lines, count: lines.length };
    }),
    section(box.length > 0, live(box).length === 0, async () => {
      const lists = await Promise.all(live(box).map((a) => new GmailClient(accounts.auth(a)).search(UNREAD_QUERY, 20)));
      const unread = lists.flat().sort((a, b) => b.date.getTime() - a.date.getTime());
      if (!unread.length) return { lines: [], count: 0 };
      const n = lists.some((l) => l.length === 20) ? `${unread.length}+` : String(unread.length);
      const head = `✉ ${n} unread in Primary`;
      // Unread mail is one thing to do ("check mail"), not one per message: 20 newsletters shouldn't read as "20 things today".
      return { lines: [head, ...unread.slice(0, MAIL_SHOWN).map((m) => `   ${truncate(displayName(m.from), 24)} — ${truncate(m.subject, 60)}`)], count: 1 };
    }),
  ]);
  return { calendar, mail };
}

export type BriefDays = "weekdays" | "daily" | "off";
export const DEFAULT_BRIEF_TIME = "08:30";
const COMING_UP_DAYS = 3;

export function briefSchedule(): { time: string; days: BriefDays } {
  const s = loadSettings();
  return { time: s.briefTime ?? DEFAULT_BRIEF_TIME, days: s.briefDays ?? "weekdays" };
}

/** True once today's brief time has passed on a brief day and it hasn't been shown via `channel` yet. */
export function briefDue(memory: MemoryStore, channel: "toast" | "repl", now = new Date()): boolean {
  const { time, days } = briefSchedule();
  if (days === "off") return false;
  if (days === "weekdays" && (now.getDay() === 0 || now.getDay() === 6)) return false;
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return hhmm >= time && memory.getMeta(`brief:${channel}`) !== today();
}

export const markBriefShown = (memory: MemoryStore, channel: "toast" | "repl") => memory.setMeta(`brief:${channel}`, today());

export interface Brief {
  title: string;
  /** Lines, most important first. */
  lines: string[];
  /** Number of actionable items (0 = nothing today). */
  count: number;
}

export function composeBrief(memory: MemoryStore, reminders: ReminderStore, now = new Date(), google: BriefGoogle = {}, bills?: BillStore): Brief {
  const billing = bills ? briefBills(bills, now) : { lines: [], count: 0 };
  const day = today();
  const lines = (s: BriefSection, what: string) => (s === "unavailable" ? [`${what} unavailable right now`] : (s?.lines ?? []));
  const count = (s: BriefSection) => (s === "unavailable" || !s ? 0 : s.count);
  const events = lines(google.calendar, "📅 calendar");
  const mail = lines(google.mail, "✉ mail");
  const todays = reminders
    .upcoming()
    .filter((r) => (r.snoozedUntil ?? r.dueAt).slice(0, 10) === day)
    .map((r) => `⏰ ${(r.snoozedUntil ?? r.dueAt).slice(11)} ${truncate(r.text, 60)}`);
  const horizon = addDays(COMING_UP_DAYS);
  const comingUp = memory
    .list({ tier: "short", kind: "event" })
    .filter((m) => m.validUntil && m.validUntil >= day && m.validUntil <= horizon)
    .sort((a, b) => a.validUntil!.localeCompare(b.validUntil!))
    .map((m) => `📌 ${m.validUntil!.slice(5)} ${truncate(m.text, 70)}`);
  const pending = memory.list({ status: "pending" }).length;
  const review = pending ? [`🔒 ${pending} memor${pending === 1 ? "y" : "ies"} awaiting /memory review`] : [];

  const total = count(google.calendar) + todays.length + billing.count + comingUp.length + count(google.mail) + pending;
  const date = formatDue(`${day}T00:00`, now).slice(0, -6); // "Thu 10-01"
  return {
    title: total ? `☀ ${date} · ${total} thing${total === 1 ? "" : "s"} today` : `☀ ${date} · nothing scheduled`,
    lines: [...events, ...todays, ...billing.lines, ...comingUp, ...mail, ...review],
    count: total,
  };
}

/** Next time the brief will be shown, for /brief. */
export function nextBriefAt(now = new Date()): string | null {
  const { time, days } = briefSchedule();
  if (days === "off") return null;
  for (let i = 0; i < 8; i++) {
    const d = fromLocal(`${addDays(i, now)}T${time}`);
    if (d <= now) continue;
    if (days === "weekdays" && (d.getDay() === 0 || d.getDay() === 6)) continue;
    return formatDue(`${addDays(i, now)}T${time}`, now);
  }
  return null;
}
