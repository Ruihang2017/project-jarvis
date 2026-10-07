// Demo mode (D44): the made-up Google answers Edward's calls and nothing else.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "edward-demo-test-"));
process.env.EDWARD_DATA_DIR = dir;

const { demoGoogle, demoData, DEMO_EMAIL } = await import("../src/demo/google.js");
const { fromJsonLd } = await import("../src/headsup/trips.js");
const { BILL_QUERY } = await import("../src/bills/scan.js");
const { TRIP_QUERY } = await import("../src/headsup/trips.js");
const { UNREAD_QUERY } = await import("../src/google/gmail.js");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// A fixed time of day: the made-up site visit is 40 minutes from "now", which is tomorrow after 23:05.
const noon = new Date();
noon.setHours(12, 0, 0, 0);
const http = demoGoogle(() => noon);
const get = async (url: string, init?: RequestInit) => {
  const r = await http(url, init);
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const gmail = (q: string) => get(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=50`).then((r) => r.body.messages.map((m: { id: string }) => m.id));

eq("anything that isn't Google is refused", (await get("https://api.openai.com/v1/models")).status, 400);
eq("a token refresh succeeds", (await get("https://oauth2.googleapis.com/token", { method: "POST" })).body.access_token, "demo");
eq("unread in Primary", await gmail(UNREAD_QUERY), ["d01", "d02"]);
eq("bills search", (await gmail(BILL_QUERY)).sort(), ["d05", "d06", "d16"]);
eq("booking search", (await gmail(TRIP_QUERY)).sort(), ["d03", "d04"]);
eq("adverts only when asked", [(await gmail("in:inbox newer_than:30d category:promotions")).length, (await gmail("in:inbox -category:promotions newer_than:1d")).includes("d12")], [4, false]);
eq("from a person", await gmail("{from:sam@carterbuilding.example to:sam@carterbuilding.example} newer_than:30d"), ["d01"]);
eq("sent before (first-time check)", [await gmail("in:sent to:sam@carterbuilding.example"), await gmail("in:sent to:stranger@x.example")], [["s01"], []]);
eq("plain words", await gmail("benchtop"), ["d01"]);
const full = (await get("https://gmail.googleapis.com/gmail/v1/users/me/messages/d03?format=full")).body;
ok("a full message has its HTML with booking data", fromJsonLd(Buffer.from(full.payload.parts[1].body.data, "base64url").toString()).length === 1);


// Drafts: one waiting, new ones kept as written, read back like Gmail does, gone once sent.
const { GmailWriter, buildRaw, isPlainText } = await import("../src/google/gmail.js");
const { GoogleAuthError } = await import("../src/google/oauth.js");
// As GoogleAuth.api answers: the JSON, or an error that carries the status.
const draftsOf = new GmailWriter({
  api: async (url: string, init?: RequestInit) => {
    const res = await http(url, init);
    if (!res.ok) throw new GoogleAuthError(`http_${res.status}`, `Google API ${res.status}`);
    return res.json();
  },
} as never);
eq("a draft is waiting", (await draftsOf.listDrafts()).map((d) => [d.message.to, d.message.subject]), [["Priya Shah <priya.shah@mailbox.example>", "Weekend at the coast?"]]);
const madeDraft = await draftsOf.createDraft(buildRaw({ to: ["Sam Carter <sam@carterbuilding.example>"], cc: [], subject: "Benchtop", body: "Hi Sam,\n\nSnow White please.\n\nAlex" }));
const readBack = (await draftsOf.getDraft(madeDraft.id))!;
eq("a new draft reads back as it was written", [readBack.to, readBack.subject, readBack.body, isPlainText(readBack)], ["Sam Carter <sam@carterbuilding.example>", "Benchtop", "Hi Sam,\n\nSnow White please.\n\nAlex", true]);
await draftsOf.updateDraft(madeDraft.id, buildRaw({ to: ["Sam Carter <sam@carterbuilding.example>"], cc: [], subject: "Benchtop colour", body: "Ash Grey." }));
eq("…changed, and the newest first", (await draftsOf.listDrafts()).map((d) => d.message.subject), ["Benchtop colour", "Weekend at the coast?"]);
await draftsOf.sendDraft(madeDraft.id);
eq("…and gone from Drafts once sent", [(await draftsOf.listDrafts()).length, await draftsOf.getDraft(madeDraft.id)], [1, null]);

const cal = await get("https://www.googleapis.com/calendar/v3/users/me/calendarList");
eq("calendars", cal.body.items.map((c: { id: string }) => c.id)[0], DEMO_EMAIL);
const { today } = demoData(noon);
const day = (n: number) => new Date(`${today}T00:00`).getTime() + n * 86_400_000;
const events = async () => (await get(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(DEMO_EMAIL)}/events?timeMin=${new Date(day(0)).toISOString()}&timeMax=${new Date(day(1)).toISOString()}`)).body.items;
ok("today's events include the site visit", (await events()).some((e: { summary: string }) => e.summary === "Kitchen renovation site visit"));
const made = (await get(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(DEMO_EMAIL)}/events?sendUpdates=none`, { method: "POST", body: JSON.stringify({ summary: "Haircut", start: { dateTime: new Date(day(0) + 15 * 3_600_000).toISOString() }, end: { dateTime: new Date(day(0) + 16 * 3_600_000).toISOString() } }) })).body;
ok("an added event shows up, until quit", (await events()).some((e: { id: string }) => e.id === made.id));

const lists = (await get("https://tasks.googleapis.com/tasks/v1/users/@me/lists")).body.items.map((l: { title: string }) => l.title);
eq("lists", lists, ["Shopping", "Home", "Packing"]);
const added = (await get("https://tasks.googleapis.com/tasks/v1/lists/L1/tasks", { method: "POST", body: JSON.stringify({ title: "Avocados" }) })).body;
await get(`https://tasks.googleapis.com/tasks/v1/lists/L1/tasks/${added.id}`, { method: "PATCH", body: JSON.stringify({ status: "completed" }) });
const shopping = (await get("https://tasks.googleapis.com/tasks/v1/lists/L1/tasks")).body.items;
ok("an item added and ticked", shopping.some((t: { title: string; status: string }) => t.title === "Avocados" && t.status === "completed"));

// The site visit is about 40 minutes away, and still today late in the evening.
const visitAt = (h: number, m: number) => {
  const t = new Date();
  t.setHours(h, m, 0, 0);
  const d = demoData(t);
  const start = d.events.find((e: { summary: string }) => e.summary === "Kitchen renovation site visit")!.start;
  return [start.slice(0, 10) === d.today, start.slice(11)];
};
eq("the site visit: 40 minutes on, at a quarter hour", [visitAt(12, 0), visitAt(9, 20)], [[true, "12:45"], [true, "10:00"]]);
eq("…and never tomorrow", [visitAt(23, 0), visitAt(23, 14), visitAt(23, 55)], [[true, "23:45"], [true, "23:45"], [true, "23:45"]]);
ok("only made-up addresses", demoData().mail.every((m) => /\.example>?$|@gmail\.com>?$/.test(m.from.replace(/>$/, "")) || m.from.includes(DEMO_EMAIL)));

rmSync(dir, { recursive: true, force: true });
console.log(results.map(([name, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
