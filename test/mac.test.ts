// macOS support (M): sealing secrets with a keychain key, finding Codex, the launchd agent's definition
// and notification scripts. All of it runs on any system; the real keychain only on a Mac.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testKeychain } from "./mac-keychain.js";

const dir = mkdtempSync(join(tmpdir(), "edward-mac-test-"));
process.env.EDWARD_DATA_DIR = dir;
testKeychain(dir);

const k = await import("../src/google/keychain.js");
const { protect, unprotect } = await import("../src/google/dpapi.js");
const { findCodex, codexEnv, macBinDirs } = await import("../src/config.js");
const task = await import("../src/background/task.js");
const { appleString, appleNotification } = await import("../src/background/notify.js");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const fails = async (name: string, p: Promise<unknown>, match: string, never = "") => {
  try {
    await p;
    ok(name, false, "did not fail");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    ok(name, m.includes(match) && (!never || !m.includes(never)), m);
  }
};

// --- secrets sealed with a key (a stand-in for the keychain) ---
const memoryStore = () => {
  let key: Buffer | null = null;
  const calls = { read: 0, create: 0 };
  const store: InstanceType<typeof Object> & import("../src/google/keychain.js").KeyStore = {
    read: async () => (calls.read++, key),
    // Like the keychain: the first one stays.
    create: async (made) => void (calls.create++, (key ??= made)),
  };
  return { store, calls, set: (b: Buffer | null) => (key = b), get: () => key };
};
const a = memoryStore();
const secret = "1//refresh-token-秘密";
const [s1, s2] = await Promise.all([k.seal(Buffer.from(secret), a.store), k.seal(Buffer.from(secret), a.store)]);
ok("a sealed file is marked, and holds no readable secret", k.isSealed(s1!) && !s1!.includes(Buffer.from("refresh-token")));
ok("the same secret seals differently each time", !s1!.equals(s2!));
eq("opens again", [(await k.unseal(s1!, a.store)).toString(), (await k.unseal(s2!, a.store)).toString()], [secret, secret]);
eq("one key, made once and then remembered", [a.calls.create, a.get()?.length], [1, 32]);
const changed = Buffer.from(s1!);
changed[changed.length - 1]! ^= 1;
await fails("a changed file doesn't open", k.unseal(changed, a.store), "couldn't open a saved sign-in", "refresh");
await fails("a cut-off file doesn't open", k.unseal(s1!.subarray(0, 20), a.store), "not a file Edward sealed");
const b = memoryStore();
await k.seal(Buffer.from("x"), b.store);
await fails("another key doesn't open it", k.unseal(s1!, b.store), "couldn't open a saved sign-in");

// Two Edwards starting at once: the second finds the first one's key and uses it.
const shared = memoryStore();
const first = { read: shared.store.read, create: shared.store.create };
const second = { read: shared.store.read, create: shared.store.create };
const [fromFirst] = await Promise.all([k.seal(Buffer.from("same"), first), k.seal(Buffer.from("same"), second)]);
eq("two starting together agree on one key", (await k.unseal(fromFirst!, second)).toString(), "same");

// A keychain that can't keep the key (locked): an error, and nothing is written unprotected.
const locked = { read: async () => null, create: async () => {} };
await fails("a keychain that won't keep the key is an error", k.seal(Buffer.from(secret), locked), "macOS keychain", "refresh");

// --- the real thing: only on a Mac, in the test's own keychain file ---
if (process.platform === "darwin") {
  const blob = await protect(secret);
  ok("Mac: a saved sign-in is sealed, not plain", k.isSealed(blob) && !blob.includes(Buffer.from("refresh-token")));
  eq("Mac: and opens again", await unprotect(blob), secret);
  writeFileSync(join(dir, "token.bin"), blob);
  eq("Mac: from the file too", await unprotect(readFileSync(join(dir, "token.bin"))), secret);
  const again = k.macKeychain();
  ok("Mac: the key is in the keychain, 32 bytes", (await again.read())?.length === 32);
  eq("Mac: the key can be removed, once", [await k.forgetKey(), await k.forgetKey()], [true, false]);
} else {
  const blob = await protect(secret);
  eq("round trip on this system", await unprotect(blob), secret);
}
eq("a file from before Mac keychains (plain marker) still opens", await unprotect(Buffer.concat([Buffer.from("JARVIS-PLAIN1\n"), Buffer.from("old")])), "old");

