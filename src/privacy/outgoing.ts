/**
 * The privacy guard at the process boundary (S1): every message Jarvis writes to `codex app-server`
 * passes through here, so nothing — user text, instructions, memory, tool results, answers — can
 * reach Codex without being redacted, whichever code path produced it.
 *
 * Fail-closed (P3): every string in every request, notification and reply is redacted, whatever
 * the method. Only the structural fields named in STRUCTURAL are left alone, so a request type
 * added later is covered without anyone remembering to list it here.
 */
import type { OutgoingFilter } from "../rpc.js";
import { redact, redactDeep, type Category } from "./guard.js";

/**
 * Where removed text was headed: shown to the user ("from your message", "from a tool result").
 * "background": a turn on a throwaway thread (memory learning, tidying) — the listener decides.
 */
export type Source = "message" | "instructions" | "tool" | "answer" | "background";

/**
 * Fields that carry identifiers, paths or Jarvis's own fixed definitions rather than user or
 * third-party text. Redacting them would break requests (a thread id or a file path can contain
 * digit runs) and they can't hold anything the user typed or an email said.
 */
const STRUCTURAL = new Set([
  "threadId",
  "turnId",
  "itemId",
  "callId",
  "requestId",
  "cursor",
  "cwd",
  "path",
  "model",
  "effort",
  "sandbox",
  "sandboxPolicy",
  "approvalPolicy",
  "approvalsReviewer",
  "config",
  "dynamicTools",
  "outputSchema",
  "clientInfo",
  "capabilities",
]);

export function guardOutgoing(onRedacted: (source: Source, removed: Category[], threadId?: string) => void = () => {}): OutgoingFilter {
  let threadId: string | undefined;
  const report = (source: Source, removed: Category[]) => {
    if (removed.length) onRedacted(source, removed, threadId);
  };
  const scrub = (params: unknown, source: Source) => {
    if (!params || typeof params !== "object") {
      if (typeof params !== "string") return params;
      const r = redact(params);
      report(source, r.removed);
      return r.text;
    }
    threadId = typeof (params as { threadId?: unknown }).threadId === "string" ? (params as { threadId: string }).threadId : undefined;
    const { value, removed } = redactDeep(params, [], STRUCTURAL);
    report(source, removed);
    return value;
  };
  return {
    request(method, params) {
      return scrub(params, method.startsWith("thread/") ? "instructions" : "message");
    },
    notify(_method, params) {
      return scrub(params, "message");
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
