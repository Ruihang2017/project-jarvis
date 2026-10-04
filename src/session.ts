import { mkdirSync } from "node:fs";
import { ensureCodexHome } from "./home.js";
import { declineAll, type Interactions } from "./interactions.js";
import type { InitializeResponse, ServerNotification, ServerRequest } from "./protocol/index.js";
import type {
  AccountLoginCompletedNotification,
  AskForApproval,
  FileUpdateChange,
  SandboxMode,
  SandboxPolicy,
  GetAccountRateLimitsResponse,
  GetAccountResponse,
  LoginAccountResponse,
  Model,
  ModelListResponse,
  Thread,
  RateLimitSnapshot,
  ThreadItem,
  ThreadListResponse,
  ThreadResumeResponse,
  ThreadTokenUsage,
  ThreadTurnsListResponse,
  ThreadStartResponse,
  TurnStartResponse,
  Turn,
  TurnError,
} from "./protocol/v2/index.js";
import { CodexClient } from "./rpc.js";
import { TOOL_SPECS, ToolRunner } from "./tools.js";
import { memoryInstructions } from "./memory/prompt.js";
import { MemoryStore } from "./memory/store.js";
import { REMINDER_INSTRUCTIONS } from "./reminders/prompt.js";
import { ReminderStore } from "./reminders/store.js";
import { Accounts } from "./accounts/accounts.js";
import { BillStore } from "./bills/store.js";
import { NoticeStore } from "./headsup/notices.js";
import { DigestStore } from "./headsup/mailsummary.js";
import { TripStore } from "./headsup/trips.js";
import { BILL_INSTRUCTIONS } from "./bills/tools.js";
import { googleInstructions } from "./google/instructions.js";
import { config, PERSONA } from "./config.js";
import { guardOutgoing, type Source } from "./privacy/outgoing.js";
import type { Category } from "./privacy/guard.js";
import { relative, isAbsolute, resolve } from "node:path";
import { stripControlDeep } from "./util.js";
import { loadSettings } from "./settings.js";

