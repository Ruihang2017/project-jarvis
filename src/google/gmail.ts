/**
 * Gmail (N4a: reading). Personal Gmail only (D13). Nothing is written to disk: messages read in the
 * last few minutes are remembered in memory only, so the same email isn't fetched again and again
 * (Gmail allows about 300 reads a minute). Scopes don't allow archiving, labelling or deleting mail (D23).
 */
import { toLocal } from "../reminders/schedule.js";
import { stripControl, truncate } from "../util.js";
import { GoogleAuthError, type GoogleAuth } from "./auth.js";
import { dayLabel, localDate } from "./calendar.js";

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"];
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export const hasGmailAccess = (scopes: string[] | undefined) => GMAIL_SCOPES.every((s) => scopes?.includes(s));

/** Limit on body text handed to the model per gmail_read call. */
export const BODY_LIMIT = 8000;

interface Header {
  name: string;
  value: string;
}

export interface Part {
  mimeType?: string;
  filename?: string;
  headers?: Header[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: Part[];
}

export interface ApiMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: Part;
}

export interface MessageSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: Date;
  snippet: string;
  unread: boolean;
}

export interface Attachment {
  filename: string;
  size: number;
  mimeType: string;
}

/** A picture the HTML refers to as cid:… (a logo in the email itself, not loaded from the web). */
export interface InlineImage {
  cid: string;
  mimeType: string;
  /** base64url, when Gmail sent it with the message; otherwise fetch it with attachmentId. */
  data?: string;
  attachmentId?: string;
}

export interface Message extends MessageSummary {
  cc: string;
  replyTo?: string;
  messageId?: string;
  references?: string;
  body: string;
  attachments: Attachment[];
  /** The email's own HTML, for the desktop app's original view only; never sent to the model. */
  html?: string;
  inline: InlineImage[];
}

export const header = (headers: Header[] | undefined, name: string) => headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/** RFC 2047 encoded-words ("=?UTF-8?B?…?="), in case Gmail passes a header through undecoded. */
export function decodeWords(s: string): string {
  return stripControl(decodeWordsRaw(s));
}

function decodeWordsRaw(s: string): string {
  return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=(\s+(?==\?))?/g, (_, charset: string, enc: string, text: string) => {
    try {
      const bytes =
        enc.toUpperCase() === "B"
          ? Buffer.from(text, "base64")
          : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1");
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return text;
    }
  });
}

function charsetOf(part: Part): string {
  return /charset="?([^";\s]+)"?/i.exec(header(part.headers, "Content-Type"))?.[1] ?? "utf-8";
}

function decodeData(part: Part): string {
  const data = part.body?.data;
  if (!data) return "";
  const bytes = Buffer.from(data, "base64url");
  try {
    return new TextDecoder(charsetOf(part)).decode(bytes);
  } catch {
    return bytes.toString("utf8"); // unknown charset label
  }
}

const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'",
  ensp: " ", emsp: " ", thinsp: " ", hellip: "…", mdash: "—", ndash: "–", bull: "•", middot: "·",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", copy: "©", reg: "®", trade: "™",
  rarr: "→", larr: "←", uarr: "↑", darr: "↓", times: "×", divide: "÷", deg: "°", plusmn: "±",
  euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶", frac12: "½", frac14: "¼", frac34: "¾",
  zwnj: "", zwj: "", shy: "", lrm: "", rlm: "",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  }).replace(/&nbsp(?![\w;])/gi, " "); // browsers accept it without the semicolon, and so does mail
}

// Zero-width and other invisible characters; marketing mail pads its preview line with them.
const INVISIBLE = /[­͏ᅟᅠ឴឵᠎​-‏⁠-⁤﻿ㅤﾠ]/g;

/** Drops invisible padding, trims each line and keeps at most one blank line in a row. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A text/plain part that is really HTML (some senders put the same markup in both parts). */
const isMarkup = (plain: string) => /<(?:!doctype|html|body)\b/i.test(plain.slice(0, 3000));

