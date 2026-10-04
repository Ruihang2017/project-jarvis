/**
 * Edward for the desktop window: one Session (the same core as the terminal version) plus the data
 * each page shows. Every method here is reachable from the window through preload's bridge; the
 * window itself never touches Node, files or Codex.
 */
import { app, clipboard, dialog, shell, type BrowserWindow } from "electron";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Session, type Mode } from "../../src/session.js";
import { config } from "../../src/config.js";
import { appDataDir, imagesDir, loadSettings, updateSettings } from "../../src/settings.js";
import { activityLabel, activityNotes } from "../../src/activity.js";
import { runtime } from "../../src/runtime.js";
import { backgroundSuggestion, claimDueNow, handleGeneratedImage, startBackgroundWork, turnInputs, withoutNotes } from "../../src/assistant.js";
import { moveFromJarvis, renameMessage } from "../../src/data/rename.js";
import { ensureDataVersion, readDataVersion, DATA_VERSION } from "../../src/data/version.js";
import { backupData, listBackups } from "../../src/data/backup.js";
import { exportAll, sizeOf } from "../../src/data/export.js";
import { wipeData } from "../../src/data/wipe.js";
import { describeRemoved, redact } from "../../src/privacy/guard.js";
import { CALENDAR_SCOPES, CalendarClient, dayLabel, dayStart, freeSlots, hasCalendarAccess, localDate, nextDate, resolveTimes, type CalendarEvent, type EventInput } from "../../src/google/calendar.js";
import {
  GMAIL_SCOPES,
  GmailClient,
  GmailWriter,
  addressOf,
  buildRaw,
  displayName,
  hasGmailAccess,
  splitAddresses,
  UNREAD_QUERY,
  type Message,
  type MessageSummary,
  type Outgoing,
} from "../../src/google/gmail.js";
import { startFrom, WRITE_INSTRUCTIONS } from "../../src/google/compose.js";
import { missingFeatures } from "../../src/google/instructions.js";
import { shortScope } from "../../src/google/auth.js";
import { clientPath, hasClient, loadClient, GoogleAuthError } from "../../src/google/oauth.js";
import type { Account } from "../../src/accounts/accounts.js";
import { MergedList } from "../../src/google/merged.js";
import { formatAmount, type Bill } from "../../src/bills/store.js";
import { acceptBill, editBill, ignoreBill, markPaid } from "../../src/bills/actions.js";
import { billSettings, runScan, scanSummary } from "../../src/bills/view.js";
import { billsInMonth, monthCsv } from "../../src/bills/summary.js";
import { daysUntil, noticeLine, noticeToast } from "../../src/bills/remind.js";
import { describeRepeat, formatDue, toLocal } from "../../src/reminders/schedule.js";
import type { Reminder } from "../../src/reminders/store.js";
import { secretReason } from "../../src/memory/guard.js";
import type { Memory } from "../../src/memory/store.js";
import { listImages, stripRequest } from "../../src/images.js";
import { briefSchedule, nextBriefAt } from "../../src/background/brief.js";
import { installTask, removeTask, taskStatus } from "../../src/background/task.js";
import { showToast } from "../../src/background/notify.js";
import { reminderToast } from "../../src/background/tick.js";
import { copyImageToClipboard, openWithDefaultApp } from "../../src/system.js";
import { runDoctor } from "../../src/doctor.js";
import { region } from "../../src/region.js";
import { stripControl, truncate } from "../../src/util.js";
import type { ThreadItem } from "../../src/protocol/v2/index.js";
import { GuiInteractions } from "./interactions.js";
import { imageUrl, allowImage } from "./images.js";
import { hasRemoteContent, prepareMail, showMail } from "./mailview.js";
import type * as A from "../shared/api.js";

const GUIDE_URL = "https://github.com/Ruihang2017/project-jarvis/blob/main/docs/google-cloud-setup.md";
const REMINDER_POLL_MS = 20_000;
const MAX_ATTACHMENTS = 5;
const IMAGE_TYPES = ["png", "jpg", "jpeg", "gif", "webp"];

const ok = (message = ""): A.Result => ({ ok: true, message });
const fail = (e: unknown): A.Result => ({ ok: false, message: e instanceof Error ? e.message : String(e) });
const clean = (s: string | undefined | null) => stripControl(s ?? "");

