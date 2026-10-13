/**
 * Gives a recorded video a spoken track, from the lines in app/scripts/voice/<name>.json:
 *   node app/scripts/narrate.mjs [name]      (from the repository root; default 00-demo)
 * Needs OPENAI_API_KEY in the environment (the realtime model is billed to it) and ffmpeg/ffprobe on
 * PATH (or FFMPEG / FFPROBE). Each line is spoken by OpenAI's realtime model, one response per line,
 * and laid at its `at` second; the picture is copied as it is. A line that hasn't changed is taken
 * from a cache in the temp folder, so changing one line costs one line.
 *
 * The times belong to one recording: after app/scripts/videos.mjs records the video again (which also
 * removes the sound), move the `at` values to where the captions now are, then run this.
 * `--check` only prints the timetable from the cache and says which lines are missing or collide.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const RATE = 24_000; // what the realtime model sends: 16-bit mono
const GAP = 0.2; // seconds of quiet a line needs before the next one
const root = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const name = args.find((a) => !a.startsWith("--")) ?? "00-demo";
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const ffprobe = process.env.FFPROBE ?? "ffprobe";
const mp4 = join(root, "site", "videos", `${name}.mp4`);
const plan = JSON.parse(readFileSync(join(root, "app", "scripts", "voice", `${name}.json`), "utf8"));
const cache = join(tmpdir(), "edward-voice-cache");
mkdirSync(cache, { recursive: true });

const fileOf = (say) => join(cache, `${createHash("sha256").update(JSON.stringify([plan.model, plan.voice, plan.speed, plan.style, say])).digest("hex").slice(0, 24)}.pcm`);
const words = (t) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).join(" ");

/** One realtime session that says each text in turn; resolves when all are in the cache. */
async function speak(lines) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(plan.model)}`, { headers: { authorization: `Bearer ${key}` } });
  const waiting = [];
  const queue = [];
  ws.addEventListener("message", (m) => {
    const e = JSON.parse(String(m.data));
    const w = waiting.shift();
    if (w) w.resolve(e);
    else queue.push(e);
  });
  const closed = new Promise((_, reject) => {
    ws.addEventListener("error", (e) => reject(new Error(`realtime connection failed: ${e.message ?? "error"}`)));
    ws.addEventListener("close", (e) => reject(new Error(`realtime connection closed (${e.code} ${e.reason})`)));
  });
  closed.catch(() => {});
  const next = () => (queue.length ? Promise.resolve(queue.shift()) : Promise.race([new Promise((resolve) => waiting.push({ resolve })), closed]));
  const until = async (type, each) => {
    for (;;) {
      const e = await next();
      if (e.type === "error") throw new Error(`realtime: ${e.error?.message ?? JSON.stringify(e)}`);
      each?.(e);
      if (e.type === type) return e;
    }
  };
  await Promise.race([new Promise((resolve) => ws.addEventListener("open", resolve)), closed]);
  ws.send(JSON.stringify({
    type: "session.update",
    session: {
      type: "realtime",
      output_modalities: ["audio"],
      instructions: `You are a voice-over artist recording a product video, one line at a time. You only read the line you are given, exactly as written, and add nothing. ${plan.style}`,
      audio: { input: { turn_detection: null }, output: { voice: plan.voice, speed: plan.speed, format: { type: "audio/pcm", rate: RATE } } },
    },
  }));
  const session = (await until("session.updated")).session;
  console.log(`session: ${session.model}, voice ${session.audio?.output?.voice}, speed ${session.audio?.output?.speed}`);
  try {
    for (const say of lines) {
      for (let attempt = 1; ; attempt++) {
        const audio = [];
        let heard = "";
        ws.send(JSON.stringify({ type: "response.create", response: { conversation: "none", input: [], output_modalities: ["audio"], instructions: `${plan.style}\n\nSay exactly this, and nothing else:\n\n${say}` } }));
        const done = await until("response.done", (e) => {
          if (e.type === "response.output_audio.delta" || e.type === "response.audio.delta") audio.push(Buffer.from(e.delta, "base64"));
          if (e.type === "response.output_audio_transcript.done" || e.type === "response.audio_transcript.done") heard = e.transcript ?? "";
        });
        if (done.response?.status !== "completed") throw new Error(`"${say}": ${done.response?.status} ${JSON.stringify(done.response?.status_details ?? "")}`);
        // The model sometimes answers instead of reading: only the exact words are kept.
        if (words(heard) === words(say)) {
          writeFileSync(fileOf(say), Buffer.concat(audio));
          break;
        }
        if (attempt === 3) throw new Error(`"${say}" was spoken as "${heard}" three times`);
        console.log(`  again (said "${heard}")`);
      }
    }
  } finally {
    ws.close();
  }
}

/** A clip without the quiet at its ends, so `at` is when the voice starts. */
function trimmed(file) {
  const b = readFileSync(file);
  const s = new Int16Array(b.buffer, b.byteOffset, b.length >> 1);
  let from = 0;
  let to = s.length;
  while (from < to && Math.abs(s[from]) < 260) from++;
  while (to > from && Math.abs(s[to - 1]) < 260) to--;
  const pad = Math.round(RATE * 0.03);
  return s.subarray(Math.max(0, from - pad), Math.min(s.length, to + pad));
}

const missing = plan.lines.filter((l) => !existsSync(fileOf(l.say))).map((l) => l.say);
if (missing.length && checkOnly) console.log(`${missing.length} line(s) not spoken yet`);
if (missing.length && !checkOnly) await speak(missing);

const seconds = Number(execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4], { encoding: "utf8" }).trim());
const track = new Int16Array(Math.ceil(seconds * RATE));
let collisions = 0;
plan.lines.forEach((l, i) => {
  if (!existsSync(fileOf(l.say))) return;
  const clip = trimmed(fileOf(l.say));
  const end = l.at + clip.length / RATE;
  const limit = plan.lines[i + 1]?.at ?? seconds;
  const late = end > limit - (plan.lines[i + 1] ? GAP : 0);
  if (late) collisions++;
  console.log(`${l.at.toFixed(1).padStart(6)} → ${end.toFixed(1).padStart(5)}  ${(limit - end).toFixed(1).padStart(5)} s spare${late ? "  ← TOO LONG" : ""}  ${l.say}`);
  const start = Math.round(l.at * RATE);
  for (let k = 0; k < clip.length && start + k < track.length; k++) track[start + k] = Math.max(-32768, Math.min(32767, track[start + k] + clip[k]));
});
if (collisions) {
  console.log(`${collisions} line(s) run into the next: shorten them or move "at"`);
  process.exitCode = 1;
}
if (collisions || checkOnly) process.exit();

const header = Buffer.alloc(44);
const bytes = track.length * 2;
header.write("RIFF", 0);
header.writeUInt32LE(36 + bytes, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(bytes, 40);
const wav = join(cache, `${name}.wav`);
const out = join(cache, `${name}.mp4`);
writeFileSync(wav, Buffer.concat([header, Buffer.from(track.buffer, track.byteOffset, bytes)]));
// The picture is copied untouched; the voice is brought to an even loudness and stored as AAC.
execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", mp4, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", "loudnorm=I=-17:TP=-1.5:LRA=11,aresample=48000", "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-movflags", "+faststart", out], { stdio: "inherit" });
rmSync(mp4);
renameSync(out, mp4);
rmSync(wav);
console.log(`${name}: ${plan.lines.length} lines, ${plan.voice} at ${plan.speed}× → ${mp4}`);
