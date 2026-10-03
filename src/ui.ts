import { createInterface, type Interface } from "node:readline/promises";
import { styleText } from "node:util";
import { MODE_CYCLE, MODES, type Mode, type Session } from "./session.js";
import { runCommand, runningCommand, UNGUARDED_WARNING } from "./commands.js";
import { describeRemoved, type Category } from "./privacy/guard.js";
import type { Source } from "./privacy/outgoing.js";
import { MarkdownStream } from "./markdown.js";
import { terminalInteractions } from "./prompts.js";
import { activityLabel, activityNotes } from "./activity.js";
import { backgroundSuggestion, claimDueNow, handleGeneratedImage, startBackgroundWork, turnInputs } from "./assistant.js";
import type { RateLimitWindow, ThreadTokenUsage, TurnStatus } from "./protocol/v2/index.js";
import { envVar, loadSettings, updateSettings } from "./settings.js";
import { showToast } from "./background/notify.js";
import { reminderToast } from "./background/tick.js";
import { missingFeatures } from "./google/instructions.js";
import { noticeLine, noticeToast } from "./bills/remind.js";
import { GETTING_STARTED } from "./setup.js";
import { detectSixel, preview, renderPreview } from "./sixel.js";
import { formatDue, lateness } from "./reminders/schedule.js";
import type { Fired } from "./reminders/store.js";
import { stripControl } from "./util.js";

const dim = (s: string) => styleText("dim", s);
const USER_PROMPT = styleText("cyan", "you › ");

/**
 * The input prompt always shows the permission mode when it isn't chat, so a riskier mode can't go
 * unnoticed: "you [manual] › " (yellow), "you [auto] › " (red). No ⚠ here: Windows Terminal draws it two
 * columns wide but readline counts one, so the text after it overlapped and the cursor drifted.
 */
export function modePrompt(mode: Mode, images = 0): string {
  const tags = [mode === "chat" ? "" : mode, images ? `🖼 ${images}` : ""].filter(Boolean);
  const text = tags.length ? `you [${tags.join(" · ")}] › ` : "you › ";
  return styleText(mode === "chat" ? "cyan" : mode === "auto" ? "red" : "yellow", text);
}

type KeyHandler = (s: string | undefined, key: { name?: string; shift?: boolean } | undefined) => void;

/**
 * Calls `handler` on Shift+Tab instead of letting readline insert the escape sequence. Readline has
 * no public key hook: keypresses go to an internal method keyed by a Symbol("_ttyWrite") (Node 24;
 * the string `_ttyWrite` is only a deprecated alias that keypresses don't use), so wrap that.
 * Returns false if it isn't there (then /mode still works).
 */
export function onShiftTab(rl: object, handler: () => void): boolean {
  for (let p = Object.getPrototypeOf(rl); p; p = Object.getPrototypeOf(p)) {
    const sym = Object.getOwnPropertySymbols(p).find((s) => s.description === "_ttyWrite");
    if (!sym) continue;
    const target = rl as Record<symbol, KeyHandler>;
    const original = target[sym]!;
    target[sym] = function (this: unknown, s, key) {
      if (key?.name === "tab" && key.shift) return handler();
      return original.call(this, s, key);
    };
    return true;
  }
  return false;
}

const REDACTION_SOURCE: Record<Source, string> = {
  message: "from your message",
  tool: "from a tool result",
  instructions: "from Edward's notes",
  answer: "from your answer",
  background: "from a background task (memory learning)",
};

export const redactionNotice = (source: Source, removed: Category[]) =>
  `⛔ removed ${describeRemoved(removed)} ${REDACTION_SOURCE[source]} before sending — the model didn't see it`;
const BOT_PREFIX = styleText("magenta", "edward › ");
const tty = Boolean(process.stdout.isTTY);
const color = tty && !process.env.NO_COLOR;
const REMINDER_POLL_MS = Number(envVar("REMINDER_POLL_MS") ?? 20_000);

/** "⏰ 09:00 交报销 · 2h 5m late · next Fri 10-02 09:00" */
function reminderNotice({ reminder: r, occurrence }: Fired): string {
  const late = lateness(occurrence);
  const next = r.status === "scheduled" && r.repeat ? `next ${formatDue(r.dueAt)}` : `/remind snooze ${r.id} 10m`;
  return `⏰ ${occurrence.slice(11)} ${r.text}${late ? ` · ${late}` : ""} · ${next}`;
}

/**
 * Routes input lines: while a prompt (approval/question) is waiting, the next line answers it;
 * otherwise lines queue up as chat messages, so type-ahead during a reply isn't lost.
 */
