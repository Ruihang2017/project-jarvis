/**
 * Meeting heads-up (H1, D43): a notification shortly before an event that has a place, other
 * people or related email. Google Calendar already reminds about every event on the phone, so
 * Edward only speaks up when it can add something. Code only: no model, no ChatGPT quota.
 */
import type { Account, Accounts } from "../accounts/accounts.js";
import type { Toast } from "../background/notify.js";
import { CalendarClient, dayStart, localDate, nextDate, type CalendarEvent } from "../google/calendar.js";
import { displayName, GmailClient, type MessageSummary } from "../google/gmail.js";
import type { MemoryStore } from "../memory/store.js";
import { fromLocal, toLocal } from "../reminders/schedule.js";
import { loadSettings } from "../settings.js";
import { truncate } from "../util.js";
import type { NoticeStore } from "./notices.js";

export const DEFAULT_MEETING_LEAD = 30;
export const MEETING_LEADS = [15, 30, 60] as const;
/** How often Google is asked about the coming events (the tick runs every minute). */
const CHECK_EVERY_MIN = 5;
/** Events starting before this get a second heads-up the evening before, from EVENING on. */
const EARLY = "09:00";
const EVENING = "20:00";
const RELATED_MAX = 3;
const RELATED_DAYS = 30;
/** Titles too common to find related email by: "Lunch" would match every newsletter about lunch. */
const GENERIC = new Set(["meeting", "call", "catch up", "catch-up", "catchup", "lunch", "dinner", "breakfast", "coffee", "gym", "busy", "appointment", "chat", "sync", "1:1", "event", "(no title)"]);

/** Minutes before an event, or null when switched off. */
export function meetingLead(): number | null {
  const v = loadSettings().meetingLead;
  if (v === "off") return null;
  return (MEETING_LEADS as readonly number[]).includes(v as number) ? (v as number) : DEFAULT_MEETING_LEAD;
}

export interface Related {
  account: Account;
  m: MessageSummary;
}

export interface HeadsUp {
  e: CalendarEvent;
  account: Account;
  related: Related[];
  /** Notes from memory about the people in it. */
  notes: string[];
  /** soon: within the lead time; tomorrow: the evening before an early start. */
  when: "soon" | "tomorrow";
}

/** Timed, not declined, on a calendar the user keeps (owner or writer): not holidays or someone else's calendar. */
export const isCandidate = (e: CalendarEvent) => !e.allDay && !e.declined && e.writable;

/** Worth a heads-up: somewhere to be, someone to meet, or email about it. */
export const worthIt = (e: CalendarEvent, related: number) => Boolean(e.location) || e.guests > 0 || related > 0;

const hhmm = (d: Date) => toLocal(d).slice(11);

/** Gmail query for email about an event: with its people, else with its exact title; null when neither works. */
export function relatedQuery(e: CalendarEvent): string | null {
  const emails = e.people.map((p) => p.email).filter((a): a is string => Boolean(a && /^[^\s@"{}()]+@[^\s@"{}()]+$/.test(a))).slice(0, 6);
  if (emails.length) return `{${emails.flatMap((a) => [`from:${a}`, `to:${a}`]).join(" ")}} newer_than:${RELATED_DAYS}d`;
  const title = titleForSearch(e.title);
  return title ? `subject:"${title}" newer_than:${RELATED_DAYS}d -category:promotions` : null;
}

