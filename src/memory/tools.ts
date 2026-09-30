import type { Tool } from "../tools.js";
import { truncate } from "../util.js";
import { ASK_FIRST, secretReason } from "./guard.js";
import { describe, KINDS, today, type Kind, type Memory, type Sensitivity, type Tier } from "./store.js";

const SENSITIVITY: Sensitivity[] = ["none", "health", "finance", "work_confidential", "secret"];
/** BM25 score above which an existing memory counts as related to a new one (tuned on sample data). */
const RELATED_MIN = 2.5;
/** Marks the "check related memories first" failure so the UI can show it as a step, not an error. */
export const RELATED_CHECK = "Not saved yet —";

export const MEMORY_TOOLS: Tool[] = [
  {
    name: "memory_save",
    description:
      "Save one fact about the user to memory. Use when the user asks you to remember/note something, " +
      "or corrects something you already know (pass `supersedes`). One fact per call, in the user's language: " +
      "'lives in Sydney' and 'works at Acme Corp' are two calls. When superseding, restate anything in the old memory that is still true.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Self-contained statement, e.g. 'Alice is my manager' / '周五前交差旅报销'." },
        kind: { type: "string", enum: [...KINDS], description: "profile: who the user is; preference: how they like things; fact: people/things; event: dated plans or commitments; note: anything they asked you to jot down." },
        tier: { type: "string", enum: ["short", "long"], description: "short: temporary/situational (expires); long: stable. Omit to infer (events are short)." },
        valid_until: { type: "string", description: "YYYY-MM-DD when a short-term item stops being relevant (e.g. the event date). Omit for 30 days." },
        keywords: { type: "array", items: { type: "string" }, description: "3–8 search keywords incl. synonyms, in BOTH Chinese and English." },
        importance: { type: "integer", minimum: 1, maximum: 5 },
        sensitivity: { type: "string", enum: SENSITIVITY, description: "health, finance, work_confidential (client names, contract amounts, unannounced projects) or secret (passwords, keys, card numbers)." },
        supersedes: { type: "integer", description: "Id of an existing memory this one replaces." },
        independent: { type: "boolean", description: "Set true after a related-memory check to confirm this is a separate fact, not an update." },
      },
      required: ["text", "kind", "keywords", "sensitivity"],
      additionalProperties: false,
    },
    approval: "auto",
    async prepare(args, ctx) {
      const text = str(args.text);
      if (!text) throw new Error("`text` is required");
      const kind = oneOf(args.kind, KINDS, "kind");
      const sensitivity = oneOf(args.sensitivity, SENSITIVITY, "sensitivity");
      const secret = sensitivity === "secret" ? "secret" : secretReason(text);
      if (secret) throw new Error(`refused: this looks like a ${secret}. Secrets are never stored in memory; tell the user so.`);
      const tier = args.tier === undefined ? undefined : oneOf(args.tier, ["short", "long"] as const, "tier");
      const validUntil = args.valid_until === undefined ? undefined : isoDate(args.valid_until);
      const supersedes = args.supersedes === undefined ? undefined : Number(args.supersedes);
      const old = supersedes !== undefined ? ctx.memory.get(supersedes) : undefined;
      if (supersedes !== undefined && (!old || old.status !== "active")) throw new Error(`no active memory #${supersedes}`);
      const keywords = Array.isArray(args.keywords) ? args.keywords.map(String).filter(Boolean).slice(0, 12) : [];
      // Updates otherwise pile up as duplicates, or a combined memory loses the parts that still hold.
      if (supersedes === undefined && args.independent !== true) {
        const related = ctx.memory.search(`${text} ${keywords.join(" ")}`, { limit: 3 }).filter((h) => h.score >= RELATED_MIN);
        if (related.length) {
          throw new Error(
            `${RELATED_CHECK} related memories exist:\n${related.map((h) => describe(h.memory)).join("\n")}\n` +
              "If the new information updates one of these, call memory_save again with supersedes=<id> and a text that also restates whatever in the old memory is still true. " +
              "If it is a separate fact, call again with independent=true.",
          );
        }
      }
      const sensitive = ASK_FIRST.has(sensitivity);
      return {
        summary: `remember${sensitive ? ` (${sensitivity})` : ""}: ${text}`,
        preview: old ? `replaces #${old.id}: ${old.text}` : undefined,
        needsApproval: sensitive,
        allowAlways: false,
        execute: async () => {
          const m = ctx.memory.add({
            kind: kind as Kind,
            text,
            tier: tier as Tier | undefined,
            keywords,
            sensitivity,
            importance: typeof args.importance === "number" ? args.importance : undefined,
            validUntil,
            supersedes,
            source: "explicit",
            threadId: ctx.threadId,
          });
          return `Saved ${describe(m)} (${m.tier}-term).${old ? ` Replaced #${old.id}.` : ""}`;
        },
      };
    },
  },
  {
    name: "memory_search",
    description:
      "Search what you remember about the user: people, plans, past events, notes, preferences. Use when the user refers to something personal " +
      "that isn't in your instructions. Query with a few keywords; results include ids for memory_save(supersedes) / memory_forget.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        include_archived: { type: "boolean", description: "Also search expired/archived memories (e.g. 'what did I do last month')." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    approval: "auto",
    async prepare(args, ctx) {
      const query = str(args.query);
      if (!query) throw new Error("`query` is required");
      return {
        summary: `search memory: ${query}`,
        execute: async () => {
          const hits = ctx.memory.search(query, { includeArchived: args.include_archived === true });
          ctx.memory.touch(hits.map((h) => h.memory.id));
          if (!hits.length) return "No matching memories.";
          return hits.map((h) => formatHit(h.memory)).join("\n");
        },
      };
    },
  },
  {
    name: "memory_forget",
    description: "Permanently delete a memory by id. Only when the user asks you to forget something; find the id with memory_search first.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
      additionalProperties: false,
    },
    approval: "ask",
    async prepare(args, ctx) {
      const m = ctx.memory.get(Number(args.id));
      if (!m) throw new Error(`no memory #${args.id}`);
      return {
        summary: `forget #${m.id}`,
        preview: m.text,
        allowAlways: false,
        execute: async () => {
          ctx.memory.remove(m.id);
          return `Forgot #${m.id}.`;
        },
      };
    },
  },
];

