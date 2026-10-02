process.env.TZ = "Australia/Sydney";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-gmail-test-"));
process.env.JARVIS_DATA_DIR = dir;

const g = await import("../src/google/gmail.js");
const { GMAIL_TOOLS, clip, formatThread } = await import("../src/google/gmail-tools.js");
const { googleInstructions, missingFeatures, CALENDAR_SCOPES, GMAIL_SCOPES } = await import("../src/google/instructions.js");
const { briefGoogle, composeBrief } = await import("../src/background/brief.js");
const { GoogleAuthError } = await import("../src/google/auth.js");
const { MemoryStore } = await import("../src/memory/store.js");
const { ReminderStore } = await import("../src/reminders/store.js");
type GoogleAuth = import("../src/google/auth.js").GoogleAuth;
type GoogleState = import("../src/google/auth.js").GoogleState;
type Part = import("../src/google/gmail.js").Part;

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const throws = async (name: string, f: () => unknown, match: string) => {
  try {
    await f();
    ok(name, false, "did not throw");
  } catch (e) {
    ok(name, String(e).includes(match), String(e));
  }
};

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const part = (mimeType: string, data: string | Buffer, headers: Record<string, string> = {}, filename = ""): Part => ({
  mimeType,
  filename,
  headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
  body: { data: b64(data), size: Buffer.byteLength(data) },
});

// --- headers ---
eq("encoded-word base64", g.decodeWords("=?UTF-8?B?5L2g5aW9?="), "你好");
eq("encoded-word Q", g.decodeWords("=?ISO-8859-1?Q?Caf=E9_au_lait?="), "Café au lait");
eq("adjacent encoded words join", g.decodeWords("=?UTF-8?B?5L2g?= =?UTF-8?B?5aW9?= world"), "你好 world");
eq("plain header untouched", g.decodeWords("Re: invoice"), "Re: invoice");
eq("display name", [g.displayName('"Alice Smith" <alice@x.com>'), g.displayName("Bob <bob@x.com>"), g.displayName("<c@x.com>"), g.displayName("d@x.com")], ["Alice Smith", "Bob", "c@x.com", "d@x.com"]);

// --- bodies ---
const html = `<html><head><style>p{color:red}</style><title>t</title></head><body><p>Hi&nbsp;Alex,</p><p>See <a href="https://x.com/doc">the doc</a> &amp; reply.<br>Thanks</p><ul><li>One</li><li>Two</li></ul><!-- hidden --><script>alert(1)</script>&#20320;&#x597D;</body></html>`;
eq("html to text", g.htmlToText(html), "Hi Alex,\nSee the doc (https://x.com/doc) & reply.\nThanks\n• One\n• Two\n你好");
const alt: Part = { mimeType: "multipart/alternative", parts: [part("text/plain", "Plain version\r\nline 2"), part("text/html", "<p>HTML version</p>")] };
eq("prefers text/plain", g.extractContent(alt).body, "Plain version\nline 2");
eq("falls back to html", g.extractContent({ mimeType: "multipart/alternative", parts: [part("text/html", "<p>Only HTML</p>")] }).body, "Only HTML");
const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]); // 你好 in GBK
eq("charset from Content-Type (GBK)", g.extractContent(part("text/plain", gbk, { "Content-Type": 'text/plain; charset="gbk"' })).body, "你好");
const mixed: Part = { mimeType: "multipart/mixed", parts: [alt, part("application/pdf", "PDFDATA", {}, "contract.pdf")] };
const content = g.extractContent(mixed);
eq("attachments listed, not read as body", [content.body, content.attachments], ["Plain version\nline 2", [{ filename: "contract.pdf", size: 7, mimeType: "application/pdf" }]]);
eq("strip quoted (English)", g.stripQuoted("Sounds good.\n\nOn Wed, 30 Sep 2026 at 10:00 Alice <a@x.com> wrote:\n> earlier text"), "Sounds good.");
eq("strip quoted (Chinese)", g.stripQuoted("好的\n在 2026年9月30日 周三 10:00，Alice 写道：\n> 之前"), "好的");
eq("strip > lines", g.stripQuoted("Top\n> quoted\nmore"), "Top\nmore");
eq("clip", [clip("abcdef", 10), clip("abcdef", 3)], ["abcdef", "abc\n[… 3 more characters not shown]"]);

// --- dates ---
const now = new Date(2026, 9, 1, 12, 0);
eq("short dates", [g.shortDate(new Date(2026, 9, 1, 9, 30), now), g.shortDate(new Date(2026, 8, 29, 9, 0), now), g.shortDate(new Date(2026, 8, 12), now)], ["09:30", "Tue 09-29", "2026-09-12"]);