class LineInput {
  private queue: string[] = [];
  private waiter: ((line: string | null) => void) | null = null;
  private asker: ((line: string | null) => void) | null = null;
  closed = false;
  /** Restored after a question prompt; follows the current mode. */
  defaultPrompt = USER_PROMPT;

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
      this.rl.setPrompt(this.defaultPrompt);
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
    // A long-running command (/connect google): Ctrl+C cancels it.
    if (runningCommand) {
      process.stdout.write("\n");
      runningCommand.abort();
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
  console.log(dim(`Edward · ${session.model} · effort ${session.effort} · ${session.mode} mode (Shift+Tab to switch) · /help for commands`));

  // Privacy guard notices: printed above whatever is on screen (reply in progress or prompt).
  session.onRedacted = (source, removed) => printAbove(styleText("yellow", `  ${redactionNotice(source, removed)}`));
  // While the prompt waits for input, clear it, print, and redraw it with whatever was typed.
  const printAbove = (line: string) => {
    if (activeRender) {
      activeRender.pause();
      console.log(line);
      activeRender.resume();
    } else if (atPrompt && !input.asking && tty) {
      process.stdout.write("\r\x1b[K");
      console.log(line);
      rl.prompt(true);
    } else console.log(line);
  };

  // Shift+Tab cycles chat → manual → semi-auto (auto only via /mode auto). Without a TTY, /mode works.
  if (tty) onShiftTab(rl, () => cycleMode());
  const cycleMode = () => {
    if (session.busy || input.asking) return;
    const next = MODE_CYCLE[(MODE_CYCLE.indexOf(session.mode) + 1) % MODE_CYCLE.length]!;
    void session.setMode(next).then(
      () => {
        input.defaultPrompt = modePrompt(next, session.pendingImages.length);
        rl.setPrompt(input.defaultPrompt);
        process.stdout.write("\r\x1b[K");
        console.log(MODES[next].guarded ? dim(`  [mode: ${next}]`) : styleText("yellow", `  [mode: ${next}] ⚠ ${UNGUARDED_WARNING}`));
        rl.prompt(true);
      },
      (e: Error) => console.log(dim(`  [couldn't switch mode: ${e.message}]`)),
    );
  };

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
    input.defaultPrompt = modePrompt(session.mode, n);
    rl.setPrompt(input.defaultPrompt);
    rl.prompt();
    atPrompt = true;
  };

  // Memory learning, the daily tidy, the Codex version note and the daily bill scan (assistant.ts).
  const learnFailed = (e: unknown) => {
    if (envVar("DEBUG")) console.error(dim(`[memory learning failed] ${e instanceof Error ? e.message : String(e)}`));
  };
  startBackgroundWork(session, notify, learnFailed);

  // Reminders, bill notices and the daily brief due while Edward is open (the background task
  // handles the rest). Claiming is atomic, so each shows here or as a background notification.
  const checkReminders = () => {
    try {
      const due = claimDueNow(session);
      if (due.reminders.length) {
        if (tty) process.stdout.write("\x07"); // bell: flashes the tab/taskbar if Edward isn't focused
        notify(due.reminders.map(reminderNotice));
        // Also a desktop notification, in case the terminal isn't the window in front.
        for (const f of due.reminders) void showToast(reminderToast(f));
      }
      if (due.bills.length) {
        notify(due.bills.map(noticeLine));
        for (const n of due.bills) void showToast(noticeToast(n));
      }
      void due.brief?.then((brief) => notify([brief.title, ...brief.lines.map((l) => `  ${l}`)]));
    } catch (e) {
      if (envVar("DEBUG")) console.error(dim(`[reminder check failed] ${e instanceof Error ? e.message : String(e)}`));
    }
  };
  const reminderTimer = setInterval(checkReminders, REMINDER_POLL_MS);
  reminderTimer.unref();

  // First run: a few lines on how to start (again with /start).
  if (!loadSettings().onboarded) {
    updateSettings({ onboarded: true });
    console.log(styleText("bold", GETTING_STARTED[0]!));
    for (const l of GETTING_STARTED.slice(1)) console.log(dim(l));
  }
  const google = session.google.state();
  if (google?.invalidAt) queued.push("Google connection expired — /connect google to reconnect");
  else if (missingFeatures(google).length) queued.push(`${missingFeatures(google).join(" and ")} need${missingFeatures(google).length === 1 ? "s" : ""} one more Google permission — /connect google to add it`);
  showPrompt();
  checkReminders(); // anything that came due while Edward was closed
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
  clearInterval(reminderTimer);
  rl.close();
}

export interface TurnOptions {
  /** Print the `edward ›` prefix (REPL) or not (one-shot output). */
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
    out(md.write(stripControl(t)));
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
    const { images, notes } = turnInputs(session, text);
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
        const lines = item.type === "imageGeneration" ? handleGeneratedImage(item, session, text).lines : activityNotes(item);
        const suggestion = backgroundSuggestion(item);
        if (suggestion) lines.push(suggestion);
        for (const line of lines) note(stripControl(line));
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
