/**
 * The privacy guard at the process boundary (S1): every message Jarvis writes to `codex app-server`
 * passes through here, so nothing — user text, instructions, memory, tool results, answers — can
 * reach Codex without being redacted, whichever code path produced it.
 */
import type { OutgoingFilter } from "../rpc.js";
import { redact, redactDeep, type Category } from "./guard.js";

/**
 * Where removed text was headed: shown to the user ("from your message", "from a tool result").
 * "background": a turn on a throwaway thread (memory learning, tidying) — the listener decides.
 */
export type Source = "message" | "instructions" | "tool" | "answer" | "background";

export function guardOutgoing(onRedacted: (source: Source, removed: Category[], threadId?: string) => void = () => {}): OutgoingFilter {
  let threadId: string | undefined;
  const report = (source: Source, removed: Category[]) => {
    if (removed.length) onRedacted(source, removed, threadId);
  };
  return {
    request(method, params) {
      if (!params || typeof params !== "object") return params;
      const p = { ...(params as Record<string, unknown>) };
      threadId = typeof p.threadId === "string" ? p.threadId : undefined;
      if (method === "thread/start" || method === "thread/resume") {
        const removed: Category[] = [];
        for (const k of ["developerInstructions", "baseInstructions"] as const) {
          if (typeof p[k] !== "string") continue;
          const r = redact(p[k] as string);
          p[k] = r.text;
          removed.push(...r.removed);
        }
        report("instructions", removed);
      } else if (method === "turn/start" || method === "turn/steer") {
        const removed: Category[] = [];
        if (Array.isArray(p.input)) {
          p.input = p.input.map((item: { type?: string; text?: string }) => {
            if (item?.type !== "text" || typeof item.text !== "string") return item; // images: not checked (D24)
            const r = redact(item.text);
            removed.push(...r.removed);
            return { ...item, text: r.text };
          });
        }
        report("message", removed);
      }
      return p;
    },
    reply(method, result) {
      threadId = (result as { threadId?: string } | undefined)?.threadId; // replies rarely carry one
      const { value, removed } = redactDeep(result);
      report(method === "item/tool/call" ? "tool" : "answer", removed);
      return value;
    },
    error(_method, message) {
      return redact(message).text;
    },
  };
}
