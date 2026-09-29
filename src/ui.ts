import { createInterface, type Interface } from "node:readline/promises";
import { styleText } from "node:util";
import type { Session } from "./session.js";
import { runCommand } from "./commands.js";
import { MarkdownStream } from "./markdown.js";
import { describeChange, terminalInteractions } from "./prompts.js";
import type { RateLimitWindow, ThreadItem, ThreadTokenUsage, TurnStatus } from "./protocol/v2/index.js";
import { displayCommand, truncate } from "./util.js";

const dim = (s: string) => styleText("dim", s);
const USER_PROMPT = styleText("cyan", "you › ");
const BOT_PREFIX = styleText("magenta", "jarvis › ");
const tty = Boolean(process.stdout.isTTY);
const color = tty && !process.env.NO_COLOR;

/**
 * Routes input lines: while a prompt (approval/question) is waiting, the next line answers it;
 * otherwise lines queue up as chat messages, so type-ahead during a reply isn't lost.
 */
class LineInput {
  private queue: string[] = [];
  private waiter: ((line: string | null) => void) | null = null;
  private asker: ((line: string | null) => void) | null = null;
  closed = false;

  constructor(private readonly rl: Interface) {
    rl.on("line", (line) => {
      if (this.asker) return this.settle("asker", line);
      if (this.waiter) return this.settle("waiter", line);
      this.queue.push(line);
    });
    rl.on("close", () => {
      this.closed = true;
      this.settle("asker", null);
      this.settle("waiter", null);
    });
  }

  get asking(): boolean {
    return this.asker !== null;
  }

  /** Next chat line, or null once input is closed. */
  next(): Promise<string | null> {
    if (this.queue.length) return Promise.resolve(this.queue.shift()!);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => (this.waiter = resolve));
  }

  /** Reads one answer line with its own prompt. Resolves null on Ctrl+C or closed input. */
  async ask(prompt: string): Promise<string | null> {
    if (this.closed) return null;
    this.rl.setPrompt(prompt);
    this.rl.prompt();
    try {
      return await new Promise<string | null>((resolve) => (this.asker = resolve));
    } finally {
      this.rl.setPrompt(USER_PROMPT);
    }
  }

  cancelAsk() {
    this.settle("asker", null);
  }

  private settle(which: "asker" | "waiter", line: string | null) {
    const fn = this[which];
    this[which] = null;
    fn?.(line);
  }
}

/** Hooks the prompts use to move the in-flight reply rendering out of the way. */
interface RenderControl {
  pause(): void;
  resume(): void;
}
let activeRender: RenderControl | null = null;

export async function repl(session: Session): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
  const input = new LineInput(rl);
  let quitting = false;
  let lastSigint = 0;

  session.interactions = terminalInteractions(
    {
      ask: (p) => input.ask(p),
      pauseRender: () => activeRender?.pause(),
      resumeRender: () => activeRender?.resume(),
    },
    () => void session.interrupt().catch(() => {}),
  );

  rl.on("SIGINT", () => {
    // Answering a prompt: Ctrl+C cancels it (and the turn).
    if (input.asking) {
      process.stdout.write("\n");
      input.cancelAsk();
      return;
    }
    // During a turn: first Ctrl+C interrupts, a second within 1s force-quits.
    if (session.busy) {
      const now = Date.now();
      if (now - lastSigint < 1000) process.exit(130);
      lastSigint = now;
      process.stdout.write(dim("\n[interrupting…]"));
      session.interrupt().catch((e) => console.error(dim(`\n[interrupt failed] ${e.message}`)));
      return;
    }
    // At the prompt: clear a partial line, or exit on an empty one.
    if (rl.line.length > 0) {
      rl.write(null, { ctrl: true, name: "u" });
      return;
    }
    rl.close();
  });

  session.client.on("exit", (code) => {
    if (quitting) return; // expected: session.close() on quit
    console.error(dim(`\n[codex app-server exited (${code})]`));
    process.exit(1);
  });

  session.rateLimits().catch(() => {}); // seed the status line; failures just hide limits
  console.log(dim(`Jarvis · ${session.model} · effort ${session.effort} · ${session.mode} mode · /help for commands`));

  rl.setPrompt(USER_PROMPT);
  rl.prompt();
  for (let raw = await input.next(); raw !== null; raw = await input.next()) {
    const line = raw.trim();
    if (line.startsWith("/")) {
      if ((await runCommand(line, session)) === "exit") break;
    } else if (line) {
      await runTurn(session, line);
    }
    if (!input.closed) rl.prompt();
  }

  quitting = true;
  rl.close();
}

