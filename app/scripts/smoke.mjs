// Starts the packaged app once, hidden, on made-up data, and saves pictures of two pages: proof that
// the build opens and draws on this system (CI runs it on Windows and macOS after packaging).
//   node scripts/smoke.mjs            (after npm run dist, dist:dir or dist:mac)
// Pictures and the page's console go to app/dist/smoke/. Nothing of the user's is read: its own data
// folder, its own Codex folder (so no sign-in), and on a Mac its own keychain file.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(app, "..");
const mac = process.platform === "darwin";

function packaged() {
  const dist = join(app, "dist");
  const dirs = existsSync(dist) ? readdirSync(dist) : [];
  const found = mac
    ? dirs.filter((d) => d.startsWith("mac")).map((d) => join(dist, d, "Edward.app", "Contents", "MacOS", "Edward"))
    : dirs.filter((d) => d.endsWith("-unpacked")).map((d) => join(dist, d, "Edward.exe"));
  const exe = found.find((p) => existsSync(p));
  if (!exe) throw new Error(`no packaged Edward in ${dist}: build it first (npm run dist, dist:dir or dist:mac)`);
  return exe;
}

const exe = packaged();
const scratch = mkdtempSync(join(tmpdir(), "edward-smoke-"));
const out = join(app, "dist", "smoke");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const env = { ...process.env, EDWARD_DATA_DIR: join(scratch, "data"), EDWARD_CODEX_HOME: join(scratch, "codex-home") };

if (mac) {
  // The made-up Google sign-in is sealed with a key in a keychain: a throwaway one, not the user's.
  const keychain = join(scratch, "smoke.keychain-db");
  for (const args of [["create-keychain", "-p", "", keychain], ["unlock-keychain", "-p", "", keychain], ["set-keychain-settings", keychain]]) {
    const r = spawnSync("/usr/bin/security", args, { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`security ${args[0]} failed: ${r.stderr}`);
  }
  env.EDWARD_KEYCHAIN = keychain;
}

const demo = spawnSync(process.execPath, [join(repo, "node_modules", "tsx", "dist", "cli.mjs"), "app/scripts/demo.ts"], { cwd: repo, env, encoding: "utf8" });
if (demo.status !== 0) throw new Error(`making the demo data failed:\n${demo.stdout}\n${demo.stderr}`);

const shots = { today: join(out, "today.png"), mail: join(out, "mail.png") };
const log = join(out, "page.log");
const child = spawn(exe, [], {
  env: { ...env, EDWARD_DEMO: "1", EDWARD_SHOT: Object.entries(shots).map(([page, file]) => `${page}=${file}`).join(";"), EDWARD_SHOT_LOG: log, EDWARD_SHOT_WAIT: "4000" },
  stdio: "inherit",
});
const code = await new Promise((resolve) => {
  const timer = setTimeout(() => {
    child.kill();
    resolve("timeout");
  }, 180_000);
  child.on("exit", (c) => {
    clearTimeout(timer);
    resolve(c);
  });
  child.on("error", (e) => {
    clearTimeout(timer);
    resolve(e.message);
  });
});

/** Width and height from a PNG's header; null when it isn't one. */
function pngSize(file) {
  const b = readFileSync(file);
  return b.length > 24 && b.toString("latin1", 1, 4) === "PNG" ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null;
}

const problems = [];
if (code !== 0) problems.push(`Edward ended with ${code}`);
for (const [page, file] of Object.entries(shots)) {
  if (!existsSync(file)) {
    problems.push(`no picture of ${page}`);
    continue;
  }
  const size = pngSize(file);
  const bytes = statSync(file).size;
  console.log(`${page}: ${size ? size.join("×") : "not a PNG"}, ${Math.round(bytes / 1024)} KB`);
  // An empty window compresses to a few KB; a drawn page is far bigger.
  if (!size || size[0] < 800 || bytes < 20_000) problems.push(`the picture of ${page} looks empty`);
}
if (existsSync(log)) console.log(`--- page console ---\n${readFileSync(log, "utf8").slice(-4000)}`);
try {
  // Codex may still be letting go of its files for a moment.
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
} catch {
  console.log(`(left behind: ${scratch})`);
}
if (problems.length) {
  console.error(`smoke test failed: ${problems.join("; ")}`);
  process.exit(1);
}
console.log(`smoke test passed: ${exe}`);
