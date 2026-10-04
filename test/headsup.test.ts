// Heads-ups (H): meeting heads-up (H1) against a fake Google Calendar and Gmail, and the notice store.
process.env.TZ = "Australia/Sydney";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "edward-headsup-test-"));
process.env.EDWARD_DATA_DIR = dir;

const { NoticeStore } = await import("../src/headsup/notices.js");
const m = await import("../src/headsup/meetings.js");
const { toEvent } = await import("../src/google/calendar.js");
const { ALL_SCOPES } = await import("../src/google/instructions.js");
const { MemoryStore } = await import("../src/memory/store.js");
const { fakeAccounts } = await import("./fake-accounts.js");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const T0 = new Date("2026-10-06T13:00:00+11:00"); // Tue 13:00
const after = (min: number) => new Date(T0.getTime() + min * 60_000);
const iso = (d: Date) => d.toISOString();

// --- a fake Google: two calendars (one the user's, one read-only holidays) and some mail ---
type Ev = { id: string; summary: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string }; location?: string; attendees?: unknown[] };
const timed = (id: string, summary: string, startMin: number, o: Partial<Ev> = {}): Ev => ({ id, summary, start: { dateTime: iso(after(startMin)) }, end: { dateTime: iso(after(startMin + 60)) }, ...o });
const mine: Ev[] = [
  timed("dentist", "Dentist", 20, { location: "12 Smith St, Newtown" }),
  timed("gym", "Gym", 25),
  timed("piano", "Piano practice", 22),
  timed("kickoff", "Project kickoff", 15, { attendees: [{ self: true, email: "me@gmail.com" }, { email: "Bob.Lee@example.com", displayName: "Bob Lee" }, { email: "room@resource.calendar.google.com", resource: true }] }),
  timed("lunch-sam", "Lunch", 28, { attendees: [{ self: true, responseStatus: "declined" }, { email: "sam@example.com" }] }),
  timed("later", "Tax agent", 50, { location: "Level 3, 1 George St" }),
  timed("renovation", "Kitchen renovation quote", 10),
  { id: "allday", summary: "Ella's birthday", start: { date: "2026-10-06" }, end: { date: "2026-10-07" }, location: "Home" },
  // Tomorrow early (07:30) and later (10:00)
  { id: "flight", summary: "Flight to Melbourne", start: { dateTime: "2026-10-07T07:30:00+11:00" }, end: { dateTime: "2026-10-07T09:00:00+11:00" }, location: "Sydney Airport T2" },
  { id: "late", summary: "Haircut", start: { dateTime: "2026-10-07T10:00:00+11:00" }, end: { dateTime: "2026-10-07T10:30:00+11:00" }, location: "Main St" },
];
const holidays: Ev[] = [timed("hol", "Someone else's event", 12, { location: "Somewhere" })];
const mail: Record<string, { id: string; from: string; subject: string; date: string }[]> = {
  bob: [
    { id: "m1", from: "Bob Lee <bob.lee@example.com>", subject: "Agenda for the kickoff", date: "2026-10-05T09:00:00+11:00" },
    { id: "m2", from: "Me <me@gmail.com>", subject: "Re: timeline", date: "2026-10-04T09:00:00+11:00" },
  ],
  renovation: [
    { id: "m3", from: "Builder <quotes@builder.example>", subject: "Your kitchen renovation quote", date: "2026-10-03T09:00:00+11:00" },
    { id: "m4", from: "Shop <news@shop.example>", subject: "Renovation ideas!", date: "2026-10-02T09:00:00+11:00" },
  ],
};
const queries: string[] = [];
let calendarCalls = 0;
const auth = {
  state: () => ({ email: "me@gmail.com", scopes: ALL_SCOPES, connectedAt: "x" }),
  api: async (url: string) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/calendarList")) {
      calendarCalls++;
      return { items: [{ id: "me@gmail.com", summary: "Me", primary: true, accessRole: "owner" }, { id: "hol", summary: "Holidays", selected: true, accessRole: "reader" }] };
    }
    if (u.pathname.includes("/calendars/")) {
      const list = u.pathname.includes("/hol/") ? holidays : mine;
      const min = new Date(u.searchParams.get("timeMin")!).getTime();
      const max = new Date(u.searchParams.get("timeMax")!).getTime();
      const startOf = (e: Ev) => new Date(e.start.dateTime ?? `${e.start.date}T00:00:00+11:00`).getTime();
      const endOf = (e: Ev) => new Date(e.end.dateTime ?? `${e.end.date}T00:00:00+11:00`).getTime();
      return { items: list.filter((e) => startOf(e) < max && endOf(e) > min) };
    }
    if (u.pathname.endsWith("/messages")) {
      const q = u.searchParams.get("q")!;
      queries.push(q);
      const hits = q.includes("bob.lee@example.com") ? mail.bob! : /renovation/i.test(q) ? mail.renovation! : [];
      return { messages: hits.map((h) => ({ id: h.id })) };
    }
    const id = u.pathname.split("/").pop()!;
    const h = [...mail.bob!, ...mail.renovation!].find((x) => x.id === id)!;
    return { id, threadId: id, internalDate: String(new Date(h.date).getTime()), payload: { headers: [{ name: "From", value: h.from }, { name: "Subject", value: h.subject }, { name: "To", value: "me@gmail.com" }] } };
  },
};
const accounts = fakeAccounts([{ auth: auth as never, email: "me@gmail.com" }]);
const notices = new NoticeStore();
const memory = new MemoryStore();
memory.add({ kind: "fact", text: "Bob Lee prefers to keep meetings short", source: "user" });
memory.add({ kind: "fact", text: "The dentist is Dr Wong", source: "user" });

