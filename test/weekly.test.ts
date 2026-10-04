// Weekly review (H3): when it comes, and the seven days it shows, against a fake Google.
process.env.TZ = "Australia/Sydney";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "edward-weekly-test-"));
process.env.EDWARD_DATA_DIR = dir;

const w = await import("../src/headsup/weekly.js");
const { NoticeStore } = await import("../src/headsup/notices.js");
const { ReminderStore } = await import("../src/reminders/store.js");
const { BillStore } = await import("../src/bills/store.js");
const { ALL_SCOPES } = await import("../src/google/instructions.js");
const { fakeAccounts } = await import("./fake-accounts.js");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const settings = (o: object) => writeFileSync(join(dir, "settings.json"), JSON.stringify(o));
const at = (s: string) => new Date(`${s}+11:00`);

// --- when (2026-10-11 is a Sunday) ---
eq("default: Sunday 19:00", w.weeklySchedule(), { day: 0, time: "19:00" });
settings({ weeklyReview: { day: 9, time: "7pm" } });
eq("bad values fall back", w.weeklySchedule(), { day: 0, time: "19:00" });
settings({ weeklyReview: "off" });
eq("off", [w.weeklySchedule(), w.weeklyShowing(at("2026-10-11T20:00:00"))], [null, false]);
settings({});
const n = new NoticeStore();
eq("Sunday before 19:00: no", w.weeklyDue(n, at("2026-10-11T18:59:00")), false);
eq("Sunday 19:00: once", [w.weeklyDue(n, at("2026-10-11T19:00:00")), w.weeklyDue(n, at("2026-10-11T21:00:00"))], [true, false]);
eq("Monday: no", w.weeklyDue(n, at("2026-10-12T19:00:00")), false);
eq("the card shows on Sunday evening only", [w.weeklyShowing(at("2026-10-11T19:30:00")), w.weeklyShowing(at("2026-10-12T09:00:00"))], [true, false]);
n.close();

// --- a fake Google: two calendar accounts (one failing), lists in the first ---
type Ev = { id: string; summary: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string }; attendees?: unknown[] };
const events: Ev[] = [
  { id: "1", summary: "Standup", start: { dateTime: "2026-10-12T09:30:00+11:00" }, end: { dateTime: "2026-10-12T10:00:00+11:00" } },
  { id: "2", summary: "Dentist", start: { dateTime: "2026-10-12T14:00:00+11:00" }, end: { dateTime: "2026-10-12T15:00:00+11:00" } },
  { id: "3", summary: "Lunch with Sam", start: { dateTime: "2026-10-12T12:30:00+11:00" }, end: { dateTime: "2026-10-12T13:30:00+11:00" } },
  { id: "4", summary: "Gym", start: { dateTime: "2026-10-12T18:00:00+11:00" }, end: { dateTime: "2026-10-12T19:00:00+11:00" } },
  { id: "5", summary: "Declined thing", start: { dateTime: "2026-10-13T10:00:00+11:00" }, end: { dateTime: "2026-10-13T11:00:00+11:00" }, attendees: [{ self: true, responseStatus: "declined" }] },
  { id: "6", summary: "Holiday in Bali", start: { date: "2026-10-15" }, end: { date: "2026-10-18" } },
  { id: "7", summary: "Next Monday's meeting", start: { dateTime: "2026-10-19T09:00:00+11:00" }, end: { dateTime: "2026-10-19T10:00:00+11:00" } },
];
const tasks = [
  { id: "t1", title: "Fix the tap", due: "2026-10-14T00:00:00.000Z", status: "needsAction" },
  { id: "t2", title: "Old job", due: "2026-10-01T00:00:00.000Z", status: "needsAction" },
  { id: "t3", title: "Far away", due: "2026-11-01T00:00:00.000Z", status: "needsAction" },
  { id: "t4", title: "Milk", status: "needsAction" },
];
const auth = {
  state: () => ({ email: "me@gmail.com", scopes: ALL_SCOPES, connectedAt: "x" }),
  api: async (url: string) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/calendarList")) return { items: [{ id: "me@gmail.com", summary: "Me", primary: true, accessRole: "owner" }] };
    if (u.pathname.includes("/calendars/")) {
      const min = new Date(u.searchParams.get("timeMin")!).getTime();
      const max = new Date(u.searchParams.get("timeMax")!).getTime();
      const t = (x: { dateTime?: string; date?: string }) => new Date(x.dateTime ?? `${x.date}T00:00:00+11:00`).getTime();
      return { items: events.filter((e) => t(e.start) < max && t(e.end) > min) };
    }
    if (u.pathname.endsWith("/users/@me/lists")) return { items: [{ id: "L1", title: "Home" }] };
    if (u.pathname.includes("/lists/")) return { items: tasks };
    throw new Error(`unexpected ${url}`);
  },
};
const broken = { state: () => ({ email: "two@gmail.com", scopes: ALL_SCOPES, connectedAt: "x" }), api: async () => Promise.reject(new Error("offline")) };
const accounts = fakeAccounts([{ auth: auth as never }, { auth: broken as never, name: "Two" }], { tasks: "g1" });

