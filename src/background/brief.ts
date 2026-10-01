/**
 * Daily brief (N1c): what's on today, from local data only (no model call). Shown as a notification
 * by the background tick at the brief time, and as a block the first time Jarvis opens that day.
 * Calendar and email sections come later (N3, N4).
 */
import type { MemoryStore } from "../memory/store.js";
import { addDays, today } from "../memory/store.js";
import { formatDue, fromLocal } from "../reminders/schedule.js";
import type { ReminderStore } from "../reminders/store.js";
import { loadSettings } from "../settings.js";
import { truncate } from "../util.js";

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

export function composeBrief(memory: MemoryStore, reminders: ReminderStore, now = new Date()): Brief {
  const day = today();
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

  const count = todays.length + comingUp.length + pending;
  const date = formatDue(`${day}T00:00`, now).slice(0, -6); // "Thu 10-01"
  return {
    title: count ? `☀ ${date} · ${count} thing${count === 1 ? "" : "s"} today` : `☀ ${date} · nothing scheduled`,
    lines: [...todays, ...comingUp, ...review],
    count,
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
