/**
 * Fills a folder with the made-up person, Google account and data the demo mode uses (D44: tutorial
 * videos and website pictures). Everything is invented. Then run the app on it with EDWARD_DEMO:
 *   EDWARD_DATA_DIR=<folder> npx tsx app/scripts/demo.ts
 *   EDWARD_DEMO=1 EDWARD_DATA_DIR=<folder> EDWARD_CODEX_HOME=<login> npx electron app
 * Refuses to run without EDWARD_DATA_DIR, or on a folder that already has data.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appDataDir, envVar, updateSettings } from "../../src/settings.js";
import { accountDir, Accounts } from "../../src/accounts/accounts.js";
import { protect } from "../../src/google/dpapi.js";
import { ALL_SCOPES } from "../../src/google/instructions.js";
import { MemoryStore } from "../../src/memory/store.js";
import { ReminderStore } from "../../src/reminders/store.js";
import { BillStore } from "../../src/bills/store.js";
import { TripStore, scanTrips } from "../../src/headsup/trips.js";
import { DEMO_EMAIL, demoData, demoGoogle } from "../../src/demo/google.js";
import { nextDate } from "../../src/google/calendar.js";

const dir = envVar("DATA_DIR");
if (!dir) throw new Error("set EDWARD_DATA_DIR to an empty folder first");
if (existsSync(join(dir, "memory.db")) || existsSync(join(dir, "accounts.json"))) throw new Error(`${dir} already has data; use an empty folder`);
mkdirSync(dir, { recursive: true });
// No morning brief popping up over the pages in the videos.
updateSettings({ onboarded: true, backgroundSuggested: true, dateOrder: "dmy", currency: "AUD", briefDays: "off", billsRemindDays: "off" });

// A Google sign-in that only the demo's made-up Google accepts.
writeFileSync(join(appDataDir(), "google-client.json"), JSON.stringify({ installed: { client_id: "demo.apps.googleusercontent.com", client_secret: "demo" } }));
writeFileSync(join(appDataDir(), "accounts.json"), JSON.stringify({ accounts: [{ id: "g1", provider: "google", email: DEMO_EMAIL, name: "Alex Morgan", color: "#2A52BE", mail: true, calendar: true, addedAt: new Date().toISOString() }] }, null, 2));
const acc = accountDir("g1");
mkdirSync(acc, { recursive: true });
writeFileSync(join(acc, "google-token.bin"), await protect("demo-refresh-token"));
const now = new Date().toISOString();
writeFileSync(join(acc, "google.json"), JSON.stringify({ email: DEMO_EMAIL, scopes: ALL_SCOPES, connectedAt: now, checkedAt: now }, null, 2));

const { today } = demoData();
const memory = new MemoryStore();
for (const [kind, text] of [
  ["profile", "The user's name is Alex"],
  ["profile", "Lives in Sydney with partner Jamie and daughter Ella"],
  ["preference", "Prefers short answers and appointments before noon"],
  ["fact", "Sam Carter is the builder for the kitchen renovation"],
  ["fact", "Priya Shah is a close friend; they have dinner most months"],
  ["fact", "Dentist is Dr Wong at Northside Dental"],
] as const) memory.add({ kind, text, tier: "long", source: "explicit" });
memory.add({ kind: "event", text: "Kitchen install is on Monday", tier: "short", source: "extracted" });
memory.close();

const reminders = new ReminderStore();
reminders.add({ text: "Order the benchtop with Sam", dueAt: `${nextDate(today, 1)}T09:00` });
reminders.add({ text: "Ella's swimming permission note", dueAt: `${nextDate(today, 2)}T08:00` });
reminders.add({ text: "Renew the car registration", dueAt: `${nextDate(today, 12)}T09:00` });
reminders.close();

const bills = new BillStore();
const bill = (b: Partial<Parameters<BillStore["add"]>[0]> & { payee: string; messageId: string }) =>
  bills.add({ category: "other", kind: "bill", amountCents: null, currency: "AUD", dueDate: null, status: "tracked", senderDomain: "example.com", title: "Your bill", flags: [], needsCheck: false, mailbox: "g1", ...b });
bill({ payee: "Northwind Energy", category: "electricity", amountCents: 24530, dueDate: nextDate(today, 3), messageId: "d05", senderDomain: "northwindenergy.example", title: "Your electricity bill is ready" });
bill({ payee: "Harbour Water", category: "water", status: "pending", amountCents: 8650, dueDate: nextDate(today, 21), messageId: "d06", senderDomain: "harbourwater.example", title: "Your October water bill" });
bill({ payee: "Fibreline Internet", category: "internet", kind: "autopay", status: "autopay", amountCents: 7900, dueDate: nextDate(today, 11), messageId: "d16", senderDomain: "fibreline.example", title: "Your invoice" });
for (const id of ["d05", "d06", "d16"]) bills.markScanned(id, true);
bills.close();

// The bookings, read from the made-up emails' booking data (no model needed).
const trips = new TripStore();
const found = await scanTrips({ accounts: new Accounts(demoGoogle()), store: trips, run: async () => JSON.stringify({ trips: [] }) });
trips.close();
console.log(`demo data in ${dir}: ${found.found.length} trips`);
