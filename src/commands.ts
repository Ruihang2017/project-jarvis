import { styleText } from "node:util";
import type { RateLimitWindow, Thread, ThreadItem } from "./protocol/v2/index.js";
import { MODES, type Mode, type Session } from "./session.js";
import { truncate } from "./util.js";

const MODE_HELP: Record<Mode, string> = {
  chat: "answers only; no commands or file changes",
  assist: "may run commands and edit files (starts in ~/.jarvis/workspace); asks before every action",
};

const dim = (s: string) => styleText("dim", s);
const bold = (s: string) => styleText("bold", s);

export type CommandResult = "exit" | void;

interface Command {
  usage: string;
  help: string;
  run: (args: string, session: Session) => Promise<CommandResult>;
}

// Numbering from the last /resume listing, so `/resume 2` refers to what was shown.
let lastListing: Thread[] = [];

const COMMANDS: Record<string, Command> = {
  "/help": {
    usage: "/help",
    help: "Show commands",
    run: async () => {
      const width = Math.max(...Object.values(COMMANDS).map((c) => c.usage.length));
      for (const c of Object.values(COMMANDS)) console.log(`  ${c.usage.padEnd(width)}  ${dim(c.help)}`);
      console.log(dim("  Ctrl+C interrupts a reply; Ctrl+C on an empty line or Ctrl+D quits."));
    },
  },

  "/new": {
    usage: "/new",
    help: "Start a new conversation",
    run: async (_, session) => {
      await session.newThread();
      console.log(dim("[new conversation]"));
    },
  },

  "/resume": {
    usage: "/resume [n|id]",
    help: "List recent conversations, or resume one",
    run: async (args, session) => {
      if (!args) {
        lastListing = await session.listThreads(10);
        if (lastListing.length === 0) return console.log(dim("[no saved conversations]"));
        lastListing.forEach((t, i) => {
          const mark = t.id === session.threadId ? "*" : " ";
          console.log(`${mark}${String(i + 1).padStart(2)}. ${threadTitle(t)}  ${dim(`${ago(t.updatedAt)} · ${shortId(t.id)}`)}`);
        });
        console.log(dim("  /resume <n> to continue one"));
        return;
      }

      const target = await findThread(args, session);
      if (!target) return console.log(dim(`[no conversation matches "${args}"]`));
      const res = await session.resumeThread(target.id);
      console.log(dim(`[resumed: ${threadTitle(res.thread)}]`));
      printLastExchange(res.thread);
    },
  },

  "/model": {
    usage: "/model [id]",
    help: "List models, or switch model",
    run: async (args, session) => {
      const models = (await session.listModels()).filter((m) => !m.hidden);
      if (!args) {
        for (const m of models) {
          const mark = m.id === session.model ? "*" : " ";
          console.log(`${mark} ${m.id.padEnd(16)} ${dim(m.description)}`);
        }
        return;
      }
      const m = models.find((x) => x.id === args);
      if (!m) return console.log(dim(`[unknown model "${args}"; /model lists them]`));
      session.model = m.id;
      const efforts = m.supportedReasoningEfforts.map((e) => e.reasoningEffort);
      if (!efforts.includes(session.effort)) {
        session.effort = m.defaultReasoningEffort;
        console.log(dim(`[effort reset to ${session.effort}; ${m.id} supports ${efforts.join(", ")}]`));
      }
      console.log(dim(`[model: ${m.id} · effort ${session.effort}]`));
    },
  },

  "/effort": {
    usage: "/effort [level]",
    help: "Show or set reasoning effort",
    run: async (args, session) => {
      const model = (await session.listModels()).find((m) => m.id === session.model);
      const efforts = model?.supportedReasoningEfforts.map((e) => e.reasoningEffort) ?? [];
      if (!args) {
        console.log(`effort: ${bold(session.effort)}  ${dim(`(${session.model} supports ${efforts.join(", ") || "unknown"})`)}`);
        return;
      }
      if (efforts.length && !efforts.includes(args)) {
        return console.log(dim(`[${session.model} supports ${efforts.join(", ")}]`));
      }
      session.effort = args;
      console.log(dim(`[effort: ${args}]`));
    },
  },

  "/usage": {
    usage: "/usage",
    help: "Show ChatGPT plan usage limits",
    run: async (_, session) => {
      const res = await session.rateLimits();
      const snap = res.rateLimits;
      console.log(`plan: ${bold(snap.planType ?? "unknown")}`);
      for (const w of [snap.primary, snap.secondary]) if (w) console.log(`  ${formatWindow(w)}`);
      if (snap.rateLimitReachedType) console.log(styleText("yellow", `  limit reached: ${snap.rateLimitReachedType}`));
    },
  },

  "/mode": {
    usage: "/mode [chat|assist]",
    help: "Show or switch mode (assist can run commands and edit files, with your approval)",
    run: async (args, session) => {
      if (!args) {
        for (const m of Object.keys(MODES) as Mode[]) {
          console.log(`${m === session.mode ? "*" : " "} ${m.padEnd(7)} ${dim(MODE_HELP[m])}`);
        }
        return;
      }
      if (!(args in MODES)) return console.log(dim(`[unknown mode "${args}"; chat or assist]`));
      session.mode = args as Mode;
      console.log(dim(`[mode: ${args}]`));
      if (args === "assist" && process.platform === "win32") {
        console.log(
          styleText("yellow", "  No sandbox on Windows: every command asks first, and approved commands run with your full user permissions."),
        );
      }
    },
  },

  "/exit": {
    usage: "/exit",
    help: "Quit (also /quit)",
    run: async () => "exit",
  },
};

