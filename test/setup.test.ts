import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "edward-setup-test-"));
process.env.JARVIS_DATA_DIR = dir;

const { detectRegion, region, money } = await import("../src/region.js");
const { datesIn } = await import("../src/bills/parse.js");
const { updateSettings } = await import("../src/settings.js");
const { runSetup, GETTING_STARTED } = await import("../src/setup.js");
const { HELP_GROUPS, commandNames } = await import("../src/commands.js");
type SetupEnv = import("../src/setup.js").SetupEnv;

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// --- region ---
eq("detect: Australia", detectRegion("en-AU"), { dateOrder: "dmy", currency: "AUD" });
eq("detect: United States", detectRegion("en-US"), { dateOrder: "mdy", currency: "USD" });
eq("detect: UK, Germany, China (script subtag)", [detectRegion("en-GB"), detectRegion("de-DE"), detectRegion("zh-Hans-CN")], [
  { dateOrder: "dmy", currency: "GBP" },
  { dateOrder: "dmy", currency: "EUR" },
  { dateOrder: "dmy", currency: "CNY" },
]);
eq("detect: unknown country falls back to day-first, USD", detectRegion("eo"), { dateOrder: "dmy", currency: "USD" });
updateSettings({ dateOrder: "mdy", currency: "USD" });
eq("settings override detection", region(), { dateOrder: "mdy", currency: "USD" });
const ref = new Date(2026, 9, 1);
eq("10/12/2026 day-first vs month-first", [[...datesIn("due 10/12/2026", ref, "dmy")], [...datesIn("due 10/12/2026", ref, "mdy")]], [["2026-12-10"], ["2026-10-12"]]);
eq("the region setting drives date reading", [...datesIn("due 10/12/2026", ref)], ["2026-10-12"]);
eq("written-out months don't depend on the order", [...datesIn("due 12 October 2026", ref, "mdy")], ["2026-10-12"]);
eq("month-first with an impossible month is dropped", [...datesIn("31/01/2026", ref, "mdy")], []);
eq("money: home currency plain, others marked", [money(24530, "AUD", "AUD"), money(249, "USD", "AUD"), money(249, "AUD", "USD"), money(1000, "EUR", "USD"), money(1000, "GBP", "GBP"), money(1234567, "SEK", "AUD")], ["$245.30", "US$2.49", "A$2.49", "€10.00", "£10.00", "SEK 12,345.67"]);
updateSettings({ dateOrder: undefined, currency: undefined });

// --- /help covers every command exactly once ---
const grouped = HELP_GROUPS.flatMap(([, entries]) => entries.map(([name]) => name));
eq("every command is in a /help group", commandNames().filter((n) => !grouped.includes(n)), []);
eq("no /help entry for a command that doesn't exist", grouped.filter((n) => !commandNames().includes(n)), []);
eq("no command listed twice", grouped.length, new Set(grouped).size);
ok("getting-started tips mention privacy and setup", GETTING_STARTED.some((l) => l.includes("removed before anything reaches the AI")) && GETTING_STARTED.some((l) => l.includes("edward setup")));

// --- setup wizard ---
function scenario(o: { answers?: (string | null)[]; node?: string; codex?: "ok" | "warn" | "fail"; account?: string | null; signInWorks?: boolean; taskInstalled?: boolean; hasClient?: boolean; connected?: string | null; missing?: string[]; supported?: boolean }) {
  const said: string[] = [];
  const asked: string[] = [];
  const did: string[] = [];
  const answers = [...(o.answers ?? [])];
  let account = o.account === undefined ? "me@example.com" : o.account;
  let reg = { dateOrder: "dmy" as "dmy" | "mdy", currency: "AUD" };
  const env: SetupEnv = {
    node: o.node ?? "24.1.0",
    codex: async () => ({ name: "Codex", status: o.codex ?? "ok", detail: o.codex === "fail" ? "not found" : "0.159.3" }),
    account: async () => account,
    signIn: async () => {
      did.push("signIn");
      if (o.signInWorks === false) throw new Error("browser closed");
      account = "new@example.com";
    },
    background: { supported: o.supported ?? true, installed: async () => o.taskInstalled ?? false, install: async () => (did.push("installTask"), { ok: true, message: "" }) },
    google: {
      clientPath: "DATA/google-client.json",
      hasClient: () => o.hasClient ?? false,
      connected: () => (o.connected === undefined ? null : o.connected),
      missing: () => o.missing ?? [],
      connect: async () => (did.push("connectGoogle"), "me@gmail.com"),
    },
    region: { current: () => reg, set: (r) => (did.push(`region:${JSON.stringify(r)}`), (reg = { ...reg, ...r })) },
    doctor: async () => ["[ok] everything"],
  };
  const io = { say: (l: string) => void said.push(l), ask: async (q: string) => (asked.push(q.trim()), answers.length ? answers.shift()! : null) };
  return { run: () => runSetup(io, env), said, asked, did };
}

