import { createInterface } from "node:readline/promises";
import { styleText } from "node:util";
import type { Session } from "./session.js";
import { runCommand } from "./commands.js";
import { MarkdownStream } from "./markdown.js";
import type { RateLimitWindow, ThreadItem, ThreadTokenUsage, TurnStatus } from "./protocol/v2/index.js";

const dim = (s: string) => styleText("dim", s);
const USER_PROMPT = styleText("cyan", "you › ");
const BOT_PREFIX = styleText("magenta", "jarvis › ");
const tty = Boolean(process.stdout.isTTY);
const color = tty && !process.env.NO_COLOR;

export async function repl(session: Session): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
  let closed = false;
  let lastSigint = 0;

  rl.on("close", () => (closed = true));
  rl.on("SIGINT", () => {
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
    if (closed) return; // expected: session.close() on quit
    console.error(dim(`\n[codex app-server exited (${code})]`));
    process.exit(1);
  });

  session.rateLimits().catch(() => {}); // seed the status line; failures just hide limits
  console.log(dim(`Jarvis · ${session.model} · effort ${session.effort} · /help for commands`));

  // Async iteration buffers lines typed (or piped) while a turn is streaming.
  rl.setPrompt(USER_PROMPT);
  rl.prompt();
  for await (const raw of rl) {
    const line = raw.trim();
    if (line.startsWith("/")) {
      if ((await runCommand(line, session)) === "exit") break;
    } else if (line) {
      await runTurn(session, line);
    }
    if (!closed) rl.prompt();
  }

  closed = true;
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

  // Transient one-line indicator (tty only), replaced by the reply or a note.
  const showIndicator = (s: string) => {
    if (!tty || started) return;
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
    if (started) return;
    clearIndicator();
    started = true;
    if (prefix) out(BOT_PREFIX);
  };
  // Persistent note (e.g. a web search) on its own line, before or between reply text.
  const note = (s: string) => {
    clearIndicator();
    if (started) endLine();
    out(dim(`  ${s}`) + "\n");
    if (!started) showIndicator("thinking…");
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
        if (item.type === "webSearch") showIndicator("searching the web…");
        // Separate consecutive assistant messages within one turn.
        else if (item.type === "agentMessage" && started) {
          endLine();
          out("\n");
        }
      },
      onItemCompleted: (item) => {
        if (item.type === "webSearch") note(`⌕ ${describeSearch(item)}`);
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
  }
  clearIndicator();
  if (started) endLine();
  if (status) out(dim(statusLine(session, usage, Date.now() - t0)) + "\n");
  if (prefix) out("\n");
  return result;
}

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
