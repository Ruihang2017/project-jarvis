import { acceptBill, editBill, ignoreBill, markPaid } from "./bills/actions.js";
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
import { installTask, removeTask, TASK_NAME, taskStatus } from "./background/task.js";
import { briefGoogle, briefSchedule, composeBrief, nextBriefAt } from "./background/brief.js";
import { GmailClient, summaryLine, UNREAD_QUERY } from "./google/gmail.js";
import { ALL_SCOPES } from "./google/instructions.js";
import { TasksClient } from "./google/tasks.js";
import { CalendarClient, dayLabel, dayStart, eventLine, groupByDay, localDate, nextDate } from "./google/calendar.js";
import { preview, renderPreview } from "./sixel.js";
import { copyImageToClipboard, openWithDefaultApp } from "./system.js";
import { GoogleAuthError, shortScope } from "./google/auth.js";
import { stripControl, tildify, truncate } from "./util.js";
import { scanTripsNow, summariseNow, tripScanLines, withoutNotes } from "./assistant.js";
import { tripLine } from "./headsup/trips.js";
import { digestLines } from "./headsup/mailsummary.js";
import { formatAmount, type Bill } from "./bills/store.js";
import { billLine, billLines, billSettings, runScan, scanSummary } from "./bills/view.js";
import { monthCsv, monthSummary } from "./bills/summary.js";
import { backupData, listBackups } from "./data/backup.js";
import { exportAll, sizeOf } from "./data/export.js";
import { DATA_VERSION, readDataVersion } from "./data/version.js";
import { formatChecks, runDoctor } from "./doctor.js";
import { config } from "./config.js";
import { region } from "./region.js";
import { GETTING_STARTED } from "./setup.js";

const MODE_HELP: Record<Mode, string> = {
  chat: "Codex can't run commands or read files; everything it sees passes the privacy guard",
  manual: "Codex may run commands and edit files, asking before every action",
  "semi-auto": "like manual, but edits inside the Edward workspace go ahead without asking",
  auto: "Codex runs commands and edits files without asking (no sandbox on Windows)",
};

/** Shown when leaving chat: Codex's own reads bypass the guard (D24). */
export const UNGUARDED_WARNING = "Commands Codex runs and files it reads go to the model directly — the privacy guard can't check them.";

const dim = (s: string) => styleText("dim", s);
const bold = (s: string) => styleText("bold", s);

export type CommandResult = "exit" | void;

/** /help layout: every command belongs to one group, with a one-line description. */
export const HELP_GROUPS: [string, [string, string][]][] = [
  [
    "Conversation",
    [
      ["/new", "start a new conversation"],
      ["/resume", "list recent conversations, or continue one"],
      ["/image", "attach an image to your next message"],
      ["/model", "list or switch the model"],
      ["/effort", "how hard the model thinks"],
      ["/usage", "your ChatGPT plan limits"],
      ["/mode", "what Codex may do on this computer (chat, manual, semi-auto, auto)"],
    ],
  ],
  [
    "What Edward looks after",
    [
      ["/brief", "today at a glance: events, reminders, bills, mail"],
      ["/calendar", "your Google Calendar, today and tomorrow or the week"],
      ["/mail", "unread mail from the last day; /mail summary: what needs you"],
      ["/lists", "shopping list, home jobs, to-dos"],
      ["/trips", "flights, hotels and car hire found in booking emails"],
      ["/bills", "bills found in your email: review, pay status, monthly summary"],
      ["/remind", "reminders: list, done, snooze, cancel"],
      ["/memory", "what Edward remembers about you"],
      ["/images", "pictures Edward generated"],
    ],
  ],
  [
    "Setup and care",
    [
      ["/start", "getting-started tips"],
      ["/connect", "add a Google account"],
      ["/accounts", "connected accounts and defaults"],
      ["/google", "check each Google sign-in works"],
      ["/disconnect", "revoke Edward's Google access"],
      ["/background", "reminders even when Edward is closed"],
      ["/region", "date order and currency"],
      ["/web", "let the model search the web, or not"],
      ["/data", "where your data is; back up; export everything"],
      ["/doctor", "check that everything works"],
      ["/help", "this list"],
      ["/exit", "quit"],
    ],
  ],
];

interface Command {
  usage: string;
  help: string;
  run: (args: string, session: Session, signal: AbortSignal) => Promise<CommandResult>;
}