export async function runCommand(line: string, session: Session): Promise<CommandResult> {
  const [name = "", ...rest] = line.split(/\s+/);
  const cmd = COMMANDS[name === "/quit" ? "/exit" : name];
  if (!cmd) {
    console.log(dim(`[unknown command ${name}; /help lists commands]`));
    return;
  }
  try {
    return await cmd.run(rest.join(" ").trim(), session);
  } catch (e) {
    console.log(dim(`[${name} failed] ${e instanceof Error ? e.message : String(e)}`));
  }
}

async function findThread(arg: string, session: Session): Promise<Thread | undefined> {
  if (/^\d+$/.test(arg)) {
    if (lastListing.length === 0) lastListing = await session.listThreads(10);
    return lastListing[Number(arg) - 1];
  }
  const threads = await session.listThreads(50);
  const matches = threads.filter((t) => t.id === arg || shortId(t.id) === arg || t.id.endsWith(arg));
  if (matches.length > 1) throw new Error(`"${arg}" matches ${matches.length} conversations; use more characters`);
  return matches[0];
}

// Thread ids are UUIDv7: the prefix is a timestamp, so show the random tail.
const shortId = (id: string) => id.slice(-8);

function threadTitle(t: Thread): string {
  const text = (t.name ?? t.preview).split("\n")[0]?.trim() || "(untitled)";
  return truncate(text, 60);
}

function printLastExchange(t: Thread) {
  const items = t.turns.at(-1)?.items ?? [];
  const user = items.find((i): i is Extract<ThreadItem, { type: "userMessage" }> => i.type === "userMessage");
  const agent = items.findLast((i): i is Extract<ThreadItem, { type: "agentMessage" }> => i.type === "agentMessage");
  const userText = user?.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join(" ");
  if (userText) console.log(dim(`  you › ${truncate(userText, 200)}`));
  if (agent) console.log(dim(`  jarvis › ${truncate(agent.text, 200)}`));
}

function formatWindow(w: RateLimitWindow): string {
  const mins = w.windowDurationMins;
  const label = mins == null ? "window" : mins === 10080 ? "weekly" : mins % 60 === 0 ? `${mins / 60}h` : `${mins}m`;
  const pct = `${Math.round(w.usedPercent)}% used`;
  const reset = w.resetsAt ? `, resets in ${until(w.resetsAt)}` : "";
  return `${label.padEnd(7)} ${bar(w.usedPercent)} ${pct}${dim(reset)}`;
}

function bar(pct: number, width = 20): string {
  const filled = Math.min(width, Math.round((pct / 100) * width));
  return "█".repeat(filled) + dim("░".repeat(width - filled));
}

function duration(secs: number): string {
  if (secs < 60) return `${Math.max(0, Math.round(secs))}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 86400)}d ${Math.round((secs % 86400) / 3600)}h`;
}

const ago = (unixSecs: number) => `${duration(Date.now() / 1000 - unixSecs)} ago`;
const until = (unixSecs: number) => duration(unixSecs - Date.now() / 1000);