export class EdwardService implements A.EdwardApi {
  session!: Session;
  private interactions!: GuiInteractions;
  private entries: A.ChatEntry[] = [];
  private renameNotice: string[] = [];
  private account: { email?: string; plan?: string } = {};
  private signedIn = false;
  private ready = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly emit: (e: A.EdwardEvent) => void,
    private readonly window: () => BrowserWindow | null,
  ) {}

  /** Runs once at start-up, before the window asks for anything. */
  async start(): Promise<void> {
    this.renameNotice = renameMessage(await moveFromJarvis());
    const data = ensureDataVersion();
    if (data.newer) this.renameNotice.push(`Your data (v${data.to}) is newer than this Edward — update Edward before relying on it.`);
    this.session = new Session();
    this.interactions = new GuiInteractions(
      (ask) => this.emit({ type: "ask", ask }),
      (id) => this.emit({ type: "askDone", id }),
      () => void this.session.interrupt().catch(() => {}),
    );
    this.session.interactions = this.interactions;
    this.session.onRedacted = (source, removed) => {
      const where = { message: "your message", tool: "a tool's answer", instructions: "Edward's notes", answer: "your answer", background: "a background task" }[source];
      this.push({ kind: "notice", id: randomUUID(), tone: "guard", text: `${capitalise(describeRemoved(removed))} removed from ${where} before it left this computer. The model didn't see it.` });
    };
    this.session.client.on("exit", (code) => this.notice([`Codex stopped (${code}). Close and reopen Edward.`]));
    const { account } = await this.session.init();
    this.signedIn = account?.type === "chatgpt";
    if (account?.type === "chatgpt") this.account.email = account.email ?? undefined;
    if (this.signedIn) this.afterSignIn();
    this.ready = true;
  }

  private afterSignIn() {
    this.session.rateLimits().then((r) => (this.account.plan = r.rateLimits.planType ?? undefined), () => {});
    if (!runtime.noBackgroundWork) startBackgroundWork(this.session, (lines) => this.notice(lines), () => {});
    const check = () => {
      try {
        const due = claimDueNow(this.session);
        for (const f of due.reminders) void showToast(reminderToast(f));
        for (const n of due.bills) void showToast(noticeToast(n));
        const lines = [...due.reminders.map((f) => `⏰ ${f.occurrence.slice(11)} ${f.reminder.text}`), ...due.bills.map(noticeLine)];
        if (lines.length) this.notice(lines);
        void due.brief?.then((b) => this.notice([b.title, ...b.lines]));
      } catch {
        // a failed check is retried on the next tick
      }
    };
    check();
    this.timer = setInterval(check, REMINDER_POLL_MS);
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.session?.close();
  }

  private notice(lines: string[]) {
    // Terminal hints ("· /bills paid 3") and leading emoji don't belong in the window.
    const clean = lines.map((l) => stripControl(l.replace(/\s*· \/[a-z]+[^·]*$/i, "").replace(/^[^\p{L}\p{N}"(]+/u, "").trim())).filter(Boolean);
    if (clean.length) this.emit({ type: "notice", lines: clean });
  }

  private push(entry: A.ChatEntry) {
    this.entries.push(entry);
    this.emit({ type: "entry", entry });
  }

  private pushState() {
    void this.state().then((state) => this.emit({ type: "state", state }));
  }

  // ---------------------------------------------------------------- state and sign-in

  async state(): Promise<A.AppState> {
    const s = this.session;
    const settings = loadSettings();
    return {
      ready: this.ready,
      signedIn: this.signedIn,
      email: this.account.email,
      plan: this.account.plan,
      model: s?.model ?? config.model,
      effort: s?.effort ?? config.effort,
      mode: (s?.mode ?? "chat") as A.Mode,
      threadId: s?.threadId ?? null,
      renameNotice: this.renameNotice,
      firstRun: !settings.onboarded,
      google: await this.google(),
      background: (await taskStatus()).installed,
      webSearch: settings.webSearch !== "off",
      dataDir: appDataDir(),
      version: app.getVersion(),
      attachments: (s?.pendingImages ?? []).map(attachment),
    };
  }

  async signIn(): Promise<A.Result> {
    try {
      await this.session.login((url) => void shell.openExternal(url));
      const { account } = await this.session.init();
      this.signedIn = account?.type === "chatgpt";
      if (account?.type === "chatgpt") this.account.email = account.email ?? undefined;
      if (this.signedIn) this.afterSignIn();
      this.pushState();
      return this.signedIn ? ok(`Signed in as ${this.account.email ?? "you"}`) : { ok: false, message: "That wasn't a ChatGPT account" };
    } catch (e) {
      return fail(e);
    }
  }

  async finishSetup() {
    updateSettings({ onboarded: true });
    this.pushState();
  }

  // ---------------------------------------------------------------- conversation

  async send(text: string): Promise<void> {
    const line = text.trim();
    if (!line) return;
    if (line.startsWith("/")) return this.command(line);
    if (this.session.busy) return this.notice(["Edward is still answering. Wait for it, or press Stop."]);
    const { images, notes } = turnInputs(this.session, line);
    // Shown as it was sent: anything the guard removes is marked, not kept on screen.
    this.push({ kind: "user", id: randomUUID(), text: redact(line).text, images: images.filter((p) => p !== this.session.lastGeneratedImage).map(attachment) });
    this.pushState();
    let reply: Extract<A.ChatEntry, { kind: "assistant" }> | null = null;
    const finishReply = () => {
      if (reply) {
        reply.streaming = false;
        this.emit({ type: "entry", entry: reply });
      }
      reply = null;
    };
    this.emit({ type: "turn", busy: true, label: "Thinking…" });
    try {
      const turn = await this.session.send(
        line,
        {
          onDelta: (t) => {
            const piece = stripControl(t);
            if (!reply) {
              reply = { kind: "assistant", id: randomUUID(), text: "", streaming: true };
              this.push(reply);
            }
            reply.text += piece;
            this.emit({ type: "delta", id: reply.id, text: piece });
          },
          onItemStarted: (item) => {
            const label = activityLabel(item);
            if (label) this.emit({ type: "turn", busy: true, label: label.replace(/^🎨 /, "") });
            if (item.type === "agentMessage") finishReply();
          },
          onItemCompleted: (item) => {
            if (item.type === "agentMessage") return finishReply();
            if (item.type === "imageGeneration") {
              finishReply();
              const r = handleGeneratedImage(item, this.session, line);
              if (r.record) {
                allowImage(r.record.path);
                this.push({ kind: "image", id: randomUUID(), url: imageUrl(r.record.path), path: r.record.path, prompt: line, revised: r.record.revisedPrompt ? clean(r.record.revisedPrompt) : undefined });
              } else this.push({ kind: "notice", id: randomUUID(), tone: "warn", text: capitalise(r.problem ?? "no picture") });
            } else {
              const lines = activityNotes(item).map(plain);
              if (lines.length) {
                finishReply();
                const [first, ...rest] = lines;
                this.push({ kind: "activity", id: randomUUID(), icon: activityIcon(item), text: first!, detail: rest.length ? rest : undefined });
              }
            }
            const suggestion = backgroundSuggestion(item);
            if (suggestion) this.push({ kind: "notice", id: randomUUID(), tone: "info", text: suggestion.replace(/^🔔 /, "").replace("(/background on)", "(Settings)") });
            this.emit({ type: "turn", busy: true, label: "Thinking…" });
          },
          onError: (e, retry) => this.push({ kind: "notice", id: randomUUID(), tone: "error", text: `${clean(e.message)}${retry ? " (retrying)" : ""}` }),
        },
        images,
        notes,
      );
      finishReply();
      if (turn.status === "interrupted") this.push({ kind: "notice", id: randomUUID(), tone: "info", text: "Stopped." });
      else if (turn.status === "failed") this.push({ kind: "notice", id: randomUUID(), tone: "error", text: clean(turn.error?.message ?? "Something went wrong.") });
    } catch (e) {
      finishReply();
      this.push({ kind: "notice", id: randomUUID(), tone: "error", text: clean(e instanceof Error ? e.message : String(e)) });
    } finally {
      this.emit({ type: "turn", busy: false });
      this.pushState();
    }
  }

  /** The window has pages for most commands; a few still work typed. */
  private async command(line: string) {
    const [name = "", ...rest] = line.split(/\s+/);
    const arg = rest.join(" ");
    const pages: Record<string, string> = {
      "/brief": "today", "/calendar": "calendar", "/mail": "mail", "/bills": "bills", "/remind": "reminders", "/memory": "memory", "/images": "pictures",
      "/settings": "settings", "/model": "settings", "/effort": "settings", "/usage": "settings", "/region": "settings", "/web": "settings", "/background": "settings",
      "/doctor": "doctor", "/data": "data", "/google": "google", "/connect": "google", "/disconnect": "google", "/resume": "history", "/help": "commands", "/start": "commands",
    };
    if (name === "/new") return this.newConversation();
    if (name === "/mode" && ["chat", "manual", "semi-auto"].includes(arg)) return void (await this.setMode(arg as Mode));
    if (name === "/mode") return this.emit({ type: "navigate", to: "modes" });
    if (pages[name]) return this.emit({ type: "navigate", to: pages[name]! });
    this.notice([`${name} isn't a command here. Type / to see them.`]);
  }

  async interrupt() {
    await this.session.interrupt().catch(() => {});
  }

  async newConversation() {
    if (this.session.busy) return this.notice(["Wait for the reply to finish first."]);
    await this.session.newThread();
    this.entries = [];
    this.pushState();
  }

  async transcript() {
    return this.entries;
  }

  async conversations(): Promise<A.ThreadInfo[]> {
    const threads = await this.session.listThreads(30);
    return threads.map((t) => {
      const said = withoutNotes(t.preview);
      const text = clean(t.name ?? said).split("\n")[0]?.trim() || "Untitled";
      return { id: t.id, title: truncate(text, 70), preview: truncate(clean(said).replace(/\s+/g, " "), 140), updatedAt: t.updatedAt * 1000 };
    });
  }

  async openConversation(id: string): Promise<A.ChatEntry[]> {
    if (this.session.busy) throw new Error("Wait for the reply to finish first.");
    await this.session.resumeThread(id);
    const turns = await this.session.readTurns(id, 30);
    this.entries = turns.flatMap((t) => t.items.flatMap(historyEntries));
    this.pushState();
    return this.entries;
  }

  async setMode(mode: A.Mode): Promise<A.Result> {
    try {
      await this.session.setMode(mode);
      this.pushState();
      return ok(`${capitalise(mode)} mode`);
    } catch (e) {
      return fail(e);
    }
  }

  async answer(id: string, a: A.AskAnswer) {
    this.interactions.answer(id, a);
  }

  async attachFiles(): Promise<A.Attachment[]> {
    const win = this.window();
    const res = win
      ? await dialog.showOpenDialog(win, { title: "Attach pictures", properties: ["openFile", "multiSelections"], filters: [{ name: "Pictures", extensions: IMAGE_TYPES }] })
      : await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], filters: [{ name: "Pictures", extensions: IMAGE_TYPES }] });
    for (const p of res.filePaths) this.addAttachment(p);
    return this.session.pendingImages.map(attachment);
  }

  async attachClipboard(): Promise<A.Attachment[]> {
    let png: Buffer | null = null;
    for (const item of await clipboard.read().catch(() => [])) {
      if (!item.types.includes("image/png")) continue;
      png = Buffer.from(await (await item.getType("image/png")).arrayBuffer());
      break;
    }
    if (!png) {
      this.notice(["There's no picture on the clipboard."]);
      return this.session.pendingImages.map(attachment);
    }
    const dir = join(appDataDir(), "attachments");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `pasted-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
    writeFileSync(path, png);
    this.addAttachment(path);
    return this.session.pendingImages.map(attachment);
  }

  private addAttachment(path: string) {
    if (!IMAGE_TYPES.includes(extname(path).slice(1).toLowerCase())) return this.notice([`${basename(path)} isn't a picture.`]);
    if (this.session.pendingImages.length >= MAX_ATTACHMENTS) return this.notice([`At most ${MAX_ATTACHMENTS} pictures per message.`]);
    allowImage(path);
    if (!this.session.pendingImages.includes(path)) this.session.pendingImages.push(path);
  }

  async removeAttachment(path: string) {
    this.session.pendingImages = this.session.pendingImages.filter((p) => p !== path);
    return this.session.pendingImages.map(attachment);
  }

  // ---------------------------------------------------------------- today

  async today(): Promise<A.TodayView> {
    const now = new Date();
    const hour = now.getHours();
    const evening = hour >= 18 || hour < 4;
    const greeting = hour < 4 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const acc = this.session.accounts;
    const google = acc.connected().some((a) => !acc.state(a)?.invalidAt);
    let events: A.EventInfo[] = [];
    let tomorrow: A.EventInfo[] = [];
    let calendarProblem: string | undefined;
    if (acc.for("calendar").length) {
      const day = localDate(now);
      const { events: all, problem } = await this.eventsAcross(dayStart(day), dayStart(nextDate(day, 2)));
      const live = all.filter(({ e }) => !e.declined);
      events = live.filter(({ e }) => localDate(e.start) === day && (e.allDay || e.end > now)).map((x) => this.eventInfo(x));
      tomorrow = live.filter(({ e }) => localDate(e.start) === nextDate(day)).map((x) => this.eventInfo(x));
      calendarProblem = problem;
    }
    let mail: A.MailSummary[] = [];
    let mailCount = 0;
    let mailProblem: string | undefined;
    if (acc.for("mail").length) {
      const { unread, problem } = await this.unreadAcross();
      mailCount = unread.length;
      mail = unread.slice(0, 3);
      mailProblem = problem;
    }
    const tracked = this.session.bills.list("tracked").filter((b) => b.dueDate && daysUntil(b.dueDate, now) <= 14).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
    const reminders = this.session.reminders.upcoming().filter((r) => (r.snoozedUntil ?? r.dueAt).slice(0, 10) === localDate(now)).map(reminderInfo);
    const newBills = this.session.bills.list("pending").length;
    const parts = [
      events.length ? `${count(events.length, "thing")} on today` : google ? "nothing left in your calendar today" : "",
      tracked.length ? `${count(tracked.length, "bill")} due soon` : "",
      reminders.length ? count(reminders.length, "reminder") : "",
      mailCount ? `${count(mailCount, "unread email")}` : "",
    ].filter(Boolean);
    const summary = parts.length ? `${capitalise(joinWords(parts))}.` : "Nothing needs you right now.";
    return {
      greeting: `${greeting}${this.firstName() ? `, ${this.firstName()}` : ""}.`,
      date: now.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" }),
      evening,
      summary,
      events,
      tomorrow,
      calendarProblem,
      bills: tracked.slice(0, 3).map(billInfo),
      newBills,
      mail,
      mailCount,
      mailProblem,
      reminders,
      google,
    };
  }

  private firstName(): string {
    const profile = this.session.memory.core().find((m) => /\bname is ([A-Z][a-z]+)/.test(m.text));
    return profile ? /\bname is ([A-Z][a-z]+)/.exec(profile.text)![1]! : "";
  }

  // ---------------------------------------------------------------- calendar and mail

  async calendar(days: number): Promise<A.CalendarView> {
    const first = localDate(new Date());
    return this.calendarBetween(first, nextDate(first, days));
  }

  async calendarRange(from: string, to: string): Promise<A.CalendarView> {
    const date = /^\d{4}-\d{2}-\d{2}$/;
    if (!date.test(String(from)) || !date.test(String(to)) || to <= from) throw new Error("bad range");
    // A month view needs six weeks; nothing asks for more.
    return this.calendarBetween(from, to < nextDate(from, 43) ? to : nextDate(from, 43));
  }

  /** Days `first` up to (not including) `last`, every calendar account, with free time from now on. */
  private async calendarBetween(first: string, last: string): Promise<A.CalendarView> {
    const acc = this.session.accounts;
    const accounts = acc.for("calendar");
    const empty = { days: [], free: [], calendars: [] };
    if (!accounts.length) return { connected: false, ...empty };
    const today = localDate(new Date());
    const from = dayStart(first);
    const to = dayStart(last);
    const [{ events, problem }, calendars] = await Promise.all([
      this.eventsAcross(from, to),
      Promise.all(accounts.map(async (a) => (await new CalendarClient(acc.auth(a)).calendars().catch(() => [])).map((c) => ({ name: clean(c.name), primary: c.primary, ...this.from(a) })))),
    ]);
    if (problem && !events.length) return { connected: true, problem, ...empty };
    const list: A.CalendarView["days"] = [];
    for (let d = first; d < last; d = nextDate(d)) {
      list.push({
        date: d,
        label: niceDay(d, today),
        events: events.filter(({ e }) => localDate(e.start) === d || (e.allDay && localDate(e.start) <= d && localDate(e.end) > d)).map((x) => this.eventInfo(x)),
      });
    }
    // Busy in any account is busy.
    const slots = to > new Date() ? freeSlots(
      events.map((x) => x.e),
      from > new Date() ? from : new Date(),
      to,
      { minutes: 30, weekends: true },
    ) : [];
    const free: A.CalendarView["free"] = [];
    for (const s of slots) {
      const d = localDate(s.start);
      let day = free.find((f) => f.date === d);
      if (!day) free.push((day = { date: d, label: niceDay(d, today), slots: [] }));
      day.slots.push(`${hhmm(s.start)} to ${hhmm(s.end)}`);
    }
    return { connected: true, problem, days: list, free: free.slice(0, 4), calendars: calendars.flat(), manyAccounts: accounts.length > 1 };
  }

  async mail(): Promise<A.MailView> {
    if (!this.session.accounts.for("mail").length) return { connected: false, unread: [] };
    const { unread, problem } = await this.unreadAcross();
    return { connected: true, problem, unread, manyAccounts: this.session.accounts.for("mail").length > 1 };
  }

  /** Open mail lists ("load more" continues one); the oldest are dropped. */
  private readonly lists = new Map<string, MergedList<MessageSummary>>();

  /** One page of the Inbox (30 days), Unread or a search, from every mail account, newest first. */
  async mailList(o: { view: A.MailListView; query?: string; cursor?: string }): Promise<A.MailPage> {
    const acc = this.session.accounts;
    const accounts = acc.for("mail");
    if (!accounts.length) return { connected: false, items: [] };
    let id = o.cursor;
    let list = id ? this.lists.get(id) : undefined;
    if (!list) {
      const query = o.view === "inbox" ? INBOX_QUERY : o.view === "unread" ? UNREAD_QUERY : (o.query ?? "").trim();
      if (!query) return { connected: true, items: [], manyAccounts: accounts.length > 1 };
      const source = (a: Account) => ({
        key: a.id,
        fetch: async (token?: string) => {
          const page = await new GmailClient(acc.auth(a)).page(query, PAGE_SIZE, token);
          return { items: page.messages, next: page.next };
        },
      });
      list = new MergedList<MessageSummary>(accounts.map(source), (m) => m.date.getTime());
      id = randomUUID();
      this.lists.set(id, list);
      while (this.lists.size > 6) this.lists.delete(this.lists.keys().next().value!);
    }
    const items = (await list.next(PAGE_SIZE)).map(({ key, item }) => this.mailSummary(item, acc.get(key)!));
    if (!list.more) this.lists.delete(id!);
    const problem = list.problems.map((p) => (accounts.length > 1 ? `${acc.label(acc.get(p.key)!)}: ${googleProblem(p.error)}` : googleProblem(p.error))).join(" · ");
    return { connected: true, items, cursor: list.more ? id : undefined, problem: problem || undefined, manyAccounts: accounts.length > 1 };
  }

  // ------------------------------------------------ writing email (F1b): the user's own, no model

  async mailCompose(start?: { id: string; mode: "reply" | "replyAll" | "forward" }): Promise<A.ComposeDraft> {
    const acc = this.session.accounts;
    if (!start) {
      const from = acc.primary("mail");
      if (!from) throw new Error("No mail account is connected.");
      return { mode: "new", from: from.id, to: "", cc: "", subject: "", body: "" };
    }
    const slash = start.id.indexOf("/");
    const account = slash > 0 ? acc.get(start.id.slice(0, slash)) : acc.for("mail")[0];
    const { gmail, id } = this.message(start.id);
    const m = this.opened.get(start.id) ?? (await gmail.message(id));
    const f = startFrom(m, start.mode, account ? acc.state(account)?.email : undefined);
    return { mode: start.mode, from: account!.id, to: f.to.join(", "), cc: f.cc.join(", "), subject: f.subject, body: f.body, threadId: f.threadId, inReplyTo: f.inReplyTo, references: f.references };
  }

  /** The account and the parsed message, or the reasons it can't go. */
  private outgoing(d: A.ComposeDraft): { problems: string[]; account?: Account; out: Outgoing } {
    const acc = this.session.accounts;
    const account = acc.get(d.from);
    const to = splitAddresses(d.to ?? "");
    const cc = splitAddresses(d.cc ?? "");
    const problems: string[] = [];
    if (!account || !acc.usable(account, "mail")) problems.push("That account can't send mail right now.");
    if (!to.length) problems.push("Add someone to send it to.");
    const bad = [...to, ...cc].filter((e) => !addressOf(e));
    if (bad.length) problems.push(`Not an email address: ${bad.join(", ")}`);
    if (!String(d.subject ?? "").trim()) problems.push("Add a subject.");
    if (!String(d.body ?? "").trim()) problems.push("The email is empty.");
    return { problems, account, out: { to, cc, subject: String(d.subject ?? "").trim(), body: String(d.body ?? ""), inReplyTo: d.inReplyTo, references: d.references } };
  }

  async mailCheck(d: A.ComposeDraft): Promise<A.ComposeCheck> {
    const { problems, account, out } = this.outgoing(d);
    const from = account ? (this.session.accounts.state(account)?.email ?? this.session.accounts.label(account)) : "";
    if (problems.length || !account) return { problems, firstTime: [], from };
    const writer = new GmailWriter(this.session.accounts.auth(account));
    const addresses = [...new Set([...out.to, ...out.cc].map(addressOf).filter((a): a is string => Boolean(a)))];
    const firstTime = (await Promise.all(addresses.map(async (a) => ((await writer.emailedBefore(a).catch(() => true)) ? null : a)))).filter((a): a is string => Boolean(a));
    return { problems, firstTime, from };
  }

  /** Saves (or updates) the Gmail draft; returns its id. */
  private async saveDraft(d: A.ComposeDraft): Promise<{ writer: GmailWriter; draftId: string }> {
    const { problems, account, out } = this.outgoing(d);
    if (problems.length || !account) throw new Error(problems.join(" "));
    const writer = new GmailWriter(this.session.accounts.auth(account));
    const raw = buildRaw(out);
    const { id } = d.draftId ? await writer.updateDraft(d.draftId, raw, d.threadId) : await writer.createDraft(raw, d.threadId);
    return { writer, draftId: id };
  }

  async mailSaveDraft(d: A.ComposeDraft): Promise<A.Result & { draftId?: string }> {
    try {
      const { draftId } = await this.saveDraft(d);
      return { ...ok("Saved in Gmail drafts"), draftId };
    } catch (e) {
      return fail(e);
    }
  }

  async mailSend(d: A.ComposeDraft): Promise<A.Result> {
    try {
      const { writer, draftId } = await this.saveDraft(d);
      await writer.sendDraft(draftId);
      return ok("Sent");
    } catch (e) {
      return fail(e);
    }
  }

  async mailWrite(d: A.ComposeDraft, notes: string): Promise<A.Result & { body?: string }> {
    const what = String(notes ?? "").trim();
    if (!what) return { ok: false, message: "Say what the email should say." };
    try {
      // Everything here goes to the model through the privacy guard, like any message.
      const replyingTo = d.mode === "reply" || d.mode === "replyAll" || d.mode === "forward" ? String(d.body ?? "").slice(0, 8000) : "";
      const input = [`To: ${d.to}`, `Subject: ${d.subject}`, "", `The user's notes: ${what}`, ...(replyingTo ? ["", "What is in the email so far (with the quoted email it answers):", replyingTo] : [])].join("\n");
      const body = stripControl(await this.session.runEphemeral(WRITE_INSTRUCTIONS, input)).trim();
      return { ...ok("Written. Read it through before sending."), body };
    } catch (e) {
      return fail(e);
    }
  }

  /** Which account something is from, for the window's label and colour. */
  private from(a: Account): A.FromAccount {
    return { account: a.id, accountLabel: this.session.accounts.label(a), color: a.color };
  }

  /** Events from every calendar account; one account failing doesn't hide the others. */
  private async eventsAcross(from: Date, to: Date): Promise<{ events: { e: CalendarEvent; a: Account }[]; problem?: string }> {
    const acc = this.session.accounts;
    const problems: string[] = [];
    const lists = await Promise.all(
      acc.for("calendar").map(async (a) => {
        try {
          return (await new CalendarClient(acc.auth(a)).events(from, to)).map((e) => ({ e, a }));
        } catch (e) {
          problems.push(acc.for("calendar").length > 1 ? `${acc.label(a)}: ${googleProblem(e)}` : googleProblem(e));
          return [];
        }
      }),
    );
    const events = lists.flat().sort((x, y) => x.e.start.getTime() - y.e.start.getTime() || Number(y.e.allDay) - Number(x.e.allDay));
    return { events, problem: problems.join(" · ") || undefined };
  }

  /** Unread Primary mail from every mail account, newest first. */
  private async unreadAcross(): Promise<{ unread: A.MailSummary[]; problem?: string }> {
    const acc = this.session.accounts;
    const problems: string[] = [];
    const lists = await Promise.all(
      acc.for("mail").map(async (a) => {
        try {
          return (await new GmailClient(acc.auth(a)).search(UNREAD_QUERY, 20)).map((m) => ({ m, a }));
        } catch (e) {
          problems.push(acc.for("mail").length > 1 ? `${acc.label(a)}: ${googleProblem(e)}` : googleProblem(e));
          return [];
        }
      }),
    );
    const unread = lists
      .flat()
      .sort((x, y) => y.m.date.getTime() - x.m.date.getTime())
      .map(({ m, a }) => this.mailSummary(m, a));
    return { unread, problem: problems.join(" · ") || undefined };
  }

  private eventInfo({ e, a }: { e: CalendarEvent; a: Account }): A.EventInfo {
    return { ...eventInfo(e), id: packId(a.id, e.calendarId, e.id), ...this.from(a) };
  }

  // ------------------------------------------------ calendar by hand (F2b): the user's own form, no model

  async calendarTargets(): Promise<A.CalendarTarget[]> {
    const acc = this.session.accounts;
    const def = acc.primary("calendar");
    const lists = await Promise.all(
      acc.for("calendar").map(async (a) =>
        (await new CalendarClient(acc.auth(a)).calendars().catch(() => []))
          .filter((c) => c.writable)
          .map((c) => ({ id: packId(a.id, c.id), name: clean(c.name), primary: c.primary, isDefault: def?.id === a.id && c.primary, ...this.from(a) })),
      ),
    );
    return lists.flat();
  }

  /** The account, calendar and (when changing) event an id names; refuses what Edward may not change (D22). */
  private async eventTarget(calendarRef: [string, string], eventId?: string) {
    const acc = this.session.accounts;
    const account = acc.get(calendarRef[0]);
    if (!account || !acc.usable(account, "calendar")) throw new Error("That calendar's account isn't connected any more.");
    const client = new CalendarClient(acc.auth(account));
    const calendar = (await client.calendars()).find((c) => c.id === calendarRef[1]);
    if (!calendar) throw new Error("That calendar isn't shown any more.");
    if (!calendar.writable) throw new Error(`The "${calendar.name}" calendar is read-only.`);
    const event = eventId ? await client.getEvent(calendar, eventId) : null;
    if (eventId && !event) throw new Error("That event no longer exists.");
    if (event && event.guests > 0) throw new Error("This event has other guests. Change it in Google Calendar, so they are told.");
    return { client, calendar, event };
  }

  async eventSave(form: A.EventForm, id?: string): Promise<A.Result> {
    try {
      const title = stripControl(String(form.title ?? "")).trim();
      if (!title) return { ok: false, message: "Give it a title." };
      const parts = id ? unpackId(id) : form.target ? unpackId(form.target) : null;
      if (!parts || parts.length < 2) return { ok: false, message: "Choose a calendar." };
      const { client, calendar, event } = await this.eventTarget([parts[0]!, parts[1]!], id ? parts[2] : undefined);
      const times = resolveTimes(String(form.start ?? ""), String(form.end ?? "") || undefined, event ?? undefined);
      const input: EventInput = { title, ...times, location: stripControl(String(form.location ?? "")).trim(), notes: stripControl(String(form.notes ?? "")).trim() };
      if (event) {
        await client.updateEvent(calendar, event.id, input);
        return ok(event.recurring ? "Changed (this time only)" : "Changed");
      }
      await client.createEvent(calendar, { ...input, location: input.location || undefined, notes: input.notes || undefined });
      return ok(`Added to ${calendar.name}`);
    } catch (e) {
      return fail(e);
    }
  }

  async eventDelete(id: string): Promise<A.Result> {
    try {
      const parts = unpackId(id);
      if (parts.length < 3) return { ok: false, message: "Unknown event." };
      const { client, calendar, event } = await this.eventTarget([parts[0]!, parts[1]!], parts[2]);
      await client.deleteEvent(calendar, event!.id);
      return ok(event!.recurring ? "Deleted (this time only)" : "Deleted");
    } catch (e) {
      return fail(e);
    }
  }

  /** "g2/abc123" → the account and Gmail's id. Ids from before A1 (no account) are the first account's. */
  private message(key: string): { gmail: GmailClient; id: string } {
    const acc = this.session.accounts;
    const slash = key.indexOf("/");
    const a = slash > 0 ? acc.get(key.slice(0, slash)) : acc.for("mail")[0];
    if (!a || !acc.usable(a, "mail")) throw new Error("That email's account isn't connected any more.");
    return { gmail: new GmailClient(acc.auth(a)), id: slash > 0 ? key.slice(slash + 1) : key };
  }

  private mailSummary(m: MessageSummary, a: Account): A.MailSummary {
    return {
      ...this.from(a),
      id: `${a.id}/${m.id}`,
      threadId: m.threadId,
      from: clean(displayName(m.from)),
      subject: clean(m.subject) || "(no subject)",
      snippet: clean(m.snippet),
      date: shortWhen(m.date),
      unread: m.unread,
      looksLikeBill: Boolean(this.session.bills.byMessage(m.id)) || /\b(bill|invoice|statement|amount due|payment due)\b/i.test(`${m.subject} ${m.snippet}`),
    };
  }

  async mailMessage(id: string): Promise<A.MailMessage> {
    const where = this.message(id);
    const m = await where.gmail.message(where.id);
    this.opened.set(id, m);
    while (this.opened.size > 10) this.opened.delete(this.opened.keys().next().value!);
    const body = clean(m.body);
    return {
      id,
      from: clean(m.from),
      to: clean(m.to),
      subject: clean(m.subject),
      date: m.date.toLocaleString("en-AU"),
      body,
      removed: [...new Set(redact(body).removed)].map((c) => describeRemoved([c])),
      hasHtml: Boolean(m.html),
    };
  }

  /** Emails opened recently, and their HTML ready for the frame (pictures inside the email included). */
  private readonly opened = new Map<string, Message>();
  private readonly prepared = new Map<string, string>();

  async mailOriginal(id: string, pictures: boolean): Promise<A.MailOriginal | null> {
    const { gmail, id: messageId } = this.message(id);
    const m = this.opened.get(id) ?? (await gmail.message(messageId));
    if (!m.html) return null;
    let html = this.prepared.get(id);
    if (html === undefined) {
      // Pictures that travel inside the email (logos and the like): up to 30 of them, 5 MB in all.
      const inline = new Map<string, string>();
      let total = 0;
      for (const img of m.inline.slice(0, 30)) {
        const bytes = img.data ? Buffer.from(img.data, "base64url") : img.attachmentId ? await gmail.attachment(m.id, img.attachmentId).catch(() => null) : null;
        if (!bytes || (total += bytes.length) > 5_000_000) continue;
        inline.set(img.cid.toLowerCase(), `data:${img.mimeType};base64,${bytes.toString("base64")}`);
      }
      html = prepareMail(m.html, inline);
      this.prepared.set(id, html);
      while (this.prepared.size > 10) this.prepared.delete(this.prepared.keys().next().value!);
    }
    const shown = pictures || loadSettings().mailPictures === "always";
    return { url: showMail(html, shown), remote: hasRemoteContent(html), shown };
  }

  // ---------------------------------------------------------------- bills

  async bills(): Promise<A.BillsView> {
    const store = this.session.bills;
    const today = localDate(new Date());
    const month = today.slice(0, 7);
    const toPay = store.list("tracked").sort(byDue);
    const autopay = store.list("autopay").filter((b) => !b.dueDate || b.dueDate >= today).sort(byDue);
    const paidThisMonth = store.list("paid").filter((b) => (b.paidAt ?? b.dueDate ?? "").slice(0, 7) === month);
    return {
      pending: store.list("pending").map(billInfo),
      toPay: toPay.map(billInfo),
      autopay: autopay.map(billInfo),
      paidThisMonth: paidThisMonth.map(billInfo),
      toPayTotal: total(toPay),
      paidTotal: total(paidThisMonth),
      settings: billSettings() as A.BillSettings,
      canScan: this.session.accounts.for("mail").length > 0,
    };
  }

  async billHistory(id: number): Promise<A.BillHistory> {
    const b = this.session.bills.get(id);
    if (!b) throw new Error(`no bill #${id}`);
    return { bill: billInfo(b), earlier: this.session.bills.history(b.payee, b.id).slice(0, 5).map(billInfo), usualDomains: this.session.bills.payeeDomains(b.payee) };
  }

  async billAction(id: number, action: "accept" | "ignore" | "paid"): Promise<A.Result> {
    const store = this.session.bills;
    const r = action === "accept" ? acceptBill(store, id) : action === "ignore" ? ignoreBill(store, id) : markPaid(store, id);
    return r.ok ? ok(`${r.bill.payee} ${action === "accept" ? "is tracked" : action === "ignore" ? "ignored" : "marked paid"}`) : { ok: false, message: r.reason };
  }

  async billEdit(id: number, field: "amount" | "due" | "payee", value: string): Promise<A.Result> {
    const r = editBill(this.session.bills, id, field, value);
    return r.ok ? ok("Saved") : { ok: false, message: capitalise(r.reason) };
  }

  async billScan(): Promise<A.Result> {
    try {
      const r = await runScan(this.session);
      const lines = scanSummary(r).map((l) => l.replace(/^[^\w]+/u, "").replace(/ — \/bills.*$/, ""));
      return ok(lines.join(" ") || `No new bills (${count(r.scanned, "email")} checked).`);
    } catch (e) {
      return fail(e);
    }
  }

  async billMonth(month = localDate(new Date()).slice(0, 7)): Promise<A.MonthView> {
    const bills = billsInMonth(this.session.bills, month);
    const sum = (list: Bill[]) => list.reduce((n, b) => n + (b.amountCents ?? 0), 0);
    const all = sum(bills);
    const cats = new Map<string, number>();
    for (const b of bills) cats.set(b.category, (cats.get(b.category) ?? 0) + (b.amountCents ?? 0));
    const max = Math.max(1, ...cats.values());
    const cur = region().currency;
    return {
      month,
      label: new Date(`${month}-01T00:00`).toLocaleDateString("en-AU", { month: "long", year: "numeric" }),
      total: formatAmount({ amountCents: all, currency: cur }),
      paid: formatAmount({ amountCents: sum(bills.filter((b) => b.status === "paid")), currency: cur }),
      toPay: formatAmount({ amountCents: sum(bills.filter((b) => b.status === "tracked")), currency: cur }),
      byCategory: [...cats].sort((a, b) => b[1] - a[1]).map(([category, cents]) => ({ category: capitalise(category), amount: formatAmount({ amountCents: cents, currency: cur }), share: Math.round((cents / max) * 100) })),
      bills: bills.map(billInfo),
    };
  }

  async billExport(month: string): Promise<A.Result> {
    const dir = join(appDataDir(), "exports");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `bills-${month}.csv`);
    writeFileSync(path, monthCsv(this.session.bills, month));
    shell.showItemInFolder(path);
    return ok(`Saved ${basename(path)}`);
  }

  async forgetBills(): Promise<A.Result> {
    return ok(`Forgot ${count(this.session.bills.forgetAll(), "bill")}.`);
  }

  // ---------------------------------------------------------------- reminders

  async reminders(): Promise<A.RemindersView> {
    const r = this.session.reminders;
    const { time, days } = briefSchedule();
    return {
      ringing: r.recentlyFired(6).filter((x) => x.status === "fired").map(reminderInfo),
      upcoming: r.upcoming().map(reminderInfo),
      brief: { time, days, next: nextBriefAt() },
    };
  }

  async reminderAction(id: number, action: "done" | "cancel" | "snooze10" | "snooze60"): Promise<A.Result> {
    const r = this.session.reminders;
    const rem = r.get(id);
    if (!rem) return { ok: false, message: `No reminder #${id}` };
    if (action === "done") {
      if (rem.repeat && rem.status === "scheduled") return { ok: false, message: "This one repeats. Cancel it to stop it." };
      r.setStatus(id, "done");
      return ok("Done");
    }
    if (action === "cancel") {
      r.setStatus(id, "cancelled");
      return ok("Cancelled");
    }
    const s = r.snooze(id, action === "snooze10" ? 10 : 60);
    return s?.status === "scheduled" ? ok(`Snoozed until ${formatDue(s.snoozedUntil ?? s.dueAt).slice(-5)}`) : { ok: false, message: "This one can't be snoozed" };
  }

  // ---------------------------------------------------------------- memory

  async memory(query?: string): Promise<A.MemoryView> {
    const mem = this.session.memory;
    const q = query?.trim();
    const pick = (list: Memory[]) => list.map(memoryInfo);
    if (q) {
      const hits = mem.search(q, { limit: 30 }).map((h) => h.memory);
      return { learning: loadSettings().memoryLearning !== false, core: [], long: pick(hits.filter((m) => m.tier === "long")), short: pick(hits.filter((m) => m.tier === "short")), pending: [] };
    }
    return {
      learning: loadSettings().memoryLearning !== false,
      core: pick(mem.core()),
      long: pick(mem.list({ tier: "long" })),
      short: pick(mem.list({ tier: "short" })),
      pending: pick(mem.list({ status: "pending" })),
    };
  }

  async memoryAdd(text: string): Promise<A.Result> {
    const t = text.trim();
    if (!t) return { ok: false, message: "Nothing to remember" };
    const reason = secretReason(t);
    if (reason) return { ok: false, message: `Not saved: it looks like a ${reason}, and Edward never stores those.` };
    try {
      this.session.memory.add({ kind: "note", text: t, source: "manual", threadId: this.session.threadId });
      return ok("Remembered");
    } catch (e) {
      return fail(e);
    }
  }

  async memoryEdit(id: number, text: string): Promise<A.Result> {
    const reason = secretReason(text);
    if (reason) return { ok: false, message: `Not saved: it looks like a ${reason}.` };
    try {
      this.session.memory.update(id, { text: text.trim() });
      return ok("Saved");
    } catch (e) {
      return fail(e);
    }
  }

  async memoryForget(id: number): Promise<A.Result> {
    return this.session.memory.remove(id) ? ok("Forgotten") : { ok: false, message: `No memory #${id}` };
  }

  async memoryReview(id: number, keep: boolean): Promise<A.Result> {
    const mem = this.session.memory;
    if (mem.get(id)?.status !== "pending") return { ok: false, message: "That one isn't waiting for review" };
    return (keep ? mem.approve(id) : mem.remove(id)) ? ok(keep ? "Kept" : "Not kept") : { ok: false, message: "Couldn't change it" };
  }

  async memoryUndo(): Promise<A.Result> {
    const m = this.session.memory.undo();
    return m ? ok(`Removed "${truncate(m.text, 60)}"`) : { ok: false, message: "Nothing saved in this session to undo" };
  }

  async memoryExport(): Promise<A.Result> {
    const dir = join(appDataDir(), "exports");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `memory-export-${new Date().toLocaleDateString("sv")}.md`);
    writeFileSync(path, this.session.memory.exportMarkdown());
    shell.showItemInFolder(path);
    return ok(`Saved ${basename(path)}`);
  }

  // ---------------------------------------------------------------- pictures

  async pictures(): Promise<A.PicturesView> {
    const list = listImages(60);
    for (const r of list) allowImage(r.path);
    return {
      pictures: list.map((r) => ({ path: r.path, url: imageUrl(r.path), prompt: clean(stripRequest(r.prompt) || basename(r.path)), createdAt: new Date(r.createdAt).toLocaleString("en-AU"), size: r.width ? `${r.width}×${r.height}` : undefined })),
      folder: imagesDir(),
      autoOpen: loadSettings().autoOpenImages !== false,
    };
  }

  async pictureAction(path: string, action: "open" | "copy" | "folder"): Promise<A.Result> {
    if (!listImages(500).some((r) => r.path === path) && action !== "folder") return { ok: false, message: "That picture isn't in Edward's list" };
    try {
      if (action === "open") openWithDefaultApp(path);
      else if (action === "copy") await copyImageToClipboard(path);
      else shell.showItemInFolder(existsSync(path) ? path : imagesDir());
      return ok(action === "copy" ? "Copied" : "");
    } catch (e) {
      return fail(e);
    }
  }

  // ---------------------------------------------------------------- settings

  async settings(): Promise<A.Settings> {
    const s = loadSettings();
    const r = region();
    const models = await this.session.listModels().catch(() => []);
    const limits = this.session.limits;
    const windows = [limits?.primary, limits?.secondary].filter((w): w is NonNullable<typeof w> => Boolean(w));
    return {
      model: this.session.model,
      models: models.filter((m) => !m.hidden).map((m) => ({ id: m.id, description: clean(m.description), efforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort) })),
      effort: this.session.effort,
      webSearch: s.webSearch !== "off",
      learning: s.memoryLearning !== false,
      briefTime: briefSchedule().time,
      briefDays: briefSchedule().days,
      background: (await taskStatus()).installed,
      dateOrder: r.dateOrder,
      dateOrderDetected: !s.dateOrder,
      currency: r.currency,
      currencyDetected: !s.currency,
      autoOpenImages: s.autoOpenImages !== false,
      mailPictures: s.mailPictures === "always",
      imagesDir: imagesDir(),
      limits: windows.map((w) => ({
        label: w.windowDurationMins === 10080 ? "Weekly limit" : w.windowDurationMins ? `${Math.round(w.windowDurationMins / 60)}-hour limit` : "Limit",
        usedPercent: Math.round(w.usedPercent),
        resets: w.resetsAt ? new Date(w.resetsAt * 1000).toLocaleString("en-AU", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "",
      })),
    };
  }

  async updateSettings(p: A.SettingsPatch): Promise<A.Settings> {
    const session = this.session;
    if (p.model) {
      const m = (await session.listModels()).find((x) => x.id === p.model);
      if (m) {
        session.model = m.id;
        const efforts = m.supportedReasoningEfforts.map((e) => e.reasoningEffort);
        if (!efforts.includes(session.effort)) session.effort = m.defaultReasoningEffort;
      }
    }
    if (p.effort) session.effort = p.effort;
    if (p.webSearch !== undefined) {
      updateSettings({ webSearch: p.webSearch ? "on" : "off" });
      await session.reloadThread().catch(() => {});
    }
    if (p.learning !== undefined) updateSettings({ memoryLearning: p.learning });
    if (p.briefTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.briefTime)) updateSettings({ briefTime: p.briefTime });
    if (p.briefDays) updateSettings({ briefDays: p.briefDays });
    if (p.background !== undefined) {
      const r = p.background ? await installTask() : await removeTask();
      updateSettings({ backgroundSuggested: true });
      if (!r.ok) this.notice([`Couldn't change background reminders: ${r.message}`]);
    }
    if (p.dateOrder !== undefined) updateSettings({ dateOrder: p.dateOrder ?? undefined });
    if (p.currency !== undefined) updateSettings({ currency: p.currency ? p.currency.toUpperCase() : undefined });
    if (p.autoOpenImages !== undefined) updateSettings({ autoOpenImages: p.autoOpenImages });
    if (p.mailPictures !== undefined) updateSettings({ mailPictures: p.mailPictures ? "always" : "ask" });
    if (p.billSettings) {
      const b = p.billSettings;
      if (b.scan) updateSettings({ billsScan: b.scan });
      if (b.confirm) updateSettings({ billsConfirm: b.confirm });
      if (b.remind) updateSettings({ billsRemindDays: b.remind === "off" ? "off" : [...new Set(b.remind)].sort((x, y) => y - x) });
    }
    this.pushState();
    return this.settings();
  }

  async chooseImagesFolder(): Promise<A.Settings> {
    const res = await dialog.showOpenDialog({ title: "Save pictures in", properties: ["openDirectory", "createDirectory"] });
    if (res.filePaths[0]) updateSettings({ imagesDir: res.filePaths[0] });
    return this.settings();
  }

  // ---------------------------------------------------------------- care

  async doctor(): Promise<A.Check[]> {
    return (await runDoctor(this.session)).map((c) => ({ name: c.name, status: c.status, detail: clean(c.detail).replace(/ — \/[a-z]+.*$/, "") }));
  }

  async data(): Promise<A.DataView> {
    const dir = appDataDir();
    const parts = [
      { name: "Memory, reminders and bills", what: "One database", path: join(dir, "memory.db") },
      { name: "Conversations", what: "Kept by Codex", path: config.codexHome },
      { name: "Pictures", what: "Ones Edward made", path: imagesDir() },
      { name: "Backups", what: "Copies made before upgrades and when you asked", path: join(dir, "backups") },
      { name: "Exports", what: "Files you exported", path: join(dir, "exports") },
    ];
    const sizes = parts.map((p) => sizeOf(p.path));
    return {
      dir,
      version: readDataVersion() ?? DATA_VERSION,
      parts: parts.map((p, i) => ({ name: p.name, what: p.what, size: bytes(sizes[i]!) })),
      total: bytes(sizes.reduce((a, b) => a + b, 0)),
      backups: listBackups().slice(0, 5).map((b) => ({ name: b.name.replace(/^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d).*?-(\w[\w-]*)$/, "$1 $2:$3 · $4"), at: b.at.toLocaleString("en-AU") })),
    };
  }

  async backup(): Promise<A.Result> {
    try {
      return ok(`Backed up to ${basename(backupData("manual"))}`);
    } catch (e) {
      return fail(e);
    }
  }

  async exportAll(): Promise<A.Result> {
    try {
      const r = exportAll(join(appDataDir(), "exports", `edward-export-${new Date().toLocaleDateString("sv")}`));
      shell.openPath(r.dir);
      return ok(`Exported ${r.files.length} files`);
    } catch (e) {
      return fail(e);
    }
  }

  async openDataFolder() {
    await shell.openPath(appDataDir());
  }

  /** Deletes everything Edward stored, then quits. The window asked the user twice before calling this. */
  async deleteEverything(): Promise<A.Result> {
    const accounts = this.session.accounts;
    this.close();
    const report = await wipeData({
      disconnectGoogle: async () => {
        for (const a of accounts.list()) await accounts.disconnect(a.id);
      },
      removeTask: () => removeTask(),
    });
    setTimeout(() => app.quit(), 1500);
    return report.problems.length ? { ok: false, message: report.problems.join("; ") } : ok("Deleted. Edward will close now.");
  }

  // ---------------------------------------------------------------- Google

  async google(): Promise<A.GoogleInfo> {
    const acc = this.session?.accounts;
    const list: A.AccountInfo[] = (acc?.connected() ?? []).map((a) => {
      const g = acc!.state(a)!;
      return {
        id: a.id,
        email: a.email ?? g.email,
        name: a.name,
        label: acc!.label(a),
        color: a.color,
        mail: a.mail,
        calendar: a.calendar,
        mailWorks: acc!.usable(a, "mail"),
        calendarWorks: acc!.usable(a, "calendar"),
        expired: Boolean(g.invalidAt),
        missing: missingFeatures(g),
        permissions: g.scopes.map(shortScope).filter((s) => s !== "openid" && s !== "email" && s !== "userinfo.email"),
        connectedAt: new Date(g.connectedAt).toLocaleDateString("en-AU", { day: "numeric", month: "long" }),
        checkedAt: g.checkedAt ? new Date(g.checkedAt).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : undefined,
        sendsMail: acc!.primary("mail")?.id === a.id,
        getsEvents: acc!.primary("calendar")?.id === a.id,
      };
    });
    const first = list[0];
    return {
      connected: list.length > 0,
      email: list.map((a) => a.email).filter(Boolean).join(", ") || undefined,
      permissions: [...new Set(list.flatMap((a) => a.permissions))],
      expired: list.some((a) => a.expired),
      missing: [...new Set(list.flatMap((a) => a.missing))],
      connectedAt: first?.connectedAt,
      checkedAt: first?.checkedAt,
      clientFile: hasClient(),
      accounts: list,
    };
  }

  async chooseGoogleClient(): Promise<A.Result> {
    const res = await dialog.showOpenDialog({ title: "Choose the file you downloaded from Google Cloud", properties: ["openFile"], filters: [{ name: "Google client file", extensions: ["json"] }] });
    const path = res.filePaths[0];
    if (!path) return { ok: false, message: "" };
    try {
      loadClient(path);
      mkdirSync(appDataDir(), { recursive: true });
      copyFileSync(path, clientPath());
      return ok("Looks right");
    } catch (e) {
      return fail(e);
    }
  }

  async connectGoogle(account?: string): Promise<A.Result> {
    try {
      const r = await this.session.accounts.connect([...CALENDAR_SCOPES, ...GMAIL_SCOPES], (url) => void shell.openExternal(url), { account });
      await this.session.reloadThread().catch(() => {}); // the conversation learns about the account
      this.pushState();
      return ok(`${r.added && this.session.accounts.list().length > 1 ? "Added" : "Connected as"} ${r.state.email ?? "your Google account"}`);
    } catch (e) {
      if (e instanceof GoogleAuthError && e.code === "cancelled") return { ok: false, message: "Cancelled" };
      return fail(e);
    }
  }

  async checkGoogle(account?: string): Promise<A.Result> {
    const acc = this.session.accounts;
    const list = account ? acc.list().filter((a) => a.id === account) : acc.connected();
    if (!list.length) return { ok: false, message: "Not connected" };
    try {
      const bad: string[] = [];
      for (const a of list) if ((await acc.auth(a).check()) !== "ok") bad.push(acc.label(a));
      this.pushState();
      return bad.length ? { ok: false, message: `The connection expired: ${bad.join(", ")}. Sign in again.` } : ok(list.length > 1 ? "All working" : "Working");
    } catch (e) {
      return fail(e);
    }
  }

  async disconnectGoogle(account?: string): Promise<A.Result> {
    const acc = this.session.accounts;
    const id = account ?? (acc.list().length === 1 ? acc.list()[0]!.id : undefined);
    if (!id) return { ok: false, message: "Choose which account to remove." };
    try {
      const { revoked } = await acc.disconnect(id);
      await this.session.reloadThread().catch(() => {});
      this.pushState();
      return ok(revoked ? "Removed" : "Removed from this computer; check myaccount.google.com/connections to be sure");
    } catch (e) {
      return fail(e);
    }
  }

  async updateAccount(account: string, patch: { name?: string; color?: string; mail?: boolean; calendar?: boolean }): Promise<A.Result> {
    try {
      const clean = {
        name: typeof patch.name === "string" ? stripControl(patch.name) : undefined,
        color: typeof patch.color === "string" ? patch.color : undefined,
        mail: typeof patch.mail === "boolean" ? patch.mail : undefined,
        calendar: typeof patch.calendar === "boolean" ? patch.calendar : undefined,
      };
      this.session.accounts.update(account, clean);
      await this.session.reloadThread().catch(() => {});
      this.pushState();
      return ok("Saved");
    } catch (e) {
      return fail(e);
    }
  }

  async setDefaultAccount(feature: "mail" | "calendar", account: string): Promise<A.Result> {
    if (feature !== "mail" && feature !== "calendar") return { ok: false, message: "Unknown feature" };
    try {
      this.session.accounts.setDefault(feature, account);
      await this.session.reloadThread().catch(() => {});
      this.pushState();
      return ok(feature === "mail" ? "New emails will go from this account" : "New events will go into this account");
    } catch (e) {
      return fail(e);
    }
  }

  async openGuide() {
    await shell.openExternal(GUIDE_URL);
  }
}