/** Activity line for memory tools, or undefined for other tools. */
export function describeMemoryCall(tool: string, a: Record<string, unknown>, ok = true): string | undefined {
  switch (tool) {
    case "memory_save": {
      if (!ok) return `🧠 not saved: ${truncate(str(a.text), 90)}`;
      const tier = a.tier ?? (a.kind === "event" || a.valid_until ? "short" : "long");
      const until = a.valid_until ? `, until ${a.valid_until}` : "";
      const replaces = a.supersedes !== undefined ? `, replaces #${a.supersedes}` : "";
      return `🧠 remembered (${tier}${until}${replaces}): ${truncate(str(a.text), 90)}`;
    }
    case "memory_search":
      return `🧠 ${ok ? "recalled" : "recall failed"}: "${truncate(str(a.query), 60)}"`;
    case "memory_forget":
      return ok ? `🧠 forgot #${a.id}` : `🧠 kept #${a.id}`;
    default:
      return undefined;
  }
}

function formatHit(m: Memory): string {
  const status = m.status === "active" ? "" : ` {${m.status}}`;
  return `${describe(m)} — ${m.tier}-term, saved ${m.createdAt.slice(0, 10)}${status}`;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function oneOf<T extends string>(v: unknown, allowed: readonly T[], name: string): T {
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  throw new Error(`\`${name}\` must be one of ${allowed.join(", ")}`);
}

function isoDate(v: unknown): string {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new Error("`valid_until` must be YYYY-MM-DD");
  if (s < today()) throw new Error("`valid_until` is in the past");
  return s;
}