// --- fake Gmail ---
const msg = (id: string, o: { from: string; subject: string; date: Date; unread?: boolean; thread?: string; body?: Part; to?: string; cc?: string }) => ({
  id,
  threadId: o.thread ?? `t-${id}`,
  labelIds: o.unread ? ["UNREAD", "INBOX"] : ["INBOX"],
  snippet: "Snippet &amp; more",
  internalDate: String(o.date.getTime()),
  payload: {
    ...(o.body ?? part("text/plain", `Body of ${id}`)),
    headers: [
      { name: "From", value: o.from },
      { name: "To", value: o.to ?? "me@gmail.com" },
      ...(o.cc ? [{ name: "Cc", value: o.cc }] : []),
      { name: "Subject", value: o.subject },
      { name: "Message-ID", value: `<${id}@mail>` },
    ],
  },
});
const store: Record<string, ReturnType<typeof msg>> = {
  a1: msg("a1", { from: "Alice <alice@x.com>", subject: "Contract", date: new Date(2026, 9, 1, 9, 0), unread: true, thread: "T1", body: mixed }),
  a2: msg("a2", { from: "Me <me@gmail.com>", subject: "Re: Contract", date: new Date(2026, 9, 1, 10, 0), thread: "T1", body: part("text/plain", "Looks fine.\n\nOn Thu Alice wrote:\n> Plain version") }),
  b1: msg("b1", { from: "=?UTF-8?B?5byg5LiJ?= <zhang@x.com>", subject: "=?UTF-8?B?5Lya6K6u?=", date: new Date(2026, 9, 1, 11, 0), unread: true }),
};
let current: GoogleState | null;
const urls: string[] = [];
const fakeAuth = {
  state: () => current,
  api: async (url: string, init: RequestInit = {}) => {
    urls.push(url);
    const u = new URL(url);
    if (u.pathname.includes("/drafts")) return draftsApi(u, init);
    if (u.pathname.endsWith("/messages") && (u.searchParams.get("q") ?? "").startsWith("in:sent to:")) {
      return { messages: sentTo.has(u.searchParams.get("q")!.slice("in:sent to:".length)) ? [{ id: "s" }] : [] };
    }
    if (u.pathname.endsWith("/messages")) {
      const q = u.searchParams.get("q") ?? "";
      const hits = Object.values(store).filter((m) => (q.includes("is:unread") ? m.labelIds.includes("UNREAD") : true));
      return { messages: hits.slice(0, Number(u.searchParams.get("maxResults"))).map((m) => ({ id: m.id })) };
    }
    const id = decodeURIComponent(u.pathname.split("/").pop()!);
    if (u.pathname.includes("/threads/")) return { messages: Object.values(store).filter((m) => m.threadId === id) };
    if (!store[id]) throw new Error("Google API 404: Not Found");
    return store[id];
  },
} as unknown as GoogleAuth;
const state = (scopes: string[], o: Partial<GoogleState> = {}): GoogleState => ({ email: "me@gmail.com", scopes: ["openid", ...scopes], connectedAt: "x", ...o });

// Fake drafts: raw RFC 2822 in, parsed back out the way Gmail's format=full would.
const sentTo = new Set(["alice@x.com"]);
const gDrafts = new Map<string, { raw: string; threadId?: string }>();
const sent: { raw: string; threadId?: string }[] = [];
function parseRaw(raw: string) {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const [head, ...rest] = text.split("\r\n\r\n");
  const headers = head!.split("\r\n").map((l) => ({ name: l.slice(0, l.indexOf(":")), value: l.slice(l.indexOf(":") + 1).trim() }));
  const body = Buffer.from(rest.join("\r\n\r\n").replace(/\r\n/g, ""), "base64").toString("utf8");
  return { headers, body };
}
function draftsApi(u: URL, init: RequestInit) {
  const method = init.method ?? "GET";
  const body = init.body ? JSON.parse(String(init.body)) : {};
  if (u.pathname.endsWith("/drafts/send")) {
    const d = gDrafts.get(body.id);
    if (!d) throw new Error("Google API 404: Not Found");
    gDrafts.delete(body.id);
    sent.push(d);
    return { id: `sent-${sent.length}`, threadId: d.threadId ?? "new" };
  }
  if (u.pathname.endsWith("/drafts") && method === "POST") {
    const id = `D${gDrafts.size + sent.length + 1}`;
    gDrafts.set(id, { raw: body.message.raw, threadId: body.message.threadId });
    return { id };
  }
  const id = decodeURIComponent(u.pathname.split("/").pop()!);
  const d = gDrafts.get(id);
  if (!d) throw new GoogleAuthError("http_404", "Google API 404: Not Found");
  if (method === "PUT") {
    gDrafts.set(id, { raw: body.message.raw, threadId: body.message.threadId });
    return { id };
  }
  const { headers, body: text } = parseRaw(d.raw);
  return { id, message: { id: `msg-${id}`, threadId: d.threadId ?? "new", payload: { mimeType: "text/plain", headers, body: { data: b64(text) } } } };
}

