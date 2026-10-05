/**
 * What happens around a conversation, independent of how it is shown: the notes sent with each
 * message, saving generated pictures, background work after start-up, and what came due. The
 * terminal (ui.ts) and the desktop app both use this, so they behave the same.
 */
import { existsSync } from "node:fs";
import type { Session } from "./session.js";
import type { ThreadItem } from "./protocol/v2/index.js";
import { saveGeneratedImage, type ImageRecord } from "./images.js";
import { loadSettings, updateSettings } from "./settings.js";
import { briefDue, briefGoogle, composeBrief, markBriefShown, type Brief } from "./background/brief.js";
import { Turns } from "./background/turns.js";
import { scanDue } from "./bills/scan.js";
import { runScan, scanSummary } from "./bills/view.js";
import { claimDueNotices, type DueNotice } from "./bills/remind.js";
import { claimHeadsUps, type HeadsUp } from "./headsup/meetings.js";
import { mergeDigests, nextSince, summariseMail, summaryDue, type MailDigest } from "./headsup/mailsummary.js";
import { runtime } from "./runtime.js";
import { composeWeek, weeklyDue, type Week } from "./headsup/weekly.js";
import { claimTripNotices, scanTrips, tripLine, tripScanDue, type TripNotice, type TripScanResult } from "./headsup/trips.js";
import { codexVersion, compareCodex } from "./doctor.js";
import { openWithDefaultApp } from "./system.js";
import { MemoryLearner } from "./memory/learn.js";
import { recallFor } from "./memory/recall.js";
import { MemoryTidier } from "./memory/tidy.js";
import { nowNote } from "./reminders/prompt.js";
import type { Fired } from "./reminders/store.js";
import { tildify, truncate } from "./util.js";

/** Pictures and notes to send along with the user's text. Takes the pending attachments. */
export function turnInputs(session: Session, text: string): { images: string[]; notes: string[] } {
  const images = session.pendingImages.splice(0);
  const notes: string[] = [];
  // Carry the last generated image forward unless the user attached their own.
  if (session.lastGeneratedImage && !images.length && existsSync(session.lastGeneratedImage)) {
    images.push(session.lastGeneratedImage);
    notes.push("[Edward] The attached image is the one you generated in your previous reply. If I ask for changes, edit this image.");
  }
  session.lastGeneratedImage = null;
  notes.push(nowNote());
  const recalled = recallFor(text, session.memory, session.recalledIds);
  if (recalled) notes.push(recalled.note);
  return { images, notes };
}

/**
 * A thread's preview joins the user's text with the notes sent after it ("…bills?[Edward] Now: …");
 * keeps only the user's part, for titles. Older threads carry the old name.
 */
export function withoutNotes(preview: string): string {
  return preview.replace(/\[(?:Edward|Jarvis)\] [\s\S]*$/, "").trim();
}

export interface GeneratedImage {
  /** Lines to show, as the terminal prints them. */
  lines: string[];
  /** The saved picture, when it worked. */
  record?: ImageRecord;
  /** Why there is no picture. */
  problem?: string;
}

/** Saves a finished generation (and opens it if the setting says so). */
export function handleGeneratedImage(
  item: Extract<ThreadItem, { type: "imageGeneration" }>,
  session: Session,
  prompt: string,
  open = loadSettings().autoOpenImages !== false,
): GeneratedImage {
  if (item.failure) {
    const reset = item.failure.resetsAt ? `; resets in ${Math.max(1, Math.round((item.failure.resetsAt - Date.now() / 1000) / 60))}m` : "";
    const problem = `image generation unavailable: usage limit reached${reset}`;
    return { lines: [`🖼 ${problem}`], problem };
  }
  if (item.status !== "completed") return { lines: [`🖼 image generation ${item.status}`], problem: `image generation ${item.status}` };
  try {
    const record = saveGeneratedImage(item, { threadId: session.threadId ?? "", prompt });
    session.lastGeneratedImage = record.path;
    if (open) openWithDefaultApp(record.path);
    const size = record.width ? ` · ${record.width}×${record.height}` : "";
    const lines = [`🖼 ${tildify(record.path)}${size}`];
    if (record.revisedPrompt) lines.push(`   "${truncate(record.revisedPrompt, 110)}"`);
    return { lines, record };
  } catch (e) {
    const problem = `couldn't save image: ${e instanceof Error ? e.message : String(e)}`;
    return { lines: [`🖼 ${problem}`], problem };
  }
}

/** After the first reminder is set, suggest background reminders once. */
export function backgroundSuggestion(item: ThreadItem): string | null {
  if (item.type !== "dynamicToolCall" || item.tool !== "reminder_create" || item.success === false) return null;
  if (loadSettings().backgroundSuggested) return null;
  updateSettings({ backgroundSuggested: true });
  return "🔔 Reminders only pop up while Edward is open. Background reminders (/background on) make them work when it's closed too.";
}