export interface TurnOptions {
  /** Print the `jarvis ›` prefix (REPL) or not (one-shot output). */
  prefix?: boolean;
  /** Print the model/context/limits line after the reply. */
  status?: boolean;
}

/** Sends one message and renders the streamed reply. Returns the final turn status. */
export async function runTurn(session: Session, text: string, opts: TurnOptions = {}): Promise<TurnStatus | "error"> {
  const { prefix = true, status = true } = opts;
  const out = (s: string) => s && process.stdout.write(s);
  const md = new MarkdownStream(color);
  const t0 = Date.now();
  let usage: ThreadTokenUsage | null = null;
  let started = false;
  let indicator = false;

  // Transient one-line indicator (tty only), shown only at the start of a line.
  const showIndicator = (s: string) => {
    if (!tty || (started && !md.endsWithNewline)) return;
    clearIndicator();
    out(dim(s));
    indicator = true;
  };
  const clearIndicator = () => {
    if (!indicator) return;
    out("\r\x1b[K");
    indicator = false;
  };
  const endLine = () => {
    out(md.flush());
    if (!md.endsWithNewline) {
      out("\n");
      md.endsWithNewline = true;
    }
  };
  const start = () => {
    clearIndicator();
    if (started) return;
    started = true;
    if (prefix) out(BOT_PREFIX);
  };
  // Persistent note (tool activity, errors) on its own line, before or between reply text.
  const note = (s: string) => {
    clearIndicator();
    if (started) endLine();
    out(dim(`  ${s}`) + "\n");
  };

  activeRender = {
    pause: () => {
      clearIndicator();
      if (started) endLine();
    },
    resume: () => showIndicator("working…"),
  };

  showIndicator("thinking…");
  let result: TurnStatus | "error";
  try {
    const turn = await session.send(text, {
      onDelta: (t) => {
        start();
        out(md.write(t));
      },
      onItemStarted: (item) => {
        const busy = activityLabel(item);
        if (busy) showIndicator(busy);
        // Separate consecutive assistant messages within one turn.
        else if (item.type === "agentMessage" && started) {
          endLine();
          out("\n");
        }
      },
      onItemCompleted: (item) => {
        for (const line of activityNotes(item)) note(line);
        if (activityLabel(item)) showIndicator("thinking…");
      },
      onTokenUsage: (u) => (usage = u),
      onError: (e, retry) => note(`[error${retry ? ", retrying" : ""}] ${e.message}`),
    });
    result = turn.status;
    if (turn.status === "interrupted") note("[interrupted]");
    else if (turn.status === "failed") note(`[failed] ${turn.error?.message ?? ""}`);
  } catch (e) {
    result = "error";
    note(`[error] ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    activeRender = null;
  }
  clearIndicator();
  if (started) endLine();
  if (status) out(dim(statusLine(session, usage, Date.now() - t0)) + "\n");
  if (prefix) out("\n");
  return result;
}

/** Indicator text while a tool item runs; null for items that aren't tool activity. */
function activityLabel(item: ThreadItem): string | null {
  switch (item.type) {
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
function activityNotes(item: ThreadItem): string[] {
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
    case "dynamicToolCall":
      return [`⚙ ${item.tool} · ${item.success === false || item.status === "failed" ? "failed" : "ok"}`];
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

function statusLine(session: Session, usage: ThreadTokenUsage | null, ms: number): string {
  const parts = [session.model, session.effort, `${(ms / 1000).toFixed(1)}s`];
  if (session.mode !== "chat") parts.unshift(`${session.mode} mode`);
  if (usage?.modelContextWindow) {
    parts.push(`ctx ${Math.round((usage.last.totalTokens / usage.modelContextWindow) * 100)}%`);
  }
  const l = session.limits;
  for (const w of [l?.primary, l?.secondary]) if (w) parts.push(`${windowLabel(w)} ${Math.round(w.usedPercent)}%`);
  return parts.join(" · ");
}

function windowLabel(w: RateLimitWindow): string {
  const m = w.windowDurationMins;
  if (m === 10080) return "wk";
  if (m == null) return "limit";
  return m % 60 === 0 ? `${m / 60}h` : `${m}m`;
}
