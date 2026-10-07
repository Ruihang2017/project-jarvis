process.env.TZ = "Australia/Sydney";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "edward-gmail-test-"));
process.env.JARVIS_DATA_DIR = dir;

const g = await import("../src/google/gmail.js");
const { GMAIL_TOOLS, clip, formatThread } = await import("../src/google/gmail-tools.js");
const { googleInstructions, missingFeatures, ALL_SCOPES, CALENDAR_SCOPES, GMAIL_SCOPES } = await import("../src/google/instructions.js");
const { briefGoogle, composeBrief } = await import("../src/background/brief.js");
const { fakeAccounts } = await import("./fake-accounts.js");
/** The model instructions for one account in this state (null: nothing connected). */
const instructionsFor = (st: unknown) => googleInstructions(st ? fakeAccounts([{ auth: { state: () => st } as never, email: (st as { email?: string }).email }]) : fakeAccounts([]));
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
// Marketing mail whose text/plain was generated from the HTML: CSS first, entities left in, hundreds
// of blank lines (seen 2026-10-03; the page showed only the CSS).
const generated = ` td, p, a, span { font-family: Helvetica, sans-serif !important; } a {text-decoration: none;}\n${"\n".repeat(300)}See the latest&nbsp;&zwnj;&nbsp;&zwnj; results`;
const marketing: Part = {
  mimeType: "multipart/alternative",
  parts: [
    part("text/plain", generated),
    part("text/html", `<!--[if mso]><style>td, p { font-family: Helvetica; }</style><![endif]--><style type="text/css">a{x:y}</style ><div>See the latest&nbsp;&zwnj;&nbsp;&zwnj;&#8203; results</div><p>Springfield&nbsp;&mdash; 3 sold</p>`),
  ],
};
ok("generated plain part detected", g.looksGenerated(generated));
ok("…or one holding schema.org data", g.looksGenerated('carsales\n\n[{\n"@context": "http://schema.org/",\n"@type": "Organization"}]'));
eq("&nbsp without a semicolon, LRM/RLM padding", g.htmlToText("<p>Area.&nbsp</p><p>Trending ‎‏ ‎‏ posts</p><p>Saved cars &rarr; &euro;5</p>"), "Area.\nTrending posts\nSaved cars → €5");
eq("plain part that is HTML, no HTML part: converted", g.extractContent(part("text/plain", "\r\n\r\n<!DOCTYPE html><html><head><style>a{color:#999}</style></head><body><p>Hi Ruby,</p><p>Inspection Saturday</p></body></html>")).body, "Hi Ruby,\nInspection Saturday");
ok("an ordinary plain part isn't", !g.looksGenerated("Hi Sam,\nThe meeting {room 4} is at 3pm.\nThanks"));
eq("generated plain part: the HTML is used instead", g.extractContent(marketing).body, "See the latest results\nSpringfield — 3 sold");
eq("blank lines in plain text collapse", g.extractContent(part("text/plain", "Hi\n\n\n\n\nBye")).body, "Hi\n\nBye");
eq("generated plain part without HTML: entities decoded", g.extractContent(part("text/plain", "Total&nbsp;$5 &amp; tax")).body, "Total $5 & tax");
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
  if (u.pathname.endsWith("/drafts") && method === "GET") return { drafts: [...gDrafts.keys()].map((id) => ({ id })) };
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
const accounts = fakeAccounts([{ auth: fakeAuth, email: "me@gmail.com" }]);
const ctx = { accounts } as never;
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
ok("draft result says NOT sent + handle", d1.startsWith("Draft [d1] saved in the Gmail drafts of me@gmail.com — NOT sent.") && d1.includes("From: me@gmail.com") && d1.includes("To: Alice <alice@x.com>") && d1.includes("gmail_send with draft d1"), d1);
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

await throws("send: only Edward drafts", () => tool("gmail_send").prepare({ draft: "d9" }, ctx), "only drafts Edward wrote");
const send1 = await tool("gmail_send").prepare({ draft: "d1" }, ctx);
eq("send preview", [send1.summary, send1.preview, send1.allowAlways], [
  "send email to Alice: Re: Contract",
  "From: me@gmail.com\n  To: Alice <alice@x.com>\n  Subject: Re: Contract\n  \n  Friday 3pm works for me.",
  false,
]);