// ---------------------------------------------------------------- conversions

/** The mail page's Inbox: everything in the inbox from the last 30 days, read or not. */
const INBOX_QUERY = "in:inbox newer_than:30d";
const PAGE_SIZE = 25;

function attachment(path: string): A.Attachment {
  allowImage(path);
  return { path, name: basename(path), url: imageUrl(path) };
}

function eventInfo(e: CalendarEvent): A.EventInfo {
  return {
    id: e.id,
    title: clean(e.title) || "(no title)",
    start: e.allDay ? "All day" : hhmm(e.start),
    end: e.allDay ? "" : hhmm(e.end),
    allDay: e.allDay,
    location: e.location ? clean(e.location) : undefined,
    calendar: clean(e.calendarName),
    guests: e.guests,
    declined: e.declined,
    date: localDate(e.start),
    startAt: e.allDay ? localDate(e.start) : toLocal(e.start),
    endAt: e.allDay ? nextDate(localDate(e.end), -1) : toLocal(e.end),
    notes: e.description ? clean(e.description) : undefined,
    recurring: e.recurring,
    editable: e.writable && e.guests === 0,
  };
}

/** Ids the window gets for calendars and events: account, calendar and event in one opaque string. */
const packId = (...parts: string[]) => Buffer.from(JSON.stringify(parts)).toString("base64url");
function unpackId(id: string): string[] {
  try {
    const parts = JSON.parse(Buffer.from(String(id), "base64url").toString("utf8"));
    return Array.isArray(parts) && parts.every((p) => typeof p === "string") ? parts : [];
  } catch {
    return [];
  }
}

