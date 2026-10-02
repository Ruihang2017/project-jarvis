/**
 * Jarvis's own tools, registered with Codex as dynamic tools (experimental API) and executed
 * here in Node. Approval is Jarvis-side: "ask" tools prompt the user before running.
 */
import type { Interactions } from "./interactions.js";
import type {
  DynamicToolCallParams,
  DynamicToolCallResponse,
  DynamicToolFunctionSpec,
  DynamicToolSpec,
} from "./protocol/v2/index.js";
import { openWithDefaultApp, readClipboard, resolveOpenTarget, writeClipboard } from "./system.js";
import { tildify, truncate } from "./util.js";
import type { MemoryStore } from "./memory/store.js";
import { describeMemoryCall, MEMORY_TOOLS } from "./memory/tools.js";
import type { ReminderStore } from "./reminders/store.js";
import { describeReminderCall, REMINDER_TOOLS } from "./reminders/tools.js";
import type { GoogleAuth } from "./google/auth.js";
import { CALENDAR_TOOLS, describeCalendarCall } from "./google/calendar-tools.js";
import { describeGmailCall, GMAIL_TOOLS } from "./google/gmail-tools.js";

const MAX_CLIPBOARD_CHARS = 50_000;

/** A tool call that has been validated and is ready to confirm/execute. */
export interface PreparedCall {
  /** One line shown in the approval prompt and the activity note. */
  summary: string;
  /** Optional preview shown in the approval prompt (e.g. what would be shared). */
  preview?: string;
  /** Per-call override of the tool's approval policy (e.g. sensitive memories). */
  needsApproval?: boolean;
  /** Offer "always allow this session"; false for sensitive or destructive calls. */
  allowAlways?: boolean;
  execute(): Promise<string>;
}

export interface ToolContext {
  workspace: string;
  memory: MemoryStore;
  reminders: ReminderStore;
  google: GoogleAuth;
  threadId: string;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  approval: "ask" | "auto";
  prepare(args: Record<string, unknown>, ctx: ToolContext): Promise<PreparedCall>;
}

const TOOLS: Tool[] = [
  ...MEMORY_TOOLS,
  ...REMINDER_TOOLS,
  ...CALENDAR_TOOLS,
  ...GMAIL_TOOLS,
  {
    name: "clipboard_read",
    description:
      "Read the text currently on the user's system clipboard. Use when the user refers to something they copied (e.g. 'summarise what I copied').",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    approval: "ask",
    // Read up front so the prompt previews exactly what the model would receive.
    async prepare() {
      const text = await readClipboard();
      const clipped = text.length > MAX_CLIPBOARD_CHARS;
      const body = clipped ? text.slice(0, MAX_CLIPBOARD_CHARS) : text;
      return {
        summary: `read clipboard (${text.length} chars)`,
        preview: text ? truncate(text, 160) : "(empty or not text)",
        execute: async () =>
          text ? body + (clipped ? `\n\n[truncated: showing ${MAX_CLIPBOARD_CHARS} of ${text.length} chars]` : "") : "(clipboard is empty or contains no text)",
      };
    },
  },
  {
    name: "clipboard_write",
    description: "Replace the user's clipboard with the given text so they can paste it. Use when the user asks you to copy something.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Exact text to put on the clipboard." } },
      required: ["text"],
      additionalProperties: false,
    },
    approval: "auto",
    async prepare(args) {
      const text = typeof args.text === "string" ? args.text : "";
      if (!text) throw new Error("`text` must be a non-empty string");
      return {
        summary: `copied ${text.length} chars to clipboard`,
        execute: async () => {
          await writeClipboard(text);
          return `Copied ${text.length} characters to the clipboard.`;
        },
      };
    },
  },
  {
    name: "open",
    description:
      "Open a web URL (http, https, mailto) in the default browser, or an existing local file or folder in its default app. Relative paths resolve against the workspace; ~ is the home directory.",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string", description: "URL or file/folder path." } },
      required: ["target"],
      additionalProperties: false,
    },
    approval: "ask",
    async prepare(args, ctx) {
      const target = resolveOpenTarget(String(args.target ?? ""), ctx.workspace);
      const shown = target.kind === "path" ? tildify(target.value) : target.value;
      return {
        summary: `open ${shown}`,
        execute: async () => {
          openWithDefaultApp(target.value);
          return `Opened ${shown}.`;
        },
      };
    },
  },
];

export const TOOL_SPECS: DynamicToolSpec[] = TOOLS.map((t) => ({
  type: "function",
  name: t.name,
  description: t.description,
  inputSchema: t.inputSchema as DynamicToolFunctionSpec["inputSchema"],
}));

/** Short description of a finished dynamic tool call, for the activity line. */
export function describeToolCall(tool: string, args: unknown, ok = true): string {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  switch (tool) {
    case "clipboard_read":
      return "⚙ read clipboard";
    case "clipboard_write":
      return `⚙ copied ${typeof a.text === "string" ? a.text.length : "?"} chars to clipboard`;
    case "open":
      return `⚙ open ${truncate(String(a.target ?? ""), 80)}`;
    default:
      return describeMemoryCall(tool, a, ok) ?? describeReminderCall(tool, a, ok) ?? describeCalendarCall(tool, a, ok) ?? describeGmailCall(tool, a, ok) ?? `⚙ ${tool}`;
  }
}

export type ToolDecision = "accept" | "acceptForSession" | "decline";

export class ToolRunner {
  // Tools the user chose "always" for, in this Jarvis session.
  private alwaysAllowed = new Set<string>();

  constructor(
    private readonly workspace: string,
    private readonly memory: MemoryStore,
    private readonly reminders: ReminderStore,
    private readonly google: GoogleAuth,
  ) {}

  async call(req: DynamicToolCallParams, ui: Interactions): Promise<DynamicToolCallResponse> {
    const fail = (text: string): DynamicToolCallResponse => ({ success: false, contentItems: [{ type: "inputText", text }] });
    const tool = TOOLS.find((t) => t.name === req.tool && !req.namespace);
    if (!tool) return fail(`Unknown tool: ${req.tool}`);

    const args = req.arguments && typeof req.arguments === "object" && !Array.isArray(req.arguments) ? req.arguments : {};
    let call: PreparedCall;
    try {
      call = await tool.prepare(args as Record<string, unknown>, { workspace: this.workspace, memory: this.memory, reminders: this.reminders, google: this.google, threadId: req.threadId });
    } catch (e) {
      return fail(`Invalid call: ${e instanceof Error ? e.message : String(e)}`);
    }

    const ask = call.needsApproval ?? tool.approval === "ask";
    if (ask && !(call.allowAlways !== false && this.alwaysAllowed.has(tool.name))) {
      const decision = await ui.approveTool(tool.name, call.summary, call.preview, call.allowAlways !== false);
      if (decision === "decline") return fail("The user declined this action.");
      if (decision === "acceptForSession") this.alwaysAllowed.add(tool.name);
    }

    try {
      return { success: true, contentItems: [{ type: "inputText", text: await call.execute() }] };
    } catch (e) {
      return fail(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