const newMail = await (await tool("gmail_draft").prepare({ to: "New Person <new@x.com>", subject: "Hello", body: "Hi there" }, ctx)).execute();
const newRef = newMail.match(/\[(d\d+)\]/)![1]!;
// The user edits the draft in Gmail before sending.
const [newId, newDraft] = [...gDrafts.entries()].find(([, d]) => parseRaw(d.raw).body === "Hi there")!;
gDrafts.set(newId, { ...newDraft, raw: g.buildRaw({ to: ["New Person <new@x.com>"], cc: [], subject: "Hello", body: "Hi there — edited by me" }) });
const send2 = await tool("gmail_send").prepare({ draft: newRef }, ctx);
ok("send preview shows the Gmail version + edit note + first-time warning", send2.preview!.includes("(edited in Gmail since Edward drafted it)") && send2.preview!.includes("Hi there — edited by me") && send2.preview!.includes("⚠ first email to new@x.com"), send2.preview);

// A long draft can not hide text past the preview: the prompt says how much is not shown (P3).
const longDraft = await (await tool("gmail_draft").prepare({ to: "alice@x.com", subject: "Long", body: "A".repeat(1500) + "SECRET-TAIL" }, ctx)).execute();
const longSend = await tool("gmail_send").prepare({ draft: longDraft.match(/\[(d\d+)\]/)![1]! }, ctx);
ok("send preview warns about text beyond what it shows", longSend.preview!.includes("11 more characters are not shown here") && !longSend.preview!.includes("SECRET-TAIL"), longSend.preview!.slice(-140));

const { ToolRunner } = await import("../src/tools.js");
const runner = new ToolRunner(dir, {} as never, {} as never, accounts, {} as never);
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

// --- a draft is shown to the user: the card in the conversation, the lines in the terminal ---
const { parseDraftResult, draftHandle, draftChanged } = await import("../src/google/gmail-tools.js");
const { draftOf, activityNotes } = await import("../src/activity.js");
eq("a draft's result reads back as the draft", parseDraftResult(d1), { ref: "d1", from: "me@gmail.com", to: "Alice <alice@x.com>", cc: "", subject: "Re: Contract", body: "Friday works for me." });
const withCc = await (await tool("gmail_draft").prepare({ to: "Bo <bo@x.com>", cc: "cy@x.com", subject: "Plan", body: "Line one\n\nLine two\n\nTo send it, call me." }, ctx)).execute();
const card = parseDraftResult(withCc)!;
eq("…with Cc, and blank lines in the text kept", [card.cc, card.body], ["cy@x.com", "Line one\n\nLine two\n\nTo send it, call me."]);
eq("anything else isn't a draft", [parseDraftResult("Failed: no recipient"), parseDraftResult("")], [null, null]);
const toolItem = (text: string, good = true) => ({ type: "dynamicToolCall", id: "i", tool: "gmail_draft", arguments: { to: "Bo <bo@x.com>" }, status: good ? "completed" : "failed", success: good, contentItems: [{ type: "inputText", text }] }) as never;
eq("a finished gmail_draft call carries its draft", draftOf(toolItem(withCc))?.ref, card.ref);
eq("a failed one doesn't", draftOf(toolItem("Invalid call: no recipient", false)), null);
const shownLines = activityNotes(toolItem(withCc));
ok("the terminal prints the draft under its line", shownLines[0]!.includes("drafted email to Bo") && shownLines.includes("   To: Bo <bo@x.com>") && shownLines.includes("   Subject: Plan") && shownLines.includes("   Line two"), shownLines.join("|"));

const handle = draftHandle(card.ref)!;
ok("the card can find the draft in Gmail", handle.account === "g1" && gDrafts.has(handle.draftId), JSON.stringify(handle));
eq("no handle for a draft that isn't this session's", draftHandle("d99"), undefined);
// The user changes it in the app: the next revision starts from what they have.
draftChanged(handle.draftId, { to: ["Bo <bo@x.com>"], cc: [], subject: "Plan B", body: "Mine now" });
const revised = parseDraftResult(await (await tool("gmail_draft").prepare({ draft: card.ref, body: "Shorter" }, ctx)).execute())!;
eq("a revision after the user's change keeps their subject and recipients", [revised.subject, revised.cc, revised.body], ["Plan B", "", "Shorter"]);

