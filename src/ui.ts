import { existsSync } from "node:fs";
import { createInterface, type Interface } from "node:readline/promises";
import { styleText } from "node:util";
import type { Session } from "./session.js";
import { runCommand } from "./commands.js";
import { MarkdownStream } from "./markdown.js";
import { describeChange, terminalInteractions } from "./prompts.js";
import type { RateLimitWindow, ThreadItem, ThreadTokenUsage, TurnStatus } from "./protocol/v2/index.js";
import { saveGeneratedImage } from "./images.js";
import { loadSettings } from "./settings.js";
import { detectSixel, preview, renderPreview } from "./sixel.js";
import { openWithDefaultApp } from "./system.js";
import { describeToolCall } from "./tools.js";
import { RELATED_CHECK } from "./memory/tools.js";
import { MemoryLearner } from "./memory/learn.js";
import { recallFor } from "./memory/recall.js";
import { MemoryTidier } from "./memory/tidy.js";
import { displayCommand, tildify, truncate } from "./util.js";

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
  // Must run before readline owns stdin (it reads the terminal's DA1 reply).
  const mode = loadSettings().inlinePreview ?? "auto";
  preview.enabled = mode === "on" ? tty : mode === "auto" ? await detectSixel() : false;

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
  const input = new LineInput(rl);
  let quitting = false;
  let lastSigint = 0;

  session.interactions = terminalInteractions(
    {
      ask: (p) => input.ask(p),
      cancel: () => {
        if (!input.asking) return false;
        process.stdout.write("\n");
        input.cancelAsk();
        return true;
      },
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

  // Background notices (memory learning): shown above the prompt when idle, otherwise after the turn.
  let atPrompt = false;
  const queued: string[] = [];
  const printNotices = (lines: string[]) => {
    for (const l of lines) console.log(dim(`  ${l}`));
  };
  const notify = (lines: string[]) => {
    if (!lines.length || quitting) return;
    if (!atPrompt || input.asking) return void queued.push(...lines);
    if (tty) process.stdout.write("\r\x1b[K");
    else process.stdout.write("\n");
    printNotices(lines);
    rl.prompt(true); // redraws the prompt and whatever the user had typed
  };

  // Shows pending /image attachments in the prompt, e.g. "you [🖼 2] › ".
  const showPrompt = () => {
    printNotices(queued.splice(0));
    const n = session.pendingImages.length;
    rl.setPrompt(n ? styleText("cyan", `you [🖼 ${n}] › `) : USER_PROMPT);
    rl.prompt();
    atPrompt = true;
  };

  // Memory learning runs in the background: on leaving a conversation, and at startup for any missed.
  const learner = new MemoryLearner(session);
  const learnFailed = (e: unknown) => {
    if (process.env.JARVIS_DEBUG) console.error(dim(`[memory learning failed] ${e instanceof Error ? e.message : String(e)}`));
  };
  session.onLeaveThread = (id) => {
    learner.learnFromThread(id).then((r) => notify(r?.lines ?? []), learnFailed);
  };
  // Catch up on unlearned conversations first, then the daily tidy (so it sees what was just learned).
  void (async () => {
    notify((await learner.catchUp()).flatMap((r) => r.lines));
    if (learner.enabled()) notify(await new MemoryTidier(session).runIfDue());
  })().catch(learnFailed);

  showPrompt();
  for (let raw = await input.next(); raw !== null; raw = await input.next()) {
    atPrompt = false;
    const line = raw.trim();
    if (line.startsWith("/")) {
      if ((await runCommand(line, session)) === "exit") break;
    } else if (line) {
      await runTurn(session, line);
    }
    if (!input.closed) showPrompt();
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
  let ticker: NodeJS.Timeout | null = null;

  // Transient one-line indicator (tty only), shown only at the start of a line.
  // With `tick`, it redraws every second with the elapsed time (for slow tools like image generation).
  const showIndicator = (s: string, tick = false) => {
    if (!tty || (started && !md.endsWithNewline)) return;
    clearIndicator();
    out(dim(s));
    indicator = true;
    if (tick) {
      const since = Date.now();
      ticker = setInterval(() => out("\r\x1b[K" + dim(`${s} ${Math.round((Date.now() - since) / 1000)}s`)), 1000);
    }
  };
  const clearIndicator = () => {
    if (ticker) clearInterval(ticker);
    ticker = null;
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

  // While a prompt is open, hold reply text back so it doesn't land on the prompt line.
  let paused = false;
  const held: string[] = [];
  const writeDelta = (t: string) => {
    start();
    out(md.write(t));
  };
  activeRender = {
    pause: () => {
      paused = true;
      clearIndicator();
      if (started) endLine();
    },
    resume: () => {
      paused = false;
      for (const t of held.splice(0)) writeDelta(t);
      showIndicator("working…");
    },
  };

  showIndicator("thinking…");
  let result: TurnStatus | "error";
  try {
    const images = session.pendingImages.splice(0);
    const notes: string[] = [];
    // Carry the last generated image forward unless the user attached their own.
    if (session.lastGeneratedImage && !images.length && existsSync(session.lastGeneratedImage)) {
      images.push(session.lastGeneratedImage);
      notes.push("[Jarvis] The attached image is the one you generated in your previous reply. If I ask for changes, edit this image.");
    }
    session.lastGeneratedImage = null;
    const recalled = recallFor(text, session.memory, session.recalledIds);
    if (recalled) notes.push(recalled.note);
    const turn = await session.send(text, {
      onDelta: (t) => (paused ? held.push(t) : writeDelta(t)),
      onItemStarted: (item) => {
        const busy = activityLabel(item);
        if (busy) showIndicator(busy, item.type === "imageGeneration");
        // Separate consecutive assistant messages within one turn.
        else if (item.type === "agentMessage" && started) {
          endLine();
          out("\n");
        }
      },
      onItemCompleted: (item) => {
        const lines = item.type === "imageGeneration" ? imageNotes(item, session, text) : activityNotes(item);
        for (const line of lines) note(line);
        if (item.type === "imageGeneration" && session.lastGeneratedImage && preview.enabled) {
          out(renderPreview(session.lastGeneratedImage));
        }
        if (activityLabel(item)) showIndicator("thinking…");
      },
      onTokenUsage: (u) => (usage = u),
      onError: (e, retry) => note(`[error${retry ? ", retrying" : ""}] ${e.message}`),
    }, images, notes);
    result = turn.status;
    if (turn.status === "interrupted") note("[interrupted]");
    else if (turn.status === "failed") note(`[failed] ${turn.error?.message ?? ""}`);
  } catch (e) {
    result = "error";
    note(`[error] ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    // Turn ended while a prompt was open (e.g. it expired): flush what was held back.
    paused = false;
    for (const t of held.splice(0)) writeDelta(t);
    activeRender = null;
  }
  clearIndicator();
  if (started) endLine();
  if (status) out(dim(statusLine(session, usage, Date.now() - t0)) + "\n");
  if (prefix) out("\n");
  return result;
}

/** Saves a finished generation, opens it if configured, and returns the lines to show. */
function imageNotes(item: Extract<ThreadItem, { type: "imageGeneration" }>, session: Session, prompt: string): string[] {
  if (item.failure) {
    const reset = item.failure.resetsAt ? `; resets in ${Math.max(1, Math.round((item.failure.resetsAt - Date.now() / 1000) / 60))}m` : "";
    return [`🖼 image generation unavailable: usage limit reached${reset}`];
  }
  if (item.status !== "completed") return [`🖼 image generation ${item.status}`];
  try {
    const rec = saveGeneratedImage(item, { threadId: session.threadId ?? "", prompt });
    session.lastGeneratedImage = rec.path;
    if (loadSettings().autoOpenImages !== false) openWithDefaultApp(rec.path);
    const size = rec.width ? ` · ${rec.width}×${rec.height}` : "";
    const lines = [`🖼 ${tildify(rec.path)}${size}`];
    if (rec.revisedPrompt) lines.push(`   "${truncate(rec.revisedPrompt, 110)}"`);
    return lines;
  } catch (e) {
    return [`🖼 couldn't save image: ${e instanceof Error ? e.message : String(e)}`];
  }
}

/** Indicator text while a tool item runs; null for items that aren't tool activity. */
function activityLabel(item: ThreadItem): string | null {
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
    case "dynamicToolCall": {
      // Jarvis's own tools report declines/errors as failed calls; surface the reason.
      const failed = item.success === false || item.status === "failed";
      const reason = item.contentItems?.find((c) => c.type === "inputText");
      if (failed && reason?.type === "inputText" && reason.text.includes(RELATED_CHECK)) {
        return ["🧠 checking related memories before saving…"];
      }
      const suffix = failed ? ` · ${reason && reason.type === "inputText" ? truncate(reason.text, 80) : "failed"}` : "";
      return [`${describeToolCall(item.tool, item.arguments, !failed)}${suffix}`];
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
