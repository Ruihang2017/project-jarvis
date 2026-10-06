// Voice (V): the key, what the realtime session is told, what gets read aloud, and the call's set-up.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testKeychain } from "./mac-keychain.js";

const dir = mkdtempSync(join(tmpdir(), "edward-voice-test-"));
process.env.EDWARD_DATA_DIR = dir;
testKeychain(dir);

const v = await import("../src/voice/voice.js");
const { answerCall, checkKey } = await import("../app/main/voice.js");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const rejects = async (name: string, p: Promise<unknown>, match: string) => {
  try {
    await p;
    ok(name, false, "did not reject");
  } catch (e) {
    ok(name, String(e).includes(match), String(e));
  }
};

// --- the key ---
const KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789";
ok("a real-looking key passes, junk doesn't", v.looksLikeKey(KEY) && !v.looksLikeKey("hello") && !v.looksLikeKey("sk-short") && !v.looksLikeKey("sk-has spaces in it 1234567890"));
await rejects("junk isn't saved", v.saveVoiceKey("password123"), "doesn't look like");
eq("no key yet", [v.hasVoiceKey(), await v.loadVoiceKey()], [false, null]);
await v.saveVoiceKey(` ${KEY} `);
ok("saved encrypted, not as text", existsSync(v.keyPath()) && !readFileSync(v.keyPath()).includes(Buffer.from("abcdefghij")));
eq("read back, trimmed", await v.loadVoiceKey(), KEY);

// --- the session: hears, never answers by itself ---
const s = v.sessionConfig({ voice: "cedar" });
eq("realtime mini by default", s.model, v.DEFAULT_MODEL);
eq("the voice chosen", s.audio.output.voice, "cedar");
eq("an unknown voice falls back", v.sessionConfig({ voice: "darth" }).audio.output.voice, v.DEFAULT_VOICE);
eq("detects the end of speech but doesn't reply on its own", s.audio.input.turn_detection, { type: "server_vad", create_response: false, interrupt_response: true });
ok("transcribes what is said", s.audio.input.transcription.model === v.TRANSCRIBE_MODEL);
ok("told it is only the voice", s.instructions.includes("never answer"));

// --- what gets read aloud ---
eq("markdown taken out", v.speakable("**Tomorrow:** dentist at 3pm.\n\n- Take the card\n- [Map](https://maps.example/x)"), "Tomorrow: dentist at 3pm.\nTake the card\nMap");
eq("code and bare links are pointed to, not read", v.speakable("Run `npm i` then:\n```\nlong code\n```\nSee https://x.example/a"), "Run npm i then:\n (code on screen) \nSee (link on screen)");
const long = v.speakable(`${"This is a sentence. ".repeat(100)}`);
ok("a long reply is cut at a sentence and points to the screen", long.length < 1300 && long.endsWith("The rest is on the screen.") && /\. The rest/.test(long), long.slice(-60));
const say = v.sayEvent("Hello");
eq("said outside the conversation, audio only", [say.type, say.response.conversation, say.response.input, say.response.output_modalities], ["response.create", "none", [], ["audio"]]);
ok("…the exact text", say.response.instructions.endsWith("Hello"));

// --- the call's set-up (main process; the key stays there) ---
const sent: { url: string; auth: string | null; sdp?: string; session?: string }[] = [];
const fakeHttp = (status: number, body: string) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    const form = init?.body instanceof FormData ? init.body : undefined;
    sent.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), sdp: form?.get("sdp")?.toString(), session: form?.get("session")?.toString() });
    return new Response(body, { status });
  }) as typeof fetch;
const answer = await answerCall("v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n", { voice: "marin" }, fakeHttp(201, "v=0\r\nanswer"));
eq("answer returned", answer, "v=0\r\nanswer");
eq("posted to the realtime calls endpoint with the key", [sent[0]!.url, sent[0]!.auth], ["https://api.openai.com/v1/realtime/calls", `Bearer ${KEY}`]);
ok("offer and session sent as form fields", sent[0]!.sdp!.startsWith("v=0") && JSON.parse(sent[0]!.session!).audio.output.voice === "marin");
await rejects("a refused key is explained", answerCall("v=0\r\n", {}, fakeHttp(401, JSON.stringify({ error: { message: "Incorrect API key" } }))), "didn't accept the key");
await rejects("no credit is explained", answerCall("v=0\r\n", {}, fakeHttp(429, "{}")), "out of credit");
await rejects("not an offer", answerCall("hello", {}, fakeHttp(201, "x")), "bad offer");
await checkKey(KEY, fakeHttp(200, "{}"));
await rejects("key check fails on 401", checkKey("sk-wrong", fakeHttp(401, "{}")), "didn't accept");
v.removeVoiceKey();
await rejects("without a key, voice asks for one", answerCall("v=0\r\n", {}, fakeHttp(201, "x")), "Settings → Voice");

// --- what voice costs (estimate) ---
const sp = await import("../src/voice/spend.js");
const usage = { total_tokens: 1500, input_tokens: 500, output_tokens: 1000, input_token_details: { text_tokens: 400, audio_tokens: 100, cached_tokens: 300, cached_tokens_details: { text_tokens: 300, audio_tokens: 0 } }, output_token_details: { text_tokens: 200, audio_tokens: 800 } };
const counts = sp.fromResponseUsage(usage);
eq("a reply's tokens, cached ones apart", [counts.textIn, counts.cachedTextIn, counts.audioIn, counts.textOut, counts.audioOut], [100, 300, 100, 200, 800]);
const mini = sp.costOf("gpt-realtime-2.1-mini", counts);
ok("priced like OpenAI's table", Math.abs(mini - (100 * 0.6 + 300 * 0.06 + 100 * 10 + 200 * 2.4 + 800 * 20) / 1e6) < 1e-12, String(mini));
ok("an unknown model is priced like the dearest", sp.costOf("gpt-new", counts) > mini);
eq("transcription by the minute", sp.costOf("gpt-realtime-2.1-mini", sp.fromTranscriptionUsage({ type: "duration", seconds: 120 })), 0.009);
eq("junk from the window counts as nothing", [sp.fromResponseUsage({ input_token_details: { text_tokens: -5, audio_tokens: "9" } }).textIn, sp.fromTranscriptionUsage({ type: "tokens", input_tokens: 99 }).transcribed, sp.fromResponseUsage(null).audioOut], [0, 0, 0]);
const spend = new sp.SpendStore();
const day = new Date(2026, 9, 5, 12);
spend.add("gpt-realtime-2.1-mini", counts, day);
spend.add("gpt-realtime-2.1-mini", counts, day);
spend.add("gpt-realtime-2.1-mini", sp.fromTranscriptionUsage({ type: "duration", seconds: 60 }), new Date(2026, 9, 1, 12));
spend.add("gpt-realtime-2.1-mini", counts, new Date(2026, 7, 1, 12)); // over 30 days ago
const tot = spend.totals(day);
ok("today, and the last 30 days", Math.abs(tot.today - 2 * mini) < 1e-12 && Math.abs(tot.last30 - (2 * mini + 0.0045)) < 1e-12, JSON.stringify(tot));
spend.close();
eq("shown", [sp.dollars(0), sp.dollars(0.004), sp.dollars(0.4249), sp.dollars(12.5)], ["$0.00", "under 1¢", "$0.42", "$12.50"]);

rmSync(dir, { recursive: true, force: true });
console.log(results.map(([n, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${n}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
