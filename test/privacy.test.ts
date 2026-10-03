import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

const dir = mkdtempSync(join(tmpdir(), "edward-privacy-test-"));
process.env.JARVIS_DATA_DIR = dir;

const { guardOutgoing } = await import("../src/privacy/outgoing.js");
const { CodexClient } = await import("../src/rpc.js");
const { MemoryStore } = await import("../src/memory/store.js");
const { ReminderStore } = await import("../src/reminders/store.js");
const { secretReason } = await import("../src/memory/guard.js");
const { codexChannels, MODES, MODE_CYCLE } = await import("../src/session.js");
const { modePrompt, redactionNotice } = await import("../src/ui.js");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// --- the filter ---
const reports: [string, string[]][] = [];
const f = guardOutgoing((source, removed) => reports.push([source, removed]));
const start = f.request("thread/start", { model: "m", cwd: "C:/x", developerInstructions: "Core: user's card ending 4409", config: { a: 1 } }) as Record<string, unknown>;
ok("thread/start instructions redacted", String(start.developerInstructions).includes("[removed: card number]") && !String(start.developerInstructions).includes("4409"));
eq("other thread/start fields untouched", [start.model, start.cwd, start.config], ["m", "C:/x", { a: 1 }]);
const turn = f.request("turn/start", { threadId: "t", input: [{ type: "text", text: "我的密码是 hunter2" }, { type: "localImage", path: "C:/img/1234567890.png" }] }) as { input: { type: string; text?: string; path?: string }[] };
eq("turn/start text redacted; image left alone", turn.input, [{ type: "text", text: "我的密码是 [removed: password/PIN/code]" }, { type: "localImage", path: "C:/img/1234567890.png" }]);
eq("unrelated requests untouched", f.request("model/list", { cursor: "4111 1111 1111 1111" }), { cursor: "4111 1111 1111 1111" });
const reply = f.reply("item/tool/call", { success: true, contentItems: [{ type: "inputText", text: "Account number: 2003 4567 89" }] }) as { contentItems: { text: string }[] };
ok("tool results redacted", !reply.contentItems[0]!.text.includes("4567"), JSON.stringify(reply));
const answer = f.reply("item/tool/requestUserInput", { answers: { q1: { answers: ["PIN 4821"] } } });
ok("answers to questions redacted", !JSON.stringify(answer).includes("4821"));
ok("error messages redacted", !f.error("item/tool/call", "Failed: card 4111 1111 1111 1111 declined").includes("1111 1111"));
eq("each removal reported with its source", reports.map(([s, r]) => `${s}:${r.join(",")}`), ["instructions:card", "message:secret", "tool:bank", "answer:secret"]);

const seen: (string | undefined)[] = [];
const g2 = guardOutgoing((_s, _r, threadId) => seen.push(threadId));
g2.request("turn/start", { threadId: "bg-1", input: [{ type: "text", text: "PIN 4821" }] });
eq("the listener learns which thread a redaction was for (background labelling)", seen, ["bg-1"]);

// --- end to end through CodexClient: what actually reaches the process ---
const fake = mkdtempSync(join(tmpdir(), "edward-fake-codex-"));
const log = join(fake, "received.log");
writeFileSync(
  join(fake, "app-server"),
  `const fs = require("fs");
const rl = require("readline").createInterface({ input: process.stdin });
const out = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
rl.on("line", (line) => {
  fs.appendFileSync(${JSON.stringify(log)}, line + "\\n");
  const m = JSON.parse(line);
  if (m.method === "turn/start") {
    out({ id: m.id, result: {} });
    out({ id: 900, method: "item/tool/call", params: { threadId: "t", turnId: "u", callId: "c", tool: "gmail_read", arguments: {} } });
  } else if (m.method) out({ id: m.id, result: {} });
  if (m.id === 900) process.exit(0);
});
`,
);
const cwd = process.cwd();
process.chdir(fake); // CodexClient runs "<bin> app-server"; with node as bin, that's ./app-server
const e2eReports: string[] = [];
const client = new CodexClient(process.execPath, [], process.env, guardOutgoing((s, r) => e2eReports.push(`${s}:${r.join(",")}`)));
process.chdir(cwd);
client.onServerRequest(async () => ({ success: true, contentItems: [{ type: "inputText", text: "Your BSB 062-000 account 12345678, PIN 4821" }] }));
const exited = new Promise((resolve) => client.on("exit", resolve));
await client.request("thread/start", { developerInstructions: "TFN 123 456 782" } as never);
await client.request("turn/start", { threadId: "t", input: [{ type: "text", text: "card 4111 1111 1111 1111 尾号4409" }] } as never);
await exited;
const sent = readFileSync(log, "utf8");
const leaked = ["123 456 782", "4111", "4409", "062-000", "12345678", "4821"].filter((s) => sent.includes(s));
eq("nothing sensitive reached the Codex process", leaked, []);
ok("the redacted messages did arrive", sent.includes("[removed: tax file number]") && sent.includes("[removed: card number]") && sent.includes('"id":900'), sent);
eq("end-to-end removals reported", e2eReports, ["instructions:tfn", "message:card,card", "tool:bank,bank,secret"]);
rmSync(fake, { recursive: true, force: true });

