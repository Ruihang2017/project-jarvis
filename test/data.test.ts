import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dir = mkdtempSync(join(tmpdir(), "edward-data-test-"));
process.env.JARVIS_DATA_DIR = dir;
// A CODEX_HOME outside the data folder, as in every other test: delete-data must never touch it.
const outsideCodex = mkdtempSync(join(tmpdir(), "edward-outside-codex-"));
process.env.JARVIS_CODEX_HOME = outsideCodex;
mkdirSync(join(outsideCodex, "sessions"), { recursive: true });
writeFileSync(join(outsideCodex, "sessions", "real-conversation.jsonl"), "{}");

const { ensureDataVersion, readDataVersion, DATA_VERSION } = await import("../src/data/version.js");
const { backupData, listBackups, KEEP_BACKUPS } = await import("../src/data/backup.js");
const { exportAll, sizeOf } = await import("../src/data/export.js");
const { wipeData, looksLikeDataDir } = await import("../src/data/wipe.js");
const { compareCodex, guardSelfTest, formatChecks, runDoctor } = await import("../src/doctor.js");
const { MemoryStore } = await import("../src/memory/store.js");
const { ReminderStore } = await import("../src/reminders/store.js");
const { BillStore } = await import("../src/bills/store.js");
const { updateSettings } = await import("../src/settings.js");
const { stripVTControlCharacters } = await import("node:util");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const dbPath = join(dir, "memory.db");

// --- data version ---
eq("no database yet → no version", readDataVersion(), null);
const first = ensureDataVersion();
eq("new install is stamped with the current version, no backup", [first.from, first.to, first.backup, first.applied, first.newer], [null, DATA_VERSION, undefined, [], false]);
eq("version readable", readDataVersion(), DATA_VERSION);

const mem = new MemoryStore(dbPath);
mem.add({ kind: "fact", text: "Lives in Sydney", source: "explicit" });
mem.close();
const rem = new ReminderStore(dbPath);
rem.add({ text: "Submit expenses", dueAt: "2030-01-01T09:00" });
rem.close();
const bills = new BillStore(dbPath);
bills.add({ payee: "Origin Energy", category: "electricity", kind: "bill", amountCents: 24530, currency: "AUD", dueDate: "2030-01-18", status: "tracked", messageId: "m1", senderDomain: "originenergy.com.au", title: "Your bill", flags: [], needsCheck: false });
bills.close();
updateSettings({ briefTime: "07:45" });
writeFileSync(join(dir, "google.json"), JSON.stringify({ email: "me@example.com", scopes: [] }));
writeFileSync(join(dir, "google-token.bin"), "ENCRYPTED");

// Upgrade v1 → v3 with two pretend steps: backup first, steps in order, version recorded.
const ran: string[] = [];
const migrations = [
  { to: 3, describe: "add colour", run: (db: InstanceType<typeof DatabaseSync>) => (ran.push("3"), db.exec("ALTER TABLE memories ADD COLUMN colour TEXT")) },
  { to: 2, describe: "add nickname", run: (db: InstanceType<typeof DatabaseSync>) => (ran.push("2"), db.exec("ALTER TABLE memories ADD COLUMN nickname TEXT")) },
];
const up = ensureDataVersion({ version: 3, migrations });
eq("steps run in version order", [ran, up.applied, up.from, up.to], [["2", "3"], ["v2: add nickname", "v3: add colour"], DATA_VERSION, 3]);
ok("backup taken before upgrading", Boolean(up.backup) && existsSync(join(up.backup!, "memory.db")) && existsSync(join(up.backup!, "settings.json")), String(up.backup));
const backedUp = new DatabaseSync(join(up.backup!, "memory.db"));
const oldColumns = (backedUp.prepare("PRAGMA table_info(memories)").all() as { name: string }[]).map((c) => c.name);
const oldRows = (backedUp.prepare("SELECT COUNT(*) AS n FROM memories").get() as { n: number }).n;
backedUp.close();
ok("the backup holds the data as it was before the upgrade", !oldColumns.includes("nickname") && oldRows === 1, oldColumns.join(","));
ok("the Google token is not copied into backups", !existsSync(join(up.backup!, "google-token.bin")));
ran.length = 0;
eq("already up to date → nothing runs, no new backup", [ensureDataVersion({ version: 3, migrations }).applied, ran, listBackups().length], [[], [], 1]);