/**
 * Work that runs while Edward is open: memory learning when a conversation is left and for any
 * missed at start-up, the daily memory tidy, a note if Codex changed version, and the daily bill
 * and booking (H2) scans. Results arrive as lines through `notify`.
 */
export function startBackgroundWork(session: Session, notify: (lines: string[]) => void, onError: (e: unknown) => void): MemoryLearner {
  const learner = new MemoryLearner(session);
  session.onLeaveThread = (id) => {
    learner.learnFromThread(id).then((r) => notify(r?.lines ?? []), onError);
  };
  void (async () => {
    notify((await learner.catchUp()).flatMap((r) => r.lines));
    const codex = compareCodex(await codexVersion());
    if (codex.status !== "ok") notify([`Codex ${codex.detail} · the health check looks at everything`]);
    if (learner.enabled()) notify(await new MemoryTidier(session).runIfDue());
    if (session.accounts.for("mail").length && scanDue(session.bills)) notify(scanSummary(await mailTurns.run(() => runScan(session))));
    if (session.accounts.for("mail").length && tripScanDue(session.notices)) notify(tripScanLines(await mailTurns.run(() => scanTripsNow(session))));
  })().catch(onError);
  return learner;
}

/**
 * The automatic bill scan, booking scan and mail summary take turns, a minute apart: each reads a
 * lot of mail, and Gmail counts requests per minute. What the user asks for runs at once.
 */
export const MAIL_GAP_MS = 60_000;
const mailTurns = new Turns(MAIL_GAP_MS);

/** Looks for new booking emails (H2); the model only reads those without booking data. */
export const scanTripsNow = (session: Session): Promise<TripScanResult> =>
  scanTrips({ accounts: session.accounts, store: session.trips, run: (i, input, schema) => session.runEphemeral(i, input, schema) });

export function tripScanLines(r: TripScanResult): string[] {
  return r.found.map((t) => `✈ Found in your email: ${tripLine(t)}`);
}

let summarising: Promise<MailDigest> | null = null;

/** Summarises the mail since the last summary (H4) and keeps it; one at a time. */
export function summariseNow(session: Session, now = new Date()): Promise<MailDigest> {
  summarising ??= summariseMail({ accounts: session.accounts, bills: session.bills, run: (i, input, schema) => session.runEphemeral(i, input, schema) }, nextSince(session.digests, now), now)
    .then((fresh) => {
      const d = mergeDigests(fresh, session.digests.latest());
      session.digests.save(d);
      return d;
    })
    .finally(() => (summarising = null));
  return summarising;
}

export interface DueNow {
  reminders: Fired[];
  bills: DueNotice[];
  /** The daily brief, the first time Edward is open after its time on a brief day. */
  brief: Promise<Brief> | null;
  /** Meeting heads-ups (H1); resolves to none when nothing is due or Google can't be reached. */
  meetings: Promise<HeadsUp[]>;
  /** The mail summary, at its times of day (H4); null when not due. */
  mailDigest: Promise<MailDigest | null> | null;
  /** The weekly review, on its day and time (H3). */
  week: Promise<Week> | null;
  /** The evening before a trip, and time to leave (H2). */
  trips: TripNotice[];
}

/**
 * What came due while Edward is open. Claiming is atomic, shared with the background task, so each
 * reminder or bill notice shows once: here or as a background notification.
 */
export function claimDueNow(session: Session, now = new Date()): DueNow {
  const reminders = session.reminders.claimDue(now);
  const bills = claimDueNotices(session.bills, now);
  let brief: Promise<Brief> | null = null;
  if (briefDue(session.memory, "repl", now)) {
    markBriefShown(session.memory, "repl");
    brief = briefGoogle(session.accounts, now).then((google) => composeBrief(session.memory, session.reminders, now, google, session.bills));
  }
  const meetings = claimHeadsUps(session.accounts, session.notices, session.memory, now).catch(() => []);
  // A model call: not in screenshot checks (no background work there). It may wait for its turn, so
  // it covers the mail up to when it runs.
  const mailDigest =
    !runtime.noBackgroundWork && session.accounts.for("mail").length && summaryDue(session.notices, now) ? mailTurns.run(() => summariseNow(session)).catch(() => null) : null;
  const week = weeklyDue(session.notices, now) ? composeWeek(session.accounts, session.reminders, session.bills, now) : null;
  const trips = claimTripNotices(session.trips, session.notices, now);
  return { reminders, bills, brief, meetings, mailDigest, week, trips };
}
