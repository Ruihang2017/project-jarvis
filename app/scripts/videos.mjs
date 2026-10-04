/**
 * Records the tutorial videos (D44) from the step files in app/scripts/videos/*.json:
 *   node app/scripts/videos.mjs [name …]      (from the repository root; needs ffmpeg on PATH or FFMPEG)
 * Each video gets a fresh made-up data folder (app/scripts/demo.ts) and its own Codex folder holding
 * only a copy of the ChatGPT sign-in (so demo chats never land in your history); both are deleted
 * afterwards. Output: site/videos/<name>.mp4 and <name>.jpg (poster).
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const app = join(root, "app");
const stepsDir = join(app, "scripts", "videos");
const outDir = join(root, "site", "videos");
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const login = join(process.env.EDWARD_CODEX_HOME ?? join(process.env.LOCALAPPDATA ?? "", "Edward", "codex-home"), "auth.json");
if (!existsSync(login)) throw new Error(`no ChatGPT sign-in at ${login}`);
mkdirSync(outDir, { recursive: true });

/** Seconds into a video for its poster, where the middle would be a dull frame. */
const POSTER_AT = { "05-bills": 5 };
const wanted = process.argv.slice(2);
const names = readdirSync(stepsDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((n) => !wanted.length || wanted.includes(n));
const electron = join(app, "node_modules", "electron", "dist", "electron.exe");
// Always the current code: an old build without the recording mode would open a normal window.
execFileSync("npm", ["run", "build"], { cwd: app, stdio: "inherit", shell: true });

for (const name of names) {
  const work = mkdtempSync(join(tmpdir(), `edward-video-${name}-`));
  try {
    const data = join(work, "data");
    const codex = join(work, "codex-home");
    const frames = join(work, "frames");
    mkdirSync(codex, { recursive: true });
    copyFileSync(login, join(codex, "auth.json"));
    const env = { ...process.env, EDWARD_DATA_DIR: data, EDWARD_CODEX_HOME: codex };
    execFileSync("npx", ["tsx", join(app, "scripts", "demo.ts")], { env, stdio: "inherit", shell: true });
    console.log(`recording ${name}…`);
    execFileSync(electron, ["."], { cwd: app, env: { ...env, EDWARD_DEMO: "1", EDWARD_RECORD: join(stepsDir, `${name}.json`), EDWARD_RECORD_OUT: frames }, stdio: "inherit", timeout: 15 * 60_000 });
    if (existsSync(join(frames, "error.txt"))) throw new Error(readFileSync(join(frames, "error.txt"), "utf8"));
    const done = JSON.parse(readFileSync(join(frames, "done.json"), "utf8"));
    const mp4 = join(outDir, `${name}.mp4`);
    // Constant 30 fps, even width/height, H.264 that every browser plays, streaming-friendly.
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(frames, "frames.txt"), "-vf", "fps=30,scale=1600:-2:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-movflags", "+faststart", "-an", mp4], { stdio: "inherit" });
    // The poster: a frame from the middle, when there is something on screen.
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-ss", String(POSTER_AT[name] ?? (done.seconds * 0.55).toFixed(1)), "-i", mp4, "-frames:v", "1", "-q:v", "3", join(outDir, `${name}.jpg`)], { stdio: "inherit" });
    console.log(`${name}: ${done.frames} frames, ${done.seconds.toFixed(1)} s → ${mp4}`);
  } finally {
    rmSync(work, { recursive: true, force: true }); // includes the copied sign-in
  }
}
