import { mkdirSync } from "node:fs";
import { ensureCodexHome } from "./home.js";
import type { InitializeResponse, ServerNotification } from "./protocol/index.js";
import type {
  AccountLoginCompletedNotification,
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
  ThreadStartResponse,
  TurnStartResponse,
  Turn,
  TurnError,
} from "./protocol/v2/index.js";
import { CodexClient } from "./rpc.js";
import { config, PERSONA } from "./config.js";

export interface TurnCallbacks {
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onItemStarted?: (item: ThreadItem) => void;
  onItemCompleted?: (item: ThreadItem) => void;
  onTokenUsage?: (usage: ThreadTokenUsage) => void;
  onError?: (err: TurnError, willRetry: boolean) => void;
}

interface ActiveTurn {
  threadId: string;
  turnId: string | null;
  started: boolean;
  interruptRequested: boolean;
}

export class Session {
  readonly client: CodexClient;
  threadId: string | null = null;
  model = config.model;
  effort = config.effort;

  constructor() {
    const codexHome = ensureCodexHome();
    this.client = new CodexClient(config.codexBin, [], { ...process.env, CODEX_HOME: codexHome });
    // Chat mode never grants tool access; decline anything that slips through.
    this.client.onServerRequest(async (req) => {
      switch (req.method) {
        case "item/commandExecution/requestApproval":
        case "item/fileChange/requestApproval":
          return { decision: "decline" };
        default:
          throw new Error(`unsupported server request: ${req.method}`);
      }
    });
    this.client.on("notification", (n) => {
      if (n.method === "account/rateLimits/updated") this.mergeRateLimits(n.params.rateLimits);
    });
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
      clientInfo: { name: "jarvis", title: "Jarvis", version: "0.1.0" },
      capabilities: null,
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

  /** Settings shared by thread/start and thread/resume so resumed threads stay in chat mode. */
  private threadSettings() {
    mkdirSync(config.workspace, { recursive: true });
    return {
      model: this.model,
      cwd: config.workspace,
      sandbox: "read-only" as const,
      approvalPolicy: "never" as const,
      developerInstructions: PERSONA,
      config: { model_reasoning_effort: this.effort },
    };
  }

  async newThread(): Promise<ThreadStartResponse> {
    const res = await this.client.request<ThreadStartResponse>("thread/start", this.threadSettings());
    this.threadId = res.thread.id;
    return res;
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
    const res = await this.client.request<ThreadResumeResponse>("thread/resume", {
      threadId,
      ...this.threadSettings(),
    });
    this.threadId = res.thread.id;
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
  async send(text: string, cb: TurnCallbacks = {}): Promise<Turn> {
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
          input: [{ type: "text", text, text_elements: [] }],
          model: this.model,
          effort: this.effort,
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
  }
}
