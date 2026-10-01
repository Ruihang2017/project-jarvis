/**
 * Google Calendar (N3): reads the calendars the user shows in Google Calendar (primary + selected).
 * Nothing is cached locally; every call asks Google. Times are handled in the machine's time zone.
 */
import { fromLocal, toLocal } from "../reminders/schedule.js";
import { truncate } from "../util.js";
import { GoogleAuthError, type GoogleAuth } from "./auth.js";

export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];
const API = "https://www.googleapis.com/calendar/v3";

export const hasCalendarAccess = (scopes: string[] | undefined) => CALENDAR_SCOPES.every((s) => scopes?.includes(s));

export interface CalendarInfo {
  id: string;
  name: string;
  primary: boolean;
}

interface EventTime {
  dateTime?: string;
  date?: string;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  primaryCalendar: boolean;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  description?: string;
  /** "transparent" = shows as available. */
  busy: boolean;
  declined: boolean;
  recurring: boolean;
}

interface ApiEvent {
  id: string;
  status?: string;
  summary?: string;
  start?: EventTime;
  end?: EventTime;
  location?: string;
  description?: string;
  transparency?: string;
  recurringEventId?: string;
  attendees?: { self?: boolean; responseStatus?: string }[];
}

/** Local midnight of a "YYYY-MM-DD" date. */
export const dayStart = (date: string) => fromLocal(`${date}T00:00`);
export const localDate = (d: Date) => toLocal(d).slice(0, 10);
export function nextDate(date: string, n = 1): string {
  const [y, m, d] = date.split("-").map(Number);
  return localDate(new Date(y!, m! - 1, d! + n));
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Thu 10-01" */
export const dayLabel = (date: string) => `${DAYS[dayStart(date).getDay()]} ${date.slice(5)}`;
const hhmm = (d: Date) => toLocal(d).slice(11);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tool input → Date. "YYYY-MM-DD" means the start of that day, or (for an end bound) the end of it,
 * so "from 10-01 to 10-03" covers three whole days.
 */
export function parseBound(s: unknown, end: boolean): Date {
  if (typeof s !== "string") throw new Error("expected YYYY-MM-DD or YYYY-MM-DDTHH:MM");
  if (DATE_RE.test(s)) return dayStart(end ? nextDate(s) : s);
  return fromLocal(s);
}

export function toEvent(e: ApiEvent, cal: CalendarInfo): CalendarEvent | null {
  if (e.status === "cancelled" || !e.start || !e.end) return null;
  const allDay = Boolean(e.start.date);
  const start = allDay ? dayStart(e.start.date!) : new Date(e.start.dateTime!);
  const end = allDay ? dayStart(e.end.date!) : new Date(e.end.dateTime!);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return {
    id: e.id,
    calendarId: cal.id,
    calendarName: cal.name,
    primaryCalendar: cal.primary,
    title: e.summary?.trim() || "(no title)",
    start,
    end,
    allDay,
    location: e.location?.trim() || undefined,
    description: e.description?.trim() || undefined,
    busy: e.transparency !== "transparent",
    declined: e.attendees?.some((a) => a.self && a.responseStatus === "declined") ?? false,
    recurring: Boolean(e.recurringEventId),
  };
}

export class CalendarClient {
  constructor(private readonly auth: GoogleAuth) {}

  /** Throws a clear error when Google isn't connected or calendar access wasn't granted. */
  ensureAccess() {
    const s = this.auth.state();
    if (!s) throw new GoogleAuthError("not_connected", "Google isn't connected — run /connect google");
    if (s.invalidAt) throw new GoogleAuthError("invalid_grant", "the Google connection expired — run /connect google");
    if (!hasCalendarAccess(s.scopes)) throw new GoogleAuthError("no_scope", "calendar access hasn't been granted yet — run /connect google to add it");
  }

  async calendars(): Promise<CalendarInfo[]> {
    this.ensureAccess();
    const res = await this.auth.api<{ items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean; selected?: boolean }[] }>(
      `${API}/users/me/calendarList?minAccessRole=reader&maxResults=250`,
    );
    return (res.items ?? [])
      .filter((c) => c.primary || c.selected)
      .map((c) => ({ id: c.id, name: c.summaryOverride ?? c.summary ?? c.id, primary: Boolean(c.primary) }))
      .sort((a, b) => Number(b.primary) - Number(a.primary));
  }

  /** Events overlapping [from, to) on the shown calendars, recurring ones expanded, sorted by start. */
  async events(from: Date, to: Date, query?: string): Promise<CalendarEvent[]> {
    const cals = await this.calendars();
    const lists = await Promise.all(
      cals.map(async (cal) => {
        const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250" });
        if (query) q.set("q", query);
        const res = await this.auth.api<{ items?: ApiEvent[] }>(`${API}/calendars/${encodeURIComponent(cal.id)}/events?${q}`);
        return (res.items ?? []).map((e) => toEvent(e, cal)).filter((e): e is CalendarEvent => e !== null);
      }),
    );
    return lists.flat().sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.allDay) - Number(a.allDay));
  }
}

