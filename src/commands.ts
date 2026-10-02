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
import { GMAIL_SCOPES } from "./google/instructions.js";
import { CALENDAR_SCOPES, CalendarClient, dayLabel, dayStart, eventLine, groupByDay, localDate, nextDate } from "./google/calendar.js";
import { preview, renderPreview } from "./sixel.js";
import { copyImageToClipboard, openWithDefaultApp } from "./system.js";
import { GoogleAuthError, shortScope } from "./google/auth.js";
import { tildify, truncate } from "./util.js";
import { formatAmount, type Bill } from "./bills/store.js";
import { billLine, billLines, billSettings, runScan, scanSummary } from "./bills/view.js";
import { monthCsv, monthSummary } from "./bills/summary.js";

const MODE_HELP: Record<Mode, string> = {
  chat: "Codex can't run commands or read files; everything it sees passes the privacy guard",
  manual: "Codex may run commands and edit files, asking before every action",
  "semi-auto": "like manual, but edits inside the Jarvis workspace go ahead without asking",
  auto: "Codex runs commands and edits files without asking (no sandbox on Windows)",
};

/** Shown when leaving chat: Codex's own reads bypass the guard (D24). */
export const UNGUARDED_WARNING = "Commands Codex runs and files it reads go to the model directly — the privacy guard can't check them.";

const dim = (s: string) => styleText("dim", s);
const bold = (s: string) => styleText("bold", s);

export type CommandResult = "exit" | void;