let s = scenario({ taskInstalled: true, hasClient: true, connected: "me@gmail.com", answers: [""] });
eq("everything already done: nothing is changed, only the region is confirmed", [await s.run(), s.did, s.asked], [true, [], ["Is that right? [Y/n]"]]);
ok("…and it says so", s.said.some((l) => l.includes("Signed in as me@example.com")) && s.said.some((l) => l.includes("Already on")) && s.said.some((l) => l.includes("Connected as me@gmail.com")) && s.said.at(-1)!.includes("edward"));

s = scenario({ account: null, answers: ["", "", "", ""], hasClient: true });
eq("fresh install, Enter at every step: sign in, background on, connect Google, keep region", [await s.run(), s.did], [true, ["signIn", "installTask", "connectGoogle"]]);

s = scenario({ account: null, answers: ["n"] });
eq("declining sign-in stops the wizard and changes nothing", [await s.run(), s.did], [false, []]);
s = scenario({ account: null, answers: ["y"], signInWorks: false });
ok("a failed sign-in is explained, not thrown", (await s.run()) === false && s.said.some((l) => l.includes("didn't work: browser closed")));

s = scenario({ answers: ["n", "", ""], hasClient: false });
eq("no client file: Google is explained and skipped without asking", [await s.run(), s.did, s.asked.some((q) => q.includes("Connect now"))], [true, [], false]);
ok("…with the guide and where the file goes", s.said.some((l) => l.includes("docs/google-cloud-setup.md")) && s.said.some((l) => l.includes("DATA/google-client.json")));

s = scenario({ taskInstalled: true, hasClient: true, connected: "me@gmail.com", missing: ["Gmail"], answers: ["y", ""] });
eq("connected but missing a permission: offers to add it", [await s.run(), s.did, s.said.some((l) => l.includes("without permission for Gmail"))], [true, ["connectGoogle"], true]);

s = scenario({ taskInstalled: true, hasClient: true, connected: "me@gmail.com", answers: ["n", "mdy", "usd"] });
eq("region changed when the detection is wrong", [await s.run(), s.did], [true, ['region:{"dateOrder":"mdy","currency":"USD"}']]);
s = scenario({ taskInstalled: true, hasClient: true, connected: "me@gmail.com", answers: ["n", "whatever", "dollars"] });
eq("nonsense region answers change nothing", [await s.run(), s.did], [true, []]);

s = scenario({ account: null, answers: [] });
eq("closed input never signs in or installs anything by itself", [await s.run(), s.did], [false, []]);
s = scenario({ taskInstalled: false, hasClient: true, answers: [] });
eq("closed input: background and Google are skipped, not assumed", [await s.run(), s.did], [true, []]);

s = scenario({ codex: "fail" });
eq("no Codex: stops at step 1", [await s.run(), s.said.some((l) => l.startsWith("\n2/6"))], [false, false]);
s = scenario({ node: "20.11.0" });
ok("old Node: stops with the reason", (await s.run()) === false && s.said.some((l) => l.includes("needs Node 24")));
s = scenario({ supported: false, hasClient: true, connected: "x@gmail.com", answers: [""] });
ok("not Windows: says background is unavailable and carries on", (await s.run()) === true && s.said.some((l) => l.includes("Only available on Windows")));

// --- which Codex sign-ins Edward runs on (P) ---
const { signInOf } = await import("../src/session.js");
eq("sign-in: a ChatGPT plan or an OpenAI API key, nothing else", [signInOf({ type: "chatgpt" }), signInOf({ type: "apiKey" }), signInOf({ type: "amazonBedrock" }), signInOf(null), signInOf(undefined)], ["chatgpt", "apiKey", null, null, null]);