function billInfo(b: Bill): A.BillInfo {
  const daysLeft = b.dueDate ? daysUntil(b.dueDate) : null;
  return {
    id: b.id,
    payee: clean(b.payee),
    category: capitalise(b.category),
    amount: b.amountCents === null ? "amount not found" : formatAmount(b),
    amountCents: b.amountCents,
    dueDate: b.dueDate,
    due: b.dueDate ? dueText(b, daysLeft!) : "No due date in the email",
    status: b.status,
    autopay: b.kind === "autopay",
    flags: b.flags.map((f) => capitalise(clean(f))),
    needsCheck: b.needsCheck,
    title: clean(b.title),
    senderDomain: b.senderDomain,
    messageId: b.messageId,
    paidAt: b.paidAt,
    daysLeft,
  };
}

function dueText(b: Bill, days: number): string {
  const verb = b.kind === "autopay" ? "Charged" : "Due";
  const date = dayStart(b.dueDate!).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  const rel = days === 0 ? "today" : days === 1 ? "tomorrow" : days > 1 ? `in ${days} days` : `${-days} day${days === -1 ? "" : "s"} overdue`;
  return `${verb} ${date}, ${rel}`;
}

function reminderInfo(r: Reminder): A.ReminderInfo {
  const at = r.snoozedUntil ?? r.dueAt;
  return { id: r.id, text: clean(r.text), due: niceDue(at), dueAt: at, repeat: r.repeat ? capitalise(describeRepeat(r.repeat)) : null, status: r.status };
}