// --- the event's people ---
const kickoff = toEvent(mine.find((e) => e.id === "kickoff") as never, { id: "me@gmail.com", name: "Me", primary: true, writable: true })!;
eq("people: others only, no rooms, addresses lower-cased", kickoff.people, [{ email: "bob.lee@example.com", name: "Bob Lee" }]);
const dirty = toEvent(timed("x", "X", 0, { attendees: [{ email: "a@b.com", displayName: "Eve\u001b[31m" }] }) as never, { id: "c", name: "c", primary: true, writable: true })!;
eq("people's names are cleaned of control characters", dirty.people[0]!.name, "Eve[31m");

// --- which events, and how related email is found ---
eq("query by people", m.relatedQuery(kickoff), "{from:bob.lee@example.com to:bob.lee@example.com} newer_than:30d");
const ev = (summary: string) => toEvent(timed("x", summary, 0) as never, { id: "c", name: "c", primary: true, writable: true })!;
eq("query by an exact title", m.relatedQuery(ev("Kitchen renovation quote")), 'subject:"Kitchen renovation quote" newer_than:30d -category:promotions');
eq("no query for a common title", [m.relatedQuery(ev("Lunch")), m.relatedQuery(ev("Gym")), m.relatedQuery(ev("abc"))], [null, null, null]);
eq("quotes and braces can't break the query", m.relatedQuery(ev('Say "hi" {now}')), 'subject:"Say hi now" newer_than:30d -category:promotions');
eq("worth it: place, people or email", [m.worthIt(ev("Gym"), 0), m.worthIt(ev("Gym"), 1), m.worthIt(kickoff, 0)], [false, true, true]);

// --- claiming at 13:00 with the default 30 minutes ---
const first = await m.claimHeadsUps(accounts, notices, memory, T0);
eq("due now: events with a place, people or related email, within 30 minutes", first.map((h) => h.e.id).sort(), ["dentist", "kickoff", "renovation"]);
const byId = (id: string) => first.find((h) => h.e.id === id)!;
eq("related email by people", byId("kickoff").related.map((r) => r.m.id), ["m1", "m2"]);
eq("related email by title keeps only subjects with the title", byId("renovation").related.map((r) => r.m.id), ["m3"]);
eq("notes about the people from memory", byId("kickoff").notes, ["Bob Lee prefers to keep meetings short"]);
ok("not: plain Gym or Piano practice (nothing to add), declined lunch, all-day, someone else's calendar, beyond 30 minutes", !first.some((h) => ["gym", "piano", "lunch-sam", "allday", "hol", "later"].includes(h.e.id)));

