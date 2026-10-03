/**
 * The desktop version of everything Codex or Edward's own tools may ask mid-conversation: each
 * request becomes a card in the conversation, and the turn waits for the user's answer.
 */
import { randomUUID } from "node:crypto";
import type { Interactions } from "../../src/interactions.js";
import type { ToolDecision } from "../../src/tools.js";
import { displayCommand, stripControl, tildify } from "../../src/util.js";
import type { Ask, AskAnswer } from "../shared/api.js";

type Send = (ask: Ask) => void;
type Done = (id: string) => void;

export class GuiInteractions implements Interactions {
  private waiting = new Map<string, (a: AskAnswer | null) => void>();

  constructor(
    private readonly show: Send,
    private readonly done: Done,
    /** Cancels the running turn (the user cancelled a request). */
    private readonly cancelTurn: () => void,
  ) {}

  /** The window's answer to a card. */
  answer(id: string, a: AskAnswer) {
    const resolve = this.waiting.get(id);
    this.waiting.delete(id);
    resolve?.(a);
    this.done(id);
  }

  /** The server withdrew its request: close every open card. */
  cancelPending() {
    for (const [id, resolve] of this.waiting) {
      resolve(null);
      this.done(id);
    }
    this.waiting.clear();
  }

  private ask(a: Omit<Ask, "id">): Promise<AskAnswer | null> {
    const id = randomUUID();
    const clean = JSON.parse(stripControl(JSON.stringify(a))) as Omit<Ask, "id">;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.show({ id, ...clean });
    });
  }

  private decision(a: AskAnswer | null): "accept" | "acceptForSession" | "decline" | "cancel" {
    if (!a || !("decision" in a)) return "cancel";
    if (a.decision === "cancel") this.cancelTurn();
    return a.decision;
  }

  async approveCommand(req: Parameters<Interactions["approveCommand"]>[0]) {
    const context = [req.cwd && `in ${tildify(req.cwd)}`, req.reason && `reason: ${req.reason}`, req.networkApprovalContext && `network: ${req.networkApprovalContext.host}`].filter(Boolean);
    const a = await this.ask({
      kind: "command",
      title: "Run this command?",
      summary: context.join(" · "),
      preview: displayCommand(req.command ?? "(unknown)"),
    });
    return this.decision(a);
  }

  async approveFileChange(req: Parameters<Interactions["approveFileChange"]>[0], changes: Parameters<Interactions["approveFileChange"]>[1]) {
    const verb = (k: string) => (k === "add" ? "Create" : k === "delete" ? "Delete" : "Change");
    const lines = changes.map((c) => `${verb(c.kind.type)} ${tildify(c.path)}${c.kind.type === "update" && c.kind.move_path ? ` → ${tildify(c.kind.move_path)}` : ""}`);
    const a = await this.ask({
      kind: "file",
      title: changes.length === 1 ? "Change this file?" : `Change ${changes.length} files?`,
      summary: [req.grantRoot && `gives write access to ${tildify(req.grantRoot)}`, req.reason && `reason: ${req.reason}`].filter(Boolean).join(" · "),
      preview: lines.join("\n") || "(no details available)",
    });
    return this.decision(a);
  }

  async approvePermissions(req: Parameters<Interactions["approvePermissions"]>[0]) {
    const { network, fileSystem } = req.permissions;
    const lines = [network?.enabled ? "network access" : "", ...(fileSystem?.read ?? []).map((p) => `read ${tildify(p)}`), ...(fileSystem?.write ?? []).map((p) => `write ${tildify(p)}`)].filter(Boolean);
    const a = await this.ask({ kind: "permissions", title: "Give Codex extra permissions?", summary: req.reason ?? "", preview: lines.join("\n") });
    const d = this.decision(a);
    if (d !== "accept" && d !== "acceptForSession") return { permissions: {}, scope: "turn" as const };
    return { permissions: { ...(network ? { network } : {}), ...(fileSystem ? { fileSystem } : {}) }, scope: d === "acceptForSession" ? ("session" as const) : ("turn" as const) };
  }

  async askUser(req: Parameters<Interactions["askUser"]>[0]) {
    const a = await this.ask({
      kind: "question",
      title: req.questions.length === 1 ? "A question for you" : "Some questions for you",
      summary: "",
      questions: req.questions.map((q) => ({ id: q.id, header: q.header ?? "", question: q.question, options: (q.options ?? []).map((o) => o.label) })),
    });
    if (!a || !("answers" in a)) {
      this.cancelTurn();
      return { answers: {} };
    }
    return { answers: Object.fromEntries(Object.entries(a.answers).map(([k, v]) => [k, { answers: [v] }])) };
  }

  async elicit() {
    // Connector forms aren't used by Edward (apps are off); decline rather than guess.
    return { action: "decline" as const, content: null, _meta: null };
  }

  async approveTool(tool: string, summary: string, preview?: string, allowAlways = true): Promise<ToolDecision> {
    const a = await this.ask({ kind: "tool", title: toolTitle(tool), summary, preview, allowAlways });
    const d = this.decision(a);
    return d === "accept" || d === "acceptForSession" ? d : "decline";
  }
}

const TITLES: Record<string, string> = {
  gmail_send: "Send this email?",
  gmail_draft: "Save this draft in Gmail?",
  calendar_create: "Add this event?",
  calendar_update: "Change this event?",
  calendar_delete: "Remove this event?",
  bill_mark_paid: "Mark this bill as paid?",
  clipboard_read: "Let Edward read your clipboard?",
  open: "Open this?",
  "auto mode": "Turn on Auto mode?",
  "forget all bills": "Forget all bills?",
  "export to OneDrive": "Export to OneDrive?",
};

const toolTitle = (tool: string) => TITLES[tool] ?? `Allow ${tool.replace(/_/g, " ")}?`;