function memoryInfo(m: Memory): A.MemoryInfo {
  return { id: m.id, text: clean(m.text), kind: capitalise(m.kind), tier: m.tier, source: m.source === "extracted" ? "learned" : "you said so", status: m.status, createdAt: new Date(m.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) };
}

/** A past conversation as entries (resumed from Codex's history). Edward's own notes are left out. */
function historyEntries(item: ThreadItem): A.ChatEntry[] {
  const id = randomUUID();
  switch (item.type) {
    case "userMessage": {
      const text = item.content.filter((c) => c.type === "text" && !/^\[(Edward|Jarvis)\]/.test(c.text)).map((c) => (c.type === "text" ? c.text : "")).join("\n");
      const images = item.content.filter((c) => c.type === "localImage").map((c) => (c.type === "localImage" ? attachment(c.path) : null)).filter((x): x is A.Attachment => Boolean(x));
      return text || images.length ? [{ kind: "user", id, text: clean(text), images }] : [];
    }
    case "agentMessage":
      return item.text ? [{ kind: "assistant", id, text: clean(item.text), streaming: false }] : [];
    case "imageGeneration":
      return [{ kind: "activity", id, icon: "image", text: "Made a picture" }];
    default: {
      const lines = activityNotes(item).map(plain);
      return lines.length ? [{ kind: "activity", id, icon: activityIcon(item), text: lines[0]!, detail: lines.length > 1 ? lines.slice(1) : undefined }] : [];
    }
  }
}