// --- finding Codex ---
const has = (...paths: string[]) => (p: string) => paths.includes(p);
const never = () => null;
const WIN = "C:\\Users\\a\\AppData\\Local";
eq("Windows: on PATH", findCodex({ platform: "win32", env: { PATH: "C:\\bin;C:\\tools", LOCALAPPDATA: WIN }, exists: has("C:\\tools\\codex.cmd") }), "codex");
eq("Windows: not on PATH, where the installer puts it", findCodex({ platform: "win32", env: { PATH: "C:\\bin", LOCALAPPDATA: WIN }, exists: has(`${WIN}\\Programs\\OpenAI\\Codex\\bin\\codex.exe`) }), `${WIN}\\Programs\\OpenAI\\Codex\\bin\\codex.exe`);
eq("Windows: nowhere", findCodex({ platform: "win32", env: { PATH: "C:\\bin", LOCALAPPDATA: WIN }, exists: has() }), "codex");
const dock = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", SHELL: "/bin/zsh" }; // what an app opened from the Dock gets
eq("Mac: on PATH", findCodex({ platform: "darwin", env: { PATH: "/usr/bin:/opt/homebrew/bin" }, exists: has("/opt/homebrew/bin/codex"), askShell: never }), "codex");
eq("Mac from the Dock: Homebrew on Apple silicon", findCodex({ platform: "darwin", env: dock, home: "/Users/a", exists: has("/opt/homebrew/bin/codex"), askShell: never }), "/opt/homebrew/bin/codex");
eq("Mac from the Dock: Homebrew on Intel, or npm", findCodex({ platform: "darwin", env: dock, home: "/Users/a", exists: has("/usr/local/bin/codex"), askShell: never }), "/usr/local/bin/codex");
eq("Mac from the Dock: OpenAI's installer first", findCodex({ platform: "darwin", env: dock, home: "/Users/a", exists: has("/Users/a/.local/bin/codex", "/usr/local/bin/codex"), askShell: never }), "/Users/a/.local/bin/codex");
let asked = "";
eq("Mac: somewhere else, the login shell knows", findCodex({ platform: "darwin", env: dock, home: "/Users/a", exists: has("/Users/a/.nvm/versions/node/v24/bin/codex"), askShell: (sh) => ((asked = sh), "/Users/a/.nvm/versions/node/v24/bin/codex") }), "/Users/a/.nvm/versions/node/v24/bin/codex");
eq("…asked of the user's own shell", asked, "/bin/zsh");
eq("Mac: the shell names something that isn't there", findCodex({ platform: "darwin", env: dock, home: "/Users/a", exists: has(), askShell: () => "/nope/codex" }), "codex");
eq("Linux: PATH only", findCodex({ platform: "linux", env: { PATH: "/usr/bin" }, exists: has(), askShell: () => "/x/codex" }), "codex");

const env = codexEnv({ CODEX_HOME: "/h" }, "/Users/a/.nvm/bin/codex", "darwin", dock, "/Users/a");
const path = env.PATH!.split(":");
ok("Mac: Codex gets its own folder and the usual ones on PATH, after what was there", path.slice(0, 4).join(":") === dock.PATH && path[4] === "/Users/a/.nvm/bin" && path.includes("/opt/homebrew/bin") && path.includes("/usr/local/bin"), env.PATH);
eq("…each once, with the extra settings", [new Set(path).size === path.length, env.CODEX_HOME], [true, "/h"]);
eq("Mac: nothing twice when PATH already has them", codexEnv({}, "codex", "darwin", { PATH: macBinDirs("/Users/a").join(":") }, "/Users/a").PATH, macBinDirs("/Users/a").join(":"));
eq("Windows: PATH untouched", codexEnv({ CODEX_HOME: "h" }, "codex", "win32", { PATH: "C:\\bin" }), { PATH: "C:\\bin", CODEX_HOME: "h" });