// --- switching to an OpenAI API key (P): checked first, then handed to Codex over stdin ---
const { checkOpenAiKey, saveKeyInCodex, CREDENTIAL_STORE } = await import("../src/ai/account.js");
const KEY = `sk-test-${"a".repeat(40)}`;
const asked: { url: string; auth: string | null }[] = [];
const openai = (status: number): typeof fetch => async (url, init) => {
  asked.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
  return new Response("{}", { status });
};
eq("key check: OpenAI knows it", await checkOpenAiKey(KEY, openai(200)), "ok");
eq("key check: only the key is sent, to OpenAI's model list", asked, [{ url: "https://api.openai.com/v1/models", auth: `Bearer ${KEY}` }]);
eq("key check: 401 means the key is wrong", await checkOpenAiKey(KEY, openai(401)), "rejected");
eq("key check: a key that may not list models is still a key", await checkOpenAiKey(KEY, openai(403)), "ok");
eq("key check: no network is not a wrong key", await checkOpenAiKey(KEY, async () => Promise.reject(new Error("offline"))), "unreachable");

const ran: { args: string[]; home: string | undefined; input: string }[] = [];
await saveKeyInCodex(`  ${KEY}\n`, "C:/scratch/codex-home", async (_bin, args, env, input) => (ran.push({ args, home: env.CODEX_HOME, input }), { code: 0, output: "Successfully logged in" }));
eq("save key: Codex's own login, encrypted store, in Edward's Codex folder, the key on stdin", ran, [{ args: ["login", "--with-api-key", ...CREDENTIAL_STORE], home: "C:/scratch/codex-home", input: `${KEY}\n` }]);
ok("save key: never on the command line", !ran[0]!.args.join(" ").includes(KEY));
const failed = await saveKeyInCodex(KEY, "C:/scratch/codex-home", async () => ({ code: 1, output: `error: could not store ${KEY}` })).then(() => "", (e: Error) => e.message);
ok("save key: a failure is reported without repeating the key", failed.includes("couldn't save the key") && !failed.includes(KEY), failed);
const refused = await saveKeyInCodex("not a key", "C:/scratch/codex-home", async () => ({ code: 0, output: "" })).then(() => "", (e: Error) => e.message);
ok("save key: something that isn't a key never reaches Codex", refused.includes("doesn't look like") && ran.length === 1, refused);

// --- another AI service (P): the address, the model name, the one request that tries it, what Codex is started with ---
const { checkAddress, validModel, nameOf, checkService, providerArgs, saveCustom, customAi, customLaunch, clearCustom, KEY_ENV } = await import("../src/ai/custom.js");
const { testKeychain } = await import("./mac-keychain.js");
testKeychain(dir);
eq("address: tidied, without a trailing slash", checkAddress(" https://openrouter.ai/api/v1/ ").url, "https://openrouter.ai/api/v1");
ok("address: plain http only for this computer", checkAddress("http://example.com/v1").problem !== undefined && checkAddress("http://localhost:11434/v1").url === "http://localhost:11434/v1");
ok("address: no sign-in details, no query, and it must be an address", [checkAddress("https://me:pw@host.example/v1"), checkAddress("https://host.example/v1?key=1"), checkAddress("openrouter")].every((r) => r.problem && !r.url));
eq("model names as services write them", ["qwen-plus", "qwen/qwen-plus", "~anthropic/claude-sonnet-latest", "gpt-6-luna", "llama3.1:8b"].map(validModel), [true, true, true, true, true]);
eq("model names: nothing with spaces or quotes", ["qwen plus", 'x"y', "", "a\nb"].map(validModel), [false, false, false, false]);
eq("the name shown comes from the address", ["https://openrouter.ai/api/v1", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "https://llm.example.org/v1"].map(nameOf), ["OpenRouter", "Qwen (Alibaba Cloud)", "llm.example.org"]);

