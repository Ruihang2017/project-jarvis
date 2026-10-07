/** How tool activity in a turn is described, as plain lines (terminal and desktop app). */
import type { ThreadItem } from "./protocol/v2/index.js";
import { describeChange } from "./prompts.js";
import { describeToolCall } from "./tools.js";
import { parseDraftResult, type DraftText } from "./google/gmail-tools.js";
import { RELATED_CHECK } from "./memory/tools.js";
import { displayCommand, truncate } from "./util.js";

/** The email draft a finished gmail_draft call saved, as it reported it; null for anything else. */
export function draftOf(item: ThreadItem): DraftText | null {
  if (item.type !== "dynamicToolCall" || item.tool !== "gmail_draft" || item.success === false || item.status === "failed") return null;
  const text = item.contentItems?.find((c) => c.type === "inputText");
  return text?.type === "inputText" ? parseDraftResult(text.text) : null;
}

/** Indicator text while a tool item runs; null for items that aren't tool activity. */
export function activityLabel(item: ThreadItem): string | null {
  switch (item.type) {
    case "imageGeneration":
      return "🎨 generating image…";
    case "webSearch":
      return "searching the web…";
    case "commandExecution":
      return "running command…";
    case "fileChange":
      return "editing files…";
    case "mcpToolCall":
      return `calling ${item.server}.${item.tool}…`;
    case "dynamicToolCall":
      return `${item.tool}…`;
    default:
      return null;
  }
}

/** Persistent lines summarising a finished tool item. */
export function activityNotes(item: ThreadItem): string[] {
  switch (item.type) {
    case "webSearch":
      return [`⌕ ${describeSearch(item)}`];
    case "commandExecution": {
      const cmd = `$ ${truncate(displayCommand(item.command), 100)}`;
      if (item.status === "declined") return [`${cmd} · declined`];
      const meta = [item.exitCode != null && `exit ${item.exitCode}`, item.durationMs != null && secs(item.durationMs)];
      const tail = (item.aggregatedOutput ?? "")
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .slice(-3)
        .map((l) => `  │ ${truncate(l, 110)}`);
      return [`${cmd} · ${meta.filter(Boolean).join(" · ") || item.status}`, ...tail];
    }
    case "fileChange":
      if (item.status === "declined") return item.changes.map((c) => `✎ ${describeChange(c)} · declined`);
      return item.changes.map((c) => `✎ ${describeChange(c)}${item.status === "failed" ? " · failed" : ""}`);
    case "mcpToolCall":
      return [`⚙ ${item.server}.${item.tool} · ${item.status === "failed" ? "failed" : "ok"}${item.durationMs != null ? " · " + secs(item.durationMs) : ""}`];
    case "dynamicToolCall": {
      // Edward's own tools report declines/errors as failed calls; surface the reason.
      const failed = item.success === false || item.status === "failed";
      const reason = item.contentItems?.find((c) => c.type === "inputText");
      if (failed && reason?.type === "inputText" && reason.text.includes(RELATED_CHECK)) {
        return ["🧠 checking related memories before saving…"];
      }
      const suffix = failed ? ` · ${reason && reason.type === "inputText" ? truncate(reason.text, 80) : "failed"}` : "";
      // A draft is shown whole: the user shouldn't have to open Gmail to read what Edward wrote.
      const draft = draftOf(item);
      const shown = draft ? [`From: ${draft.from}`, `To: ${draft.to}`, ...(draft.cc ? [`Cc: ${draft.cc}`] : []), `Subject: ${draft.subject}`, "", ...draft.body.split("\n")].map((l) => `   ${l}`) : [];
      return [`${describeToolCall(item.tool, item.arguments, !failed)}${suffix}`, ...shown];
    }
    default:
      return [];
  }
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function describeSearch(item: Extract<ThreadItem, { type: "webSearch" }>): string {
  const a = item.action;
  if (a?.type === "openPage" && a.url) return `opened ${hostOf(a.url)}`;
  if (a?.type === "findInPage") return `searched page for "${a.pattern ?? ""}"`;
  const queries = a?.type === "search" ? (a.queries ?? (a.query ? [a.query] : [])) : [];
  return queries.length ? queries.map((q) => `"${q}"`).join(", ") : item.query || "web search";
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

