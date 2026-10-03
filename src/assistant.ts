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
import { hasGmailAccess } from "./google/gmail.js";
import { scanDue } from "./bills/scan.js";
import { runScan, scanSummary } from "./bills/view.js";
import { claimDueNotices, type DueNotice } from "./bills/remind.js";
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
 * scan. Results arrive as lines through `notify`.
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
    const g = session.google.state();
    if (g && !g.invalidAt && hasGmailAccess(g.scopes) && scanDue(session.bills)) notify(scanSummary(await runScan(session)));
  })().catch(onError);
  return learner;
}

export interface DueNow {
  reminders: Fired[];
  bills: DueNotice[];
  /** The daily brief, the first time Edward is open after its time on a brief day. */
  brief: Promise<Brief> | null;
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
    brief = briefGoogle(session.google, now).then((google) => composeBrief(session.memory, session.reminders, now, google, session.bills));
  }
  return { reminders, bills, brief };
}
