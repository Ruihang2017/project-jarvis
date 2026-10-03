// Several Google accounts (A1): moving the single pre-A1 account, adding, signing in again, refusing
// work accounts (D34), defaults, removing; mail tools and the bill scan across accounts.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "edward-accounts-test-"));
process.env.EDWARD_DATA_DIR = dir;

const { Accounts, COLORS, accountDir, refusal } = await import("../src/accounts/accounts.js");
const { TOKEN_URL, REVOKE_URL, GoogleAuthError } = await import("../src/google/oauth.js");
const { protect, unprotect } = await import("../src/google/dpapi.js");
const { CALENDAR_SCOPES, GMAIL_SCOPES } = await import("../src/google/instructions.js");
const { GMAIL_TOOLS } = await import("../src/google/gmail-tools.js");
const { fakeAccounts } = await import("./fake-accounts.js");
const { scanBills } = await import("../src/bills/scan.js");
const { BillStore } = await import("../src/bills/store.js");
const { updateSettings } = await import("../src/settings.js");
import type { Message } from "../src/google/gmail.js";

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const rejects = async (name: string, p: Promise<unknown>, code: string) => {
  try {
    await p;
    ok(name, false, "did not reject");
  } catch (e) {
    ok(name, e instanceof GoogleAuthError && e.code === code, `got ${e instanceof Error ? `${(e as { code?: string }).code}: ${e.message}` : String(e)}`);
  }
};

const ALL = ["openid", "email", ...CALENDAR_SCOPES, ...GMAIL_SCOPES];
writeFileSync(join(dir, "google-client.json"), JSON.stringify({ installed: { client_id: "cid", client_secret: "cs" } }));

// --- the pre-A1 single account becomes g1 ---
writeFileSync(join(dir, "google-token.bin"), await protect("RT-OLD"));
writeFileSync(join(dir, "google.json"), JSON.stringify({ email: "me@gmail.com", scopes: ALL, connectedAt: "2026-10-01T00:00:00Z" }));

// Mock Google: the token endpoint answers for whichever account the "browser" signs in as.
let signInAs: { email: string; hd?: string } = { email: "other@gmail.com" };
let refresh = 0;
const revoked: string[] = [];
const jwt = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const http = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const params = new URLSearchParams(String(init?.body ?? ""));
  if (url === TOKEN_URL) {
    if (params.get("grant_type") === "refresh_token") return json({ access_token: `AT-${++refresh}`, expires_in: 3600 });
    return json({ access_token: "AT", expires_in: 3600, refresh_token: `RT-${signInAs.email}`, scope: ALL.join(" "), id_token: jwt({ email: signInAs.email, ...(signInAs.hd ? { hd: signInAs.hd } : {}) }) });
  }
  if (url === REVOKE_URL) {
    revoked.push(params.get("token") ?? "");
    return new Response("", { status: 200 });
  }
  return json({});
}) as typeof fetch;
const browser = (url: string) => {
  const u = new URL(url);
  void fetch(`${u.searchParams.get("redirect_uri")}/?state=${u.searchParams.get("state")}&code=C`).catch(() => {});
};

const acc = new Accounts(http);
const moved = acc.list();
eq("old single account becomes g1", moved.map((a) => [a.id, a.email, a.mail, a.calendar]), [["g1", "me@gmail.com", true, true]]);
ok("its files moved into accounts/g1", existsSync(join(accountDir("g1"), "google-token.bin")) && !existsSync(join(dir, "google-token.bin")) && !existsSync(join(dir, "google.json")));
eq("its sign-in still decrypts (nothing asked of Google)", await unprotect(readFileSync(join(accountDir("g1"), "google-token.bin"))), "RT-OLD");
eq("g1 usable for mail and calendar", [acc.usable(moved[0]!, "mail"), acc.usable(moved[0]!, "calendar")], [true, true]);
eq("a second Edward process sees the same list", new Accounts(http).list().map((a) => a.id), ["g1"]);

// --- adding and signing in again ---
const added = await acc.connect(ALL, browser, { timeoutMs: 10_000 });
eq("a new address is a new account", [added.added, added.account.id, added.account.email, added.account.color], [true, "g2", "other@gmail.com", COLORS[1]]);
eq("its token is its own", await unprotect(readFileSync(join(accountDir("g2"), "google-token.bin"))), "RT-other@gmail.com");
eq("no scratch folders left behind", readdirSync(join(dir, "accounts")).filter((f) => f.startsWith(".")), []);

