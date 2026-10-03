process.env.TZ = "Australia/Sydney";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "edward-security-test-"));
process.env.JARVIS_DATA_DIR = dir;

const { guardOutgoing } = await import("../src/privacy/outgoing.js");
const { redact } = await import("../src/privacy/guard.js");
const { CodexClient } = await import("../src/rpc.js");
const { stripControl, stripControlDeep } = await import("../src/util.js");
const { toSummary, toMessage, summaryLine } = await import("../src/google/gmail.js");
const { toEvent, eventLine } = await import("../src/google/calendar.js");
const { MemoryStore } = await import("../src/memory/store.js");
const { ReminderStore } = await import("../src/reminders/store.js");
const { resolveOpenTarget } = await import("../src/system.js");
const { describeToolCall, TOOL_SPECS } = await import("../src/tools.js");
const { BILL_TOOLS } = await import("../src/bills/tools.js");
const { googleInstructions } = await import("../src/google/instructions.js");
const { threadConfig } = await import("../src/session.js");
const { updateSettings } = await import("../src/settings.js");
const { PERSONA } = await import("../src/config.js");
const { REMINDER_INSTRUCTIONS } = await import("../src/reminders/prompt.js");
const { BILL_INSTRUCTIONS } = await import("../src/bills/tools.js");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const ESC = "\x1b";

// --- F1: the outgoing filter is fail-closed ---
const reports: string[] = [];
const f = guardOutgoing((source, removed) => reports.push(`${source}:${removed.length}`));
const unknown = f.request("some/future/method", { threadId: "t-4111111111111111", note: "card 4111 1111 1111 1111", nested: [{ deep: "PIN 4821" }], path: "C:/pics/4111111111111111.png" }) as Record<string, unknown>;
ok("a request type nobody listed is still redacted, at any depth", !JSON.stringify([unknown.note, unknown.nested]).match(/4111|4821/), JSON.stringify(unknown));
eq("identifiers and paths are left intact", [unknown.threadId, unknown.path], ["t-4111111111111111", "C:/pics/4111111111111111.png"]);
ok("notifications are filtered too", !JSON.stringify(f.notify("some/notice", { text: "password: hunter2" })).includes("hunter2"));
eq("a bare string parameter is redacted", f.request("x/y", "my TFN 123 456 782"), "my TFN [removed: tax file number]");
eq("removals are reported", reports, ["message:2", "message:1", "message:1"]);
// Edward's own fixed text must survive the guard untouched, or it would be silently rewritten on every start.
const own = [PERSONA, REMINDER_INSTRUCTIONS, BILL_INSTRUCTIONS, googleInstructions(null), googleInstructions({ email: "someone2024@example.com", scopes: [], connectedAt: "x" })];
eq("Edward's own instructions contain nothing the guard would remove", own.map((t) => redact(t).removed.length), [0, 0, 0, 0, 0]);
eq("…nor do the tool descriptions", redact(JSON.stringify(TOOL_SPECS)).removed, []);

const fake = mkdtempSync(join(tmpdir(), "edward-fake-codex-"));
const log = join(fake, "received.log");
writeFileSync(
  join(fake, "app-server"),
  `const fs = require("fs");
require("readline").createInterface({ input: process.stdin }).on("line", (line) => {
  fs.appendFileSync(${JSON.stringify(log)}, line + "\\n");
  const m = JSON.parse(line);
  if (m.id !== undefined) process.stdout.write(JSON.stringify({ id: m.id, result: {} }) + "\\n");
  if (m.method === "bye") process.exit(0);
});
`,
);
const cwd = process.cwd();
process.chdir(fake);
const client = new CodexClient(process.execPath, [], process.env, guardOutgoing());
process.chdir(cwd);
const exited = new Promise((resolve) => client.on("exit", resolve));
await client.request("thread/name/set" as never, { threadId: "t", name: "Bank — account 12345678, card ending 4409" } as never);
client.notify("custom/notice", { detail: "Medicare 2123 45670 1" });
client.notify("bye");
await exited;
const sent = readFileSync(log, "utf8");
eq("end to end: nothing sensitive reached Codex through an unlisted method or a notification", ["12345678", "4409", "45670"].filter((x) => sent.includes(x)), []);
rmSync(fake, { recursive: true, force: true });

// --- F2: invisible characters inside numbers ---
ok("zero-width spaces inside a card number", !redact("card 4111\u200b1111\u200b1111\u200b1111").text.includes("1111"));
ok("no-break spaces inside a card number", !redact("4111\u00a01111\u00a01111\u00a01111").text.includes("1111"));
ok("zero-width joiner after the keyword", !redact("尾号\u200d4409").text.includes("4409"));
eq("offsets stay right: text around the number is untouched", redact("a\u200bb card 4111 1111 1111 1111 z").text, "a\u200bb card [removed: card number] z");

