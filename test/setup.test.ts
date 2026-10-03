import { mkdtempSync, rmSync } from "node:fs";
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

rmSync(dir, { recursive: true, force: true });
console.log(results.map(([n, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${n}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
