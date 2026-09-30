/**
 * Automatic learning (R2): after a conversation, a background turn reads what's new in it and
 * proposes memory operations plus a short summary. Jarvis validates and applies them.
 */
import type { Session } from "../session.js";
import type { Thread, Turn } from "../protocol/v2/index.js";
import { loadSettings } from "../settings.js";
import { truncate } from "../util.js";
import { ASK_FIRST, secretReason } from "./guard.js";
import { KINDS, SHORT_TERM_DAYS, today, type Kind, type Memory, type MemoryStore, type Sensitivity, type Tier } from "./store.js";

const MAX_TRANSCRIPT_CHARS = 12_000;
const MAX_EXISTING = 200;
/** At startup, only catch up on conversations touched within this many days. */
const CATCH_UP_DAYS = 7;
const CATCH_UP_LIMIT = 5;

interface Op {
  op: "add" | "supersede" | "update" | "expire" | "mention";
  id: number | null;
  kind: Kind | null;
  tier: Tier | null;
  text: string | null;
  valid_until: string | null;
  keywords: string[] | null;
  importance: number | null;
  sensitivity: Sensitivity;
}

interface Extraction {
  ops: Op[];
  summary: { title: string; summary: string } | null;
}

const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });

/** Strict structured-output schema: every property required, optional ones nullable. */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ops", "summary"],
  properties: {
    ops: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["op", "id", "kind", "tier", "text", "valid_until", "keywords", "importance", "sensitivity"],
        properties: {
          op: { type: "string", enum: ["add", "supersede", "update", "expire", "mention"] },
          id: nullable({ type: "integer" }),
          kind: nullable({ type: "string", enum: [...KINDS] }),
          tier: nullable({ type: "string", enum: ["short", "long"] }),
          text: nullable({ type: "string" }),
          valid_until: nullable({ type: "string" }),
          keywords: nullable({ type: "array", items: { type: "string" } }),
          importance: nullable({ type: "integer" }),
          sensitivity: { type: "string", enum: ["none", "health", "finance", "work_confidential", "secret"] },
        },
      },
    },
    summary: nullable({
      type: "object",
      additionalProperties: false,
      required: ["title", "summary"],
      properties: { title: { type: "string" }, summary: { type: "string" } },
    }),
  },
};

const instructions = () => `You maintain the long-term memory of a personal assistant (Jarvis) about its user.
You get the new part of a conversation and the current memories. Output JSON operations. Today is ${today()}.

What to remember: durable, useful things about the user — who they are, preferences (incl. how they want Jarvis to answer), people in their life, plans and commitments, ongoing situations.
Skip: small talk, general-knowledge questions, one-off tasks with no future relevance, anything only the assistant said, anything already saved during the conversation (it is in the current memories).

Operations:
- add: a new fact. One fact per op.
- supersede (id = existing memory): the fact changed. text restates the full current fact, keeping whatever in the old memory is still true.
- update (id): same fact, refined — e.g. new date, more detail. Give the full new text.
- expire (id): no longer true or relevant (task done, plan cancelled).
- mention (id): an existing memory came up again with nothing new. Use this instead of re-adding.
For expire/mention only id and sensitivity matter; set the rest to null.

Fields:
- tier: "short" for situational or time-bound things (set valid_until YYYY-MM-DD if a date is known, else null = ${SHORT_TERM_DAYS} days); "long" for stable facts and preferences.
- text: plain statement in the user's language, no "用户"/"the user"; convert relative times to absolute dates.
- keywords: 3–8 search keywords with synonyms, in BOTH Chinese and English.
- importance: 1–5.
- sensitivity: "none" for ordinary personal facts (home, employer, job, family, schedules, everyday admin like expenses); "health"; "finance" (income, debts, balances, investments); "work_confidential" (client names, contract amounts, unannounced projects — not the user's own employer); "secret" (passwords, PINs, keys, card numbers — never include their value).

summary: title (≤ 12 words) and 1–3 sentences on what was discussed or decided, in the user's language; null if the conversation was trivial.
If nothing is worth remembering, return ops: [].`;

export interface LearnResult {
  threadId: string;
  lines: string[];
}

export class MemoryLearner {
  private running = new Set<string>();

  constructor(private readonly session: Session) {}

  private get store(): MemoryStore {
    return this.session.memory;
  }

  enabled(): boolean {
    return loadSettings().memoryLearning !== false;
  }

  /** Learns from whatever is new in a thread since the last run. Returns notice lines. */
  async learnFromThread(threadId: string): Promise<LearnResult | null> {
    if (!this.enabled() || this.running.has(threadId)) return null;
    this.running.add(threadId);
    try {
      const key = `learned:${threadId}`;
      const since = Number(this.store.getMeta(key) ?? 0);
      const turns = (await this.session.readTurns(threadId)).filter((t) => t.status === "completed" && (t.completedAt ?? 0) > since);
      if (!turns.length) return null;
      const watermark = Math.max(...turns.map((t) => t.completedAt ?? 0));

      const transcript = renderTranscript(turns);
      if (!transcript.trim() || userChars(turns) < 12) {
        this.store.setMeta(key, String(watermark));
        return null;
      }

      const existing = this.store
        .list({ status: ["active", "pending"] })
        .slice(0, MAX_EXISTING)
        .map((m) => `#${m.id} [${m.kind}/${m.tier}${m.validUntil ? ` until ${m.validUntil}` : ""}] ${m.text}`)
        .join("\n");
      const input = `Current memories:\n${existing || "(none)"}\n\nNew conversation:\n${transcript}`;
      const raw = await this.session.runEphemeral(instructions(), input, SCHEMA);
      const out = JSON.parse(raw) as Extraction;

      const lines = this.apply(out, threadId);
      if (out.summary?.title) {
        const first = turns[0]!.startedAt ?? watermark;
        this.store.saveSessionSummary(threadId, out.summary.title, out.summary.summary, isoDay(first), isoDay(watermark));
      }
      this.store.setMeta(key, String(watermark));
      return { threadId, lines };
    } finally {
      this.running.delete(threadId);
    }
  }