// --- F3: terminal control characters from outside ---
eq("ESC, BEL, CR and bidi overrides are removed; newline and tab stay", stripControl(`a${ESC}[2Jb\x07c\rd\u202ee\nf\tg`), "a[2Jbcde\nf\tg");
eq("deep", stripControlDeep({ a: `x${ESC}]52;c;AAAA\x07`, b: [`y${ESC}[1A`], n: 1 }), { a: "x]52;c;AAAA", b: ["y[1A"], n: 1 });
const evil = {
  id: "m1",
  threadId: "t1",
  labelIds: ["UNREAD"],
  snippet: `Hi${ESC}[2J`,
  internalDate: String(new Date(2026, 9, 1).getTime()),
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: `Bank${ESC}[1A${ESC}[2K <a@x.com>` },
      { name: "Subject", value: `=?UTF-8?B?${Buffer.from(`Invoice${ESC}]52;c;ZXZpbA==\x07`).toString("base64")}?=` },
      { name: "To", value: "me@x.com" },
    ],
    body: { data: Buffer.from(`Pay now${ESC}[8m hidden ${ESC}[0m\r\nline two`).toString("base64url") },
  },
};
const summary = toSummary(evil as never);
const message = toMessage(evil as never);
const shown = [summaryLine(summary), summary.snippet, message.body, message.from].join("|");
ok("an email can't carry control codes onto the screen (header, encoded header, snippet, body)", !/[\x00-\x08\x0b-\x1f\x7f]/.test(shown), JSON.stringify(shown));
const event = toEvent({ id: "e", summary: `Lunch${ESC}[2J`, location: `Cafe\u202e`, description: `x${ESC}c`, start: { dateTime: "2026-10-01T12:00:00+10:00" }, end: { dateTime: "2026-10-01T13:00:00+10:00" } } as never, { id: "c", name: "c", primary: true, writable: true });
ok("nor can a calendar event", !/[\x00-\x08\x0b-\x1f\x7f\u202e]/.test(eventLine(event!, { notes: true })), JSON.stringify(eventLine(event!, { notes: true })));
const mem = new MemoryStore(join(dir, "memory.db"));
eq("memories are stored without control characters", mem.add({ kind: "note", text: `Likes tea${ESC}[2J`, source: "explicit" }).text, "Likes tea[2J");
mem.close();
const rem = new ReminderStore(join(dir, "memory.db"));
eq("reminders too", rem.add({ text: `Call${ESC}[1A mum`, dueAt: "2030-01-01T09:00" }).text, "Call[1A mum");
rem.close();

// --- F5: marking a bill paid is confirmed every time ---
const fakeBills = { get: () => ({ id: 3, payee: "Origin", category: "electricity", kind: "bill", amountCents: 100, currency: "AUD", dueDate: "2030-01-01", status: "tracked", flags: [] }), update: () => undefined };
const paid = await BILL_TOOLS.find((t) => t.name === "bill_mark_paid")!.prepare({ bill: 3 }, { bills: fakeBills } as never);
eq("no 'always allow' for marking paid", paid.allowAlways, false);

// --- F6: "open" never runs things ---
for (const name of ["run.bat", "tool.EXE", "script.ps1", "thing.lnk", "macro.js", "setup.msi"]) writeFileSync(join(dir, name), "");
writeFileSync(join(dir, "notes.txt"), "");
const refused = ["run.bat", "tool.EXE", "script.ps1", "thing.lnk", "macro.js", "setup.msi"].filter((n) => {
  try {
    resolveOpenTarget(n, dir);
    return false;
  } catch (e) {
    return String(e).includes("program or script");
  }
});
eq("programs and scripts are refused", refused.length, 6);
eq("documents, folders and web links still open", [resolveOpenTarget("notes.txt", dir).kind, resolveOpenTarget(".", dir).kind, resolveOpenTarget("https://example.com", dir).kind], ["path", "path", "url"]);

// --- F7: the clipboard activity line shows what was copied ---
eq("clipboard preview", describeToolCall("clipboard_write", { text: "hello world" }), '⚙ copied to clipboard: "hello world"');
ok("long text is cut with its length", describeToolCall("clipboard_write", { text: "x".repeat(200) }).endsWith("(200 chars)"));

// --- F8: web search switch and instruction ---
ok("instructions forbid putting private data into searches", googleInstructions(null).length > 0 && googleInstructions({ email: "a@b.c", scopes: [], connectedAt: "x" }).includes("into a web search or a URL"));
eq("web search follows the setting", [(threadConfig("low", "chat") as Record<string, unknown>).web_search, (updateSettings({ webSearch: "off" }), (threadConfig("low", "chat") as Record<string, unknown>).web_search)], [undefined, "disabled"]);
ok("thread config still switches Codex's own channels off in chat", (threadConfig("low", "chat") as { features: { shell_tool: boolean } }).features.shell_tool === false);

rmSync(dir, { recursive: true, force: true });
console.log(results.map(([n, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${n}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