function activityIcon(item: ThreadItem): string {
  if (item.type === "webSearch") return "search";
  if (item.type === "commandExecution") return "terminal";
  if (item.type === "fileChange") return "file";
  if (item.type === "dynamicToolCall") {
    const t = item.tool;
    if (t.startsWith("gmail")) return t === "gmail_draft" || t === "gmail_send" ? "pencil" : "mail";
    if (t.startsWith("calendar")) return "calendar";
    if (t.startsWith("bill")) return "bill";
    if (t.startsWith("reminder")) return "bell";
    if (t.startsWith("memory")) return "book";
  }
  return "spark";
}

/** Activity lines without the terminal's leading symbols and ANSI colour. */
const plain = (s: string) => stripControl(s).replace(/^[^\p{L}\p{N}"$]+/u, "").trim();

const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const joinWords = (parts: string[]) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const byDue = (a: Bill, b: Bill) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");

function total(list: Bill[]): string {
  const cents = list.reduce((n, b) => n + (b.amountCents ?? 0), 0);
  return formatAmount({ amountCents: cents, currency: region().currency });
}

function niceDay(d: string, first: string): string {
  const date = dayStart(d).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
  return d === first ? `Today · ${date}` : d === nextDate(first) ? `Tomorrow · ${date}` : date;
}

function niceDue(at: string): string {
  const today = localDate(new Date());
  const day = at.slice(0, 10);
  const time = at.slice(11, 16);
  if (day === today) return time;
  if (day === nextDate(today)) return `Tomorrow ${time}`;
  const d = dayStart(day);
  const within = (d.getTime() - dayStart(today).getTime()) / 86_400_000 < 7;
  return `${d.toLocaleDateString("en-AU", within ? { weekday: "short" } : { day: "numeric", month: "short" })} ${time}`;
}

function shortWhen(d: Date): string {
  const today = localDate(new Date());
  if (localDate(d) === today) return hhmm(d);
  if (localDate(d) === nextDate(today, -1)) return "Yesterday";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function bytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(n ? 1 : 0, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function googleProblem(e: unknown): string {
  if (e instanceof GoogleAuthError) return "The Google connection stopped working. Reconnect it in Settings.";
  return `Couldn't reach Google: ${clean(e instanceof Error ? e.message : String(e))}`;
}

