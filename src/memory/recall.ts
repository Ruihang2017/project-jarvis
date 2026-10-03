import type { MemoryStore } from "./store.js";

/** Minimum BM25 score, and fraction of the best hit's score, for a memory to be auto-attached. */
const MIN_SCORE = 1.5;
const MIN_RELATIVE = 0.4;
const MAX_ITEMS = 5;

/**
 * Per-message recall (R3): memories relevant to what the user just said, attached as a hidden
 * note so the model doesn't have to think of searching. `seen` holds ids already attached in this
 * conversation (they stay in context), so each memory is attached at most once per thread.
 */
export function recallFor(text: string, store: MemoryStore, seen: Set<number>): { note: string; ids: number[] } | null {
  const hits = store.search(text, { limit: MAX_ITEMS * 2 });
  const best = hits[0]?.score ?? 0;
  const picked = hits
    .filter((h) => h.score >= MIN_SCORE && h.score >= best * MIN_RELATIVE && !seen.has(h.memory.id))
    .slice(0, MAX_ITEMS)
    .map((h) => h.memory);
  if (!picked.length) return null;
  const lines = picked.map((m) => `- ${m.text}${m.tier === "short" && m.validUntil ? ` (until ${m.validUntil})` : ""} (#${m.id})`);
  for (const m of picked) seen.add(m.id);
  store.touch(picked.map((m) => m.id));
  return {
    note: `[Edward] Possibly relevant memories about the user (from Edward's memory; use if helpful, don't mention this note):\n${lines.join("\n")}`,
    ids: picked.map((m) => m.id),
  };
}