// --- Gmail's Drafts, for the Mail page ---
const draftsWriter = new g.GmailWriter(fakeAuth);
const listed = await draftsWriter.listDrafts();
ok("Gmail's drafts, as they are now", listed.length === gDrafts.size && listed.some((x) => x.draftId === handle.draftId && x.message.body === "Shorter" && x.message.subject === "Plan B"), JSON.stringify(listed.map((x) => [x.draftId, x.message.subject])));
ok("Edward's drafts are plain text, so the app can change them", listed.every((x) => g.isPlainText(x.message)));
eq("a message with formatting or an attachment is left to Gmail", g.isPlainText(g.toMessage(store.a1 as never)), false);
await (await tool("gmail_draft").prepare({ reply_to: "m2", body: "Yes." }, ctx)).execute();
eq("a reply draft knows what it answers", (await draftsWriter.listDrafts()).find((x) => x.message.body === "Yes.")?.message.inReplyTo, "<a1@mail>");

// The user sends it from the app: it isn't the model's to send any more.
draftChanged(handle.draftId, null);
await throws("a draft the user sent can't be sent by the model", () => tool("gmail_send").prepare({ draft: card.ref }, ctx), "only drafts Edward wrote");

// --- a background helper only reaches the tools it was given ---
const draftCall = (threadId: string) => ({ threadId, turnId: "u", callId: "c", tool: "gmail_draft", arguments: { to: "a@x.com", subject: "s", body: "b" } }) as never;
runner.limit("helper", ["gmail_search", "gmail_read"]);
const before = gDrafts.size;
const fenced = await runner.call(draftCall("helper"), answer("accept"));
ok("a tool it wasn't given is refused, and nothing happens", fenced.success === false && JSON.stringify(fenced).includes("isn't available here") && gDrafts.size === before, JSON.stringify(fenced));
ok("…a tool it was given works", (await runner.call({ threadId: "helper", turnId: "u", callId: "c", tool: "gmail_search", arguments: { query: "is:unread" } } as never, answer("accept"))).success === true);
const elsewhere = await runner.call(draftCall("t"), answer("accept"));
ok("…and other conversations are not affected", elsewhere.success === true, JSON.stringify(elsewhere).slice(0, 200));
runner.limit("none", []);
ok("a helper with no tools reaches none", (await runner.call({ threadId: "none", turnId: "u", callId: "c", tool: "gmail_search", arguments: { query: "x" } } as never, answer("accept"))).success === false);
runner.unlimit("helper");
ok("when the helper is done its thread is ordinary again", (await runner.call(draftCall("helper"), answer("accept"))).success === true);