const gmail = new g.GmailClient(fakeAuth);
current = null;
await throws("not connected", () => gmail.ensureAccess(), "/connect google");
current = state(CALENDAR_SCOPES);
await throws("no Gmail scope", () => gmail.ensureAccess(), "Gmail access hasn't been granted");
current = state([...CALENDAR_SCOPES, ...GMAIL_SCOPES]);

const found = await gmail.search("is:unread", 50);
eq("search: newest first, unread only", found.map((m) => m.id), ["b1", "a1"]);
const listUrl = new URL(urls.find((u) => u.includes("/messages?"))!);
eq("search request: q + max capped at 20", [listUrl.searchParams.get("q"), listUrl.searchParams.get("maxResults")], ["is:unread", "20"]);
const metaUrl = new URL(urls.find((u) => u.includes("format=metadata"))!);
eq("metadata headers requested", metaUrl.searchParams.getAll("metadataHeaders"), ["From", "To", "Subject", "Date"]);
eq("encoded From/Subject decoded", [found[0]!.from, found[0]!.subject], ["张三 <zhang@x.com>", "会议"]);
eq("summary line", g.summaryLine(found[1]!, now), "● Alice — Contract · 09:00");
eq("snippet entities decoded", found[0]!.snippet, "Snippet & more");

// --- tools ---
const ctx = { google: fakeAuth } as never;
const tool = (n: string) => GMAIL_TOOLS.find((t) => t.name === n)!;
const search = await tool("gmail_search").prepare({ query: "is:unread" }, ctx);
eq("search summary", search.summary, 'search mail "is:unread"');
const out = await search.execute();
ok("search output: data note + handles + snippets", out.startsWith("Email data") && /\[m1\] ● 张三 — 会议 · [^\n]+\n {4}Snippet & more/.test(out) && out.includes("[m2] ● Alice — Contract"), out);
await throws("search needs a query", () => tool("gmail_search").prepare({ query: " " }, ctx), "required");
await throws("read unknown handle", () => tool("gmail_read").prepare({ message: "m99" }, ctx), "gmail_search first");

const read = await (await tool("gmail_read").prepare({ message: "[m2]" }, ctx)).execute();
ok("read: headers, attachment, body", read.startsWith("Email data") && read.includes("[m2] From: Alice <alice@x.com>") && read.includes("Attachments: contract.pdf (1 KB)") && read.endsWith("Plain version\nline 2"), read);
const thread = await (await tool("gmail_read").prepare({ message: "m2", thread: true }, ctx)).execute();
ok("thread: both messages, quotes stripped, new handle for the reply", thread.includes("Subject: Contract") && thread.includes("[m3] From: Me <me@gmail.com>") && thread.includes("Looks fine.") && !thread.includes("> Plain version"), thread);

// Thread budget: newest message keeps its text, older ones shrink.
const long = (id: string, n: number, d: number) => g.toMessage(msg(id, { from: "A <a@x.com>", subject: "S", date: new Date(2026, 9, 1, d), body: part("text/plain", id.repeat(n)) }) as never);
const formatted = formatThread([long("old", 9000, 8), long("new", 2000, 9)], now);
ok("thread budget favours the newest", formatted.includes("new".repeat(2000)) && formatted.includes("\n[… 25000 more characters not shown]"), String(formatted.length));