  /** Startup catch-up: recent conversations with turns not yet learned from. */
  async catchUp(exclude?: string | null): Promise<LearnResult[]> {
    if (!this.enabled()) return [];
    const cutoff = Date.now() / 1000 - CATCH_UP_DAYS * 86_400;
    const threads: Thread[] = await this.session.listThreads(20);
    const todo = threads
      .filter((t) => t.id !== exclude && t.updatedAt >= cutoff && t.updatedAt > Number(this.store.getMeta(`learned:${t.id}`) ?? 0))
      .slice(0, CATCH_UP_LIMIT);
    const results: LearnResult[] = [];
    for (const t of todo) {
      const r = await this.learnFromThread(t.id).catch(() => null);
      if (r?.lines.length) results.push(r);
    }
    return results;
  }

  /** Validates and applies extracted operations; returns user-facing notice lines. */
  private apply(out: Extraction, threadId: string): string[] {
    const lines: string[] = [];
    let pending = 0;
    for (const op of out.ops ?? []) {
      const existing = op.id != null ? this.store.get(op.id) : undefined;
      if (op.op === "mention" || op.op === "expire") {
        if (!existing || existing.status !== "active") continue;
        if (op.op === "mention") this.store.mention(existing.id, threadId);
        else {
          this.store.setStatus(existing.id, "archived");
          lines.push(`🗂 archived #${existing.id}: ${truncate(existing.text, 80)}`);
        }
        continue;
      }

      const text = op.text?.trim();
      if (!text) continue;
      if (op.sensitivity === "secret" || secretReason(text)) continue; // never stored, not even pending
      const validUntil = op.valid_until && /^\d{4}-\d{2}-\d{2}$/.test(op.valid_until) && op.valid_until >= today() ? op.valid_until : null;

      if (op.op === "update") {
        if (!existing || existing.status !== "active") continue;
        this.store.update(existing.id, {
          text,
          validUntil: existing.tier === "short" ? (validUntil ?? existing.validUntil) : null,
          keywords: op.keywords?.join(" "),
          importance: op.importance ?? undefined,
        });
        lines.push(`🧠 updated #${existing.id}: ${truncate(text, 80)}`);
        continue;
      }

      if (op.op === "supersede" && (!existing || existing.status !== "active")) continue;
      const sensitive = ASK_FIRST.has(op.sensitivity);
      const m = this.store.add({
        kind: op.kind ?? existing?.kind ?? "fact",
        text,
        tier: op.tier ?? undefined,
        keywords: op.keywords ?? [],
        sensitivity: op.sensitivity,
        importance: op.importance ?? undefined,
        validUntil,
        supersedes: op.op === "supersede" ? existing!.id : null,
        source: "extracted",
        threadId,
        status: sensitive ? "pending" : "active",
      });
      if (sensitive) pending++;
      else lines.push(noticeFor(m, op.op === "supersede" ? existing : undefined));
    }
    if (pending) lines.push(`🔒 ${pending} sensitive memor${pending === 1 ? "y" : "ies"} awaiting your OK — /memory review`);
    return lines;
  }
}

function noticeFor(m: Memory, replaced?: Memory): string {
  const tier = m.tier === "short" ? `short, until ${m.validUntil}` : "long";
  return `🧠 learned (${tier}${replaced ? `, replaces #${replaced.id}` : ""}): ${truncate(m.text, 80)}`;
}

/** User/assistant text only; drops Jarvis's injected notes and tool noise. */
function renderTranscript(turns: Turn[]): string {
  const parts: string[] = [];
  for (const t of turns) {
    for (const item of t.items) {
      if (item.type === "userMessage") {
        const text = item.content
          .filter((c) => c.type === "text" && !c.text.startsWith("[Jarvis]"))
          .map((c) => (c.type === "text" ? c.text : ""))
          .join(" ")
          .trim();
        if (text) parts.push(`User: ${truncate(text, 1500)}`);
      } else if (item.type === "agentMessage" && item.text.trim()) {
        parts.push(`Assistant: ${truncate(item.text, 1500)}`);
      }
    }
  }
  const all = parts.join("\n");
  return all.length > MAX_TRANSCRIPT_CHARS ? "…" + all.slice(-MAX_TRANSCRIPT_CHARS) : all;
}

function userChars(turns: Turn[]): number {
  let n = 0;
  for (const t of turns) for (const i of t.items) if (i.type === "userMessage") for (const c of i.content) if (c.type === "text") n += c.text.length;
  return n;
}

const isoDay = (unixSecs: number) => new Date(unixSecs * 1000).toLocaleDateString("sv");