/** "09:30–10:00", "all day", "09:30 → Sat 10-03 12:00" (multi-day). */
export function eventTime(e: CalendarEvent): string {
  if (e.allDay) {
    const last = nextDate(localDate(e.end), -1);
    return last > localDate(e.start) ? `all day → ${dayLabel(last)}` : "all day";
  }
  const sameDay = localDate(e.start) === localDate(e.end);
  return `${hhmm(e.start)}–${sameDay ? hhmm(e.end) : `${dayLabel(localDate(e.end))} ${hhmm(e.end)}`}`;
}

/** One event line without the day: "09:30–10:00 Standup @ Room 3 [Work]". */
export function eventLine(e: CalendarEvent, o: { notes?: boolean } = {}): string {
  const parts = [eventTime(e), truncate(e.title, 80)];
  if (e.location) parts.push(`@ ${truncate(e.location, 60)}`);
  if (!e.primaryCalendar) parts.push(`[${e.calendarName}]`);
  if (e.declined) parts.push("(declined)");
  else if (!e.busy && !e.allDay) parts.push("(free)");
  if (e.recurring) parts.push("(repeats)");
  let line = parts.join(" ");
  if (o.notes && e.description) line += `\n      notes: ${truncate(e.description, 160)}`;
  return line;
}

/** Groups events by local day (events that started before `from` go under the first day). */
export function groupByDay(events: CalendarEvent[], from: Date, to: Date): Map<string, CalendarEvent[]> {
  const days = new Map<string, CalendarEvent[]>();
  for (let d = localDate(from); dayStart(d) < to; d = nextDate(d)) days.set(d, []);
  for (const e of events) {
    const key = localDate(e.start < from ? from : e.start);
    days.get(key)?.push(e);
  }
  return days;
}

export interface FreeOptions {
  minutes: number;
  /** Working hours "HH:MM"; default 09:00–18:00. */
  dayStart?: string;
  dayEnd?: string;
  weekends?: boolean;
}

export interface Slot {
  start: Date;
  end: Date;
}

/** Open time of at least `minutes` within working hours, ignoring free/declined events. */
export function freeSlots(events: CalendarEvent[], from: Date, to: Date, o: FreeOptions): Slot[] {
  const busy = events.filter((e) => e.busy && !e.declined).map((e) => ({ start: e.start.getTime(), end: e.end.getTime() }));
  const slots: Slot[] = [];
  for (let d = localDate(from); dayStart(d) < to; d = nextDate(d)) {
    const dow = dayStart(d).getDay();
    if (!o.weekends && (dow === 0 || dow === 6)) continue;
    let cursor = Math.max(from.getTime(), fromLocal(`${d}T${o.dayStart ?? "09:00"}`).getTime());
    const end = Math.min(to.getTime(), fromLocal(`${d}T${o.dayEnd ?? "18:00"}`).getTime());
    const today = busy.filter((b) => b.start < end && b.end > cursor).sort((a, b) => a.start - b.start);
    for (const b of [...today, { start: end, end }]) {
      if (b.start - cursor >= o.minutes * 60_000) slots.push({ start: new Date(cursor), end: new Date(Math.min(b.start, end)) });
      cursor = Math.max(cursor, b.end);
      if (cursor >= end) break;
    }
  }
  return slots;
}

export function slotLine(s: Slot): string {
  const mins = Math.round((s.end.getTime() - s.start.getTime()) / 60_000);
  const len = mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}` : `${mins}m`;
  return `${dayLabel(localDate(s.start))} ${hhmm(s.start)}–${hhmm(s.end)} (${len})`;
}

/** Today's events for the daily brief: "📅 09:30 Standup", "📅 all day Public holiday". */
export async function todayLines(cal: CalendarClient, now = new Date()): Promise<string[]> {
  const day = localDate(now);
  const events = await cal.events(dayStart(day), dayStart(nextDate(day)));
  return events
    .filter((e) => !e.declined)
    .map((e) => `📅 ${e.allDay ? "all day" : hhmm(e.start < dayStart(day) ? dayStart(day) : e.start)} ${truncate(e.title, 60)}${e.location ? ` @ ${truncate(e.location, 30)}` : ""}`);
}
