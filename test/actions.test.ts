// Bill actions shared by /bills and the desktop app (src/bills/actions.ts), and the activity lines.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "edward-actions-test-"));
process.env.EDWARD_DATA_DIR = dir;

const { BillStore } = await import("../src/bills/store.js");
const { acceptBill, editBill, ignoreBill, markPaid } = await import("../src/bills/actions.js");
const { activityLabel } = await import("../src/activity.js");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const store = new BillStore();
const add = (payee: string, extra: Partial<Parameters<BillStore["add"]>[0]> = {}) =>
  store.add({ payee, category: "water", kind: "bill", amountCents: 8650, currency: "AUD", dueDate: "2026-10-20", status: "pending", messageId: `m-${payee}`, senderDomain: "water.example", title: "Bill", flags: [], needsCheck: false, ...extra });

const plain = add("Harbour Water");
const flagged = add("Odd Energy", { flags: ["The payment details differ from this payee's last bill."] });
const auto = add("Fibreline", { kind: "autopay" });

eq("accept: tracked", acceptBill(store, plain.id).ok && store.get(plain.id)!.status, "tracked");
ok("accept: the payee is now known", store.knownPayee("Harbour Water"));
eq("accept again: not pending any more", acceptBill(store, plain.id).ok, false);
eq("bulk accept skips a bill with warnings", acceptBill(store, flagged.id, true).ok, false);
eq("…and leaves it pending", store.get(flagged.id)!.status, "pending");
eq("accepting it on its own works", acceptBill(store, flagged.id).ok, true);
eq("autopay bills become autopay", (acceptBill(store, auto.id), store.get(auto.id)!.status), "autopay");

const odd = add("Mystery", { flags: ["the amount couldn't be found in the email — check it"], needsCheck: true });
eq("edit amount: rejects nonsense", editBill(store, odd.id, "amount", "lots").ok, false);
const r = editBill(store, odd.id, "amount", "$1,234.50");
ok("edit amount: saved in cents and the warning cleared", r.ok && r.bill.amountCents === 123450 && r.bill.flags.length === 0 && !r.bill.needsCheck, JSON.stringify(r));
eq("edit due: rejects a bad date", editBill(store, odd.id, "due", "next week").ok, false);
eq("edit due: saved", (editBill(store, odd.id, "due", "2026-11-02"), store.get(odd.id)!.dueDate), "2026-11-02");
eq("edit payee: trimmed", (editBill(store, odd.id, "payee", "  Mystery Co  "), store.get(odd.id)!.payee), "Mystery Co");
eq("ignore: dismissed", (ignoreBill(store, odd.id), store.get(odd.id)!.status), "dismissed");
eq("paid", (markPaid(store, plain.id), store.get(plain.id)!.status), "paid");
eq("unknown bill", acceptBill(store, 9999).ok, false);

eq("activity label for a web search", activityLabel({ type: "webSearch", id: "x", query: "", action: null } as never), "searching the web…");
eq("no label for a reply", activityLabel({ type: "agentMessage", id: "x", text: "" } as never), null);

const { withoutNotes } = await import("../src/assistant.js");
eq("title drops the time note", withoutNotes("can you scan the bills?[Edward] Now: Friday 2026-10-02 21:50 (Australia/Sydney)"), "can you scan the bills?");
eq("…and the old name's", withoutNotes("明天有什么安排？\n[Jarvis] Now: Thursday\n[Jarvis] Remembered: x"), "明天有什么安排？");
eq("plain text is kept", withoutNotes("hello"), "hello");

store.close();
rmSync(dir, { recursive: true, force: true });
console.log(results.map(([n, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${n}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
