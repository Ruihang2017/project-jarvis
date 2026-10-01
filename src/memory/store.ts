import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { appDataDir } from "../settings.js";
import { rank } from "./search.js";

export const KINDS = ["profile", "preference", "fact", "event", "note"] as const;
export type Kind = (typeof KINDS)[number];
export type Tier = "short" | "long";
/** pending: sensitive item learned automatically, waiting for the user's OK (/memory review). */
export type Status = "active" | "archived" | "superseded" | "pending";
export type Sensitivity = "none" | "health" | "finance" | "work_confidential" | "secret";
export type Source = "explicit" | "extracted" | "manual";

export interface Memory {
  id: number;
  kind: Kind;
  tier: Tier;
  text: string;
  keywords: string;
  sensitivity: Sensitivity;
  importance: number; // 1–5
  status: Status;
  validUntil: string | null; // YYYY-MM-DD (short-term only)
  supersedes: number | null;
  source: Source;
  threadId: string | null;
  mentionThreads: string[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  useCount: number;
  promotedAt: string | null;
}

export interface NewMemory {
  kind: Kind;
  text: string;
  tier?: Tier;
  keywords?: string[];
  sensitivity?: Sensitivity;
  importance?: number;
  validUntil?: string | null;
  supersedes?: number | null;
  source: Source;
  threadId?: string | null;
  status?: Status;
}

export interface Summary {
  id: number;
  level: "session" | "week" | "month";
  threadId: string | null;
  title: string;
  summary: string;
  periodStart: string;
  periodEnd: string;
  rolledInto: number | null;
}

/** memory.db location (also holds reminders); JARVIS_MEMORY_DB overrides. */
export const memoryDbPath = () => process.env.JARVIS_MEMORY_DB ?? join(appDataDir(), "memory.db");

/** Short-term items without an explicit date expire after this many days. */
export const SHORT_TERM_DAYS = 30;
/** Rough budget for the always-injected profile block (~800 tokens). */
const CORE_CHARS = 3200;

const localDate = (d: Date) => d.toLocaleDateString("sv"); // YYYY-MM-DD in local time
export const today = () => localDate(new Date());
export const addDays = (days: number, from = new Date()) => localDate(new Date(from.getTime() + days * 86_400_000));

export class MemoryStore {
  private db: DatabaseSync;
  /** Ids saved during this Jarvis process, newest last, for /memory undo. */
  private createdThisSession: number[] = [];