// Numbering from the last /resume listing, so `/resume 2` refers to what was shown.
let lastListing: Thread[] = [];

const COMMANDS: Record<string, Command> = {
  "/help": {
    usage: "/help [command]",
    help: "List commands by group, or show one command's full usage",
    run: async (args) => {
      if (args) {
        const name = args.startsWith("/") ? args : `/${args}`;
        const c = COMMANDS[name];
        if (!c) return console.log(dim(`[unknown command ${name}]`));
        console.log(`  ${c.usage}`);
        return console.log(dim(`  ${c.help}`));
      }
      for (const [title, entries] of HELP_GROUPS) {
        console.log(bold(title));
        for (const [name, short] of entries) console.log(`  ${name.padEnd(12)} ${dim(short)}`);
      }
      console.log(dim("  /help <command> shows its options · Shift+Tab switches mode · Ctrl+C interrupts a reply; on an empty line it quits"));
    },
  },

  "/start": {
    usage: "/start",
    help: "Show the getting-started tips again",
    run: async () => {
      console.log(bold(GETTING_STARTED[0]!));
      for (const l of GETTING_STARTED.slice(1)) console.log(dim(l));
    },
  },

  "/web": {
    usage: "/web [on|off]",
    help: "Let the model search the web (on by default). Off also closes a path by which text in an email could send information out inside a search",
    run: async (args, session) => {
      if (args === "on" || args === "off") {
        updateSettings({ webSearch: args });
        await session.reloadThread();
      } else if (args) return console.log(dim("[usage: /web on|off]"));
      const on = loadSettings().webSearch !== "off";
      console.log(`web search: ${bold(on ? "on" : "off")} ${dim(on ? "— the model can look things up online" : "— the model answers from what it knows and from your data only")}`);
    },
  },

  "/region": {
    usage: "/region [date dmy|mdy | currency CODE]",
    help: "How Edward reads numeric dates (10/12 = 10 December or October 12) and which currency bare amounts are in",
    run: async (args) => {
      const [sub, value] = args.split(/\s+/).filter(Boolean);
      if (sub === "date" && (value === "dmy" || value === "mdy")) updateSettings({ dateOrder: value });
      else if (sub === "currency" && value && /^[A-Za-z]{3}$/.test(value)) updateSettings({ currency: value.toUpperCase() });
      else if (sub) return console.log(dim("[usage: /region date dmy|mdy · /region currency USD]"));
      const r = region();
      const s = loadSettings();
      console.log(`dates:    ${bold(r.dateOrder === "dmy" ? "day/month/year" : "month/day/year")} ${dim(s.dateOrder ? "" : "(detected from your system)")}`);
      console.log(`currency: ${bold(r.currency)} ${dim(s.currency ? "" : "(detected from your system)")}`);
      console.log(dim("  /region date dmy|mdy · /region currency USD"));
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
    usage: "/mode [chat|manual|semi-auto|auto]",
    help: "Show or switch permission mode (Shift+Tab cycles chat → manual → semi-auto)",
    run: async (args, session) => {
      if (!args) {
        for (const m of Object.keys(MODES) as Mode[]) {
          console.log(`${m === session.mode ? "*" : " "} ${m.padEnd(9)} ${dim(MODE_HELP[m])}`);
        }
        return console.log(dim("  Shift+Tab cycles chat → manual → semi-auto; auto only via /mode auto"));
      }
      const next = (args === "assist" ? "manual" : args) as Mode; // "assist" was manual's old name
      if (!(next in MODES)) return console.log(dim(`[unknown mode "${args}"; chat, manual, semi-auto or auto]`));
      if (next === "auto" && session.mode !== "auto") {
        const ok = await session.interactions.approveTool(
          "auto mode",
          "Codex will run commands and change files without asking, with your full Windows permissions.",
          UNGUARDED_WARNING,
          false,
        );
        if (ok === "decline") return console.log(dim("[stayed in " + session.mode + " mode]"));
      }
      await session.setMode(next);
      console.log(dim(`[mode: ${next}]`));
      if (!MODES[next].guarded) console.log(styleText("yellow", `  ⚠ ${UNGUARDED_WARNING}`));
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
    help: "What Edward remembers: search <q>, add <text>, edit <id> <text>, forget <id>, undo, review, approve|reject <id|all>, tidy, profile, export, pause|resume",
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
          console.log(bold("Always shared with Edward at the start of a conversation:"));
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

  "/brief": {
    usage: "/brief [time HH:MM | days weekdays|daily|off]",
    help: "Today's brief now; or change when the morning brief appears",
    run: async (args, session) => {
      const [sub, val] = args.split(/\s+/).filter(Boolean);
      if (sub === "time") {
        if (!val || !/^([01]\d|2[0-3]):[0-5]\d$/.test(val)) return console.log(dim("[usage: /brief time 08:30]"));
        updateSettings({ briefTime: val });
        return console.log(dim(`[morning brief at ${val} · next ${nextBriefAt() ?? "off"}]`));
      }
      if (sub === "days") {
        if (val !== "weekdays" && val !== "daily" && val !== "off") return console.log(dim("[usage: /brief days weekdays|daily|off]"));
        updateSettings({ briefDays: val });
        return console.log(dim(`[morning brief: ${val}${val === "off" ? "" : ` · next ${nextBriefAt() ?? "?"}`}]`));
      }
      if (sub) return console.log(dim(`[unknown /brief option "${sub}"]`));
      const brief = composeBrief(session.memory, session.reminders, new Date(), await briefGoogle(session.accounts), session.bills);
      console.log(bold(brief.title));
      for (const l of brief.lines) console.log(`  ${l}`);
      const { time, days } = briefSchedule();
      console.log(dim(`  morning brief: ${days === "off" ? "off" : `${days} at ${time} · next ${nextBriefAt() ?? "?"}`} · /brief time|days`));
    },
  },

  "/bills": {
    usage: "/bills [cmd]",
    help: "Bills found in Gmail: review, ok|ignore <id|all>, edit <id> amount|due|payee <value>, paid <id>, month|export [YYYY-MM], scan, settings, set scan|confirm|remind <value>, forget all",
    run: async (args, session) => {
      const bills = session.bills;
      const [sub = "", a1, a2, ...rest] = args.split(/\s+/).filter(Boolean);
      const pick = (s: string | undefined) => {
        const b = bills.get(Number(String(s ?? "").replace(/^#/, "")));
        if (!b) throw new Error(`no bill #${s ?? "?"}`);
        return b;
      };
      const show = (list: Bill[]) => {
        for (const b of list) for (const [i, l] of billLines(b).entries()) console.log(i ? styleText("yellow", `  ${l}`) : `  ${l}`);
      };
      switch (sub) {
        case "": {
          const pending = bills.list("pending");
          const tracked = bills.list("tracked");
          const autopay = bills.list("autopay").filter((b) => !b.dueDate || b.dueDate >= localDate(new Date()));
          if (!pending.length && !tracked.length && !autopay.length) return console.log(dim("[no bills yet — /bills scan looks through recent Gmail]"));
          if (tracked.length) console.log(bold(`To pay (${tracked.length})`));
          show(tracked);
          if (autopay.length) console.log(bold(`Automatic payments (${autopay.length})`));
          show(autopay);
          if (pending.length) console.log(dim(`  ${pending.length} new bill${pending.length === 1 ? "" : "s"} waiting for your OK — /bills review`));
          return console.log(dim("  /bills paid <id> · Edward only reminds: pay in your bank or the payee's own site or app"));
        }
        case "review": {
          const pending = bills.list("pending");
          if (!pending.length) return console.log(dim("[nothing to review]"));
          console.log(bold("Found in your email — check each one against the email before accepting:"));
          show(pending);
          return console.log(dim("  /bills ok <id|all> · /bills ignore <id|all> · /bills edit <id> amount 245.30 | due 2026-10-18 | payee Name"));
        }
        case "ok":
        case "ignore": {
          const all = a1 === "all";
          const targets = all ? bills.list("pending") : [pick(a1)];
          for (const b of targets) {
            if (b.status !== "pending") {
              console.log(dim(`[#${b.id} isn't waiting for review]`));
              continue;
            }
            if (sub === "ignore") {
              ignoreBill(bills, b.id);
              console.log(dim(`[ignored ${billLine(b)}]`));
              continue;
            }
            // Bills with warnings are never accepted in bulk: each needs its own /bills ok <id>.
            const r = acceptBill(bills, b.id, all);
            if (!r.ok) {
              console.log(styleText("yellow", `  #${b.id} has warnings — check it, then /bills ok ${b.id}`));
              continue;
            }
            console.log(dim(`[tracking ${billLine(r.bill)}]`));
          }
          return;
        }
        case "edit": {
          const b = pick(a1);
          const value = rest.join(" ");
          if (a2 !== "amount" && a2 !== "due" && a2 !== "payee") return console.log(dim("[usage: /bills edit <id> amount|due|payee <value>]"));
          const r = editBill(bills, b.id, a2, value);
          if (!r.ok) return console.log(dim(`[usage: /bills edit <id> ${a2 === "amount" ? "amount 245.30" : a2 === "due" ? "due 2026-10-18" : "payee Name"}]`));
          return console.log(dim(`[updated ${billLine(r.bill)}]`));
        }
        case "paid": {
          const b = pick(a1);
          markPaid(bills, b.id);
          return console.log(dim(`[paid ${b.payee} ${formatAmount(b)}]`));
        }
        case "scan": {
          console.log(dim("[looking through recent Gmail for bills…]"));
          const r = await runScan(session);
          const lines = scanSummary(r);
          for (const l of lines.length ? lines : [`no new bills (${r.scanned} email${r.scanned === 1 ? "" : "s"} checked)`]) console.log(dim(`  ${l}`));
          return;
        }
        case "month":
        case "export": {
          const month = a1 && /^\d{4}-(0[1-9]|1[0-2])$/.test(a1) ? a1 : localDate(new Date()).slice(0, 7);
          const pathArg = (a1 === month ? [a2, ...rest] : [a1, a2, ...rest]).filter(Boolean).join(" ");
          if (sub === "month") {
            const [head, ...lines] = monthSummary(bills, month);
            console.log(bold(head!));
            for (const l of lines) console.log(l);
            return lines.length ? console.log(dim(`  /bills export ${month} saves this as a CSV file`)) : undefined;
          }
          const dir = join(appDataDir(), "exports");
          const path = pathArg ? resolve(process.cwd(), pathArg.replace(/^(["'])(.*)\1$/, "$2").replace(/^~(?=$|[\\/])/, homedir())) : join(dir, `bills-${month}.csv`);
          // OneDrive folders sync to the cloud — on a work computer that is the employer's account.
          if (/onedrive/i.test(path)) {
            const ok = await session.interactions.approveTool("export to OneDrive", `Save your bills to ${tildify(path)}?`, "OneDrive syncs this file to the cloud; on a work computer that is your employer's account.", false);
            if (ok === "decline") return console.log(dim("[not exported]"));
          }
          if (!pathArg) mkdirSync(dir, { recursive: true });
          writeFileSync(path, monthCsv(bills, month));
          return console.log(dim(`[exported ${month} to ${tildify(path)}]`));
        }
        case "settings": {
          const s = billSettings();
          console.log(`scan:    ${bold(s.scan)} ${dim(s.scan === "daily" ? "— first time Edward opens each day" : "— only when you run /bills scan")}`);
          console.log(`confirm: ${bold(s.confirm)} ${dim(s.confirm === "always" ? "— every new bill needs your OK" : "— bills from payees you've confirmed are tracked automatically")}`);
          console.log(`remind:  ${bold(s.remind === "off" ? "off" : s.remind.join(","))} ${dim(s.remind === "off" ? "— no notifications" : "— days before the due date (0 = on the day)")}`);
          return console.log(dim("  /bills set scan daily|manual · /bills set confirm always|known · /bills set remind 3,0|off"));
        }
        case "set": {
          if (a1 === "scan" && (a2 === "daily" || a2 === "manual")) updateSettings({ billsScan: a2 });
          else if (a1 === "confirm" && (a2 === "always" || a2 === "known")) updateSettings({ billsConfirm: a2 });
          else if (a1 === "remind" && a2 === "off") updateSettings({ billsRemindDays: "off" });
          else if (a1 === "remind" && a2 && /^\d{1,2}(,\d{1,2})*$/.test(a2)) updateSettings({ billsRemindDays: [...new Set(a2.split(",").map(Number))].sort((x, y) => y - x) });
          else return console.log(dim("[usage: /bills set scan daily|manual · confirm always|known · remind 3,0|off]"));
          return console.log(dim(`[bills ${a1}: ${a2}]`));
        }
        case "forget": {
          if (a1 !== "all") return console.log(dim("[usage: /bills forget all]"));
          const ok = await session.interactions.approveTool("forget all bills", "Delete every bill, confirmed payee and scan record Edward has stored.", "Your emails are not touched.", false);
          if (ok === "decline") return console.log(dim("[kept]"));
          return console.log(dim(`[deleted ${bills.forgetAll()} bills and all payee and scan records]`));
        }
        default:
          console.log(dim(`[unknown /bills option "${sub}"]`));
      }
    },
  },

  "/background": {
    usage: "/background [on|off]",
    help: "Background reminders (a scheduled task that runs every minute, even when Edward is closed)",
    run: async (args) => {
      if (args === "on") {
        const r = await installTask();
        updateSettings({ backgroundSuggested: true });
        if (!r.ok) return console.log(dim(`[couldn't turn on background reminders: ${r.message}]`));
        console.log(dim(`[background reminders on — task ${TASK_NAME} checks every minute, even when Edward is closed]`));
        return console.log(dim("  /background off removes it · notifications may be muted by Windows Focus / Do Not Disturb"));
      }
      if (args === "off") {
        const r = await removeTask();
        return console.log(dim(r.ok ? `[background reminders off (${r.message})]` : `[couldn't remove task: ${r.message}]`));
      }
      if (args) return console.log(dim("[usage: /background on|off]"));
      const s = await taskStatus();
      if (!s.installed) return console.log(`background: ${bold("off")} ${dim("— reminders only fire while Edward is open; /background on")}`);
      console.log(`background: ${bold(s.enabled ? "on" : "disabled")} ${dim(`(${TASK_NAME})`)}`);
      const beat = s.heartbeat && !Number.isNaN(s.heartbeat.getTime()) ? `${Math.round((Date.now() - s.heartbeat.getTime()) / 1000)}s ago` : "never";
      console.log(dim(`  last tick: ${beat} · last run: ${s.lastRun ?? "?"} (result ${s.lastResult ?? "?"}) · next: ${s.nextRun ?? "?"}`));
      for (const p of s.problems) console.log(styleText("yellow", `  ⚠ ${p}`));
    },
  },

  "/connect": {
    usage: "/connect google [account]",
    help: "Add a Google account (browser sign-in), or sign in to one again: /connect google <name or address>",
    run: async (args, session, signal) => {
      const [what, ...rest] = args.split(/\s+/).filter(Boolean);
      if (what !== "google") return console.log(dim("[usage: /connect google [account]]"));
      const again = rest.length ? session.accounts.find(rest.join(" ")) : undefined;
      if (rest.length && !again) return console.log(dim(`[no account "${rest.join(" ")}" — /accounts lists them]`));
      console.log(dim("[opening your browser to sign in to Google — waiting up to 5 min, Ctrl+C cancels]"));
      if (!again && session.accounts.connected().length) console.log(dim("  pick the account to add in Google's list (or the one to sign in to again)"));
      const r = await session.accounts.connect(
        ALL_SCOPES,
        (url) => {
          console.log(dim(`  if it doesn't open, visit:\n  ${url}`));
          openWithDefaultApp(url);
        },
        { signal, account: again?.id },
      );
      console.log(dim(`[${r.added ? "added" : "signed in again to"} ${r.state.email ?? "(unknown account)"} · ${r.state.scopes.map(shortScope).join(", ")}]`));
      await session.reloadThread(); // the conversation learns about the account
    },
  },

  "/calendar": {
    usage: "/calendar [week]",
    help: "Your Google Calendar: today and tomorrow, or the next 7 days, from every account (no model call)",
    run: async (args, session) => {
      if (args && args !== "week") return console.log(dim("[usage: /calendar [week]]"));
      const accounts = session.accounts.for("calendar");
      if (!accounts.length) return console.log(dim("[no calendar connected — /connect google]"));
      const days = args === "week" ? 7 : 2;
      const first = localDate(new Date());
      const from = dayStart(first);
      const to = dayStart(nextDate(first, days));
      const many = accounts.length > 1;
      const tagged = (await Promise.all(accounts.map(async (a) => (await new CalendarClient(session.accounts.auth(a)).events(from, to)).map((e) => ({ e, a }))))).flat();
      const owner = new Map(tagged.map((x) => [x.e, x.a]));
      const events = tagged.map((x) => x.e).sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.allDay) - Number(a.allDay));
      for (const [day, list] of groupByDay(events, from, to)) {
        console.log(bold(dayLabel(day) + (day === first ? " · today" : day === nextDate(first) ? " · tomorrow" : "")));
        if (!list.length) console.log(dim("  nothing"));
        for (const e of list) console.log(`  ${eventLine(e)}${many ? dim(` · ${session.accounts.label(owner.get(e)!)}`) : ""}`);
      }
    },
  },

  "/lists": {
    usage: "/lists [name]",
    help: "Your lists in Google Tasks (open items; a list by name also shows what was ticked off this week). To add or tick off, just ask (no model call here)",
    run: async (args, session) => {
      const a = session.accounts.primary("tasks");
      if (!a) return console.log(dim(session.accounts.connected().length ? "[lists need one more Google permission — /connect google]" : "[Google isn't connected — /connect google]"));
      const c = new TasksClient(session.accounts.auth(a));
      const lists = args.trim() ? [await c.findList(args.trim())].filter((l) => l !== undefined) : await c.lists();
      if (!lists.length) return console.log(dim(args.trim() ? `[no list called "${args.trim()}"]` : "[no lists yet — ask Edward to add something]"));
      for (const l of lists) {
        const items = (await c.tasks(l.id)).filter((t) => args.trim() || !t.done);
        console.log(bold(l.title));
        if (!items.length) console.log(dim("  nothing"));
        for (const t of items) console.log(`  ${t.done ? dim(`☑ ${t.title}`) : `☐ ${t.title}`}${t.due ? dim(` · due ${dayLabel(t.due)}`) : ""}`);
      }
    },
  },

  "/mail": {
    usage: "/mail [summary]",
    help: "Unread mail in Gmail's Primary tab from the last 24 hours, from every account (no model call). /mail summary: new mail sorted into what needs you, worth knowing and social (the model reads it, through the privacy guard)",
    run: async (args, session) => {
      const accounts = session.accounts.for("mail");
      if (!accounts.length) return console.log(dim("[no mail connected — /connect google]"));
      if (args.trim() === "summary") {
        console.log(dim("[reading new mail…]"));
        const d = await summariseNow(session);
        for (const l of digestLines(d)) console.log(l);
        return;
      }
      const lists = await Promise.all(accounts.map(async (a) => (await new GmailClient(session.accounts.auth(a)).search(UNREAD_QUERY, 20)).map((m) => ({ m, a }))));
      const unread = lists.flat().sort((x, y) => y.m.date.getTime() - x.m.date.getTime());
      if (!unread.length) return console.log(dim("[no unread mail in Primary from the last 24 hours]"));
      const now = new Date();
      const many = accounts.length > 1;
      for (const { m, a } of unread) console.log(`  ${summaryLine(m, now)}${many ? dim(` · ${session.accounts.label(a)}`) : ""}`);
      console.log(dim(`  ${unread.length}${lists.some((l) => l.length === 20) ? "+" : ""} unread · ask Edward to summarise or read one`));
    },
  },

  "/trips": {
    usage: "/trips [scan|ok <n>|hide <n>]",
    help: "Trips found in booking emails (flights, hotels, car hire, trains). scan: look now · ok <n>: the details are right · hide <n>: not a trip",
    run: async (args, session) => {
      const [sub, n] = args.split(/\s+/).filter(Boolean);
      if (sub === "scan") {
        if (!session.accounts.for("mail").length) return console.log(dim("[no mail connected — /connect google]"));
        const r = await scanTripsNow(session);
        const lines = tripScanLines(r);
        return console.log(lines.length ? lines.join("\n") : dim(`[no new bookings in ${r.scanned} email${r.scanned === 1 ? "" : "s"}]`));
      }
      if ((sub === "ok" || sub === "hide") && n) {
        const t = session.trips.get(Number(n));
        if (!t) return console.log(dim(`[no trip #${n}]`));
        session.trips.update(t.id, sub === "ok" ? { needsCheck: false } : { status: "dismissed" });
        return console.log(dim(`[${sub === "ok" ? "confirmed" : "hidden"}: ${t.title}]`));
      }
      const trips = session.trips.upcoming();
      if (!trips.length) return console.log(dim("[no trips — booking confirmations in your email show up here; /trips scan]"));
      for (const t of trips) console.log(`  #${t.id} ${tripLine(t)}${t.status === "added" ? dim(" · in your calendar") : ""}`);
    },
  },

  "/accounts": {
    usage: "/accounts [name|default|use] …",
    help: "Connected Google accounts and whether they work. /accounts name <account> <name> · default mail|calendar <account> · use <account> mail|calendar on|off",
    run: async (args, session) => {
      const [sub, ...rest] = args.split(/\s+/).filter(Boolean);
      const acc = session.accounts;
      if (sub === "name" && rest.length >= 1) {
        const a = acc.find(rest[0]);
        if (!a) return console.log(dim(`[no account "${rest[0]}"]`));
        acc.update(a.id, { name: rest.slice(1).join(" ") });
        await session.reloadThread();
        return console.log(dim(`[${a.email ?? a.id} is now called "${rest.slice(1).join(" ") || a.email}"]`));
      }
      if (sub === "default" && (rest[0] === "mail" || rest[0] === "calendar") && rest[1]) {
        const a = acc.find(rest.slice(1).join(" "));
        if (!a) return console.log(dim(`[no account "${rest.slice(1).join(" ")}"]`));
        acc.setDefault(rest[0], a.id);
        await session.reloadThread();
        return console.log(dim(`[new ${rest[0] === "mail" ? "emails go from" : "events go into"} ${acc.label(a)}]`));
      }
      if (sub === "use" && rest.length === 3 && (rest[1] === "mail" || rest[1] === "calendar") && (rest[2] === "on" || rest[2] === "off")) {
        const a = acc.find(rest[0]);
        if (!a) return console.log(dim(`[no account "${rest[0]}"]`));
        acc.update(a.id, { [rest[1]]: rest[2] === "on" });
        await session.reloadThread();
        return console.log(dim(`[${acc.label(a)}: ${rest[1]} ${rest[2]}]`));
      }
      if (sub && sub !== "check") return console.log(dim(`[usage: ${COMMANDS["/accounts"]!.usage}]`));
      const list = acc.list();
      if (!list.length) return console.log(`google: ${bold("not connected")} ${dim("— /connect google")}`);
      const sendFrom = acc.primary("mail");
      const calendarIn = acc.primary("calendar");
      for (const a of list) {
        const s = acc.state(a);
        let status: string;
        if (!s) status = styleText("yellow", "signed out — /connect google");
        else if (sub === "check") {
          try {
            status = (await acc.auth(a).check()) === "ok" ? styleText("green", "working") : styleText("yellow", `expired — /connect google ${a.email ?? a.id}`);
          } catch (e) {
            status = styleText("yellow", `couldn't reach Google (${e instanceof Error ? e.message : String(e)})`);
          }
        } else status = s.invalidAt ? styleText("yellow", `expired — /connect google ${a.email ?? a.id}`) : styleText("green", "connected");
        const uses = [acc.usable(a, "mail") && `mail${sendFrom?.id === a.id && list.length > 1 ? " (default)" : ""}`, acc.usable(a, "calendar") && `calendar${calendarIn?.id === a.id && list.length > 1 ? " (default)" : ""}`].filter(Boolean);
        console.log(`${bold(acc.label(a))}${a.name && a.email ? dim(` <${a.email}>`) : ""} · ${status} · ${uses.join(", ") || dim("not used")}`);
        if (s) console.log(dim(`  permissions: ${s.scopes.map(shortScope).join(", ")} · connected ${s.connectedAt.slice(0, 10)}`));
      }
      console.log(dim("  /connect google adds another · /disconnect google <account> removes one · /accounts check tests each sign-in"));
    },
  },

  "/google": {
    usage: "/google",
    help: "Same as /accounts check: each Google account, its permissions, whether it still works",
    run: async (_, session, signal) => COMMANDS["/accounts"]!.run("check", session, signal),
  },

  "/disconnect": {
    usage: "/disconnect google [account]",
    help: "Revoke Edward's access to a Google account and delete its local token",
    run: async (args, session) => {
      const [what, ...rest] = args.split(/\s+/).filter(Boolean);
      if (what !== "google") return console.log(dim("[usage: /disconnect google [account]]"));
      const list = session.accounts.list();
      if (!list.length) return console.log(dim("[Google isn't connected]"));
      const a = rest.length ? session.accounts.find(rest.join(" ")) : list.length === 1 ? list[0] : undefined;
      if (!a) return console.log(dim(rest.length ? `[no account "${rest.join(" ")}"]` : `[which one? /disconnect google <account> — ${list.map((x) => session.accounts.label(x)).join(", ")}]`));
      const { revoked } = await session.accounts.disconnect(a.id);
      await session.reloadThread();
      console.log(
        dim(
          revoked
            ? `[disconnected ${a.email ?? a.id}: access revoked at Google, local token deleted]`
            : `[${a.email ?? a.id}: local token deleted; couldn't confirm the revocation with Google — check myaccount.google.com/connections]`,
        ),
      );
    },
  },

  "/doctor": {
    usage: "/doctor",
    help: "Check that everything Edward needs is working (also: edward doctor)",
    run: async (_, session) => {
      for (const l of formatChecks(await runDoctor(session))) console.log(l);
    },
  },

  "/data": {
    usage: "/data [backup | export [path]]",
    help: "Where your data is and how big; back it up; export everything as readable files",
    run: async (args, session) => {
      const [sub = "", ...rest] = args.split(/\s+/).filter(Boolean);
      const dir = appDataDir();
      if (sub === "backup") return console.log(dim(`[backed up to ${tildify(backupData("manual"))} — database, settings and Google connection state]`));
      if (sub === "export") {
        const arg = rest.join(" ");
        const target = arg ? resolve(process.cwd(), arg.replace(/^(["'])(.*)\1$/, "$2").replace(/^~(?=$|[\\/])/, homedir())) : join(dir, "exports", `edward-export-${new Date().toLocaleDateString("sv")}`);
        // OneDrive folders sync to the cloud — on a work computer that is the employer's account.
        if (/onedrive/i.test(target)) {
          const ok = await session.interactions.approveTool("export to OneDrive", `Export everything to ${tildify(target)}?`, "OneDrive syncs these files to the cloud; on a work computer that is your employer's account.", false);
          if (ok === "decline") return console.log(dim("[not exported]"));
        }
        const r = exportAll(target);
        return console.log(dim(`[exported ${r.files.join(", ")} to ${tildify(r.dir)}]`));
      }
      if (sub) return console.log(dim("[usage: /data · /data backup · /data export [path]]"));
      const mb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
      const row = (label: string, path: string) => console.log(`  ${label.padEnd(26)} ${mb(sizeOf(path)).padStart(9)}  ${dim(tildify(path))}`);
      console.log(bold(`Edward data · v${readDataVersion() ?? DATA_VERSION}`));
      row("memories, reminders, bills", join(dir, "memory.db"));
      row("conversations", config.codexHome);
      row("generated images", imagesDir());
      row("backups", join(dir, "backups"));
      row("exports", join(dir, "exports"));
      const last = listBackups()[0];
      console.log(dim(`  last backup: ${last ? last.name : "none"} · /data backup · /data export`));
      console.log(dim("  to delete everything: exit Edward and run  edward delete-data"));
    },
  },

  "/exit": {
    usage: "/exit",
    help: "Quit (also /quit)",
    run: async () => "exit",
  },
};

/** Set while a command runs; Ctrl+C aborts it instead of quitting (/connect google waits on the browser). */
export let runningCommand: AbortController | undefined;

export async function runCommand(line: string, session: Session): Promise<CommandResult> {
  const [name = "", ...rest] = line.split(/\s+/);
  const cmd = COMMANDS[name === "/quit" ? "/exit" : name];
  if (!cmd) {
    console.log(dim(`[unknown command ${name}; /help lists commands]`));
    return;
  }
  runningCommand = new AbortController();
  try {
    return await cmd.run(rest.join(" ").trim(), session, runningCommand.signal);
  } catch (e) {
    if (e instanceof GoogleAuthError && e.code === "cancelled") return void console.log(dim(`[${name} cancelled]`));
    console.log(dim(`[${name} failed] ${e instanceof Error ? e.message : String(e)}`));
  } finally {
    runningCommand = undefined;
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

/** Accepts "Copy as path" quoting, ~ and paths relative to where edward was started. */
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
  const text = stripControl(t.name ?? withoutNotes(t.preview)).split("\n")[0]?.trim() || "(untitled)";
  return truncate(text, 60);
}

function printLastExchange(t: Thread) {
  const items = t.turns.at(-1)?.items ?? [];
  const user = items.find((i): i is Extract<ThreadItem, { type: "userMessage" }> => i.type === "userMessage");
  const agent = items.findLast((i): i is Extract<ThreadItem, { type: "agentMessage" }> => i.type === "agentMessage");
  const userText = user?.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join(" ");
  if (userText) console.log(dim(`  you › ${truncate(stripControl(userText), 200)}`));
  if (agent) console.log(dim(`  edward › ${truncate(stripControl(agent.text), 200)}`));
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

/** Every command name, for checks that /help covers them all. */
export const commandNames = () => Object.keys(COMMANDS);
