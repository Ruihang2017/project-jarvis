process.env.TZ = "Australia/Sydney";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-bills-test-"));
process.env.JARVIS_DATA_DIR = dir;

const { amountsIn, datesIn, senderDomain, phishingSigns, paymentDetailsChanged } = await import("../src/bills/parse.js");
const { BillStore, formatAmount } = await import("../src/bills/store.js");
const { scanBills, scanDue, BILL_QUERY } = await import("../src/bills/scan.js");
const { billLine, billLines, dueIn, scanSummary, billSettings } = await import("../src/bills/view.js");
const { updateSettings } = await import("../src/settings.js");
type Message = import("../src/google/gmail.js").Message;

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// --- parsing ---
eq("amounts", [...amountsIn("Total due $1,234.56, was 245.3 last time; 89 kWh; A$2.49")].sort((a, b) => a - b), [249, 8900, 24530, 123456]);
ok("amounts ignore long ids", !amountsIn("Order 123456789012").has(12345678901200));
const ref = new Date(2026, 9, 1);
eq(
  "dates in many formats (day first)",
  [...datesIn("Due 15 October 2026, or 18/10/2026, or Oct 20, 2026, or 2026-10-22, or 5th Nov, or 2026年10月25日, or 3.11.26", ref)].sort(),
  ["2026-10-15", "2026-10-18", "2026-10-20", "2026-10-22", "2026-10-25", "2026-11-03", "2026-11-05"],
);
eq("year-less date near new year", [...datesIn("due 5 January", new Date(2026, 11, 20))], ["2027-01-05"]);
eq("impossible dates dropped", [...datesIn("31/02/2026", ref)], []);
eq("sender domains", [senderDomain("Origin <no-reply@billing.originenergy.com.au>"), senderDomain("aws-billing@amazon.com"), senderDomain("nobody")], ["originenergy.com.au", "amazon.com", ""]);
ok("phishing wording", phishingSigns("Please verify your account within 24 hours or your account will be suspended").length === 3 && phishingSigns("Your bill is ready").length === 0);
ok("phishing wording (Chinese)", phishingSigns("请点击链接验证您的账户").length === 1);
const payA = "Pay by bank transfer: BSB 062-000 Account 1234 5678. BPAY Biller Code: 12345 Ref: 99887766";
ok("same payment details → unchanged", !paymentDetailsChanged(payA, "BSB: 062 000, Acct No. 12345678 — Biller code 12345 Ref 11223344"));
ok("different account → changed", paymentDetailsChanged(payA, "BSB 733-000 Account 8765 4321"));
ok("different biller → changed", paymentDetailsChanged(payA, "Biller Code: 99999 Ref: 99887766"));
ok("no details in one email → says nothing", !paymentDetailsChanged(payA, "Your bill is ready in the app") && !paymentDetailsChanged("View online", payA));

// --- store ---
const store = new BillStore(join(dir, "memory.db"));
const base = { category: "electricity" as const, kind: "bill" as const, currency: "AUD", status: "pending" as const, senderDomain: "originenergy.com.au", flags: [], needsCheck: false };
const b1 = store.add({ ...base, payee: "Origin Energy", amountCents: 24530, dueDate: "2026-10-18", messageId: "m-1", title: "Origin — Your bill [Account: 123456789012] is ready" });
ok("title stored with guarded data removed", !b1.title.includes("123456789012") && b1.title.includes("[removed"), b1.title);
try {
  store.add({ ...base, payee: "Origin account 12345678", amountCents: 1, dueDate: null, messageId: "m-x", title: "t" });
  ok("payee with an account number refused", false);
} catch (e) {
  ok("payee with an account number refused", String(e).includes("never stores"), String(e));
}
eq("amount format", [formatAmount(b1), formatAmount({ amountCents: null, currency: "AUD" }), formatAmount({ amountCents: 249, currency: "USD" })], ["$245.30", "amount not in the email", "US$2.49"]);
const columns = (store as unknown as { db: { prepare(s: string): { all(): { name: string }[] } } }).db.prepare("PRAGMA table_info(bills)").all().map((c) => c.name);
ok("bills table has no account/card/reference column", !columns.some((c) => /account|card|bsb|ref|bpay|number/i.test(c)), columns.join(","));
eq("line", billLine(b1, new Date(2026, 9, 2)), "#1 Origin Energy · electricity · $245.30 · due Sun 10-18 (in 16 days)");
eq("due in", [dueIn("2026-10-02", new Date(2026, 9, 2)), dueIn("2026-10-03", new Date(2026, 9, 2)), dueIn("2026-09-30", new Date(2026, 9, 2))], ["today", "tomorrow", "2 days overdue"]);
store.update(b1.id, { status: "tracked" });
store.confirmPayee("Origin Energy", "originenergy.com.au");
eq("payee confirmed with its domain", [store.knownPayee("origin energy"), store.payeeDomains("ORIGIN ENERGY")], [true, ["originenergy.com.au"]]);