// --- composing (N4b) ---
const longSubject = "关于下周五在 Springfield 的施工进度与防水检查安排的确认";
const encoded = g.encodeWord(longSubject);
ok("encoded subject round-trips in ≤75-char words", g.decodeWords(encoded) === longSubject && encoded.split(" ").every((w) => w.length <= 75), encoded);
eq("ASCII subject unchanged", g.encodeWord("Re: Contract"), "Re: Contract");
eq("split addresses (quoted comma kept)", g.splitAddresses('"Smith, Alice" <alice@x.com>, bob@x.com; Carol <c@x.com>'), ['"Smith, Alice" <alice@x.com>', "bob@x.com", "Carol <c@x.com>"]);
eq("address of", [g.addressOf("Alice <Alice@X.com>"), g.addressOf("bob@x.com"), g.addressOf("not an email")], ["alice@x.com", "bob@x.com", null]);
eq("reply subject", [g.replySubject("Contract"), g.replySubject("Re: Contract"), g.replySubject("回复：合同")], ["Re: Contract", "Re: Contract", "回复：合同"]);
const raw = parseRaw(g.buildRaw({ to: ["张三 <zhang@x.com>", "bob@x.com"], cc: [], subject: "会议", body: "你好\n明天见", inReplyTo: "<a1@mail>", references: "<a0@mail> <a1@mail>" }));
const hv = (n: string) => raw.headers.find((h) => h.name === n)?.value;
eq("raw: encoded name + subject decode back", [g.decodeWords(hv("To")!), g.decodeWords(hv("Subject")!)], ["张三 <zhang@x.com>, bob@x.com", "会议"]);
eq("raw: threading headers + UTF-8 plain text", [hv("In-Reply-To"), hv("References"), hv("Content-Type")], ["<a1@mail>", "<a0@mail> <a1@mail>", 'text/plain; charset="UTF-8"']);
eq("raw: body with CRLF", raw.body, "你好\r\n明天见");
ok("raw: no From (Gmail fills it)", !hv("From"));

const orig = g.toMessage(msg("r1", { from: "Alice <alice@x.com>", to: "me@gmail.com, Bob <bob@x.com>", cc: "Carol <c@x.com>, ME@gmail.com", subject: "Plan", date: now }) as never);
eq("reply: sender only", g.replyRecipients(orig, "me@gmail.com", false), { to: ["Alice <alice@x.com>"], cc: [] });
eq("reply all: others, never me", g.replyRecipients(orig, "me@gmail.com", true), { to: ["Alice <alice@x.com>"], cc: ["Bob <bob@x.com>", "Carol <c@x.com>"] });
eq("reply uses Reply-To", g.replyRecipients({ ...orig, replyTo: "noreply-handler <h@x.com>" }, "me@gmail.com", false).to, ["noreply-handler <h@x.com>"]);
eq("reply to my own message goes to its recipients", g.replyRecipients({ ...orig, from: "Me <me@gmail.com>", to: "Dan <d@x.com>", cc: "" }, "me@gmail.com", false).to, ["Dan <d@x.com>"]);

current = state([...CALENDAR_SCOPES, ...GMAIL_SCOPES]);
const draftReply = await tool("gmail_draft").prepare({ reply_to: "m2", body: "Friday works for me." }, ctx);
eq("draft reply summary", draftReply.summary, "draft reply to Alice: Re: Contract");
const d1 = await draftReply.execute();
ok("draft result says NOT sent + handle", d1.startsWith("Draft [d1] saved in the user's Gmail drafts — NOT sent.") && d1.includes("To: Alice <alice@x.com>") && d1.includes("gmail_send with draft d1"), d1);
const stored = [...gDrafts.values()][0]!;
const storedRaw = parseRaw(stored.raw);
eq("reply draft is threaded", [stored.threadId, storedRaw.headers.find((h) => h.name === "In-Reply-To")?.value], ["T1", "<a1@mail>"]);
await throws("draft: no recipient", () => tool("gmail_draft").prepare({ subject: "x", body: "y" }, ctx), "no recipient");
await throws("draft: bad address", () => tool("gmail_draft").prepare({ to: "Alice", subject: "x", body: "y" }, ctx), "not an email address: Alice");
await throws("draft: new email needs a subject", () => tool("gmail_draft").prepare({ to: "a@x.com", body: "y" }, ctx), "subject");
const revise = await tool("gmail_draft").prepare({ draft: "d1", body: "Friday 3pm works for me." }, ctx);
eq("revise summary", revise.summary, "revise draft d1: Re: Contract");
await revise.execute();
eq("revise updates the same Gmail draft", [gDrafts.size, parseRaw([...gDrafts.values()][0]!.raw).body], [1, "Friday 3pm works for me."]);

await throws("send: only Jarvis drafts", () => tool("gmail_send").prepare({ draft: "d9" }, ctx), "only drafts Jarvis wrote");
const send1 = await tool("gmail_send").prepare({ draft: "d1" }, ctx);
eq("send preview", [send1.summary, send1.preview, send1.allowAlways], [
  "send email to Alice: Re: Contract",
  "To: Alice <alice@x.com>\n  Subject: Re: Contract\n  \n  Friday 3pm works for me.",
  false,
]);

