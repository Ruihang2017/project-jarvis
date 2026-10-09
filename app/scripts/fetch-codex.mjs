// Gets the Codex that ships inside Edward's installer (D53): OpenAI's own release package for this
// system, in the version codex.lock.json names, checked against the SHA-256 written there.
//   node scripts/fetch-codex.mjs [--target win-x64|mac-arm64|mac-x64] [--lock file] [--from folder] [--out folder]
// It lands in app/vendor/codex/<target>/, laid out as OpenAI ships it, without the parts leaveOut
// lists (Codex's own voice: Edward doesn't use it). A package that doesn't match its checksum is
// deleted and the build fails. Nothing is downloaded when the right one is already there.
//   --from: a folder that already holds the package file, instead of downloading (tests, offline builds).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARK = ".edward-codex.json";

function option(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** The package for the system this runs on. Windows on ARM runs the x64 one, as it runs Edward. */
function hostTarget() {
  if (process.platform === "win32") return "win-x64";
  if (process.platform === "darwin") return process.arch === "arm64" ? "mac-arm64" : "mac-x64";
  throw new Error(`Edward's installer isn't built on ${process.platform}`);
}

function sha256(file) {
  return new Promise((done, fail) => {
    const hash = createHash("sha256");
    createReadStream(file).on("data", (d) => hash.update(d)).on("end", () => done(hash.digest("hex"))).on("error", fail);
  });
}

async function download(url, file) {
  const res = await fetch(url, { headers: { "user-agent": "edward-build" }, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`${url} answered ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
}

const lockFile = resolve(option("lock") ?? join(app, "codex.lock.json"));
const lock = JSON.parse(readFileSync(lockFile, "utf8"));
const target = option("target") ?? hostTarget();
const pkg = lock.packages[target];
if (!pkg) throw new Error(`${lockFile} has no Codex package for ${target}`);
const out = resolve(option("out") ?? join(app, "vendor", "codex"), target);
const mark = join(out, MARK);
const wanted = { version: lock.version, sha256: pkg.sha256, leaveOut: lock.leaveOut ?? [] };

const have = existsSync(mark) ? readFileSync(mark, "utf8") : "";
if (have === JSON.stringify(wanted)) {
  console.log(`Codex ${lock.version} for ${target} is already in ${relative(process.cwd(), out) || "."}`);
  process.exit(0);
}

const from = option("from");
const cache = join(dirname(out), ".cache");
mkdirSync(cache, { recursive: true });
const archive = from ? join(resolve(from), pkg.file) : join(cache, pkg.file);
if (!from && !(existsSync(archive) && (await sha256(archive)) === pkg.sha256)) {
  console.log(`Downloading Codex ${lock.version} for ${target} (${pkg.file})…`);
  const part = `${archive}.part`;
  await download(`${lock.source}/${pkg.file}`, part);
  renameSync(part, archive);
}
const found = existsSync(archive) ? await sha256(archive) : "nothing";
if (found !== pkg.sha256) {
  if (!from) rmSync(archive, { force: true });
  console.error(`${pkg.file} is not the file ${lockFile} names:\n  expected sha256 ${pkg.sha256}\n  found           ${found}\nNothing was unpacked.`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
// tar is on Windows 10+, macOS and Linux. A relative path, so neither GNU tar nor bsdtar reads "C:" as a host.
const tar = spawnSync("tar", ["-xzf", relative(out, archive).replaceAll("\\", "/")], { cwd: out, stdio: "inherit" });
if (tar.status !== 0) {
  rmSync(out, { recursive: true, force: true });
  throw new Error(`tar couldn't unpack ${pkg.file}`);
}
for (const part of wanted.leaveOut) rmSync(join(out, part), { recursive: true, force: true });

const layout = JSON.parse(readFileSync(join(out, "codex-package.json"), "utf8"));
if (layout.version !== lock.version || !existsSync(join(out, layout.entrypoint))) {
  rmSync(out, { recursive: true, force: true });
  throw new Error(`${pkg.file} isn't Codex ${lock.version}: it says ${layout.version}, entry ${layout.entrypoint}`);
}
writeFileSync(mark, JSON.stringify(wanted));
console.log(`Codex ${lock.version} for ${target} is in ${relative(process.cwd(), out) || "."} (${layout.entrypoint})`);