// A failing step rolls back and names the backup.
try {
  ensureDataVersion({ version: 4, migrations: [...migrations, { to: 4, describe: "broken", run: (db: InstanceType<typeof DatabaseSync>) => db.exec("ALTER TABLE nope ADD COLUMN x") }] });
  ok("failed upgrade reported", false);
} catch (e) {
  ok("failed upgrade reported with the backup location", String(e).includes("upgrade to v4 failed") && String(e).includes("backed up to"), String(e));
}
eq("failed step leaves the version where it was", readDataVersion(), 3);
const newer = ensureDataVersion({ version: 2, migrations });
eq("data newer than the program is left alone", [newer.newer, newer.applied, readDataVersion()], [true, [], 3]);

// --- backups ---
for (let i = 0; i < KEEP_BACKUPS + 3; i++) backupData("manual", new Date(2030, 0, 1, 0, i));
eq(`only the newest ${KEEP_BACKUPS} backups are kept`, listBackups().length, KEEP_BACKUPS);
ok("newest first", listBackups()[0]!.name > listBackups()[1]!.name);

// --- export ---
const out = join(dir, "exports", "test");
const ex = exportAll(out, new Date(2030, 0, 2));
eq("export files", ex.files.sort(), ["README.txt", "bills.json", "memories.json", "memories.md", "payees.json", "reminders.json", "settings.json", "summaries.json"]);
ok("export content", readFileSync(join(out, "memories.md"), "utf8").includes("Lives in Sydney") && JSON.parse(readFileSync(join(out, "bills.json"), "utf8"))[0].payee === "Origin Energy" && JSON.parse(readFileSync(join(out, "reminders.json"), "utf8"))[0].text === "Submit expenses");
ok("export README says where conversations are and that no account numbers are stored", /conversations\s+.*sessions/.test(readFileSync(join(out, "README.txt"), "utf8")) && readFileSync(join(out, "README.txt"), "utf8").includes("never stored"));
ok("sizeOf counts a folder", sizeOf(out) > 100 && sizeOf(join(dir, "missing")) === 0);

// --- doctor ---
eq("Codex: same minor is fine", compareCodex("0.159.9", "0.159.3").status, "ok");
ok("Codex: other minor warns, names both versions", compareCodex("0.171.0", "0.159.3").status === "warn" && compareCodex("0.171.0", "0.159.3").detail.includes("0.159.3"));
eq("Codex: missing fails", compareCodex(null).status, "fail");
eq("privacy guard self-test", guardSelfTest().status, "ok");
const lines = formatChecks([{ name: "A", status: "ok", detail: "fine" }, { name: "Longer", status: "warn", detail: "hmm" }, { name: "B", status: "fail", detail: "bad" }]).map(stripVTControlCharacters);
eq("doctor output lines up and sums up", lines, ["[ok]   A       fine", "[warn] Longer  hmm", "[fail] B       bad", "1 problem to fix, 1 warning"]);
eq("doctor summary when all fine", formatChecks([{ name: "A", status: "ok", detail: "x" }]).at(-1), "Everything looks fine");
const checks = await runDoctor();
ok("doctor without a session still checks Node, Codex, data, guard", ["Node.js", "Codex", "Data folder", "Data version", "Privacy guard"].every((n) => checks.some((c) => c.name === n)), checks.map((c) => c.name).join(","));
ok("data version check warns when the data is newer", checks.find((c) => c.name === "Data version")!.status === "warn", JSON.stringify(checks.find((c) => c.name === "Data version")));