/** Whether a path (absolute or workspace-relative) lies inside the Edward workspace. */
function insideWorkspace(p: string): boolean {
  const rel = relative(config.workspace, resolve(config.workspace, p));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export interface TurnCallbacks {
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onItemStarted?: (item: ThreadItem) => void;
  onItemCompleted?: (item: ThreadItem) => void;
  onTokenUsage?: (usage: ThreadTokenUsage) => void;
  onError?: (err: TurnError, willRetry: boolean) => void;
}

/**
 * Permission modes (S1, like Claude Code's). Only chat is "guarded": Codex's own channels (shell,
 * file reading, local image viewing, browser) are switched off, so everything the model sees came
 * through Edward and its privacy guard. The others let Codex run commands, whose output goes
 * straight to the model.
 */
export type Mode = "chat" | "manual" | "semi-auto" | "auto";

/** Shift+Tab cycles these; auto is only reachable with /mode auto (and a confirmation). */
export const MODE_CYCLE: Mode[] = ["chat", "manual", "semi-auto"];

interface ModeSpec {
  sandbox: SandboxMode;
  approvalPolicy: AskForApproval;
  sandboxPolicy: SandboxPolicy;
  guarded: boolean;
  /** Accept file edits inside the Edward workspace without asking. */
  autoApproveEdits: boolean;
}

// Approval is the safeguard in manual/semi-auto: "untrusted" asks before every command and patch.
// Not workspace-write: on Windows (codex 0.156.1) it doesn't confine approved commands anyway, and
// approved apply_patch calls hang inside its sandbox helper.
export const MODES: Record<Mode, ModeSpec> = {
  chat: { sandbox: "read-only", approvalPolicy: "never", sandboxPolicy: { type: "readOnly", networkAccess: false }, guarded: true, autoApproveEdits: false },
  manual: { sandbox: "danger-full-access", approvalPolicy: "untrusted", sandboxPolicy: { type: "dangerFullAccess" }, guarded: false, autoApproveEdits: false },
  "semi-auto": { sandbox: "danger-full-access", approvalPolicy: "untrusted", sandboxPolicy: { type: "dangerFullAccess" }, guarded: false, autoApproveEdits: true },
  auto: { sandbox: "danger-full-access", approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" }, guarded: false, autoApproveEdits: true },
};

/**
 * Codex features that read data without going through Edward. Off in guarded threads; per-thread
 * `config` works (verified 2026-10-02, codex 0.156.1; the nested form — dotted keys did not).
 * Browser and computer use stay off everywhere: Edward has no UI for them.
 */
export function codexChannels(guarded: boolean) {
  return {
    features: {
      shell_tool: !guarded,
      unified_exec: !guarded,
      view_image: !guarded,
      browser_use: false,
      computer_use: false,
      in_app_browser: false,
      multi_agent: false,
    },
  };
}

interface ActiveTurn {
  threadId: string;
  turnId: string | null;
  started: boolean;
  interruptRequested: boolean;
}

/** Per-thread Codex config: effort, the mode's channel switches, and web search off when the user turned it off. */
export function threadConfig(effort: string, mode: Mode) {
  return { model_reasoning_effort: effort, ...codexChannels(MODES[mode].guarded), ...(loadSettings().webSearch === "off" ? { web_search: "disabled" } : {}) };
}

export class Session {
  readonly client: CodexClient;
  threadId: string | null = null;
  model = config.model;
  effort = config.effort;
  mode: Mode = "chat";
  /** Local image paths queued by /image; sent with (and cleared by) the next message. */
  pendingImages: string[] = [];
  /**
   * Latest image generated in this thread, re-attached to the next message: generated images
   * don't enter the model context, so without this, edits would apply to an older image.
   */
  lastGeneratedImage: string | null = null;
  /** Memory ids already auto-attached in the current thread (they stay in its context). */
  recalledIds = new Set<number>();
  interactions: Interactions = declineAll;
  // Approval requests don't carry the diff; remember it from the fileChange item.
  private fileChanges = new Map<string, FileUpdateChange[]>();
  readonly memory = new MemoryStore();
  readonly reminders = new ReminderStore();
  /** Connected Google accounts (A1). */
  readonly accounts = new Accounts();
  readonly bills = new BillStore();
  /** Heads-ups already shown (H). */
  readonly notices = new NoticeStore();
  /** Mail summaries (H4). */
  readonly digests = new DigestStore();
  /** Trips found in booking emails (H2). */
  readonly trips = new TripStore();
  private tools = new ToolRunner(config.workspace, this.memory, this.reminders, this.accounts, this.bills);
  /** Told whenever the privacy guard removed something on its way to Codex. */
  onRedacted?: (source: Source, removed: Category[]) => void;
  /** Throwaway threads (runEphemeral): their redactions are reported as "background", not "your message". */
  private ephemeralThreads = new Set<string>();

  constructor() {
    const codexHome = ensureCodexHome();
    // Every message to Codex passes the privacy guard (S1), whichever code path produced it.
    const filter = guardOutgoing((source, removed, threadId) =>
      this.onRedacted?.(threadId && this.ephemeralThreads.has(threadId) ? "background" : source, removed),
    );
    this.client = new CodexClient(config.codexBin, [], { ...process.env, CODEX_HOME: codexHome }, filter);
    this.client.onServerRequest((req) => this.handleServerRequest(req));
    this.client.on("serverRequestCancelled", () => this.interactions.cancelPending?.());
    this.client.on("notification", (n) => {
      if (n.method === "account/rateLimits/updated") this.mergeRateLimits(n.params.rateLimits);
      if (n.method === "item/started" && n.params.item.type === "fileChange") {
        this.fileChanges.set(n.params.item.id, n.params.item.changes);
      }
      if (n.method === "item/completed") this.fileChanges.delete(n.params.item.id);
      // The server doesn't always withdraw a request explicitly: a timed-out dynamic tool call just
      // completes its item, then the turn ends. Either way the open prompt is moot.
      const moot =
        (n.method === "item/completed" && this.openRequests.has(n.params.item.id)) ||
        (n.method === "turn/completed" && [...this.openRequests.values()].includes(n.params.turn.id));
      if (moot) this.interactions.cancelPending?.();
    });
  }

  /** Server requests awaiting the user, keyed by item/call id → turn id. */
  private openRequests = new Map<string, string>();

  private async handleServerRequest(raw: ServerRequest): Promise<unknown> {
    // What Codex asks or passes on is model-written: no terminal control characters in prompts or tool arguments.
    const req = stripControlDeep(raw);
    const p = req.params as { itemId?: string; callId?: string; turnId?: string | null };
    const key = p.itemId ?? p.callId;
    if (key && p.turnId) this.openRequests.set(key, p.turnId);
    try {
      return await this.dispatchServerRequest(req);
    } finally {
      if (key) this.openRequests.delete(key);
    }
  }

  private async dispatchServerRequest(req: ServerRequest): Promise<unknown> {
    const ui = this.interactions;
    switch (req.method) {
      case "item/commandExecution/requestApproval":
        return { decision: await ui.approveCommand(req.params) };
      case "item/fileChange/requestApproval": {
        const changes = this.fileChanges.get(req.params.itemId) ?? [];
        if (MODES[this.mode].autoApproveEdits && changes.length && changes.every((c) => insideWorkspace(c.path))) return { decision: "accept" };
        return { decision: await ui.approveFileChange(req.params, changes) };
      }
      case "item/permissions/requestApproval":
        return ui.approvePermissions(req.params);
      case "item/tool/requestUserInput":
        return ui.askUser(req.params);
      case "mcpServer/elicitation/request":
        return ui.elicit(req.params);
      case "item/tool/call":
        return this.tools.call(req.params, ui);
      // Legacy v1 approvals; v2 threads shouldn't send these.
      case "execCommandApproval":
      case "applyPatchApproval":
        return { decision: "abort" };
      default:
        throw new Error(`unsupported server request: ${req.method}`);
    }
  }

  /** Latest known plan limits; seeded by rateLimits(), kept fresh by server pushes. */
  limits: RateLimitSnapshot | null = null;

  // Updates are sparse: null fields mean "unchanged". Ignore snapshots for other limit ids.
  private mergeRateLimits(update: RateLimitSnapshot) {
    const cur = this.limits;
    if (!cur) return;
    if (update.limitId && cur.limitId && update.limitId !== cur.limitId) return;
    this.limits = {
      ...cur,
      primary: update.primary ?? cur.primary,
      secondary: update.secondary ?? cur.secondary,
      rateLimitReachedType: update.rateLimitReachedType ?? cur.rateLimitReachedType,
    };
  }

  async init(): Promise<GetAccountResponse> {
    await this.client.request<InitializeResponse>("initialize", {
      clientInfo: { name: "edward", title: "Edward", version: "0.2.0" },
      // Needed for dynamicTools (Edward tools); experimental fields may change across codex versions.
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.client.notify("initialized");
    return this.client.request<GetAccountResponse>("account/read", { refreshToken: false });
  }

  /**
   * Browser-based ChatGPT sign-in; app-server hosts the OAuth callback.
   * `onUrl` receives the URL to open. Resolves once login completes.
   */
  async login(onUrl: (url: string) => void): Promise<void> {
    const done = new Promise<AccountLoginCompletedNotification>((resolve) => {
      const onNote = (n: ServerNotification) => {
        if (n.method !== "account/login/completed") return;
        this.client.off("notification", onNote);
        resolve(n.params);
      };
      this.client.on("notification", onNote);
    });
    const res = await this.client.request<LoginAccountResponse>("account/login/start", { type: "chatgpt" });
    if (res.type !== "chatgpt") throw new Error(`unexpected login type: ${res.type}`);
    onUrl(res.authUrl);
    const result = await done;
    if (!result.success) throw new Error(`login failed: ${result.error ?? "unknown error"}`);
  }

  /** Settings shared by thread/start and thread/resume so resumed threads get Edward's mode and persona. */
  private threadSettings() {
    mkdirSync(config.workspace, { recursive: true });
    return {
      model: this.model,
      cwd: config.workspace,
      sandbox: MODES[this.mode].sandbox,
      approvalPolicy: MODES[this.mode].approvalPolicy,
      // Rebuilt on every start/resume so the thread sees the current long-term core.
      developerInstructions: PERSONA + memoryInstructions(this.memory) + REMINDER_INSTRUCTIONS + googleInstructions(this.accounts) + BILL_INSTRUCTIONS,
      config: threadConfig(this.effort, this.mode),
    };
  }

  /**
   * Switches permission mode. Codex fixes a thread's features when it is loaded (a resume of a
   * loaded thread ignores new config), so crossing the guarded boundary unloads the thread and
   * resumes it with the new channel switches: same thread id, history and Edward tools (verified
   * 2026-10-02). A chat turn therefore never runs with the shell still on.
   */
  /** Reloads the current thread so changed thread-level settings (web search on/off) take effect. */
  async reloadThread(): Promise<void> {
    if (this.busy) throw new Error("can't change this during a reply");
    if (!this.threadId) return;
    await this.client.request("thread/unsubscribe", { threadId: this.threadId });
    await this.client.request<ThreadResumeResponse>("thread/resume", { threadId: this.threadId, ...this.threadSettings() });
  }

  async setMode(next: Mode): Promise<void> {
    if (this.busy) throw new Error("can't switch modes during a reply");
    const crossing = MODES[this.mode].guarded !== MODES[next].guarded;
    const prev = this.mode;
    this.mode = next;
    if (!crossing || !this.threadId) return;
    try {
      await this.client.request("thread/unsubscribe", { threadId: this.threadId });
      await this.client.request<ThreadResumeResponse>("thread/resume", { threadId: this.threadId, ...this.threadSettings() });
    } catch (e) {
      // Couldn't reload with the new switches: don't claim a mode the thread doesn't have.
      this.mode = prev;
      throw e;
    }
  }

  /** Called with a thread the user just switched away from (/new, /resume) — memory learning hooks in here. */
  onLeaveThread?: (threadId: string) => void;

  private switchTo(threadId: string) {
    const prev = this.threadId;
    this.threadId = threadId;
    this.lastGeneratedImage = null;
    if (prev !== threadId) this.recalledIds = new Set();
    if (prev && prev !== threadId) this.onLeaveThread?.(prev);
  }

  async newThread(): Promise<ThreadStartResponse> {
    // Dynamic tools can only be registered at thread start (thread/resume has no such field).
    const res = await this.client.request<ThreadStartResponse>("thread/start", { ...this.threadSettings(), dynamicTools: TOOL_SPECS });
    this.switchTo(res.thread.id);
    return res;
  }

  /**
   * One-off background turn on a throwaway (ephemeral) thread, e.g. memory extraction.
   * Returns the final assistant message; with `outputSchema` that's JSON matching it.
   */
  async runEphemeral(instructions: string, input: string, outputSchema?: object, timeoutMs = 180_000): Promise<string> {
    const res = await this.client.request<ThreadStartResponse>("thread/start", {
      model: this.model,
      cwd: config.workspace,
      sandbox: "read-only",
      approvalPolicy: "never",
      developerInstructions: instructions,
      ephemeral: true,
      config: { model_reasoning_effort: "low", web_search: "disabled", ...codexChannels(true) },
    });
    const threadId = res.thread.id;
    this.ephemeralThreads.add(threadId);
    return new Promise<string>((resolve, reject) => {
      const done = (fn: () => void) => {
        clearTimeout(timer);
        this.client.off("notification", onNote);
        fn();
      };
      const timer = setTimeout(() => done(() => reject(new Error("background turn timed out"))), timeoutMs);
      const onNote = (n: ServerNotification) => {
        if (n.method !== "turn/completed" || n.params.threadId !== threadId) return;
        const { turn } = n.params;
        const last = turn.items.findLast((i) => i.type === "agentMessage");
        if (turn.status !== "completed" || !last || last.type !== "agentMessage") {
          done(() => reject(new Error(`background turn ${turn.status}: ${turn.error?.message ?? "no answer"}`)));
        } else {
          done(() => resolve(last.text));
        }
      };
      this.client.on("notification", onNote);
      this.client
        .request("turn/start", {
          threadId,
          input: [{ type: "text", text: input, text_elements: [] }],
          outputSchema: (outputSchema ?? null) as never,
        })
        .catch((e) => done(() => reject(e)));
    });
  }

  /** Completed turns of a thread with full items, oldest first. */
  async readTurns(threadId: string, limit = 40): Promise<Turn[]> {
    const res = await this.client.request<ThreadTurnsListResponse>("thread/turns/list", {
      threadId,
      limit,
      sortDirection: "desc",
      itemsView: "full",
    });
    return res.data.reverse();
  }

  async listThreads(limit = 10): Promise<Thread[]> {
    const res = await this.client.request<ThreadListResponse>("thread/list", {
      limit,
      sortKey: "updated_at",
      sortDirection: "desc",
      cwd: config.workspace,
    });
    return res.data;
  }

  async resumeThread(threadId: string): Promise<ThreadResumeResponse> {
    // A thread already loaded in this app-server keeps the features it was loaded with; unload it
    // first so it picks up the current mode's channel switches. Not loaded is fine.
    await this.client.request("thread/unsubscribe", { threadId }).catch(() => {});
    const res = await this.client.request<ThreadResumeResponse>("thread/resume", {
      threadId,
      ...this.threadSettings(),
    });
    this.switchTo(res.thread.id);
    return res;
  }

  private modelCache: Model[] | null = null;

  async listModels(): Promise<Model[]> {
    this.modelCache ??= (await this.client.request<ModelListResponse>("model/list", {})).data;
    return this.modelCache;
  }

  async rateLimits(): Promise<GetAccountRateLimitsResponse> {
    const res = await this.client.request<GetAccountRateLimitsResponse>("account/rateLimits/read", undefined);
    this.limits = res.rateLimits;
    return res;
  }

  get busy(): boolean {
    return this.activeTurn !== null;
  }

  /** Requests cancellation of the in-flight turn; `send()` then resolves with status "interrupted". */
  async interrupt(): Promise<void> {
    const t = this.activeTurn;
    if (!t) return;
    // The server rejects turn/interrupt until it emits turn/started; defer until then.
    if (!t.turnId || !t.started) {
      t.interruptRequested = true;
      return;
    }
    await this.client.request("turn/interrupt", { threadId: t.threadId, turnId: t.turnId });
  }

  private activeTurn: ActiveTurn | null = null;

  /** Sends one user message and resolves when the turn completes. */
  async send(text: string, cb: TurnCallbacks = {}, images: string[] = [], notes: string[] = []): Promise<Turn> {
    if (this.activeTurn) throw new Error("a turn is already in progress");
    // Register before any await so interrupt() during thread creation is honored.
    const active: ActiveTurn = { threadId: "", turnId: null, started: false, interruptRequested: false };
    this.activeTurn = active;
    try {
      if (!this.threadId) await this.newThread();
    } catch (e) {
      this.activeTurn = null;
      throw e;
    }
    const threadId = (active.threadId = this.threadId!);

    return new Promise<Turn>((resolve, reject) => {
      const off = () => {
        this.client.off("notification", onNote);
        this.client.off("exit", onExit);
        this.activeTurn = null;
      };
      const onExit = (code: number | null) => {
        off();
        reject(new Error(`codex app-server exited (${code})`));
      };
      const onNote = (n: ServerNotification) => {
        if (!("params" in n) || (n.params as { threadId?: string }).threadId !== threadId) return;
        switch (n.method) {
          case "turn/started":
            active.turnId = n.params.turn.id;
            active.started = true;
            if (active.interruptRequested) void this.interrupt().catch(() => {});
            break;
          case "item/agentMessage/delta":
            cb.onDelta?.(n.params.delta);
            break;
          case "item/reasoning/summaryTextDelta":
            cb.onReasoning?.(n.params.delta);
            break;
          case "item/started":
            cb.onItemStarted?.(n.params.item);
            break;
          case "item/completed":
            cb.onItemCompleted?.(n.params.item);
            break;
          case "thread/tokenUsage/updated":
            cb.onTokenUsage?.(n.params.tokenUsage);
            break;
          case "error":
            cb.onError?.(n.params.error, n.params.willRetry);
            break;
          case "turn/completed":
            if (active.turnId && n.params.turn.id !== active.turnId) return;
            off();
            resolve(n.params.turn);
            break;
        }
      };
      this.client.on("notification", onNote);
      this.client.on("exit", onExit);

      this.client
        .request<TurnStartResponse>("turn/start", {
          threadId,
          input: [
            { type: "text", text, text_elements: [] },
            ...images.map((path) => ({ type: "localImage" as const, path })),
            ...notes.map((note) => ({ type: "text" as const, text: note, text_elements: [] })),
          ],
          model: this.model,
          effort: this.effort,
          // Per-turn so /mode applies to the current thread immediately.
          approvalPolicy: MODES[this.mode].approvalPolicy,
          sandboxPolicy: MODES[this.mode].sandboxPolicy,
        })
        .then((res) => {
          active.turnId ??= res.turn.id;
        })
        .catch((err) => {
          off();
          reject(err);
        });
    });
  }

  close() {
    this.client.close();
    this.memory.close();
    this.reminders.close();
    this.bills.close();
    this.notices.close();
    this.digests.close();
    this.trips.close();
  }
}
