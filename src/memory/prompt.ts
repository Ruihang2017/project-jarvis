import { today, type MemoryStore } from "./store.js";

/** "YYYY-MM" of the previous month, for the relative-date example. */
function lastMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleDateString("sv").slice(0, 7);
}

const MAX_RECENT_ITEMS = 10;
const MAX_RECENT_SUMMARIES = 3;

/** Short-term "what's going on lately": active short-term items (soonest first) and recent conversations. */
function recentContext(store: MemoryStore): string {
  const items = store
    .list({ tier: "short" })
    .sort((a, b) => (a.validUntil ?? "").localeCompare(b.validUntil ?? ""))
    .slice(0, MAX_RECENT_ITEMS);
  const summaries = store.recentSummaries("session", MAX_RECENT_SUMMARIES);
  if (!items.length && !summaries.length) return "";
  let out = "\nWhat's going on lately (short-term):\n";
  out += items.length ? items.map((m) => `- ${m.text} (until ${m.validUntil}, #${m.id})`).join("\n") : "- (nothing current)";
  if (summaries.length) {
    out += "\nRecent conversations:\n" + summaries.map((s) => `- ${s.periodEnd} · ${s.title}: ${s.summary}`).join("\n");
  }
  return out + "\n";
}

/**
 * What Edward knows about the user, for a background helper that has no memory rules of its own:
 * the long-term core and what's going on lately. Empty when there is nothing.
 */
export function aboutUser(store: MemoryStore): string {
  const core = store.core();
  const recent = recentContext(store);
  if (!core.length && !recent) return "";
  return `What you know about the user (today is ${today()}; treat as true):\n${core.length ? core.map((m) => `- ${m.text}`).join("\n") : "- (nothing yet)"}\n${recent}`;
}

/**
 * Memory section appended to the persona at thread start/resume: the long-term core
 * (profile + preferences) plus rules for the memory tools.
 */
export function memoryInstructions(store: MemoryStore): string {
  const core = store.core();
  const known = core.length
    ? core.map((m) => `- ${m.text} (#${m.id})`).join("\n")
    : "- (nothing yet)";
  return `
## Memory
Edward keeps a memory about the user. Today is ${today()}.

What you know about the user (treat as true unless they say otherwise):
${known}
${recentContext(store)}

How to write memories:
- One fact per memory: "住在悉尼" and "在 Acme Corp 工作" are two separate saves.
- Plain statements without "用户"/"the user": "住在墨尔本", "Alice is my manager".
- Convert relative time to absolute dates using today's date: "上个月搬到墨尔本" → "${lastMonth()} 搬到墨尔本".

Memory tools:
- memory_save: when the user asks you to remember or note something ("记住", "记一下", "remember", "note that"), or corrects something above (pass supersedes with its #id). Don't save small talk or things only relevant to this conversation.
- memory_search: when the user mentions people, plans, past events or notes you don't see above. Search before saying you don't know.
- memory_forget: only when the user asks you to forget something.
Sensitivity (the user is asked to confirm anything not "none"):
- "none": ordinary personal facts — where they live, their employer and job title, family, hobbies, schedules, preferences, and everyday admin/to-dos (submitting expenses, paying a bill, booking travel).
- "health": medical conditions, medications, mental health.
- "finance": income, debts, account balances, investments.
- "work_confidential": internal business information — client/customer names, deal or contract amounts, unannounced projects or products, internal figures. The user's own employer or role is NOT confidential.
- "secret": passwords, PINs, API keys, card numbers — always refused; tell the user you won't store it.`;
}