// --- Codex isn't there (the usual first start on a Mac): an answer, not a crash ---
const { CodexClient } = await import("../src/rpc.js");
const missing = new CodexClient(join(dir, "no-such-codex"), [], process.env);
let ended = false;
missing.on("exit", () => (ended = true));
await fails("a Codex that can't be started fails the request with the reason", missing.request("initialize" as never, {} as never), "ENOENT");
await fails("…and every request after it", missing.request("initialize" as never, {} as never), "ENOENT");
ok("…and Edward hears that it ended", ended);
missing.close();

// --- the launchd agent ---
const tick = { exe: "/Applications/Edward.app/Contents/MacOS/Edward", args: ["/Applications/Edward.app/Contents/Resources/app.asar.unpacked/build/main/tick.js"], env: { ELECTRON_RUN_AS_NODE: "1" } };
const plist = task.agentPlist(tick, "/Users/a/Library/Application Support/Edward");
ok("agent: every minute, at sign-in, in the background", plist.includes("<key>StartInterval</key><integer>60</integer>") && plist.includes("<key>RunAtLoad</key><true/>") && plist.includes(`<string>${task.AGENT_LABEL}</string>`), plist);
eq("agent: the program, its script and environment read back", task.readAgentPlist(plist), { args: [tick.exe, ...tick.args], env: { ELECTRON_RUN_AS_NODE: "1", EDWARD_TICK_HOME: "/Users/a/Library/Application Support/Edward" } });
const odd = task.agentPlist({ exe: "/usr/local/bin/node", args: ["/Users/R&D <x>/dist/index.js", "tick"] }, "/Users/R&D <x>/data");
ok("agent: & and < in a path are escaped", odd.includes("/Users/R&amp;D &lt;x&gt;/dist/index.js") && !odd.includes("R&D"), odd);
eq("…and read back as they were", task.readAgentPlist(odd), { args: ["/usr/local/bin/node", "/Users/R&D <x>/dist/index.js", "tick"], env: { EDWARD_TICK_HOME: "/Users/R&D <x>/data" } });
eq("a task belongs to the data folder it was installed from", [task.taskBelongsTo({ installed: true, home: join(dir, "."), problems: [] }, dir), task.taskBelongsTo({ installed: true, home: tmpdir(), problems: [] }, dir), task.taskBelongsTo({ installed: false, problems: [] }, dir)], [true, false, false]);
eq("background reminders: Windows and macOS", task.backgroundSupported(), process.platform === "win32" || process.platform === "darwin");

// --- notifications on a Mac ---
eq("AppleScript string: quotes and backslashes escaped", appleString('Say "hi" \\ bye'), '"Say \\"hi\\" \\\\ bye"');
eq("…a line break written out, other control characters gone", appleString("a\nb\u0007c\u2028d"), '"a\\nb c d"');
eq("notification: one line", appleNotification({ title: "⏰ Call the dentist", body: "17:00" }), 'display notification "17:00" with title "⏰ Call the dentist"');
eq("notification: the first line becomes the subtitle, then two more", appleNotification({ title: "Site visit in 30 min", body: "14 Wattle St\nSam Carter\n2 related emails\nmore" }), 'display notification "Sam Carter\\n2 related emails" with title "Site visit in 30 min" subtitle "14 Wattle St"');
ok("notification: text can't end the string and run something", !/"\s*\n?\s*do shell script/.test(appleNotification({ title: 't" \n do shell script "x', body: "b" }).replace(/\\"/g, "")), appleNotification({ title: 't" \n do shell script "x', body: "b" }));

rmSync(dir, { recursive: true, force: true });
console.log(results.map(([name, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