signInAs = { email: "ME@gmail.com" };
const again = await acc.connect(ALL, browser, { timeoutMs: 10_000 });
eq("the same address signs in again instead of adding", [again.added, again.account.id, acc.list().length], [false, "g1", 2]);
eq("g1 now holds the new sign-in", await unprotect(readFileSync(join(accountDir("g1"), "google-token.bin"))), "RT-ME@gmail.com");
ok("nothing revoked when signing in again (it would revoke the new grant)", revoked.length === 0, revoked.join());

signInAs = { email: "me@gmail.com" };
await rejects("reconnecting g2 as someone else is refused", acc.connect(ALL, browser, { account: "g2", timeoutMs: 10_000 }), "wrong_account");
eq("…and g2 keeps its sign-in", await unprotect(readFileSync(join(accountDir("g2"), "google-token.bin"))), "RT-other@gmail.com");

// --- work accounts are refused in code (D34) ---
revoked.length = 0;
signInAs = { email: "boss@corp.example", hd: "corp.example" };
await rejects("a Google Workspace account is refused", acc.connect(ALL, browser, { timeoutMs: 10_000 }), "refused");
ok("…its sign-in is revoked at Google and nothing is kept", revoked.includes("RT-boss@corp.example") && acc.list().length === 2 && readdirSync(join(dir, "accounts")).every((f) => !f.startsWith(".")));
updateSettings({ blockedDomains: ["Blocked.example"] });
signInAs = { email: "me@mail.blocked.example" };
await rejects("an address on the blocked list is refused (subdomains too)", acc.connect(ALL, browser, { timeoutMs: 10_000 }), "refused");
eq("refusal: personal Gmail is fine", refusal("x@gmail.com", undefined, ["corp.example"]), null);
ok("refusal: Workspace names the domain", refusal("x@corp.example", "corp.example", [])!.includes("Google Workspace account (corp.example)"));
ok("refusal: blocked list with @ and spaces", refusal("x@corp.example", undefined, [" @corp.example "])!.includes("must not connect"));
eq("refusal: a lookalike domain isn't blocked", refusal("x@notcorp.example", undefined, ["corp.example"]), null);

// --- choosing accounts ---
const g1 = acc.get("g1")!;
const g2 = acc.get("g2")!;
eq("all mail accounts, in order", acc.for("mail").map((a) => a.id), ["g1", "g2"]);
eq("default: the first", acc.primary("mail")?.id, "g1");
acc.setDefault("mail", "g2");
eq("default chosen", acc.primary("mail")?.id, "g2");
eq("pick by address", acc.pick("mail", "OTHER@gmail.com").map((a) => a.id), ["g2"]);
acc.update("g1", { name: "Personal" });
eq("pick by name; label is the name", [acc.pick("calendar", "personal").map((a) => a.id), acc.label(acc.get("g1")!)], [["g1"], "Personal"]);
try {
  acc.pick("mail", "nobody");
  ok("unknown account named → error listing accounts", false);
} catch (e) {
  ok("unknown account named → error listing accounts", String(e).includes("Personal, other@gmail.com"), String(e));
}
acc.update("g1", { mail: false });
eq("mail switched off for g1", [acc.for("mail").map((a) => a.id), acc.for("calendar").map((a) => a.id)], [["g2"], ["g1", "g2"]]);
acc.update("g1", { mail: true });
acc.auth(g2).update({ invalidAt: "2026-10-03T00:00:00Z" });
eq("an expired sign-in isn't used", acc.for("mail").map((a) => a.id), ["g1"]);
eq("…and the default falls back", acc.primary("mail")?.id, "g1");
acc.auth(g2).update({ invalidAt: undefined });
void g1;

// --- removing ---
revoked.length = 0;
await acc.disconnect("g2");
ok("removed: revoked, files gone, default cleared", revoked.includes("RT-other@gmail.com") && !existsSync(accountDir("g2")) && acc.list().length === 1 && acc.primary("mail")?.id === "g1");

