import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore, addDays, describe } from "../src/memory/store.js";
import { secretReason } from "../src/memory/guard.js";
import { tokenize } from "../src/memory/search.js";

const path = join(tmpdir(), `jarvis-mem-test-${Date.now()}.db`);
const s = new MemoryStore(path);
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, info = "") => results.push([name, ok, info]);

check("tokenize CJK bigrams", JSON.stringify(tokenize("我老板是Alice")) === JSON.stringify(["我老", "老板", "板是", "alice"]), JSON.stringify(tokenize("我老板是Alice")));

const home = s.add({ kind: "profile", text: "住在悉尼", keywords: ["Sydney", "live", "居住"], source: "explicit", importance: 4 });
const boss = s.add({ kind: "fact", text: "Alice 是我的经理", keywords: ["manager", "boss", "老板", "上司"], source: "explicit" });
const pref = s.add({ kind: "preference", text: "Prefers short answers without tables", keywords: ["简短", "表格"], source: "explicit", importance: 5 });
const ev = s.add({ kind: "event", text: "周五前提交差旅报销", keywords: ["expense", "reimbursement", "报销"], validUntil: addDays(3), source: "explicit" });
const note = s.add({ kind: "fact", text: "这周在家办公", tier: "short", source: "explicit" });

check("defaults: profile→long", home.tier === "long" && home.validUntil === null);
check("defaults: event→short w/ date", ev.tier === "short" && ev.validUntil === addDays(3));
check("defaults: short w/o date → +30d", note.validUntil === addDays(30), note.validUntil ?? "");

const top = (q: string) => s.search(q)[0]?.memory.id;
check("search zh synonym via keyword: 我老板是谁", top("我老板是谁") === boss.id);
check("search en via keyword: who is my manager", top("who is my manager") === boss.id);
check("search en→zh text: where do I live, Sydney?", top("where do I live") === home.id);
check("search zh: 报销什么时候交", top("报销什么时候交") === ev.id);
check("search: no match → empty", s.search("quantum chromodynamics").length === 0);

const core = s.core().map((m) => m.id);
check("core = long profile+preference, importance order", JSON.stringify(core) === JSON.stringify([pref.id, home.id]), JSON.stringify(core));

const moved = s.add({ kind: "profile", text: "住在墨尔本", keywords: ["Melbourne"], supersedes: home.id, source: "explicit" });
check("supersede marks old", s.get(home.id)?.status === "superseded" && s.core().some((m) => m.id === moved.id) && !s.core().some((m) => m.id === home.id));
check("undo restores superseded", s.undo()?.id === moved.id && s.get(home.id)?.status === "active");

s.setStatus(ev.id, "archived");
check("archived hidden by default", !s.search("报销").some((r) => r.memory.id === ev.id));
check("archived found when asked", s.search("报销", { includeArchived: true })[0]?.memory.id === ev.id);

s.update(boss.id, { text: "Alice 是我的直属经理", importance: 9 });
check("update + clamp importance", s.get(boss.id)?.text === "Alice 是我的直属经理" && s.get(boss.id)?.importance === 5);
check("forget deletes", s.remove(note.id)?.id === note.id && !s.get(note.id));
check("describe", describe(ev).includes("[event]") && describe(ev).includes("until"));
check("export has sections", /## Long-term[\s\S]*## Archived/.test(s.exportMarkdown()));

for (const [t, want] of [
  ["我的密码是 hunter2!", "password/PIN/code"],
  ["my api key sk-proj-abcdefghijklmnopqrstuvwxyz123456", "password/PIN/code"],
  ["card 4111 1111 1111 1111 exp 12/30", "card number"],
  ["电话 0412 345 678", null],
  ["Order number 1234567890123", null],
] as const) {
  check(`guard: ${t.slice(0, 24)}`, secretReason(t) === want, String(secretReason(t)));
}

s.close();
rmSync(path, { force: true });
for (const ext of ["-wal", "-shm"]) rmSync(path + ext, { force: true });
console.log(results.map(([n, ok, info]) => `${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  → " + info}`).join("\n"));
if (results.some(([, ok]) => !ok)) process.exitCode = 1;