const SERVICE = { baseUrl: "https://llm.example.org/v1", model: "qwen-plus" };
const SERVICE_KEY = "key-0123456789abcdef";
const tried: { url: string; auth: string | null; body: unknown }[] = [];
const service = (status: number, body: unknown = {}): typeof fetch => async (url, init) => {
  tried.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
  return new Response(JSON.stringify(body), { status });
};
eq("try a service: it answers", await checkService(SERVICE, SERVICE_KEY, service(200)), { ok: true, message: "" });
eq("try a service: one small request to its Responses address, with nothing of the user's", tried, [{ url: "https://llm.example.org/v1/responses", auth: `Bearer ${SERVICE_KEY}`, body: { model: "qwen-plus", input: "Reply with the word: ok", max_output_tokens: 32 } }]);
ok("try a service: a refused key", (await checkService(SERVICE, SERVICE_KEY, service(401))).message.includes("didn't accept the key"));
ok("try a service: no Responses format there", (await checkService(SERVICE, SERVICE_KEY, service(404))).message.includes("Responses format"));
const noSuchModel = (await checkService(SERVICE, SERVICE_KEY, service(404, { error: { message: "No endpoints found matching your data policy" } }))).message;
ok("try a service: a 404 with its own words is about the model, not the address", noSuchModel.includes("said: No endpoints found matching your data policy. Check the model name") && !noSuchModel.includes("Responses format"), noSuchModel);
const refusedModel = await checkService(SERVICE, SERVICE_KEY, service(400, { error: { message: `no model qwen-plus for ${SERVICE_KEY}\u001b[31m` } }));
ok("try a service: its own words are shown plain, short and without the key", refusedModel.message.includes("said 400: no model qwen-plus") && !refusedModel.message.includes(SERVICE_KEY) && !refusedModel.message.includes("\u001b"), refusedModel.message);
ok("try a service: not reachable", (await checkService(SERVICE, SERVICE_KEY, async () => Promise.reject(new Error("offline")))).message.includes("Couldn't reach llm.example.org"));

const startedWith = providerArgs({ name: "llm.example.org", ...SERVICE });
ok("Codex is started with the service as its provider, the key's variable named, the key itself absent", startedWith.join(" ").includes('model_providers.edward.base_url="https://llm.example.org/v1"') && startedWith.includes(`model_providers.edward.env_key="${KEY_ENV}"`) && startedWith.includes('model="qwen-plus"') && !startedWith.join(" ").includes(SERVICE_KEY));
eq("no service chosen: Codex starts for OpenAI", [customAi(), await customLaunch()], [null, null]);
await saveCustom(SERVICE, SERVICE_KEY);
const launch = await customLaunch();
eq("a chosen service: remembered, its key only in Codex's environment", [customAi(), launch?.env], [{ name: "llm.example.org", ...SERVICE }, { [KEY_ENV]: SERVICE_KEY }]);
ok("the key is not in the settings", !readFileSync(join(dir, "settings.json"), "utf8").includes(SERVICE_KEY));
// Windows and macOS encrypt it; elsewhere there is nothing to encrypt with (Edward doesn't run there).
ok("the key is not readable in its file", !["win32", "darwin"].includes(process.platform) || !readFileSync(join(dir, "ai-key.bin")).includes(SERVICE_KEY));
rmSync(join(dir, "ai-key.bin"));
ok("a chosen service whose key is gone is an error, never a quiet return to OpenAI", await customLaunch().then(() => false, () => true));
clearCustom();
eq("leaving the service forgets it", customAi(), null);

// --- restarting the app-server (after a sign-in made beside it): a stand-in program that answers every request with its pid ---
const { CodexClient } = await import("../src/rpc.js");
const { writeFileSync } = await import("node:fs");
writeFileSync(
  join(dir, "app-server"),
  `require("node:readline").createInterface({ input: process.stdin }).on("line", (l) => {
  const m = JSON.parse(l);
  if (m.id !== undefined && m.method !== "hang") process.stdout.write(JSON.stringify({ id: m.id, result: { pid: process.pid } }) + "\\n");
});`,
);
const cwd = process.cwd();
process.chdir(dir); // node runs "app-server" from here
const client = new CodexClient(process.execPath);
let stopped = 0;
client.on("exit", () => stopped++);
const ask = (method: string) => client.request<{ pid: number }>(method as never, undefined as never);
const first = (await ask("ping")).pid;
const hanging = ask("hang").then(() => "answered", (e: Error) => e.message);
client.restart();
eq("restart: a request in flight fails, saying why", await hanging, "codex app-server restarted during hang");
const second = (await ask("ping")).pid;
ok("restart: a new process answers", first !== second, `${first} → ${second}`);
await new Promise((r) => setTimeout(r, 300));
eq("restart: the old process ending is not reported as Codex stopping", stopped, 0);
client.close();
await new Promise((r) => setTimeout(r, 300));
eq("close: that one is reported", stopped, 1);
process.chdir(cwd);

rmSync(dir, { recursive: true, force: true });
console.log(results.map(([n, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${n}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