interface Command {
  usage: string;
  help: string;
  run: (args: string, session: Session, signal: AbortSignal) => Promise<CommandResult>;
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
      const brief = composeBrief(session.memory, session.reminders, new Date(), await briefGoogle(session.google), session.bills);
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
          return console.log(dim("  /bills paid <id> · Jarvis only reminds: pay in your bank or the payee's own site or app"));
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
              bills.update(b.id, { status: "dismissed" });
              console.log(dim(`[ignored ${billLine(b)}]`));
              continue;
            }
            // Bills with warnings are never accepted in bulk: each needs its own /bills ok <id>.
            if (all && (b.flags.length || b.needsCheck)) {
              console.log(styleText("yellow", `  #${b.id} has warnings — check it, then /bills ok ${b.id}`));
              continue;
            }
            const done = bills.update(b.id, { status: b.kind === "autopay" ? "autopay" : "tracked", needsCheck: false })!;
            bills.confirmPayee(b.payee, b.senderDomain);
            console.log(dim(`[tracking ${billLine(done)}]`));
          }
          return;
        }
        case "edit": {
          const b = pick(a1);
          const value = rest.join(" ");
          const dropFlag = (word: string) => b.flags.filter((f) => !f.includes(word));
          if (a2 === "amount") {
            const n = Number(value.replace(/[$,]/g, ""));
            if (!value || !Number.isFinite(n) || n <= 0) return console.log(dim("[usage: /bills edit <id> amount 245.30]"));
            bills.update(b.id, { amountCents: Math.round(n * 100), flags: dropFlag("the amount"), needsCheck: b.flags.some((f) => f.includes("the due date")) });
          } else if (a2 === "due") {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(dayStart(value).getTime())) return console.log(dim("[usage: /bills edit <id> due 2026-10-18]"));
            bills.update(b.id, { dueDate: value, flags: dropFlag("the due date"), needsCheck: b.flags.some((f) => f.includes("the amount")) });
          } else if (a2 === "payee") {
            if (!value) return console.log(dim("[usage: /bills edit <id> payee Name]"));
            bills.update(b.id, { payee: value });
          } else return console.log(dim("[usage: /bills edit <id> amount|due|payee <value>]"));
          return console.log(dim(`[updated ${billLine(bills.get(b.id)!)}]`));
        }
        case "paid": {
          const b = pick(a1);
          bills.update(b.id, { status: "paid" });
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
          console.log(`scan:    ${bold(s.scan)} ${dim(s.scan === "daily" ? "— first time Jarvis opens each day" : "— only when you run /bills scan")}`);
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
          const ok = await session.interactions.approveTool("forget all bills", "Delete every bill, confirmed payee and scan record Jarvis has stored.", "Your emails are not touched.", false);
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
    help: "Background reminders (a scheduled task that runs every minute, even when Jarvis is closed)",
    run: async (args) => {
      if (args === "on") {
        const r = await installTask();
        updateSettings({ backgroundSuggested: true });
        if (!r.ok) return console.log(dim(`[couldn't turn on background reminders: ${r.message}]`));
        console.log(dim(`[background reminders on — task ${TASK_NAME} checks every minute, even when Jarvis is closed]`));
        return console.log(dim("  /background off removes it · notifications may be muted by Windows Focus / Do Not Disturb"));
      }
      if (args === "off") {
        const r = await removeTask();
        return console.log(dim(r.ok ? `[background reminders off (${r.message})]` : `[couldn't remove task: ${r.message}]`));
      }
      if (args) return console.log(dim("[usage: /background on|off]"));
      const s = await taskStatus();
      if (!s.installed) return console.log(`background: ${bold("off")} ${dim("— reminders only fire while Jarvis is open; /background on")}`);
      console.log(`background: ${bold(s.enabled ? "on" : "disabled")} ${dim(`(${TASK_NAME})`)}`);
      const beat = s.heartbeat && !Number.isNaN(s.heartbeat.getTime()) ? `${Math.round((Date.now() - s.heartbeat.getTime()) / 1000)}s ago` : "never";
      console.log(dim(`  last tick: ${beat} · last run: ${s.lastRun ?? "?"} (result ${s.lastResult ?? "?"}) · next: ${s.nextRun ?? "?"}`));
      for (const p of s.problems) console.log(styleText("yellow", `  ⚠ ${p}`));
    },
  },

  "/connect": {
    usage: "/connect google",
    help: "Connect your Google account (browser sign-in); run again to reconnect",
    run: async (args, session, signal) => {
      if (args !== "google") return console.log(dim("[usage: /connect google]"));
      console.log(dim("[opening your browser to sign in to Google — waiting up to 5 min, Ctrl+C cancels]"));
      const s = await session.google.connect(
        [...CALENDAR_SCOPES, ...GMAIL_SCOPES],
        (url) => {
          console.log(dim(`  if it doesn't open, visit:\n  ${url}`));
          openWithDefaultApp(url);
        },
        { signal },
      );
      console.log(dim(`[connected to Google as ${s.email ?? "(unknown account)"} · ${s.scopes.map(shortScope).join(", ")}]`));
    },
  },

  "/calendar": {
    usage: "/calendar [week]",
    help: "Your Google Calendar: today and tomorrow, or the next 7 days (no model call)",
    run: async (args, session) => {
      if (args && args !== "week") return console.log(dim("[usage: /calendar [week]]"));
      const days = args === "week" ? 7 : 2;
      const first = localDate(new Date());
      const from = dayStart(first);
      const to = dayStart(nextDate(first, days));
      const events = await new CalendarClient(session.google).events(from, to);
      for (const [day, list] of groupByDay(events, from, to)) {
        console.log(bold(dayLabel(day) + (day === first ? " · today" : day === nextDate(first) ? " · tomorrow" : "")));
        if (!list.length) console.log(dim("  nothing"));
        for (const e of list) console.log(`  ${eventLine(e)}`);
      }
    },
  },

  "/mail": {
    usage: "/mail",
    help: "Unread mail in Gmail's Primary tab from the last 24 hours (no model call)",
    run: async (_, session) => {
      const unread = await new GmailClient(session.google).search(UNREAD_QUERY, 20);
      if (!unread.length) return console.log(dim("[no unread mail in Primary from the last 24 hours]"));
      const now = new Date();
      for (const m of unread) console.log(`  ${summaryLine(m, now)}`);
      console.log(dim(`  ${unread.length === 20 ? "20+" : unread.length} unread · ask Jarvis to summarise or read one`));
    },
  },

  "/google": {
    usage: "/google",
    help: "Google connection status: account, permissions, whether it still works",
    run: async (_, session) => {
      const s = session.google.state();
      if (!s) return console.log(`google: ${bold("not connected")} ${dim("— /connect google")}`);
      let status: string;
      try {
        status = (await session.google.check()) === "ok" ? styleText("green", "working") : styleText("yellow", "expired — /connect google to reconnect");
      } catch (e) {
        status = styleText("yellow", `couldn't reach Google (${e instanceof Error ? e.message : String(e)})`);
      }
      console.log(`google: ${bold(s.email ?? "(unknown account)")} · ${status}`);
      console.log(dim(`  permissions: ${s.scopes.map(shortScope).join(", ")}`));
      console.log(dim(`  connected ${s.connectedAt.slice(0, 10)} · /disconnect google removes access`));
    },
  },

  "/disconnect": {
    usage: "/disconnect google",
    help: "Revoke Jarvis's Google access and delete the local token",
    run: async (args, session) => {
      if (args !== "google") return console.log(dim("[usage: /disconnect google]"));
      if (!session.google.state()) return console.log(dim("[Google isn't connected]"));
      const { revoked } = await session.google.disconnect();
      console.log(
        dim(revoked ? "[disconnected: access revoked at Google, local token deleted]" : "[local token deleted; couldn't confirm the revocation with Google — check myaccount.google.com/connections]"),
      );
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
