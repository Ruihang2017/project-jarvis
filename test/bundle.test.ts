// The Codex inside the desktop app's installer (D53): where Edward looks for it, what the check says,
// and the build script that fetches it (run on a made-up package: no network).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "edward-bundle-test-"));
process.env.EDWARD_DATA_DIR = dir;

const { bundledCodex, findCodex, config } = await import("../src/config.js");
const { compareCodex } = await import("../src/doctor.js");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const has = (...paths: string[]) => (p: string) => paths.includes(p);

// --- where Edward looks ---
const WIN_EXE = "C:\\Users\\a\\AppData\\Local\\Programs\\Edward\\Edward.exe";
const WIN_CODEX = "C:\\Users\\a\\AppData\\Local\\Programs\\Edward\\resources\\codex\\bin\\codex.exe";
const MAC_EXE = "/Applications/Edward.app/Contents/MacOS/Edward";
const MAC_CODEX = "/Applications/Edward.app/Contents/Resources/codex/bin/codex";
eq("Windows: next to Edward's program", bundledCodex({ platform: "win32", execPath: WIN_EXE, exists: has(WIN_CODEX) }), WIN_CODEX);
eq("Mac: in the app's Resources", bundledCodex({ platform: "darwin", execPath: MAC_EXE, exists: has(MAC_CODEX) }), MAC_CODEX);
eq("none when it isn't there (the terminal version, a development run)", [bundledCodex({ platform: "win32", execPath: "C:\\Program Files\\nodejs\\node.exe", exists: has() }), bundledCodex({ platform: "darwin", execPath: "/usr/local/bin/node", exists: has() })], [null, null]);
eq("none on Linux", bundledCodex({ platform: "linux", execPath: "/opt/edward/edward", exists: () => true }), null);
eq("Windows: the one inside wins over one on PATH", findCodex({ platform: "win32", execPath: WIN_EXE, env: { PATH: "C:\\tools" }, exists: has(WIN_CODEX, "C:\\tools\\codex.exe") }), WIN_CODEX);
eq("Mac: the one inside wins over Homebrew's", findCodex({ platform: "darwin", execPath: MAC_EXE, env: { PATH: "/usr/bin" }, home: "/Users/a", exists: has(MAC_CODEX, "/opt/homebrew/bin/codex"), askShell: () => null }), MAC_CODEX);
eq("without one inside, PATH as before", findCodex({ platform: "win32", execPath: WIN_EXE, env: { PATH: "C:\\tools" }, exists: has("C:\\tools\\codex.exe") }), "codex");

// --- what the check says ---
eq("check: the one inside says so", compareCodex("0.159.3", "0.159.3", true), { name: "Codex", status: "ok", detail: "0.159.3, built in" });
eq("check: the user's own Codex is just its version", compareCodex("0.159.3", "0.159.3", false).detail, "0.159.3");
const broken = compareCodex(null, "0.159.3", true);
ok("check: the one inside won't start → install Edward again, not Codex", broken.status === "fail" && broken.detail.includes("install Edward again") && !broken.detail.includes("winget") && !broken.detail.includes("curl"), broken.detail);
ok("check: none anywhere (terminal version) → how to install Codex", compareCodex(null, "0.159.3", false).detail.includes("install it"));

// --- the version the installer carries is the one Edward was verified with ---
const lock = JSON.parse(readFileSync(join("app", "codex.lock.json"), "utf8")) as { version: string; source: string; packages: Record<string, { file: string; sha256: string }>; leaveOut: string[] };
eq("the installer carries the Codex Edward was verified with", lock.version, config.testedCodex);
ok("it comes from OpenAI's releases of that version, over https", lock.source === `https://github.com/openai/codex/releases/download/rust-v${lock.version}`, lock.source);
eq("a package for each system Edward is built for, each with a SHA-256", Object.entries(lock.packages).map(([t, p]) => [t, /^[0-9a-f]{64}$/.test(p.sha256), p.file.endsWith(".tar.gz")]), [["win-x64", true, true], ["mac-arm64", true, true], ["mac-x64", true, true]]);

// --- the build script, on a made-up package ---
const made = join(dir, "made");
const src = join(dir, "from");
for (const d of [join(made, "bin"), join(made, "codex-resources", "voice", "bin"), join(made, "codex-path"), src]) mkdirSync(d, { recursive: true });
writeFileSync(join(made, "bin", "codex.exe"), "not really codex");
writeFileSync(join(made, "codex-path", "rg.exe"), "rg");
writeFileSync(join(made, "codex-resources", "voice", "bin", "voice.dll"), "voice");
writeFileSync(join(made, "codex-package.json"), JSON.stringify({ layoutVersion: 1, version: "9.9.9", entrypoint: "bin/codex.exe" }));
const FILE = "codex-package-test.tar.gz";
const packed = spawnSync("tar", ["-czf", `../from/${FILE}`, "bin", "codex-path", "codex-resources", "codex-package.json"], { cwd: made, encoding: "utf8" });
ok("(made a package to fetch)", packed.status === 0, packed.stderr);
const sum = createHash("sha256").update(readFileSync(join(src, FILE))).digest("hex");
const lockFor = (sha256: string, version = "9.9.9") => {
  const f = join(dir, `lock-${sha256.slice(0, 6)}-${version}.json`);
  writeFileSync(f, JSON.stringify({ version, source: "https://example.invalid", packages: { "win-x64": { file: FILE, sha256 } }, leaveOut: ["codex-resources/voice"] }));
  return f;
};
const fetchCodex = (lockFile: string, out: string) => spawnSync(process.execPath, [join("app", "scripts", "fetch-codex.mjs"), "--target", "win-x64", "--lock", lockFile, "--from", src, "--out", out], { encoding: "utf8" });

const good = join(dir, "out-good");
const first = fetchCodex(lockFor(sum), good);
ok("fetch: the right package is unpacked", first.status === 0 && readFileSync(join(good, "win-x64", "bin", "codex.exe"), "utf8") === "not really codex" && existsSync(join(good, "win-x64", "codex-path", "rg.exe")), first.stdout + first.stderr);
ok("fetch: without Codex's own voice", !existsSync(join(good, "win-x64", "codex-resources", "voice")));
const again = fetchCodex(lockFor(sum), good);
ok("fetch: a second run finds it there", again.status === 0 && again.stdout.includes("already"), again.stdout + again.stderr);

const bad = join(dir, "out-bad");
const wrong = fetchCodex(lockFor("0".repeat(64)), bad);
ok("fetch: a package that isn't the one named fails the build", wrong.status === 1 && wrong.stderr.includes("expected sha256") && wrong.stderr.includes(sum), wrong.stdout + wrong.stderr);
ok("fetch: …and nothing of it is unpacked", !existsSync(join(bad, "win-x64", "bin")));
const changed = fetchCodex(lockFor("0".repeat(64)), good);
ok("fetch: one unpacked earlier doesn't excuse a new checksum", changed.status === 1, changed.stdout + changed.stderr);
const other = fetchCodex(lockFor(sum, "1.0.0"), join(dir, "out-version"));
ok("fetch: a package of another version than the one named fails", other.status !== 0 && !existsSync(join(dir, "out-version", "win-x64", "bin")), other.stdout + other.stderr);

rmSync(dir, { recursive: true, force: true });
console.log(results.map(([name, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