  constructor(path = memoryDbPath()) {
    mkdirSync(join(path, ".."), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        tier TEXT NOT NULL,
        text TEXT NOT NULL,
        keywords TEXT NOT NULL DEFAULT '',
        sensitivity TEXT NOT NULL DEFAULT 'none',
        importance INTEGER NOT NULL DEFAULT 3,
        status TEXT NOT NULL DEFAULT 'active',
        valid_until TEXT,
        supersedes INTEGER,
        source TEXT NOT NULL,
        thread_id TEXT,
        mention_threads TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT,
        use_count INTEGER NOT NULL DEFAULT 0,
        promoted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS memories_status ON memories(status, tier);
      CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY,
        level TEXT NOT NULL,            -- session | week | month
        thread_id TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        rolled_into INTEGER,            -- id of the week/month summary that absorbed it
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  add(m: NewMemory): Memory {
    const now = new Date().toISOString();
    const tier: Tier = m.tier ?? (m.kind === "event" || m.validUntil ? "short" : "long");
    const validUntil = tier === "short" ? (m.validUntil ?? addDays(SHORT_TERM_DAYS)) : null;
    const res = this.db
      .prepare(
        `INSERT INTO memories (kind, tier, text, keywords, sensitivity, importance, valid_until, supersedes,
           source, thread_id, mention_threads, created_at, updated_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.kind,
        tier,
        m.text.trim(),
        (m.keywords ?? []).join(" "),
        m.sensitivity ?? "none",
        clampImportance(m.importance),
        validUntil,
        m.supersedes ?? null,
        m.source,
        m.threadId ?? null,
        JSON.stringify(m.threadId ? [m.threadId] : []),
        now,
        now,
        m.status ?? "active",
      );
    const id = Number(res.lastInsertRowid);
    // A pending item only replaces its predecessor once approved.
    if (m.supersedes && (m.status ?? "active") === "active") this.setStatus(m.supersedes, "superseded");
    this.createdThisSession.push(id);
    return this.get(id)!;
  }

  get(id: number): Memory | undefined {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
    return row ? toMemory(row) : undefined;
  }

  list(filter: { status?: Status | Status[]; tier?: Tier; kind?: Kind } = {}): Memory[] {
    const statuses = [filter.status ?? "active"].flat();
    const where = [`status IN (${statuses.map(() => "?").join(",")})`];
    const params: (string | number)[] = [...statuses];
    if (filter.tier) where.push("tier = ?"), params.push(filter.tier);
    if (filter.kind) where.push("kind = ?"), params.push(filter.kind);
    return this.db
      .prepare(`SELECT * FROM memories WHERE ${where.join(" AND ")} ORDER BY tier, kind, importance DESC, updated_at DESC`)
      .all(...params)
      .map(toMemory);
  }

  update(id: number, patch: Partial<Pick<Memory, "text" | "kind" | "tier" | "importance" | "validUntil" | "keywords">>): Memory | undefined {
    const cols: Record<string, string> = { text: "text", kind: "kind", tier: "tier", importance: "importance", validUntil: "valid_until", keywords: "keywords" };
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      sets.push(`${cols[k]} = ?`);
      params.push(k === "importance" ? clampImportance(v as number) : (v as string | null));
    }
    if (!sets.length) return this.get(id);
    this.db.prepare(`UPDATE memories SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...params, new Date().toISOString(), id);
    return this.get(id);
  }

  setStatus(id: number, status: Status) {
    this.db.prepare("UPDATE memories SET status = ?, updated_at = ? WHERE id = ?").run(status, new Date().toISOString(), id);
  }

  /** Permanently deletes (user asked to forget). */
  remove(id: number): Memory | undefined {
    const m = this.get(id);
    if (m) this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
    this.createdThisSession = this.createdThisSession.filter((x) => x !== id);
    return m;
  }

  /** Removes the most recent memory saved during this session. */
  undo(): Memory | undefined {
    const id = this.createdThisSession.at(-1);
    if (id === undefined) return undefined;
    const m = this.remove(id);
    // Restore anything it had superseded.
    if (m?.supersedes) this.setStatus(m.supersedes, "active");
    return m;
  }

  /** Approves a pending memory, applying its supersede if it has one. */
  approve(id: number): Memory | undefined {
    const m = this.get(id);
    if (!m || m.status !== "pending") return undefined;
    this.setStatus(id, "active");
    if (m.supersedes) this.setStatus(m.supersedes, "superseded");
    return this.get(id);
  }

  /** Notes that a memory came up again in another conversation (drives promotion). */
  mention(id: number, threadId: string) {
    const m = this.get(id);
    if (!m || m.mentionThreads.includes(threadId)) return;
    this.db
      .prepare("UPDATE memories SET mention_threads = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify([...m.mentionThreads, threadId]), new Date().toISOString(), id);
  }

  /** Replaces the session-level summary for a thread. */
  saveSessionSummary(threadId: string, title: string, summary: string, periodStart: string, periodEnd: string) {
    this.db.prepare("DELETE FROM summaries WHERE level = 'session' AND thread_id = ?").run(threadId);
    this.db
      .prepare("INSERT INTO summaries (level, thread_id, title, summary, period_start, period_end, created_at) VALUES ('session', ?, ?, ?, ?, ?, ?)")
      .run(threadId, title, summary, periodStart, periodEnd, new Date().toISOString());
  }

  /** Most recent summaries at a level, newest first; `excludeThread` skips the current conversation. */
  recentSummaries(level: Summary["level"], limit: number, excludeThread?: string | null): Summary[] {
    return this.db
      .prepare("SELECT * FROM summaries WHERE level = ? AND rolled_into IS NULL AND (thread_id IS NULL OR thread_id != ?) ORDER BY period_end DESC LIMIT ?")
      .all(level, excludeThread ?? "", limit)
      .map(toSummary);
  }

  /** Moves a short-term memory to long-term (no expiry). */
  promote(id: number) {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE memories SET tier = 'long', valid_until = NULL, promoted_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
  }

  /** Summaries at `level` not yet rolled up whose period ended before `before` (YYYY-MM-DD), oldest first. */
  summariesToRoll(level: Summary["level"], before: string): Summary[] {
    return this.db
      .prepare("SELECT * FROM summaries WHERE level = ? AND rolled_into IS NULL AND period_end < ? ORDER BY period_start")
      .all(level, before)
      .map(toSummary);
  }

  insertSummary(level: Summary["level"], title: string, summary: string, periodStart: string, periodEnd: string): number {
    const res = this.db
      .prepare("INSERT INTO summaries (level, thread_id, title, summary, period_start, period_end, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?)")
      .run(level, title, summary, periodStart, periodEnd, new Date().toISOString());
    return Number(res.lastInsertRowid);
  }

  markRolled(ids: number[], into: number) {
    const stmt = this.db.prepare("UPDATE summaries SET rolled_into = ? WHERE id = ?");
    for (const id of ids) stmt.run(into, id);
  }

  /** Records that a memory was used (feeds ranking and promotion). */
  touch(ids: number[]) {
    const stmt = this.db.prepare("UPDATE memories SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?");
    const now = new Date().toISOString();
    for (const id of ids) stmt.run(now, id);
  }

  search(query: string, opts: { includeArchived?: boolean; limit?: number } = {}): { memory: Memory; score: number }[] {
    const pool = this.list({ status: opts.includeArchived ? ["active", "archived"] : "active" });
    return rank(query, pool, (m) => [
      [m.text, 1],
      [m.keywords, 1.5],
    ])
      .map(({ doc, score }) => ({ memory: doc, score: score * weight(doc) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit ?? 8);
  }

  /** Long-term profile + preferences, most important first, within the core budget. */
  core(): Memory[] {
    const items = [...this.list({ tier: "long", kind: "profile" }), ...this.list({ tier: "long", kind: "preference" })].sort(
      (a, b) => b.importance - a.importance || b.updatedAt.localeCompare(a.updatedAt),
    );
    const out: Memory[] = [];
    let used = 0;
    for (const m of items) {
      if (used + m.text.length > CORE_CHARS) continue;
      out.push(m);
      used += m.text.length + 3;
    }
    return out;
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string) {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  /** Human-readable dump of everything, grouped by tier/status. */
  exportMarkdown(): string {
    const all = this.list({ status: ["active", "archived", "superseded"] });
    const section = (title: string, items: Memory[]) =>
      items.length ? `## ${title}\n\n${items.map((m) => `- ${describe(m)}`).join("\n")}\n\n` : "";
    return (
      `# Jarvis memory — exported ${new Date().toLocaleString("sv")}\n\n` +
      section("Long-term", all.filter((m) => m.status === "active" && m.tier === "long")) +
      section("Short-term", all.filter((m) => m.status === "active" && m.tier === "short")) +
      section("Archived", all.filter((m) => m.status === "archived")) +
      section("Superseded", all.filter((m) => m.status === "superseded"))
    );
  }

  close() {
    this.db.close();
  }
}

/** One-line description: `#12 [event] text (until 2026-10-03)`. */
export function describe(m: Memory): string {
  const until = m.tier === "short" && m.validUntil ? ` (until ${m.validUntil})` : "";
  const flag = m.sensitivity !== "none" ? ` [${m.sensitivity}]` : "";
  return `#${m.id} [${m.kind}] ${m.text}${until}${flag}`;
}

function toSummary(r: any): Summary {
  return {
    id: r.id,
    level: r.level,
    threadId: r.thread_id,
    title: r.title,
    summary: r.summary,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    rolledInto: r.rolled_into,
  };
}

/** Ranking multiplier: importance, a little recency and use, and a penalty for archived items. */
function weight(m: Memory): number {
  const ageDays = (Date.now() - Date.parse(m.updatedAt)) / 86_400_000;
  return (0.8 + m.importance * 0.1) * (ageDays < 7 ? 1.1 : 1) * (m.useCount > 0 ? 1.05 : 1) * (m.status === "archived" ? 0.6 : 1);
}

function clampImportance(v: number | undefined): number {
  return Math.min(5, Math.max(1, Math.round(v ?? 3)));
}

function toMemory(r: any): Memory {
  return {
    id: r.id,
    kind: r.kind,
    tier: r.tier,
    text: r.text,
    keywords: r.keywords,
    sensitivity: r.sensitivity,
    importance: r.importance,
    status: r.status,
    validUntil: r.valid_until,
    supersedes: r.supersedes,
    source: r.source,
    threadId: r.thread_id,
    mentionThreads: JSON.parse(r.mention_threads),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastUsedAt: r.last_used_at,
    useCount: r.use_count,
    promotedAt: r.promoted_at,
  };
}