/**
 * A text/plain part some mailing tools generate from their HTML: it starts with the CSS rules, still
 * has HTML entities or schema.org data in it, or is the HTML itself. The HTML part reads better then.
 */
export function looksGenerated(plain: string): boolean {
  return (
    /^\s*[^{}\n]{1,200}\{[^{}]*:[^{}]*\}/.test(plain) ||
    /&(?:nbsp|zwnj|amp|quot|#\d+);/i.test(plain) ||
    /"@context"\s*:\s*"https?:\/\/schema\.org/.test(plain) ||
    isMarkup(plain)
  );
}

/** Readable text from an HTML email: drops styles/scripts, keeps line structure and link targets. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(head|style|script|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<a\b[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => {
      const t = text.replace(/<[^>]+>/g, "").trim();
      return t && !href.includes(t) ? `${t} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|table|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "");
  return tidy(decodeEntities(text));
}

/** Body text (prefers text/plain unless it looks generated, falls back to HTML) and attachments from a MIME tree. */
export function extractContent(payload: Part | undefined): { body: string; attachments: Attachment[]; html?: string; inline: InlineImage[] } {
  const plain: string[] = [];
  const html: string[] = [];
  const attachments: Attachment[] = [];
  const inline: InlineImage[] = [];
  const walk = (p: Part) => {
    const type = (p.mimeType ?? "").toLowerCase();
    const cid = header(p.headers, "Content-ID").replace(/^\s*<|>\s*$/g, "").trim();
    if (cid && type.startsWith("image/")) inline.push({ cid, mimeType: type, data: p.body?.data, attachmentId: p.body?.attachmentId });
    if (p.filename) {
      attachments.push({ filename: stripControl(p.filename), size: p.body?.size ?? 0, mimeType: type });
      return;
    }
    if (type === "text/plain") plain.push(decodeData(p));
    else if (type === "text/html") html.push(decodeData(p));
    for (const c of p.parts ?? []) walk(c);
  };
  if (payload) walk(payload);
  const text = plain.join("\n");
  const useHtml = html.length > 0 && (!text.trim() || looksGenerated(text));
  const body = useHtml ? htmlToText(html.join("\n")) : isMarkup(text) ? htmlToText(text) : tidy(looksGenerated(text) ? decodeEntities(text) : text);
  const markup = html.length ? html.join("\n") : isMarkup(text) ? text : undefined;
  return { body: stripControl(body), attachments, html: markup, inline };
}

/** Drops quoted history ("> …" lines and everything after "On … wrote:"), for thread views. */
export function stripQuoted(body: string): string {
  const cut = body.search(/^(On .{5,200} wrote:|在 .{2,200}写道[:：]|-----Original Message-----|From: .+\nSent: )/m);
  return (cut > 0 ? body.slice(0, cut) : body)
    .split("\n")
    .filter((l) => !l.startsWith(">"))
    .join("\n")
    .trim();
}

export function toSummary(m: ApiMessage): MessageSummary {
  const h = m.payload?.headers;
  return {
    id: m.id,
    threadId: m.threadId,
    from: decodeWords(header(h, "From")),
    to: decodeWords(header(h, "To")),
    subject: decodeWords(header(h, "Subject")) || "(no subject)",
    date: m.internalDate ? new Date(Number(m.internalDate)) : new Date(header(h, "Date")),
    snippet: stripControl(htmlToText(m.snippet ?? "")),
    unread: m.labelIds?.includes("UNREAD") ?? false,
  };
}

export function toMessage(m: ApiMessage): Message {
  const h = m.payload?.headers;
  const { body, attachments, html, inline } = extractContent(m.payload);
  return {
    ...toSummary(m),
    cc: decodeWords(header(h, "Cc")),
    replyTo: decodeWords(header(h, "Reply-To")) || undefined,
    messageId: header(h, "Message-ID") || header(h, "Message-Id") || undefined,
    references: header(h, "References") || undefined,
    body,
    attachments,
    html,
    inline,
  };
}

/** "Alice Smith" from "Alice Smith <alice@x.com>"; the address when there's no name. */
export function displayName(from: string): string {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(from);
  return m ? m[1]!.trim() || m[2]! : from.trim();
}

/** "09:30" today, "Wed 09-30" this week, "2026-09-12" older. */
export function shortDate(d: Date, now = new Date()): string {
  const day = localDate(d);
  if (day === localDate(now)) return toLocal(d).slice(11);
  if (now.getTime() - d.getTime() < 6 * 86_400_000) return dayLabel(day);
  return day;
}

export function summaryLine(m: MessageSummary, now = new Date()): string {
  return `${m.unread ? "● " : ""}${truncate(displayName(m.from), 30)} — ${truncate(m.subject, 80)} · ${shortDate(m.date, now)}`;
}

/** Gmail requests one account has in flight at once; a page of mail would otherwise ask for 50 together. */
export const MAX_PARALLEL = 5;
/** How long a message read from Gmail is remembered, and how many per account. In memory only. */
export const REMEMBER_MS = 5 * 60_000;
const REMEMBER_MAX = 200;

interface Remembered {
  at: number;
  /** Fetched with format=full: good for a summary too. */
  full: boolean;
  msg: Promise<ApiMessage>;
}

/** What every GmailClient and GmailWriter of one account shares; gone when the account's sign-in object is. */
interface Shared {
  active: number;
  waiting: (() => void)[];
  remembered: Map<string, Remembered>;
}

const shared = new WeakMap<GoogleAuth, Shared>();

function sharedFor(auth: GoogleAuth): Shared {
  let s = shared.get(auth);
  if (!s) shared.set(auth, (s = { active: 0, waiting: [], remembered: new Map() }));
  return s;
}

/** A Gmail request, when one of the account's MAX_PARALLEL places is free. */
async function call<T>(auth: GoogleAuth, url: string, init?: RequestInit): Promise<T> {
  const s = sharedFor(auth);
  if (s.active >= MAX_PARALLEL) await new Promise<void>((r) => s.waiting.push(r));
  else s.active++;
  try {
    return await auth.api<T>(url, init);
  } finally {
    // The place goes straight to whoever waited longest.
    const next = s.waiting.shift();
    if (next) next();
    else s.active--;
  }
}

const METADATA = (() => {
  const q = new URLSearchParams({ format: "metadata" });
  for (const h of ["From", "To", "Subject", "Date"]) q.append("metadataHeaders", h);
  return q.toString();
})();

export class GmailClient {
  constructor(
    private readonly auth: GoogleAuth,
    private readonly now: () => number = Date.now,
  ) {}

  ensureAccess() {
    const s = this.auth.state();
    if (!s) throw new GoogleAuthError("not_connected", "Google isn't connected — run /connect google");
    if (s.invalidAt) throw new GoogleAuthError("invalid_grant", "the Google connection expired — run /connect google");
    if (!hasGmailAccess(s.scopes)) throw new GoogleAuthError("no_scope", "Gmail access hasn't been granted yet — run /connect google to add it");
  }

  /**
   * One message as Gmail gives it, from memory when it was read in the last few minutes (a full one
   * also serves when only the headers are wanted). Two callers asking at once share one request.
   */
  private raw(id: string, full: boolean): Promise<ApiMessage> {
    const { remembered } = sharedFor(this.auth);
    const at = this.now();
    const had = remembered.get(id);
    if (had && at - had.at < REMEMBER_MS && (had.full || !full)) return had.msg;
    const msg = call<ApiMessage>(this.auth, `${API}/messages/${encodeURIComponent(id)}?${full ? "format=full" : METADATA}`);
    this.remember(id, { at, full, msg });
    return msg;
  }

  private remember(id: string, entry: Remembered) {
    const { remembered } = sharedFor(this.auth);
    remembered.delete(id); // newest last
    remembered.set(id, entry);
    while (remembered.size > REMEMBER_MAX) remembered.delete(remembered.keys().next().value!);
    // A failed read isn't remembered.
    entry.msg.catch(() => {
      if (remembered.get(id) === entry) remembered.delete(id);
    });
  }

  private async summaries(ids: string[]): Promise<MessageSummary[]> {
    const msgs = await Promise.all(ids.map((id) => this.raw(id, false)));
    return msgs.map(toSummary).sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  /** Ids of one page of a query, newest first (up to 100), with the token for the next page (none on the last). */
  async list(query: string, max = 50, pageToken?: string): Promise<{ ids: string[]; next?: string }> {
    this.ensureAccess();
    const q = new URLSearchParams({ q: query, maxResults: String(Math.min(Math.max(1, max), 100)) });
    if (pageToken) q.set("pageToken", pageToken);
    const list = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(this.auth, `${API}/messages?${q}`);
    return { ids: (list.messages ?? []).map((m) => m.id), next: list.nextPageToken || undefined };
  }

  /** Gmail search syntax (from:, newer_than:7d, is:unread, has:attachment …); newest first. */
  async search(query: string, max = 10): Promise<MessageSummary[]> {
    return this.summaries((await this.list(query, Math.min(max, 20))).ids);
  }

  /** One page of a query, newest first, with the token for the next page (none on the last). */
  async page(query: string, max = 25, pageToken?: string): Promise<{ messages: MessageSummary[]; next?: string }> {
    const list = await this.list(query, Math.min(max, 50), pageToken);
    return { messages: await this.summaries(list.ids), next: list.next };
  }

  /** Ids of messages matching a query, newest first (one page, up to 100). */
  async listIds(query: string, max = 50): Promise<string[]> {
    return (await this.list(query, max)).ids;
  }

  async message(id: string): Promise<Message> {
    this.ensureAccess();
    return toMessage(await this.raw(id, true));
  }

  /** An attachment's bytes (used for the pictures inside an email's HTML). */
  async attachment(messageId: string, attachmentId: string): Promise<Buffer> {
    this.ensureAccess();
    const a = await call<{ data?: string }>(this.auth, `${API}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
    return Buffer.from(a.data ?? "", "base64url");
  }

  async thread(threadId: string): Promise<Message[]> {
    this.ensureAccess();
    const t = await call<{ messages?: ApiMessage[] }>(this.auth, `${API}/threads/${encodeURIComponent(threadId)}?format=full`);
    const at = this.now();
    for (const m of t.messages ?? []) this.remember(m.id, { at, full: true, msg: Promise.resolve(m) });
    return (t.messages ?? []).map(toMessage);
  }
}

/** Unread mail in Primary from the last day, for /mail and the brief. */
export const UNREAD_QUERY = "is:unread category:primary newer_than:1d";

// --- composing (N4b) ---

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/** Bare address from "Name <a@b.c>" or "a@b.c" (lower-cased); null if it isn't one. */
export function addressOf(s: string): string | null {
  const m = /<([^>]+)>/.exec(s);
  const a = (m ? m[1]! : s).trim().toLowerCase();
  return EMAIL_RE.test(a) ? a : null;
}

/** Splits a header like 'A <a@x.com>, "B, C" <b@x.com>' into entries (commas inside quotes kept). */
export function splitAddresses(list: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = false;
  for (const ch of list) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "<") angle = true;
    else if (ch === ">") angle = false;
    if ((ch === "," || ch === ";") && !quoted && !angle) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const nonAscii = (s: string) => /[^\x20-\x7e]/.test(s);

/** RFC 2047 B-encoding in ≤75-char words, never splitting a character across words. */
export function encodeWord(s: string): string {
  if (!nonAscii(s)) return s;
  const words: string[] = [];
  let chunk = "";
  for (const ch of s) {
    if (Buffer.byteLength(chunk + ch) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`).join(" ");
}

/** An address header entry with a non-ASCII display name encoded. */
function encodeAddress(entry: string): string {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(entry);
  if (!m || !m[1]) return entry.trim();
  const name = nonAscii(m[1]) ? encodeWord(m[1]) : /[(),.:;<>@[\]\\"]/.test(m[1]) ? `"${m[1].replace(/"/g, "")}"` : m[1];
  return `${name} <${m[2]}>`;
}

export interface Outgoing {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}

/** Plain-text UTF-8 RFC 2822 message, base64url as Gmail's `raw` wants. From is filled in by Gmail. */
export function buildRaw(m: Outgoing): string {
  const lines = [
    `To: ${m.to.map(encodeAddress).join(", ")}`,
    ...(m.cc.length ? [`Cc: ${m.cc.map(encodeAddress).join(", ")}`] : []),
    `Subject: ${encodeWord(m.subject)}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(m.references ? [`References: ${m.references}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    (Buffer.from(m.body.replace(/\r?\n/g, "\r\n")).toString("base64").match(/.{1,76}/g) ?? [""]).join("\r\n"),
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

/** "Re: subject" without stacking prefixes. */
export const replySubject = (s: string) => (/^(re|回复|答复)\s*[:：]/i.test(s.trim()) ? s.trim() : `Re: ${s.trim()}`);

/**
 * Recipients for a reply: Reply-To or From; with `all`, plus the original To and Cc. The user's own
 * address and duplicates are dropped.
 */
export function replyRecipients(orig: Message, self: string | undefined, all: boolean): { to: string[]; cc: string[] } {
  const me = self?.toLowerCase();
  const seen = new Set<string>();
  const keep = (list: string[]) =>
    list.filter((e) => {
      const a = addressOf(e);
      if (!a || a === me || seen.has(a)) return false;
      seen.add(a);
      return true;
    });
  let to = keep(splitAddresses(orig.replyTo || orig.from));
  if (!to.length) to = keep(splitAddresses(orig.to)); // replying to a message the user sent
  const cc = all ? keep([...splitAddresses(orig.to), ...splitAddresses(orig.cc)]) : [];
  return { to, cc };
}

export class GmailWriter {
  constructor(private readonly auth: GoogleAuth) {}

  async createDraft(raw: string, threadId?: string): Promise<{ id: string }> {
    return call<{ id: string }>(this.auth, `${API}/drafts`, { method: "POST", body: JSON.stringify({ message: { raw, ...(threadId ? { threadId } : {}) } }) });
  }

  async updateDraft(id: string, raw: string, threadId?: string): Promise<{ id: string }> {
    return call<{ id: string }>(this.auth, `${API}/drafts/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ id, message: { raw, ...(threadId ? { threadId } : {}) } }),
    });
  }

  /** The draft as it is now in Gmail (the user may have edited it there). null if it's gone. */
  async getDraft(id: string): Promise<Message | null> {
    try {
      const d = await call<{ id: string; message: ApiMessage }>(this.auth, `${API}/drafts/${encodeURIComponent(id)}?format=full`);
      return toMessage(d.message);
    } catch (e) {
      if (e instanceof GoogleAuthError && e.code === "http_404") return null;
      throw e;
    }
  }

  async sendDraft(id: string): Promise<{ id: string; threadId: string }> {
    return call<{ id: string; threadId: string }>(this.auth, `${API}/drafts/send`, { method: "POST", body: JSON.stringify({ id }) });
  }

  /** Whether the user has emailed this address before (for the first-time warning). */
  async emailedBefore(address: string): Promise<boolean> {
    const q = new URLSearchParams({ q: `in:sent to:${address}`, maxResults: "1" });
    const res = await call<{ messages?: unknown[] }>(this.auth, `${API}/messages?${q}`);
    return Boolean(res.messages?.length);
  }
}