function titleForSearch(title: string): string | null {
  const t = title.replace(/["{}()]/g, " ").replace(/\s+/g, " ").trim();
  if (t.length < 4 || GENERIC.has(t.toLowerCase())) return null;
  return t;
}

/** Up to three recent emails about the event, from every mail account. A failing account adds nothing. */
export async function findRelated(accounts: Accounts, e: CalendarEvent): Promise<Related[]> {
  const q = relatedQuery(e);
  if (!q) return [];
  const byTitle = !e.people.some((p) => p.email);
  const title = e.title.toLowerCase();
  const lists = await Promise.all(
    accounts.for("mail").map(async (account) => {
      try {
        return (await new GmailClient(accounts.auth(account)).search(q, RELATED_MAX)).map((m) => ({ account, m }));
      } catch {
        return [];
      }
    }),
  );
  return lists
    .flat()
    // A title search is loose: keep only emails whose subject really has the title in it.
    .filter((r) => !byTitle || r.m.subject.toLowerCase().includes(title))
    .sort((a, b) => b.m.date.getTime() - a.m.date.getTime())
    .slice(0, RELATED_MAX);
}

/** Memories that name one of the event's people (by name, or by the part before @). */
export function peopleNotes(memory: MemoryStore, e: CalendarEvent): string[] {
  const names = e.people.map((p) => p.name || p.email?.split("@")[0]?.replace(/[._]/g, " ")).filter((n): n is string => Boolean(n && n.length >= 3));
  const out: string[] = [];
  for (const name of names.slice(0, 4)) {
    for (const { memory: m } of memory.search(name, { limit: 3 })) {
      if (m.text.toLowerCase().includes(name.toLowerCase()) && !out.includes(m.text)) out.push(m.text);
    }
  }
  return out.slice(0, 3);
}

/** Timed events on the user's own calendars between `from` and `to`, from every calendar account. */
async function candidates(accounts: Accounts, from: Date, to: Date): Promise<{ e: CalendarEvent; account: Account }[]> {
  const lists = await Promise.all(
    accounts.for("calendar").map(async (account) => {
      try {
        return (await new CalendarClient(accounts.auth(account)).events(from, to)).filter(isCandidate).map((e) => ({ e, account }));
      } catch {
        return []; // offline or expired: the health check reports it; try again next time
      }
    }),
  );
  return lists.flat().sort((a, b) => a.e.start.getTime() - b.e.start.getTime());
}

const eventKey = (when: string, a: Account, e: CalendarEvent) => `meeting-${when}:${a.id}:${e.id}:${e.start.toISOString()}`;

/**
 * Heads-ups due now, each claimed so it shows once (tick, REPL or app). Asks Google at most every
 * five minutes, so a heads-up can come a few minutes early. An event is claimed before its email is
 * looked up, so an event with nothing to add is looked at once, not every five minutes.
 */
export async function claimHeadsUps(accounts: Accounts, notices: NoticeStore, memory: MemoryStore, now = new Date()): Promise<HeadsUp[]> {
  const lead = meetingLead();
  if (lead === null || !accounts.for("calendar").length) return [];
  if (!notices.every("meetings", CHECK_EVERY_MIN, now)) return [];
  const found: { e: CalendarEvent; account: Account; when: HeadsUp["when"] }[] = [];
  for (const c of await candidates(accounts, now, new Date(now.getTime() + lead * 60_000))) {
    if (c.e.start > now && notices.claim(eventKey("soon", c.account, c.e), now)) found.push({ ...c, when: "soon" });
  }
  const tomorrow = nextDate(localDate(now));
  if (hhmm(now) >= EVENING && notices.claim(`meeting-evening:${tomorrow}`, now)) {
    for (const c of await candidates(accounts, dayStart(tomorrow), fromLocal(`${tomorrow}T${EARLY}`))) {
      if (notices.claim(eventKey("tomorrow", c.account, c.e), now)) found.push({ ...c, when: "tomorrow" });
    }
  }
  const out: HeadsUp[] = [];
  for (const f of found) {
    const related = await findRelated(accounts, f.e);
    if (!worthIt(f.e, related.length)) continue;
    out.push({ ...f, related, notes: peopleNotes(memory, f.e) });
  }
  notices.prune(now);
  return out;
}

/** "Alice Smith, Bob and 2 more" */
export function withWhom(e: CalendarEvent): string {
  const names = e.people.map((p) => p.name || p.email || "").filter(Boolean);
  if (!names.length) return "";
  const shown = names.slice(0, 2).map((n) => truncate(n, 24));
  return names.length > 2 ? `${shown.join(", ")} and ${names.length - 2} more` : shown.join(" and ");
}

/** "in 25 min", "in 1 h 5 min" */
export function minutesUntil(start: Date, now = new Date()): string {
  const mins = Math.max(0, Math.round((start.getTime() - now.getTime()) / 60_000));
  return mins >= 60 ? `in ${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ""}` : `in ${mins} min`;
}

/** Lines for the terminal and the app's notice bar. */
export function headsUpLines(h: HeadsUp, now = new Date()): string[] {
  const head = h.when === "tomorrow" ? `📅 Early tomorrow: ${hhmm(h.e.start)} ${truncate(h.e.title, 60)}` : `📅 ${hhmm(h.e.start)} ${truncate(h.e.title, 60)} · ${minutesUntil(h.e.start, now)}`;
  const lines = [head];
  if (h.e.location) lines.push(`   @ ${truncate(h.e.location, 80)}`);
  const who = withWhom(h.e);
  if (who) lines.push(`   with ${who}`);
  for (const r of h.related) lines.push(`   ✉ ${truncate(displayName(r.m.from), 24)} — ${truncate(r.m.subject, 60)}`);
  for (const n of h.notes) lines.push(`   📌 ${truncate(n, 90)}`);
  return lines;
}

export function headsUpToast(h: HeadsUp, now = new Date()): Toast {
  const who = withWhom(h.e);
  const second = [h.related.length ? `${h.related.length} related email${h.related.length === 1 ? "" : "s"}` : "", who ? `with ${who}` : ""].filter(Boolean).join(" · ");
  return {
    title: h.when === "tomorrow" ? `📅 Early tomorrow: ${hhmm(h.e.start)} ${h.e.title}` : `📅 ${hhmm(h.e.start)} ${h.e.title} · ${minutesUntil(h.e.start, now)}`,
    body: [h.e.location ? `@ ${h.e.location}` : "", second].filter(Boolean).join("\n"),
    tag: `meeting-${h.e.id}`.slice(0, 64),
    kind: "info",
  };
}

/** A Google Maps search for the place (only a link: no Maps API, no key). */
export const mapUrl = (location: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