// --- mail tools across two accounts ---
const SCOPES = { email: "", scopes: ALL, connectedAt: "x" };
const mailbox = (email: string, msgs: { id: string; subject: string; hour: number }[]) => ({
  state: () => ({ ...SCOPES, email }),
  api: async (url: string) => {
    if (url.includes("/messages?")) return { messages: msgs.map((m) => ({ id: m.id })) };
    const id = decodeURIComponent(url.split("/messages/")[1]!.split("?")[0]!);
    const m = msgs.find((x) => x.id === id)!;
    const headers = [
      { name: "From", value: `Sender <s@x.com>` },
      { name: "To", value: email },
      { name: "Subject", value: m.subject },
    ];
    return { id, threadId: `t${id}`, labelIds: ["UNREAD"], snippet: `snippet ${id}`, internalDate: String(new Date(2026, 9, 3, m.hour).getTime()), payload: { mimeType: "text/plain", headers, body: { data: Buffer.from(`Body of ${id}`).toString("base64url") } } };
  },
});
const accounts = fakeAccounts([
  { auth: mailbox("me@gmail.com", [{ id: "a1", subject: "Older", hour: 8 }]) as never, email: "me@gmail.com", name: "Personal" },
  { auth: mailbox("fam@gmail.com", [{ id: "b1", subject: "Newer", hour: 9 }]) as never, email: "fam@gmail.com" },
]);
const ctx = { accounts } as never;
const tool = (n: string) => GMAIL_TOOLS.find((t) => t.name === n)!;
const out = await (await tool("gmail_search").prepare({ query: "is:unread" }, ctx)).execute();
ok("search: both accounts, newest first, each labelled", /\[m\d+\] \(fam@gmail\.com\) ● Sender — Newer[\s\S]*\[m\d+\] \(Personal\) ● Sender — Older/.test(out), out);
const handle = /\[(m\d+)\] \(fam@gmail\.com\)/.exec(out)![1]!;
const read = await (await tool("gmail_read").prepare({ message: handle }, ctx)).execute();
ok("read: from the right account, says which", read.includes("Body of b1") && read.includes("Account: fam@gmail.com"), read);
const one = await (await tool("gmail_search").prepare({ query: "is:unread", account: "Personal" }, ctx)).execute();
ok("search one account by name", one.includes("Older") && !one.includes("Newer"), one);
const s = await tool("gmail_search").prepare({ query: "x", account: "personal" }, ctx);
eq("summary names the account", s.summary, 'search mail "x" in Personal');

// --- bill scan across two mailboxes ---
const store = new BillStore();
const msg = (id: string, subject: string, body: string): Message =>
  ({ id, threadId: `t-${id}`, from: `Water <bills@water.example>`, to: "me@gmail.com", cc: "", subject, date: new Date(2026, 9, 1), snippet: "", unread: true, body, attachments: [], inline: [] }) as Message;
const boxA = new Map([["wa", msg("wa", "Your water bill", "Amount due $86.50 by 20 October 2026.")]]);
const boxB = new Map([["eb", msg("eb", "Your energy bill", "Amount due $120.00 by 22 October 2026.")]]);
const scan = await scanBills({
  mailboxes: [
    { account: "g1", gmail: { listIds: async () => [...boxA.keys()], message: async (id) => boxA.get(id)! } },
    { account: "g2", gmail: { listIds: async () => [...boxB.keys()], message: async (id) => boxB.get(id)! } },
  ],
  store,
  classify: async (_i, input) =>
    JSON.stringify({
      emails: [...input.matchAll(/=== EMAIL (\d+) ===[\s\S]*?Subject: Your (\w+) bill/g)].map((m) => ({
        email: Number(m[1]),
        kind: "bill",
        payee: m[2] === "water" ? "Harbour Water" : "Bright Energy",
        category: m[2] === "water" ? "water" : "electricity",
        amount: m[2] === "water" ? 86.5 : 120,
        currency: "AUD",
        due_date: m[2] === "water" ? "2026-10-20" : "2026-10-22",
      })),
    }),
});
eq("scan: both mailboxes looked at", scan.scanned, 2);
eq("each bill remembers its mailbox", store.list().map((b) => [b.payee, b.mailbox]).sort(), [["Bright Energy", "g2"], ["Harbour Water", "g1"]]);
store.close();

rmSync(dir, { recursive: true, force: true });
console.log(results.map(([n, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${n}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
