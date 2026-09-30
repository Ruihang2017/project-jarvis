/**
 * Daily consolidation (R3), run in the background at the first start of each day:
 * expire → promote → merge duplicates → roll session summaries into weeks, weeks into months.
 */
import type { Session } from "../session.js";
import { truncate } from "../util.js";
import { addDays, KINDS, today, type Kind, type Memory, type Summary, type Tier } from "./store.js";

/** Short-term items mentioned in this many distinct conversations become long-term. */
const PROMOTE_MENTIONS = 3;
const WEEK_AFTER_DAYS = 7;
const MONTH_AFTER_DAYS = 60;
const MAX_MERGE_INPUT = 200;

const MERGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["merges"],
  properties: {
    merges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ids", "kind", "tier", "text", "keywords", "importance", "valid_until"],
        properties: {
          ids: { type: "array", items: { type: "integer" } },
          kind: { type: "string", enum: [...KINDS] },
          tier: { type: "string", enum: ["short", "long"] },
          text: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
          importance: { type: "integer" },
          valid_until: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      },
    },
  },
};

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary"],
  properties: { title: { type: "string" }, summary: { type: "string" } },
};

export class MemoryTidier {
  constructor(private readonly session: Session) {}

  private get store() {
    return this.session.memory;
  }

  /** Runs once per calendar day; returns notice lines (empty if not due or nothing changed). */
  async runIfDue(): Promise<string[]> {
    if (this.store.getMeta("tidy:last") === today()) return [];
    const lines = await this.run();
    this.store.setMeta("tidy:last", today());
    return lines;
  }

  async run(): Promise<string[]> {
    const archived = this.expire();
    const promoted = this.promote();
    const merged = await this.merge().catch(() => 0);
    const rolled = (await this.rollUp("session", "week", WEEK_AFTER_DAYS).catch(() => 0)) + (await this.rollUp("week", "month", MONTH_AFTER_DAYS).catch(() => 0));

    const lines = promoted.map((m) => `⬆ promoted to long-term: ${truncate(m.text, 80)}`);
    const counts = [
      archived.length && `archived ${archived.length} expired`,
      merged && `merged ${merged} duplicate${merged === 1 ? "" : "s"}`,
      rolled && `condensed ${rolled} summar${rolled === 1 ? "y" : "ies"}`,
    ].filter(Boolean);
    if (counts.length) lines.push(`🗂 daily tidy: ${counts.join(" · ")}`);
    return lines;
  }

  /** Short-term items past their date are archived (still searchable). */
  private expire(): Memory[] {
    const due = this.store.list({ tier: "short" }).filter((m) => m.validUntil && m.validUntil < today());
    for (const m of due) this.store.setStatus(m.id, "archived");
    return due;
  }

  /** Short-term items that keep coming up, or are marked most important, become long-term. */
  private promote(): Memory[] {
    const ready = this.store
      .list({ tier: "short" })
      .filter((m) => m.mentionThreads.length >= PROMOTE_MENTIONS || m.importance >= 5);
    for (const m of ready) this.store.promote(m.id);
    return ready;
  }

  /** Asks the model which active memories say the same thing; replaces each group with one. */
  private async merge(): Promise<number> {
    const active = this.store.list().slice(0, MAX_MERGE_INPUT);
    if (active.length < 2) return 0;
    const list = active.map((m) => `#${m.id} [${m.kind}/${m.tier}${m.validUntil ? ` until ${m.validUntil}` : ""}] ${m.text}`).join("\n");
    const raw = await this.session.runEphemeral(
      `You deduplicate a personal assistant's memories about its user. Today is ${today()}.
Find groups of 2+ memories that state the same fact or are clearly redundant (one is a subset of another). Do NOT merge different facts that merely share a topic.
For each group output the ids and one merged memory: plain statement in the memory's language, keeping every detail that is still true; kind/tier; 3–8 keywords in both Chinese and English; importance 1–5; valid_until (YYYY-MM-DD or null) for short-term.
If there are no duplicates, return merges: [].`,
      `Memories:\n${list}`,
      MERGE_SCHEMA,
    );
    const { merges } = JSON.parse(raw) as {
      merges: { ids: number[]; kind: Kind; tier: Tier; text: string; keywords: string[]; importance: number; valid_until: string | null }[];
    };
    let count = 0;
    for (const g of merges ?? []) {
      const members = [...new Set(g.ids)].map((id) => this.store.get(id)).filter((m): m is Memory => m?.status === "active");
      if (members.length < 2 || !g.text?.trim()) continue;
      const merged = this.store.add({
        kind: g.kind,
        tier: g.tier,
        text: g.text,
        keywords: g.keywords,
        importance: Math.max(g.importance, ...members.map((m) => m.importance)),
        validUntil: g.tier === "short" ? (g.valid_until && g.valid_until >= today() ? g.valid_until : addDays(30)) : null,
        sensitivity: members.find((m) => m.sensitivity !== "none")?.sensitivity ?? "none",
        source: "extracted",
      });
      for (const m of members) {
        this.store.setStatus(m.id, "superseded");
        for (const t of m.mentionThreads) this.store.mention(merged.id, t);
      }
      count += members.length - 1;
    }
    return count;
  }

  /** Condenses \`from\`-level summaries older than \`afterDays\` into one \`to\`-level summary per period. */
  private async rollUp(from: Summary["level"], to: "week" | "month", afterDays: number): Promise<number> {
    const old = this.store.summariesToRoll(from, addDays(-afterDays));
    const groups = new Map<string, Summary[]>();
    for (const s of old) {
      const key = to === "week" ? weekStart(s.periodStart) : s.periodStart.slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    let rolled = 0;
    for (const [key, items] of groups) {
      const start = to === "week" ? key : `${key}-01`;
      const end = to === "week" ? addDays(6, new Date(`${key}T12:00:00`)) : monthEnd(key);
      const raw = await this.session.runEphemeral(
        `Condense these conversation summaries from ${start} to ${end} into one ${to}ly summary of what the user did, discussed or decided. Title ≤ 12 words; summary 2–4 sentences; same language as the input.`,
        items.map((s) => `- ${s.periodEnd} · ${s.title}: ${s.summary}`).join("\n"),
        SUMMARY_SCHEMA,
      );
      const { title, summary } = JSON.parse(raw) as { title: string; summary: string };
      const id = this.store.insertSummary(to, title, summary, start, end);
      this.store.markRolled(items.map((s) => s.id), id);
      rolled += items.length;
    }
    return rolled;
  }
}

/** Monday (YYYY-MM-DD) of the week containing a date. */
function weekStart(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toLocaleDateString("sv");
}

function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y!, m!, 0, 12).toLocaleDateString("sv");
}
