/**
 * Fills a scratch data folder with made-up reminders, bills and memories, for screenshots and trying
 * the app without touching real data:  EDWARD_DATA_DIR=<scratch> npx tsx app/scripts/seed.ts
 * Refuses to run without EDWARD_DATA_DIR (or JARVIS_DATA_DIR).
 */
import { mkdirSync } from "node:fs";
import { envVar, updateSettings } from "../../src/settings.js";
import { MemoryStore } from "../../src/memory/store.js";
import { ReminderStore } from "../../src/reminders/store.js";
import { BillStore } from "../../src/bills/store.js";
import { localDate, nextDate } from "../../src/google/calendar.js";

const dir = envVar("DATA_DIR");
if (!dir) throw new Error("set EDWARD_DATA_DIR to a scratch folder first");
mkdirSync(dir, { recursive: true });
updateSettings({ onboarded: true, backgroundSuggested: true });

const today = localDate(new Date());
const at = (day: string, time: string) => `${day}T${time}`;

const memory = new MemoryStore();
for (const [kind, text, tier] of [
  ["profile", "The user's name is Alex", "long"],
  ["profile", "Lives in Sydney and works weekdays", "long"],
  ["preference", "Prefers short answers and appointments before noon", "long"],
  ["fact", "Sam Carter is the builder for the kitchen renovation", "long"],
  ["fact", "Dentist is Northside Dental", "long"],
  ["event", "Kitchen install moved to Monday 12 October", "short"],
] as const) memory.add({ kind, text, tier, source: kind === "fact" ? "extracted" : "explicit" });
memory.add({ kind: "fact", text: "Priya drives to the market on Saturdays", source: "extracted", status: "pending" });
memory.close();

const reminders = new ReminderStore();
reminders.add({ text: "Submit expenses", dueAt: at(today, "17:00"), repeat: { kind: "monthly", day: Number(today.slice(8)) } });
reminders.add({ text: "Water the plants", dueAt: at(nextDate(today), "09:00") });
reminders.add({ text: "Renew the car registration", dueAt: at(nextDate(today, 12), "09:00") });
reminders.add({ text: "Call the dentist to confirm", dueAt: at(today, "23:30") });
reminders.close();

const bills = new BillStore();
const bill = (b: Partial<Parameters<BillStore["add"]>[0]> & { payee: string }) =>
  bills.add({ category: "other", kind: "bill", amountCents: null, currency: "AUD", dueDate: null, status: "tracked", messageId: `m-${b.payee}`, senderDomain: "example.com", title: "Your bill is ready", flags: [], needsCheck: false, ...b });
bill({ payee: "Northwind Energy", category: "electricity", amountCents: 24530, dueDate: nextDate(today, 3), senderDomain: "northwindenergy.example", title: "Your electricity bill" });
bill({ payee: "City Council", category: "council", amountCents: 8650, dueDate: nextDate(today, 20), title: "Rates notice" });
bill({ payee: "Fibreline Internet", category: "internet", kind: "autopay", status: "autopay", amountCents: 7900, dueDate: nextDate(today, 11), title: "Your invoice" });
const paid = bill({ payee: "Tasman Mobile", category: "phone", amountCents: 4540, dueDate: today, title: "Your phone bill" });
bills.update(paid.id, { status: "paid" });
bill({ payee: "Harbour Water", category: "water", status: "pending", amountCents: 8650, dueDate: nextDate(today, 21), senderDomain: "harbourwater.example", title: "Your October water bill" });
bill({
  payee: "Northwind Energy Billing",
  category: "electricity",
  status: "pending",
  amountCents: 124530,
  dueDate: nextDate(today, 2),
  messageId: "m-suspicious",
  senderDomain: "northwind-energy-pay.example",
  title: "Your electricity bill is ready",
  flags: ["The payment details differ from this payee's last bill.", "Sent from a different address than Northwind Energy's earlier bills.", "The amount is five times your usual bill."],
});
bills.close();
console.log(`seeded ${dir}`);