const newMail = await (await tool("gmail_draft").prepare({ to: "New Person <new@x.com>", subject: "Hello", body: "Hi there" }, ctx)).execute();
const newRef = newMail.match(/\[(d\d+)\]/)![1]!;
// The user edits the draft in Gmail before sending.
const [newId, newDraft] = [...gDrafts.entries()].find(([, d]) => parseRaw(d.raw).body === "Hi there")!;
gDrafts.set(newId, { ...newDraft, raw: g.buildRaw({ to: ["New Person <new@x.com>"], cc: [], subject: "Hello", body: "Hi there — edited by me" }) });
const send2 = await tool("gmail_send").prepare({ draft: newRef }, ctx);
ok("send preview shows the Gmail version + edit note + first-time warning", send2.preview!.includes("(edited in Gmail since Jarvis drafted it)") && send2.preview!.includes("Hi there — edited by me") && send2.preview!.includes("⚠ first email to new@x.com"), send2.preview);

// A long draft can not hide text past the preview: the prompt says how much is not shown (P3).
const longDraft = await (await tool("gmail_draft").prepare({ to: "alice@x.com", subject: "Long", body: "A".repeat(1500) + "SECRET-TAIL" }, ctx)).execute();
const longSend = await tool("gmail_send").prepare({ draft: longDraft.match(/\[(d\d+)\]/)![1]! }, ctx);
ok("send preview warns about text beyond what it shows", longSend.preview!.includes("11 more characters are not shown here") && !longSend.preview!.includes("SECRET-TAIL"), longSend.preview!.slice(-140));

const { ToolRunner } = await import("../src/tools.js");
const runner = new ToolRunner(dir, {} as never, {} as never, fakeAuth, {} as never);
const answer = (a: string) => ({ approveTool: async () => a }) as never;
const req = (draft: string) => ({ threadId: "t", turnId: "u", callId: "c", tool: "gmail_send", arguments: { draft } }) as never;
const declinedSend = await runner.call(req("d1"), answer("decline"));
ok("declined send → nothing sent", declinedSend.success === false && sent.length === 0, JSON.stringify(declinedSend));
const okSend = await runner.call(req("d1"), answer("accept"));
ok("approved send → sent, threaded", okSend.success === true && sent.length === 1 && sent[0]!.threadId === "T1", JSON.stringify(okSend));
const again = await runner.call(req("d1"), answer("accept"));
ok("a sent draft can't be sent again", again.success === false && sent.length === 1, JSON.stringify(again));
const after = await (await tool("gmail_draft").prepare({ to: "a@x.com", subject: "s", body: "b" }, ctx)).execute();
ok("draft handles are never reused after sending", after.startsWith("Draft [d4]"), after);
gDrafts.delete(newId); // deleted in Gmail
await throws("draft deleted in Gmail", () => tool("gmail_send").prepare({ draft: newRef }, ctx), "no longer exists");

// --- instructions & notices ---
ok("instructions: Gmail granted", googleInstructions(state([...CALENDAR_SCOPES, ...GMAIL_SCOPES])).includes("gmail_search"));
ok("instructions: draft then send, can't delete", /gmail_draft[\s\S]*gmail_send[\s\S]*can't archive, label, mark read or delete/.test(googleInstructions(state(GMAIL_SCOPES))));
ok("instructions: Gmail not granted", googleInstructions(state(CALENDAR_SCOPES)).includes("Gmail access hasn't been granted"));
eq("missing features", [missingFeatures(null), missingFeatures(state([])), missingFeatures(state(CALENDAR_SCOPES)), missingFeatures(state([...CALENDAR_SCOPES, ...GMAIL_SCOPES]))], [[], ["calendar", "Gmail"], ["Gmail"], []]);

// --- brief ---
current = state(GMAIL_SCOPES);
const bg = await briefGoogle(fakeAuth, now);
eq("brief: no calendar section without calendar access", bg.calendar, undefined);
eq("brief: unread mail section (counts as one thing)", bg.mail, { lines: ["✉ 2 unread in Primary", "   张三 — 会议", "   Alice — Contract"], count: 1 });
const mem = new MemoryStore(join(dir, "memory.db"));
const rem = new ReminderStore(join(dir, "memory.db"));
const brief = composeBrief(mem, rem, now, bg);
eq("brief counts unread mail once", [brief.count, brief.lines], [1, ["✉ 2 unread in Primary", "   张三 — 会议", "   Alice — Contract"]]);
eq("brief: mail unavailable", composeBrief(mem, rem, now, { mail: "unavailable" }).lines, ["✉ mail unavailable right now"]);
for (const m of Object.values(store)) m.labelIds = ["INBOX"];
eq("brief: no unread → nothing shown", (await briefGoogle(fakeAuth, now)).mail, { lines: [], count: 0 });
mem.close();
rem.close();
rmSync(dir, { recursive: true, force: true });

console.log(results.map(([n, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${n}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
