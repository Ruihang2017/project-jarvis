// The move from %LOCALAPPDATA%\Jarvis to %LOCALAPPDATA%\Edward (D33), rehearsed in a scratch LOCALAPPDATA.
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const local = mkdtempSync(join(tmpdir(), "edward-rename-test-"));
process.env.LOCALAPPDATA = local;
for (const v of ["EDWARD_DATA_DIR", "JARVIS_DATA_DIR", "EDWARD_MEMORY_DB", "JARVIS_MEMORY_DB"]) delete process.env[v];

const { moveFromJarvis, renamePending, renameMessage } = await import("../src/data/rename.js");
const { appDataDir } = await import("../src/settings.js");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const oldDir = join(local, "Jarvis");
const newDir = join(local, "Edward");

/** A system double that records what the move did outside the folder. */
function fakeSystem(task: string | null) {
  const calls: string[] = [];
  return {
    calls,
    system: {
      exportLegacyTask: async () => (calls.push("export"), task),
      removeLegacyTask: async () => calls.push("remove-old"),
      restoreLegacyTask: async (xml: string) => calls.push(`restore:${xml}`),
      unregisterLegacyNotifications: async () => calls.push("unregister-old"),
      installTask: async () => (calls.push("install-new"), { ok: true, message: "registered" }),
    },
  };
}

function makeOldData() {
  mkdirSync(join(oldDir, "codex-home", "sessions"), { recursive: true });
  writeFileSync(join(oldDir, "settings.json"), JSON.stringify({ currency: "AUD" }));
  writeFileSync(join(oldDir, "codex-home", "sessions", "rollout-1.jsonl"), "{}");
}

// --- nothing to move ---
eq("fresh computer: nothing pending", renamePending(), false);
eq("fresh computer: data goes to Edward", appDataDir(), newDir);
eq("fresh computer: not-needed", (await moveFromJarvis(fakeSystem(null).system)).status, "not-needed");

// --- a file in the old folder is open ---
makeOldData();
eq("before the move, Edward uses the old folder", appDataDir(), oldDir);
ok("…and the move is pending", renamePending());
const held = openSync(join(oldDir, "settings.json"), "r+");
const busy = fakeSystem("<Task>old</Task>");
const failed = await moveFromJarvis(busy.system);
closeSync(held);
// Windows refuses to rename a folder with an open file; elsewhere the rename may succeed, so only check Windows.
if (process.platform === "win32") {
  eq("open file: the move fails", failed.status, "failed");
  ok("…the old task is put back", busy.calls.includes("restore:<Task>old</Task>"), busy.calls.join(","));
  ok("…the data is untouched and still used", existsSync(join(oldDir, "settings.json")) && !existsSync(newDir) && appDataDir() === oldDir);
  ok("…and the message says to close the old Jarvis", renameMessage(failed)[0]!.includes("Close the old Jarvis"));
}

// --- the move ---
const sys = fakeSystem("<Task>old</Task>");
const moved = await moveFromJarvis(sys.system);
eq("move: moved", moved.status, "moved");
ok("…the data is in Edward", existsSync(join(newDir, "settings.json")) && existsSync(join(newDir, "codex-home", "sessions", "rollout-1.jsonl")));
ok("…a backup was made first and moved along", moved.status === "moved" && moved.backup.startsWith(newDir) && existsSync(join(moved.backup, "settings.json")), JSON.stringify(moved));
ok("…the old path is a junction to the new folder", lstatSync(oldDir).isSymbolicLink() && readFileSync(join(oldDir, "settings.json"), "utf8").includes("AUD"));
eq("…old task removed, notifications renamed, new task installed", sys.calls, ["export", "remove-old", "unregister-old", "install-new"]);
eq("…and from now on the data is in Edward", appDataDir(), newDir);
eq("…nothing pending any more", renamePending(), false);
eq("second start: not-needed", (await moveFromJarvis(fakeSystem(null).system)).status, "not-needed");
ok("message names both folders", renameMessage(moved)[0]!.includes(oldDir) && renameMessage(moved)[0]!.includes(newDir));

// --- no background task before: none afterwards ---
rmSync(oldDir, { recursive: true, force: true });
rmSync(newDir, { recursive: true, force: true });
makeOldData();
const noTask = fakeSystem(null);
eq("without a task: moved", (await moveFromJarvis(noTask.system)).status, "moved");
eq("…and no task is installed", noTask.calls, ["export", "unregister-old"]);

// --- a data folder chosen by environment variable is never moved ---
rmSync(oldDir, { recursive: true, force: true });
rmSync(newDir, { recursive: true, force: true });
makeOldData();
process.env.JARVIS_DATA_DIR = join(local, "chosen");
eq("chosen folder: nothing pending", renamePending(), false);
eq("chosen folder: not-needed", (await moveFromJarvis(fakeSystem(null).system)).status, "not-needed");
ok("…and the old folder is left alone", existsSync(join(oldDir, "settings.json")) && !existsSync(newDir));
eq("EDWARD_DATA_DIR wins over JARVIS_DATA_DIR", ((process.env.EDWARD_DATA_DIR = join(local, "new-name")), appDataDir()), join(local, "new-name"));

rmSync(local, { recursive: true, force: true });
console.log(results.map(([n, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${n}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