const reminders = new ReminderStore();
reminders.add({ text: "Call mum", dueAt: "2026-10-16T17:00" });
reminders.add({ text: "Too far", dueAt: "2026-10-25T09:00" });
const bills = new BillStore();
const base = { category: "electricity" as const, kind: "bill" as const, currency: "AUD", status: "tracked" as const, senderDomain: "x.example", flags: [], needsCheck: false, title: "t" };
bills.add({ ...base, payee: "Origin Energy", amountCents: 24530, dueDate: "2026-10-14", messageId: "b1" });
bills.add({ ...base, payee: "Water", amountCents: 9000, dueDate: "2026-10-09", messageId: "b2" });
bills.add({ ...base, payee: "Later Co", amountCents: 100, dueDate: "2026-10-30", messageId: "b3" });

const now = at("2026-10-11T19:05:00");
const week = await w.composeWeek(accounts, reminders, bills, now);
eq("seven days from tomorrow", [week.from, week.days.length, week.days[0]!.label, week.days[6]!.label], ["2026-10-12", 7, "Mon 10-12", "Sun 10-18"]);
eq("Monday's events in order", week.days[0]!.events, ["09:30 Standup", "12:30 Lunch with Sam", "14:00 Dentist", "18:00 Gym"]);
eq("declined left out", week.days[1]!.events, []);
eq("a holiday over three days shows on each", week.days.map((d) => d.events.includes("all day Holiday in Bali")), [false, false, false, true, true, true, false]);
ok("next Monday is outside the week", !week.days.some((d) => d.events.some((e) => e.includes("Next Monday"))));
eq("bills due in the week or overdue", week.bills, ["Water $90.00 — overdue since Fri 10-09", "Origin Energy $245.30 — due Wed 10-14"]);
eq("to-dos due in the week or overdue, undated left out", week.todo, ["Old job · Home (overdue)", "Fix the tap · Home (due Wed 10-14)"]);
eq("reminders in the week", week.reminders, ["Fri 10-16 17:00 Call mum"]);
eq("a failing account is named", week.problems, ["calendar (Two)"]);
eq("headline", w.weekHeadline(week), "5 events, 2 bills, 2 to-dos, 1 reminder");
const lines = w.weekLines(week);
eq("terminal lines", lines.slice(0, 3), ["🗓 Next week · 5 events, 2 bills, 2 to-dos, 1 reminder", "  Mon 10-12  09:30 Standup · 12:30 Lunch with Sam · 14:00 Dentist +1 more", "  Thu 10-15  all day Holiday in Bali"]);
ok("…with bills, to-dos, reminders and the problem", lines.includes("  💳 Origin Energy $245.30 — due Wed 10-14") && lines.includes("  ☐ Fix the tap · Home (due Wed 10-14)") && lines.includes("  ⏰ Fri 10-16 17:00 Call mum") && lines.at(-1) === "  ⚠ couldn't read: calendar (Two)");
const t = w.weekToast(week);
eq("toast", [t.title, t.body, t.kind], ["🗓 Next week · 5 events, 2 bills, 2 to-dos, 1 reminder", "Busiest: Mon 10-12 (4 events)\n💳 Water $90.00 — overdue since Fri 10-09", "info"]);
const none = new ReminderStore(join(dir, "empty.db"));
const empty = await w.composeWeek(fakeAccounts([]), none, undefined, now);
none.close();
eq("nothing connected, nothing planned", [w.weekHeadline(empty), empty.days.length, w.weekLines(empty).length], ["nothing planned yet", 7, 1]);

reminders.close();
bills.close();
rmSync(dir, { recursive: true, force: true });
console.log(results.map(([name, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