// --- scanning with a fake Gmail and a fake model ---
const msg = (id: string, from: string, subject: string, body: string, date = new Date(2026, 9, 1)): Message =>
  ({ id, threadId: `t-${id}`, from, to: "me@gmail.com", cc: "", subject, date, snippet: "", unread: true, body, attachments: [] }) as Message;
const inbox = new Map<string, Message>();
const put = (m: Message) => inbox.set(m.id, m);
put(msg("m-1", "Origin <no-reply@originenergy.com.au>", "Your bill", "Amount due $245.30 by 18 October 2026. BSB 062-000 Account 1234 5678. Customer number 5551234."));
put(msg("e-2", "AWS <aws-billing@amazon.com>", "AWS Billing Statement [Account: 123456789012]", "Your charges of USD 2.49 will be charged automatically to your card ending 4409 on 3 October 2026."));
put(msg("e-3", "ANZ <statements@anz.com>", "A new statement is available", "Your statement for the account ending 4409 is ready in the ANZ App."));
put(msg("e-4", "Shop <deals@shop.com>", "Invoice-free shopping week", "Big sale, total due to popular demand."));
put(msg("e-5", "Telco <bills@telco.com.au>", "Your bill", "Total due $89.00 on 12/10/2026."));
const sentToModel: string[] = [];
let answers: Record<string, object> = {};
const deps = {
  gmail: { listIds: async () => [...inbox.keys()].reverse(), message: async (id: string) => inbox.get(id)! },
  store,
  classify: async (_i: string, input: string) => {
    sentToModel.push(input);
    const emails = [...input.matchAll(/=== EMAIL (\d+) ===\nFrom: [^\n]*\nDate: [^\n]*\nSubject: ([^\n]*)/g)].map((m) => ({ email: Number(m[1]), ...(Object.entries(answers).find(([k]) => m[2]!.startsWith(k))?.[1] ?? { kind: "not_a_bill", payee: "", category: "other", amount: null, currency: "AUD", due_date: null }) }));
    return JSON.stringify({ emails });
  },
};
store.markScanned("m-1", true); // the Origin bill above is already recorded
answers = {
  "AWS Billing Statement": { kind: "autopay", payee: "AWS", category: "subscription", amount: 2.49, currency: "USD", due_date: "2026-10-03" },
  "A new statement is available": { kind: "statement", payee: "ANZ", category: "other", amount: null, currency: "AUD", due_date: null },
  "Your bill": { kind: "bill", payee: "Telco", category: "phone", amount: 98.0, currency: "AUD", due_date: "2026-10-12" }, // the model misreads 89 as 98
};
const r1 = await scanBills(deps);
const all = sentToModel.join("\n");
eq("nothing account-like was sent to the model", ["123456789012", "4409", "062-000", "1234 5678", "5551234"].filter((s) => all.includes(s)), []);
ok("the model still saw payee, amount and date", all.includes("USD 2.49") && all.includes("3 October 2026") && all.includes("[removed:"), all.slice(0, 300));
eq("scan: 4 emails looked at, 2 bills to review", [r1.scanned, r1.pending.map((b) => b.payee).sort(), r1.tracked.length], [4, ["AWS", "Telco"], 0]);
ok("removed items are counted for the notice", r1.removed >= 3, String(r1.removed));
const aws = r1.pending.find((b) => b.payee === "AWS")!;
eq("autopay bill verified against the email", [aws.kind, aws.amountCents, aws.currency, aws.dueDate, aws.flags, aws.needsCheck], ["autopay", 249, "USD", "2026-10-03", [], false]);
const telco = r1.pending.find((b) => b.payee === "Telco")!;
ok("a misread amount is flagged, not trusted", telco.needsCheck && telco.flags.some((f) => f.includes("amount couldn't be found")), JSON.stringify(telco.flags));
ok("statements and promotions are not bills", !store.list().some((b) => b.payee === "ANZ" || b.payee === "Shop"));
const r2 = await scanBills(deps);
eq("a second scan re-sends nothing", [r2.scanned, r2.pending.length], [0, 0]);
ok("summary lines", scanSummary(r1)[0]!.startsWith("💳 2 new bills to check (1 with ⚠ warnings)") && scanSummary(r1).some((l) => l.startsWith("⛔ removed")), scanSummary(r1).join(" | "));
eq("billLines adds one line per warning", billLines(telco, new Date(2026, 9, 2)), ["#2 Telco · phone · $98.00 · due Mon 10-12 (in 10 days)", "   ⚠ the amount couldn't be found in the email — check it"]);

// Known payee, automatic tracking, and the fraud checks.
updateSettings({ billsConfirm: "known" });
answers = { "Your October bill": { kind: "bill", payee: "Origin Energy", category: "electricity", amount: 250.1, currency: "AUD", due_date: "2026-11-18" } };
put(msg("e-6", "Origin <no-reply@originenergy.com.au>", "Your October bill", "Amount due $250.10 by 18 November 2026. BSB 062-000 Account 1234 5678.", new Date(2026, 10, 1)));
const r3 = await scanBills(deps);
eq("known payee, same details → tracked without asking", [r3.tracked.map((b) => b.payee), r3.pending.length], [["Origin Energy"], 0]);