const calls = calendarCalls;
eq("asked again within five minutes: Google isn't called", [(await m.claimHeadsUps(accounts, notices, memory, after(2))).length, calendarCalls], [0, calls]);
eq("five minutes on: nothing new is due", (await m.claimHeadsUps(accounts, notices, memory, after(5))).length, 0);
const searched = queries.length;
await m.claimHeadsUps(accounts, notices, memory, after(10));
eq("an event with nothing to add is looked up once, not every five minutes", queries.filter((q) => q.includes("Piano practice")).length, 1);
ok("…and mail isn't searched again for events already claimed", queries.length === searched || queries.slice(searched).every((q) => !q.includes("bob.lee")));
const later = await m.claimHeadsUps(accounts, notices, memory, after(25));
eq("the 13:50 appointment once it is 30 minutes away", later.map((h) => h.e.id), ["later"]);

// --- the evening before an early start ---
const evening = new Date("2026-10-06T20:30:00+11:00");
const eve = await m.claimHeadsUps(accounts, notices, memory, evening);
eq("at 20:30: tomorrow's 07:30 flight, not the 10:00 haircut", eve.map((h) => [h.e.id, h.when]), [["flight", "tomorrow"]]);
eq("once per evening", (await m.claimHeadsUps(accounts, notices, memory, new Date("2026-10-06T20:40:00+11:00"))).length, 0);
const morning = await m.claimHeadsUps(accounts, notices, memory, new Date("2026-10-07T07:05:00+11:00"));
eq("and again 30 minutes before it", morning.map((h) => [h.e.id, h.when]), [["flight", "soon"]]);

// --- what is shown ---
const t = m.headsUpToast(byId("kickoff"), T0);
eq("toast", [t.title, t.body, t.kind], ["📅 13:15 Project kickoff · in 15 min", "2 related emails · with Bob Lee", "info"]);
const d = m.headsUpToast(byId("dentist"), T0);
eq("toast with a place", d.body, "@ 12 Smith St, Newtown");
eq("evening toast", m.headsUpToast(eve[0]!, evening).title, "📅 Early tomorrow: 07:30 Flight to Melbourne");
eq("lines", m.headsUpLines(byId("kickoff"), T0), [
  "📅 13:15 Project kickoff · in 15 min",
  "   with Bob Lee",
  "   ✉ Bob Lee — Agenda for the kickoff",
  "   ✉ Me — Re: timeline",
  "   📌 Bob Lee prefers to keep meetings short",
]);
eq("minutes", [m.minutesUntil(after(25), T0), m.minutesUntil(after(65), T0), m.minutesUntil(after(120), T0)], ["in 25 min", "in 1 h 5 min", "in 2 h"]);
eq("map link is only a search URL", m.mapUrl("12 Smith St, Newtown"), "https://www.google.com/maps/search/?api=1&query=12%20Smith%20St%2C%20Newtown");

// --- settings ---
const settings = (o: object) => writeFileSync(join(dir, "settings.json"), JSON.stringify(o));
settings({ meetingLead: "off" });
const other = new NoticeStore(join(dir, "other.db"));
eq("off: nothing, and Google isn't asked", [await m.claimHeadsUps(accounts, other, memory, T0), m.meetingLead()], [[], null]);
other.close();
settings({ meetingLead: 60 });
eq("60 minutes", m.meetingLead(), 60);
settings({ meetingLead: 7 });
eq("an odd value falls back to 30", m.meetingLead(), 30);
eq("no calendar account: nothing", await m.claimHeadsUps(fakeAccounts([]), notices, memory, T0), []);

// --- the notice store ---
const n = new NoticeStore(join(dir, "n.db"));
eq("claim once", [n.claim("a"), n.claim("a"), n.has("a"), n.has("b")], [true, false, true, false]);
const t1 = new Date("2026-10-06T10:00:00Z");
eq("every: first, too soon, then again", [n.every("x", 5, t1), n.every("x", 5, new Date(t1.getTime() + 4 * 60_000)), n.every("x", 5, new Date(t1.getTime() + 5 * 60_000))], [true, false, true]);
n.claim("old", new Date("2026-07-01T00:00:00Z"));
n.prune(t1);
eq("old notices are forgotten, checks kept", [n.has("old"), n.has("a"), n.every("x", 5, new Date(t1.getTime() + 6 * 60_000))], [false, true, false]);
n.close();

notices.close();
memory.close();
rmSync(dir, { recursive: true, force: true });
console.log(results.map(([name, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