// --- storage refuses ---
const mem = new MemoryStore(join(dir, "memory.db"));
const rem = new ReminderStore(join(dir, "memory.db"));
const refuses = (name: string, f: () => unknown) => {
  try {
    f();
    ok(name, false, "saved");
  } catch (e) {
    ok(name, String(e).includes("never stores"), String(e));
  }
};
refuses("memory add refuses a partial card number", () => mem.add({ kind: "fact", text: "ANZ 信用卡尾号 4409", source: "explicit" }));
const m = mem.add({ kind: "fact", text: "Banks with ANZ", source: "explicit" });
refuses("memory update refuses an account number", () => mem.update(m.id, { text: "ANZ account 12345678" }));
refuses("reminder refuses a password", () => rem.add({ text: "login password: hunter2", dueAt: "2030-01-01T09:00" }));
ok("normal reminders still save", rem.add({ text: "Pay the Origin bill", dueAt: "2030-01-01T09:00" }).id > 0);
eq("memory guard covers partial numbers", secretReason("my card ending 4409"), "card number");
mem.saveSessionSummary("t1", "Bills", "Talked about the ANZ card ending 4409 and PIN 4821", "2026-10-01", "2026-10-02");
const savedSummary = mem.recentSummaries("session", 5)[0]!;
ok("summaries are stored with guarded data removed", !savedSummary.summary.includes("4409") && !savedSummary.summary.includes("4821") && savedSummary.summary.includes("ANZ"), savedSummary.summary);
mem.close();
rem.close();

// --- modes ---
eq("guarded threads switch Codex's own channels off", codexChannels(true).features, {
  shell_tool: false,
  unified_exec: false,
  view_image: false,
  browser_use: false,
  computer_use: false,
  in_app_browser: false,
  multi_agent: false,
});
eq("unguarded threads get shell back, never browser/computer use", [codexChannels(false).features.shell_tool, codexChannels(false).features.computer_use], [true, false]);
eq("only chat is guarded", Object.entries(MODES).filter(([, s]) => s.guarded).map(([m]) => m), ["chat"]);
eq("Shift+Tab cycle skips auto", MODE_CYCLE, ["chat", "manual", "semi-auto"]);
eq("semi-auto/auto auto-approve edits; manual asks", [MODES.manual.autoApproveEdits, MODES["semi-auto"].autoApproveEdits, MODES.auto.autoApproveEdits], [false, true, true]);
eq("auto never asks", MODES.auto.approvalPolicy, "never");
eq("prompt shows the mode", ["chat", "manual", "semi-auto", "auto"].map((x) => stripVTControlCharacters(modePrompt(x as never))), ["you › ", "you [manual] › ", "you [semi-auto] › ", "you [auto] › "]);
eq("prompt with images", stripVTControlCharacters(modePrompt("manual", 2)), "you [manual · 🖼 2] › ");
eq("notice text", redactionNotice("tool", ["bank", "bank"]), "⛔ removed 2 bank/account numbers from a tool result before sending — the model didn't see it");

// --- Shift+Tab on a simulated terminal ---
const { onShiftTab } = await import("../src/ui.js");
const { PassThrough } = await import("node:stream");
const { createInterface } = await import("node:readline/promises");
const fakeIn = new PassThrough();
const fakeOut = new PassThrough();
fakeOut.resume();
const rl = createInterface({ input: fakeIn, output: fakeOut, terminal: true });
let presses = 0;
ok("Shift+Tab hook installs on Node's readline", onShiftTab(rl, () => presses++));
fakeIn.write("ab");
fakeIn.write("\x1b[Z"); // what Windows Terminal sends for Shift+Tab
await new Promise((r) => setImmediate(r));
eq("Shift+Tab calls the handler and keeps the typed text clean", [presses, rl.line], [1, "ab"]);
fakeIn.write("\t");
await new Promise((r) => setImmediate(r));
eq("plain Tab is not Shift+Tab", presses, 1);
rl.close();

rmSync(dir, { recursive: true, force: true });
console.log(results.map(([n, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${n}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