answers = { "Your November bill": { kind: "bill", payee: "Origin Energy", category: "electricity", amount: 251.0, currency: "AUD", due_date: "2026-12-18" } };
put(msg("e-7", "Origin <billing@origin-energy-payments.com>", "Your November bill", "Amount due $251.00 by 18 December 2026. Our bank details have changed: BSB 733-000 Account 8765 4321. Please verify your account.", new Date(2026, 11, 1)));
const r4 = await scanBills(deps);
const fake = r4.pending[0]!;
ok("changed account + new sender + phishing wording → held for review with warnings", r4.tracked.length === 0 && fake.flags.some((f) => f.includes("payment details differ")) && fake.flags.some((f) => f.includes("impostor")) && fake.flags.some((f) => f.includes("verify your account")), JSON.stringify(fake.flags));

answers = { "Your December bill": { kind: "bill", payee: "Origin Energy", category: "electricity", amount: 900, currency: "AUD", due_date: "2027-01-18" } };
put(msg("e-8", "Origin <no-reply@originenergy.com.au>", "Your December bill", "Amount due $900.00 by 18 January 2027.", new Date(2026, 11, 28)));
const r5 = await scanBills(deps);
ok("unusually high amount flagged", r5.pending[0]?.flags.some((f) => f.includes("higher than this payee's usual")) ?? false, JSON.stringify(r5.pending[0]?.flags));

answers = { "Reminder: your bill is due": { kind: "bill", payee: "Origin Energy", category: "electricity", amount: 250.1, currency: "AUD", due_date: "2026-11-18" } };
put(msg("e-9", "Origin <no-reply@originenergy.com.au>", "Reminder: your bill is due", "Amount due $250.10 by 18 November 2026.", new Date(2026, 10, 10)));
const before = store.list().length;
await scanBills(deps);
eq("a reminder email for a recorded bill isn't a second bill", store.list().length, before);

// Same bill twice under slightly different company names, and an automatic payment with nothing to act on (2026-10-02).
const { payeeKey } = await import("../src/bills/store.js");
eq("payee names match across suffixes, case and punctuation", [payeeKey("Harbour Builders Pty Ltd"), payeeKey("HARBOUR BUILDERS"), payeeKey("Harbour-Builders P/L.")], ["harbour builders", "harbour builders", "harbour builders"]);
answers = {
  "Statement from GFS": { kind: "bill", payee: "Harbour Builders Pty Ltd", category: "other", amount: 51415, currency: "AUD", due_date: "2026-10-02" },
  "Weekly update": { kind: "bill", payee: "Harbour Builders", category: "other", amount: 51415, currency: "AUD", due_date: "2026-10-02" },
  "Billing statement available": { kind: "autopay", payee: "AWS", category: "subscription", amount: null, currency: "AUD", due_date: null },
};
put(msg("e-10", "GFS <accounts@harbourbuilders.example>", "Statement from GFS", "Balance due $51,415.00 on 2 October 2026."));
put(msg("e-11", "Sean <sean@harbourbuilders.example>", "Weekly update", "Reminder: $51,415.00 is due 02/10/2026."));
put(msg("e-12", "AWS <aws-billing@amazon.com>", "Billing statement available", "Your statement is available in the console."));
const r6 = await scanBills(deps);
eq("the same bill under two names is recorded once; an empty automatic payment isn't recorded", r6.pending.map((b) => payeeKey(b.payee)), ["harbour builders"]);

// --- nothing account-like on disk ---
store.close();
const disk = readFileSync(join(dir, "memory.db")).toString("latin1") + (() => { try { return readFileSync(join(dir, "memory.db-wal")).toString("latin1"); } catch { return ""; } })();
eq("the database holds no account, card or reference numbers", ["123456789012", "12345678", "1234 5678", "5551234", "062-000", "062000", "8765", "733-000"].filter((s) => disk.includes(s)), []);

// --- settings ---
updateSettings({ billsConfirm: undefined });
eq("default settings", billSettings(), { scan: "daily", confirm: "always", remind: [3, 0] });
const s2 = new BillStore(join(dir, "memory.db"));
ok("daily scan not due again today", !scanDue(s2));
updateSettings({ billsScan: "manual", billsRemindDays: [7, 1] });
eq("changed settings", billSettings(), { scan: "manual", confirm: "always", remind: [7, 1] });
s2.setMeta("bills:lastScan", "2020-01-01");
ok("manual: never due", !scanDue(s2));
updateSettings({ billsScan: "daily" });
ok("daily: due on a new day", scanDue(s2));
ok("the search skips promotions", BILL_QUERY.includes("-category:promotions") && BILL_QUERY.includes("newer_than:45d"));
const n = s2.list().length;
eq("forget all", [s2.forgetAll(), s2.list().length, s2.knownPayee("Origin Energy"), s2.wasScanned("e-2")], [n, 0, false, false]);
s2.close();
writeFileSync(join(dir, "settings.json"), "{}");
rmSync(dir, { recursive: true, force: true });

console.log(results.map(([n, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${n}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
