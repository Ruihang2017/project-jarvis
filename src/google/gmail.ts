/**
 * Gmail (N4a: reading). Personal Gmail only (D13). Nothing is cached locally; every call asks
 * Google. Scopes don't allow archiving, labelling or deleting mail (D23).
 */
import { toLocal } from "../reminders/schedule.js";
import { truncate } from "../util.js";
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

export interface Message extends MessageSummary {
  cc: string;
  replyTo?: string;
  messageId?: string;
  references?: string;
  body: string;
  attachments: Attachment[];
}

export const header = (headers: Header[] | undefined, name: string) => headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/** RFC 2047 encoded-words ("=?UTF-8?B?…?="), in case Gmail passes a header through undecoded. */
export function decodeWords(s: string): string {
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

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

/** Readable text from an HTML email: drops styles/scripts, keeps line structure and link targets. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(head|style|script|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<a\b[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => {
      const t = text.replace(/<[^>]+>/g, "").trim();
      return t && !href.includes(t) ? `${t} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|table|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Body text (prefers text/plain, falls back to HTML) and attachment list from a MIME tree. */
export function extractContent(payload: Part | undefined): { body: string; attachments: Attachment[] } {
  const plain: string[] = [];
  const html: string[] = [];
  const attachments: Attachment[] = [];
  const walk = (p: Part) => {
    const type = (p.mimeType ?? "").toLowerCase();
    if (p.filename) {
      attachments.push({ filename: p.filename, size: p.body?.size ?? 0, mimeType: type });
      return;
    }
    if (type === "text/plain") plain.push(decodeData(p));
    else if (type === "text/html") html.push(decodeData(p));
    for (const c of p.parts ?? []) walk(c);
  };
  if (payload) walk(payload);
  const body = plain.join("\n").trim() ? plain.join("\n").replace(/\r\n/g, "\n").trim() : htmlToText(html.join("\n"));
  return { body, attachments };
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
    snippet: htmlToText(m.snippet ?? ""),
    unread: m.labelIds?.includes("UNREAD") ?? false,
  };
}

export function toMessage(m: ApiMessage): Message {
  const h = m.payload?.headers;
  const { body, attachments } = extractContent(m.payload);
  return {
    ...toSummary(m),
    cc: decodeWords(header(h, "Cc")),
    replyTo: decodeWords(header(h, "Reply-To")) || undefined,
    messageId: header(h, "Message-ID") || header(h, "Message-Id") || undefined,
    references: header(h, "References") || undefined,
    body,
    attachments,
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

export class GmailClient {
  constructor(private readonly auth: GoogleAuth) {}

  ensureAccess() {
    const s = this.auth.state();
    if (!s) throw new GoogleAuthError("not_connected", "Google isn't connected — run /connect google");
    if (s.invalidAt) throw new GoogleAuthError("invalid_grant", "the Google connection expired — run /connect google");
    if (!hasGmailAccess(s.scopes)) throw new GoogleAuthError("no_scope", "Gmail access hasn't been granted yet — run /connect google to add it");
  }

  /** Gmail search syntax (from:, newer_than:7d, is:unread, has:attachment …); newest first. */
  async search(query: string, max = 10): Promise<MessageSummary[]> {
    this.ensureAccess();
    const q = new URLSearchParams({ q: query, maxResults: String(Math.min(Math.max(1, max), 20)) });
    const list = await this.auth.api<{ messages?: { id: string }[] }>(`${API}/messages?${q}`);
    const meta = new URLSearchParams({ format: "metadata" });
    for (const h of ["From", "To", "Subject", "Date"]) meta.append("metadataHeaders", h);
    const msgs = await Promise.all((list.messages ?? []).map((m) => this.auth.api<ApiMessage>(`${API}/messages/${encodeURIComponent(m.id)}?${meta}`)));
    return msgs.map(toSummary).sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  async message(id: string): Promise<Message> {
    this.ensureAccess();
    return toMessage(await this.auth.api<ApiMessage>(`${API}/messages/${encodeURIComponent(id)}?format=full`));
  }

  async thread(threadId: string): Promise<Message[]> {
    this.ensureAccess();
    const t = await this.auth.api<{ messages?: ApiMessage[] }>(`${API}/threads/${encodeURIComponent(threadId)}?format=full`);
    return (t.messages ?? []).map(toMessage);
  }
}

/** Unread mail in Primary from the last day, for /mail and the brief. */
export const UNREAD_QUERY = "is:unread category:primary newer_than:1d";