// --- instructions & notices ---
ok("instructions: a draft is shown by Edward, not read in Gmail", instructionsFor(state(GMAIL_SCOPES)).includes("Edward shows the user every draft itself") && !instructionsFor(state(GMAIL_SCOPES)).includes("tell them it's in Gmail drafts"));
ok("instructions: Gmail granted", instructionsFor(state([...CALENDAR_SCOPES, ...GMAIL_SCOPES])).includes("gmail_search"));
ok("instructions: draft then send, can't delete", /gmail_draft[\s\S]*gmail_send[\s\S]*can't archive, label, mark read or delete/.test(instructionsFor(state(GMAIL_SCOPES))));
ok("instructions: Gmail not granted", instructionsFor(state(CALENDAR_SCOPES)).includes("Gmail access hasn't been granted"));
eq("missing features", [missingFeatures(null), missingFeatures(state([])), missingFeatures(state(CALENDAR_SCOPES)), missingFeatures(state([...CALENDAR_SCOPES, ...GMAIL_SCOPES])), missingFeatures(state(ALL_SCOPES))], [[], ["calendar", "Gmail", "lists"], ["Gmail", "lists"], ["lists"], []]);

// --- brief ---
current = state(GMAIL_SCOPES);
const bg = await briefGoogle(accounts, now);
eq("brief: no calendar section without calendar access", bg.calendar, undefined);
eq("brief: unread mail section (counts as one thing)", bg.mail, { lines: ["✉ 2 unread in Primary", "   张三 — 会议", "   Alice — Contract"], count: 1 });
const mem = new MemoryStore(join(dir, "memory.db"));
const rem = new ReminderStore(join(dir, "memory.db"));
const brief = composeBrief(mem, rem, now, bg);
eq("brief counts unread mail once", [brief.count, brief.lines], [1, ["✉ 2 unread in Primary", "   张三 — 会议", "   Alice — Contract"]]);
eq("brief: mail unavailable", composeBrief(mem, rem, now, { mail: "unavailable" }).lines, ["✉ mail unavailable right now"]);
for (const m of Object.values(store)) m.labelIds = ["INBOX"];
eq("brief: no unread → nothing shown", (await briefGoogle(accounts, now)).mail, { lines: [], count: 0 });
mem.close();
rem.close();

// --- pacing: a few requests at a time per account, and an email read once (Gmail counts per minute) ---
let inFlight = 0;
let peak = 0;
let failing = false;
const asked: string[] = [];
const idOf = (url: string) => decodeURIComponent(new URL(url).pathname.split("/").pop()!);
/** How one email was asked for since `asked` was emptied. */
const reads = (id: string) => asked.filter((u) => new URL(u).pathname.endsWith(`/messages/${id}`)).map((u) => (u.includes("format=full") ? "full" : "metadata"));
const slowAuth = {
  state: () => state(GMAIL_SCOPES),
  api: async (url: string) => {
    asked.push(url);
    peak = Math.max(peak, ++inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight--;
    const u = new URL(url);
    if (u.pathname.endsWith("/messages")) return { messages: Array.from({ length: Number(u.searchParams.get("maxResults")) }, (_, i) => ({ id: `m${i + 1}` })) };
    if (u.pathname.includes("/threads/")) return { messages: [msg("t1", { from: "A <a@x.com>", subject: "Thread", date: now })] };
    if (failing) throw new GoogleAuthError("rate_limited", "Google's per-minute limit for this account was reached; try again in a minute");
    return msg(idOf(url), { from: "A <a@x.com>", subject: `Mail ${idOf(url)}`, date: now });
  },
} as unknown as GoogleAuth;
let clock = 1_000_000;
const paced = new g.GmailClient(slowAuth, () => clock);
const firstPage = await paced.page("in:inbox", 50);
eq("a page of 50: every email read", [firstPage.messages.length, asked.length], [50, 51]);
eq(`never more than ${g.MAX_PARALLEL} requests at once`, peak, g.MAX_PARALLEL);

// Another client for the same account shares the places and what was read.
asked.length = 0;
const other = new g.GmailClient(slowAuth, () => clock);
await Promise.all([other.search("in:inbox", 20), paced.page("in:inbox", 50)]);
eq("the same emails again: only the two lists are asked", asked.length, 2);
const full = await Promise.all([other.message("m1"), paced.message("m1")]);
eq("the full email: one request for two readers", [reads("m1"), full[0]!.body, full[1]!.body], [["full"], "Body of m1", "Body of m1"]);
asked.length = 0;
eq("a full email serves a summary too", [(await paced.search("in:inbox", 1))[0]!.subject, reads("m1")], ["Mail m1", []]);
await other.thread("T9");
asked.length = 0;
eq("emails that came with a thread aren't read again", [(await paced.message("t1")).subject, asked.length], ["Thread", 0]);

clock += g.REMEMBER_MS - 1;
await paced.message("m1");
eq("still remembered just before five minutes", asked.length, 0);
clock += 1;
await paced.message("m1");
eq("read again after five minutes", reads("m1"), ["full"]);

failing = true;
await throws("a failed read is passed on", () => paced.message("m60"), "per-minute limit");
failing = false;
asked.length = 0;
eq("…and not remembered", [(await paced.message("m60")).subject, reads("m60")], ["Mail m60", ["full"]]);

// Another account has its own places and its own memory.
asked.length = 0;
peak = 0;
const second = { ...slowAuth } as unknown as GoogleAuth;
await Promise.all([new g.GmailClient(second, () => clock).page("in:inbox", 10), paced.page("in:inbox", 10)]);
eq("two accounts: each its own five", [peak > g.MAX_PARALLEL, peak <= g.MAX_PARALLEL * 2], [true, true]);
eq("…and its own memory (m1 is still remembered for the first)", [reads("m1"), reads("m2")], [["metadata"], ["metadata", "metadata"]]);

// Writing waits for a place too.
peak = 0;
const writer = new g.GmailWriter(slowAuth);
await Promise.all(Array.from({ length: 12 }, (_, i) => writer.emailedBefore(`p${i}@x.com`)));
eq("drafts and checks share the limit", peak, g.MAX_PARALLEL);

rmSync(dir, { recursive: true, force: true });

console.log(results.map(([n, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${n}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