// --- delete everything ---
mkdirSync(join(dir, "images"), { recursive: true });
writeFileSync(join(dir, "images", "a.png"), "x");
mkdirSync(join(dir, "workspace"), { recursive: true });
writeFileSync(join(dir, "workspace", "notes.txt"), "mine");
writeFileSync(join(dir, "google-client.json"), "{}");
const calls: string[] = [];
const report = await wipeData({ disconnectGoogle: async () => void calls.push("google"), removeTask: async () => void calls.push("task") });
eq("Google is revoked and the task removed first", calls, ["google", "task"]);
ok("personal data is gone", !existsSync(dbPath) && !existsSync(join(dir, "settings.json")) && !existsSync(join(dir, "google-token.bin")) && !existsSync(join(dir, "backups")) && !existsSync(join(dir, "exports")) && !existsSync(join(dir, "images")), readdirSync(dir).join(","));
ok("client file and workspace are kept and reported", existsSync(join(dir, "google-client.json")) && existsSync(join(dir, "workspace", "notes.txt")) && report.kept.includes("google-client.json") && report.kept.includes("workspace"), report.kept.join("|"));
ok("a CODEX_HOME outside the data folder is never touched", existsSync(join(outsideCodex, "sessions", "real-conversation.jsonl")) && report.kept.some((k) => k.includes("not touched")), report.kept.join("|"));
eq("no problems", report.problems, []);

// Codex home inside the data folder: conversations go, sign-in stays.
const inner = mkdtempSync(join(tmpdir(), "edward-data-inner-"));
process.env.JARVIS_DATA_DIR = inner;
mkdirSync(join(inner, "codex-home", "sessions"), { recursive: true });
writeFileSync(join(inner, "codex-home", "sessions", "c.jsonl"), "{}");
writeFileSync(join(inner, "codex-home", "auth.json"), "{}");
writeFileSync(join(inner, "codex-home", "state_5.sqlite"), "x");
writeFileSync(join(inner, "memory.db"), "x");
// config.codexHome was fixed at import; run the same check through a child process with a fresh environment.
const { execFileSync } = await import("node:child_process");
const script = join(inner, "wipe.mts");
writeFileSync(script, `const { wipeData } = await import(${JSON.stringify(new URL("../src/data/wipe.ts", import.meta.url).href)});\nconsole.log(JSON.stringify(await wipeData(process.argv[2] === "all" ? { all: true } : {})));\n`);
const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const env = { ...process.env, JARVIS_DATA_DIR: inner, JARVIS_CODEX_HOME: "" };
delete (env as Record<string, string | undefined>).JARVIS_CODEX_HOME;
const r1 = JSON.parse(execFileSync(process.execPath, [tsx, script], { env, encoding: "utf8" }));
ok("own codex-home: conversations deleted, sign-in kept", !existsSync(join(inner, "codex-home", "sessions")) && !existsSync(join(inner, "codex-home", "state_5.sqlite")) && existsSync(join(inner, "codex-home", "auth.json")) && r1.kept.includes("codex-home/auth.json"), JSON.stringify(r1));

ok("--all refuses a folder that isn't Edward's", !looksLikeDataDir(tmpdir()) && !looksLikeDataDir("C:\\") && !looksLikeDataDir(join(tmpdir(), "does-not-exist")));
ok("--all accepts the data folder", looksLikeDataDir(inner));
const r2 = JSON.parse(execFileSync(process.execPath, [tsx, script, "all"], { env, encoding: "utf8", cwd: tmpdir() }));
ok("--all removes the whole data folder", !existsSync(inner) && r2.problems.length === 0, JSON.stringify(r2));

rmSync(dir, { recursive: true, force: true });
rmSync(outsideCodex, { recursive: true, force: true });
console.log(results.map(([n, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${n}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
