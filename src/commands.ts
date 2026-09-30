import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { styleText } from "node:util";
import type { RateLimitWindow, Thread, ThreadItem } from "./protocol/v2/index.js";
import { listImages, stripRequest } from "./images.js";
import { MODES, type Mode, type Session } from "./session.js";
import { appDataDir, imagesDir, loadSettings, updateSettings } from "./settings.js";
import { secretReason } from "./memory/guard.js";
import { describe as describeMemory } from "./memory/store.js";
import { MemoryTidier } from "./memory/tidy.js";
import { parseDuration } from "./reminders/schedule.js";
import { describeReminder } from "./reminders/tools.js";
import { preview, renderPreview } from "./sixel.js";
import { copyImageToClipboard, openWithDefaultApp } from "./system.js";
import { tildify, truncate } from "./util.js";

const MODE_HELP: Record<Mode, string> = {
  chat: "answers only; no commands or file changes (clipboard/open tools still work)",
  assist: "may run commands and edit files (starts in the Jarvis workspace); asks before every action",
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

  "/image": {
    usage: "/image [path|clear]",
    help: "Attach an image to your next message (no args: list attached)",
    run: async (args, session) => {
      if (!args) {
        if (!session.pendingImages.length) return console.log(dim("[no images attached]"));
        for (const p of session.pendingImages) console.log(`  🖼 ${tildify(p)}`);
        return;
      }
      if (args === "clear") {
        session.pendingImages = [];
        return console.log(dim("[attachments cleared]"));
      }
      const path = resolveImagePath(args);
      const model = (await session.listModels()).find((m) => m.id === session.model);
      if (model && !model.inputModalities.includes("image")) {
        return console.log(dim(`[${session.model} doesn't accept images; /model to switch]`));
      }
      if (session.pendingImages.length >= MAX_IMAGES) return console.log(dim(`[at most ${MAX_IMAGES} images per message]`));
      session.pendingImages.push(path);
      console.log(dim(`[attached ${basename(path)} (${formatBytes(statSync(path).size)}) — sent with your next message]`));
    },
  },

  "/images": {
    usage: "/images [cmd]",
    help: "Generated images: show|open|copy <n>, folder, dir [path|reset], autoopen on|off, preview auto|on|off",
    run: async (args) => {
      const [sub = "", ...rest] = args.split(/\s+/).filter(Boolean);
      const arg = rest.join(" ");
      const pick = (n: string) => {
        const rec = listImages(IMAGE_LIST_LIMIT)[Number(n) - 1];
        if (!/^\d+$/.test(n) || !rec) throw new Error(`no image #${n || "?"}; /images lists them`);
        return rec;
      };
      switch (sub) {
        case "": {
          const recs = listImages(IMAGE_LIST_LIMIT);
          if (!recs.length) return console.log(dim(`[no images yet; saved to ${tildify(imagesDir())}]`));
          recs.forEach((r, i) => {
            const d = new Date(r.createdAt);
            const when = `${d.toLocaleDateString("sv")} ${d.toLocaleTimeString("sv").slice(0, 5)}`; // local "YYYY-MM-DD HH:MM"
            const size = r.width ? ` · ${r.width}×${r.height}` : "";
            console.log(`${String(i + 1).padStart(3)}. ${truncate(stripRequest(r.prompt) || basename(r.path), 50)}  ${dim(when + size)}`);
          });
          return console.log(dim(`  /images show|open|copy <n> · saved in ${tildify(imagesDir())}`));
        }
        case "open": {
          const rec = pick(arg);
          openWithDefaultApp(rec.path);
          return console.log(dim(`[opened ${basename(rec.path)}]`));
        }
        case "copy": {
          const rec = pick(arg);
          await copyImageToClipboard(rec.path);
          return console.log(dim(`[copied ${basename(rec.path)} to clipboard — paste it anywhere]`));
        }
        case "show": {
          const rec = pick(arg);
          if (!preview.enabled) {
            return console.log(dim("[inline preview is off or unsupported here; /images preview on to force, or /images open]"));
          }
          const out = renderPreview(rec.path);
          if (out) process.stdout.write(out);
          else console.log(dim("[can't preview this file type]"));
          return;
        }
        case "preview": {
          if (arg !== "auto" && arg !== "on" && arg !== "off") {
            const setting = loadSettings().inlinePreview ?? "auto";
            return console.log(`preview: ${setting} (${preview.enabled ? "active" : "inactive"} in this terminal)`);
          }
          updateSettings({ inlinePreview: arg });
          if (arg !== "auto") preview.enabled = arg === "on" && Boolean(process.stdout.isTTY);
          return console.log(dim(`[preview: ${arg}${arg === "auto" ? "; takes effect next start" : ""}]`));
        }
        case "folder":
          openWithDefaultApp(imagesDir());
          return console.log(dim(`[opened ${tildify(imagesDir())}]`));
        case "dir": {
          if (!arg) return console.log(`images folder: ${tildify(imagesDir())}`);
          if (arg === "reset") {
            updateSettings({ imagesDir: undefined });
            return console.log(dim(`[images folder reset to ${tildify(imagesDir())}]`));
          }
          const dir = resolve(process.cwd(), arg.replace(/^(["'])(.*)\1$/, "$2").replace(/^~(?=$|[\\/])/, homedir()));
          mkdirSync(dir, { recursive: true });
          updateSettings({ imagesDir: dir });
          return console.log(dim(`[new images will be saved to ${tildify(dir)}; existing ones stay where they are]`));
        }
        case "autoopen": {
          if (arg !== "on" && arg !== "off") {
            return console.log(`autoopen: ${loadSettings().autoOpenImages === false ? "off" : "on"}`);
          }
          updateSettings({ autoOpenImages: arg === "on" });
          return console.log(dim(`[auto-open ${arg}]`));
        }
        default:
          console.log(dim(`[unknown /images option "${sub}"]`));
      }
    },
  },

  "/memory": {
    usage: "/memory [cmd]",
    help: "What Jarvis remembers: search <q>, add <text>, edit <id> <text>, forget <id>, undo, review, approve|reject <id|all>, tidy, profile, export, pause|resume",
    run: async (args, session) => {
      const mem = session.memory;
      const [sub = "", ...rest] = args.split(/\s+/).filter(Boolean);
      const arg = rest.join(" ");
      const id = (s: string | undefined) => {
        const n = Number(String(s ?? "").replace(/^#/, ""));
        if (!Number.isInteger(n) || !mem.get(n)) throw new Error(`no memory #${s ?? "?"}`);
        return n;
      };
      switch (sub) {
        case "": {
          const long = mem.list({ tier: "long" });
          const short = mem.list({ tier: "short" });
          if (!long.length && !short.length && !mem.list({ status: "pending" }).length) return console.log(dim("[nothing remembered yet — say \"记住…\" or /memory add <text>]"));
          if (long.length) console.log(bold(`Long-term (${long.length})`));
          for (const m of long) console.log(`  ${describeMemory(m)}`);
          if (short.length) console.log(bold(`Short-term (${short.length})`));
          for (const m of short) console.log(`  ${describeMemory(m)}`);
          const paused = loadSettings().memoryLearning === false ? " · learning paused" : "";
          const pending = mem.list({ status: "pending" }).length;
          const review = pending ? ` · ${pending} awaiting /memory review` : "";
          return console.log(dim(`  /memory search|edit|forget|export${review}${paused}`));
        }
        case "search": {
          if (!arg) return console.log(dim("[usage: /memory search <keywords>]"));
          const hits = mem.search(arg, { includeArchived: true, limit: 15 });
          if (!hits.length) return console.log(dim("[no matches]"));
          for (const { memory: m } of hits) console.log(`  ${describeMemory(m)}${m.status !== "active" ? dim(` {${m.status}}`) : ""}`);
          return;
        }
        case "add": {
          if (!arg) return console.log(dim("[usage: /memory add <text>]"));
          const reason = secretReason(arg);
          if (reason) return console.log(dim(`[not saved: looks like a ${reason}; secrets are never stored]`));
          const m = mem.add({ kind: "note", text: arg, source: "manual", threadId: session.threadId });
          return console.log(dim(`[saved ${describeMemory(m)}]`));
        }
        case "edit": {
          const [idArg, ...textParts] = rest;
          const text = textParts.join(" ");
          if (!text) return console.log(dim("[usage: /memory edit <id> <new text>]"));
          const m = mem.update(id(idArg), { text });
          return console.log(dim(`[updated ${m ? describeMemory(m) : ""}]`));
        }
        case "forget": {
          const m = mem.remove(id(arg));
          return console.log(dim(`[forgot ${m ? describeMemory(m) : ""}]`));
        }
        case "undo": {
          const m = mem.undo();
          return console.log(dim(m ? `[removed ${describeMemory(m)}]` : "[nothing saved this session to undo]"));
        }
        case "profile": {
          const core = mem.core();
          console.log(bold("Always shared with Jarvis at the start of a conversation:"));
          if (!core.length) console.log(dim("  (nothing yet)"));
          for (const m of core) console.log(`  ${describeMemory(m)}`);
          return;
        }
        case "export": {
          const path = arg
            ? resolve(process.cwd(), arg.replace(/^(["'])(.*)\1$/, "$2"))
            : join(appDataDir(), `memory-export-${new Date().toLocaleDateString("sv")}.md`);
          writeFileSync(path, mem.exportMarkdown());
          return console.log(dim(`[exported to ${tildify(path)}]`));
        }
        case "review": {
          const pending = mem.list({ status: "pending" });
          if (!pending.length) return console.log(dim("[nothing awaiting review]"));
          console.log(bold("Learned automatically, waiting for your OK (sensitive):"));
          for (const m of pending) {
            const replaces = m.supersedes ? dim(` (replaces #${m.supersedes})`) : "";
            console.log(`  ${describeMemory(m)}${replaces}`);
          }
          return console.log(dim("  /memory approve <id|all> · /memory reject <id|all>"));
        }
        case "approve":
        case "reject": {
          const ids = arg === "all" ? mem.list({ status: "pending" }).map((m) => m.id) : [id(arg)];
          for (const n of ids) {
            if (mem.get(n)?.status !== "pending") {
              console.log(dim(`[#${n} isn't awaiting review]`));
              continue;
            }
            const m = sub === "approve" ? mem.approve(n) : mem.remove(n);
            console.log(dim(`[${sub === "approve" ? "saved" : "discarded"} ${m ? describeMemory(m) : `#${n}`}]`));
          }
          return;
        }
        case "tidy": {
          console.log(dim("[tidying memory…]"));
          const lines = await new MemoryTidier(session).run();
          for (const l of lines.length ? lines : ["nothing to tidy"]) console.log(dim(`  ${l}`));
          return;
        }
        case "pause":
        case "resume":
          updateSettings({ memoryLearning: sub === "resume" });
          return console.log(dim(sub === "pause" ? "[automatic learning paused; explicit \"remember\" still works]" : "[automatic learning resumed]"));
        default:
          console.log(dim(`[unknown /memory option "${sub}"]`));
      }
    },
  },

  "/remind": {
    usage: "/remind [cmd]",
    help: "Reminders: list; done|cancel <id>; snooze <id> [10m|1h]. Set one by just asking (\"remind me …\")",
    run: async (args, session) => {
      const rem = session.reminders;
      const [sub = "", idArg, dur] = args.split(/\s+/).filter(Boolean);
      const pick = () => {
        const r = rem.get(Number(String(idArg ?? "").replace(/^#/, "")));
        if (!r) throw new Error(`no reminder #${idArg ?? "?"}`);
        return r;
      };
      switch (sub) {
        case "": {
          const upcoming = rem.upcoming();
          const fired = rem.recentlyFired();
          if (!upcoming.length && !fired.length) return console.log(dim('[no reminders — try "明天 9 点提醒我…"]'));
          if (upcoming.length) console.log(bold(`Upcoming (${upcoming.length})`));
          for (const r of upcoming) console.log(`  ${describeReminder(r)}`);
          if (fired.length) console.log(bold("Went off (last 24h)"));
          for (const r of fired) console.log(`  ${describeReminder(r)}`);
          return console.log(dim("  /remind done|cancel <id> · /remind snooze <id> 10m"));
        }
        case "done": {
          const r = pick();
          if (r.repeat && r.status === "scheduled") return console.log(dim(`[#${r.id} repeats; /remind cancel ${r.id} to stop it]`));
          rem.setStatus(r.id, "done");
          return console.log(dim(`[done ${describeReminder(r)}]`));
        }
        case "cancel": {
          const r = pick();
          rem.setStatus(r.id, "cancelled");
          return console.log(dim(`[cancelled ${describeReminder(r)}]`));
        }
        case "snooze": {
          const r = pick();
          const minutes = parseDuration(dur);
          if (minutes === null) return console.log(dim("[usage: /remind snooze <id> 10m|1h|90]"));
          const s = rem.snooze(r.id, minutes);
          return console.log(dim(s?.status === "scheduled" ? `[snoozed ${describeReminder(s)}]` : `[#${r.id} can't be snoozed (${r.status})]`));
        }
        default:
          console.log(dim(`[unknown /remind option "${sub}"]`));
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

const MAX_IMAGES = 5;
const IMAGE_LIST_LIMIT = 15;
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

/** Accepts "Copy as path" quoting, ~ and paths relative to where jarvis was started. */
function resolveImagePath(arg: string): string {
  const raw = arg.trim().replace(/^(["'])(.*)\1$/, "$2");
  const path = resolve(process.cwd(), raw.replace(/^~(?=$|[\\/])/, homedir()));
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`no such file: ${path}`);
  if (!IMAGE_EXTS.has(extname(path).toLowerCase())) {
    throw new Error(`unsupported image type ${extname(path) || "(none)"}; use ${[...IMAGE_EXTS].join(" ")}`);
  }
  return path;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
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
