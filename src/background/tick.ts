/**
 * `jarvis tick`: run every minute by the scheduled task. Fires due reminders as notifications and
 * exits. Deliberately light: no Codex, no model calls, no network.
 */
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { lateness } from "../reminders/schedule.js";
import { ReminderStore, type Fired } from "../reminders/store.js";
import { describeRepeat, formatDue } from "../reminders/schedule.js";
import { appDataDir } from "../settings.js";
import { showToast } from "./notify.js";
import { heartbeatPath } from "./task.js";
import { briefDue, composeBrief, markBriefShown } from "./brief.js";
import { MemoryStore } from "../memory/store.js";

const logPath = () => join(appDataDir(), "logs", "tick.log");

export async function runTick(now = new Date()): Promise<Fired[]> {
  mkdirSync(appDataDir(), { recursive: true });
  writeFileSync(heartbeatPath(), now.toISOString());
  const store = new ReminderStore();
  let fired: Fired[] = [];
  try {
    fired = store.claimDue(now);
    for (const f of fired) await showToast(reminderToast(f, now));
  } catch (e) {
    log(`reminders failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  }
  try {
    await maybeBrief(store, now);
  } catch (e) {
    log(`brief failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  } finally {
    store.close();
  }
  return fired;
}

/** Morning brief as a notification, once per brief day; skipped when there's nothing to say. */
async function maybeBrief(reminders: ReminderStore, now: Date) {
  const memory = new MemoryStore();
  try {
    if (!briefDue(memory, "toast", now)) return;
    markBriefShown(memory, "toast"); // mark first: a slow toast must not repeat next minute
    const brief = composeBrief(memory, reminders, now);
    if (brief.count) await showToast({ title: brief.title, body: brief.lines.join("\n"), tag: "brief", kind: "info" });
  } finally {
    memory.close();
  }
}

/** Notification for a fired reminder: "⏰ 交报销" / "09:00 · 2h 5m late · next Fri 10-02 09:00". */
export function reminderToast({ reminder: r, occurrence }: Fired, now = new Date()) {
  const late = lateness(occurrence, now);
  const next = r.status === "scheduled" && r.repeat ? `next ${formatDue(r.dueAt, now)} (${describeRepeat(r.repeat)})` : "";
  return {
    title: `⏰ ${r.text}`,
    body: [occurrence.slice(11), late, next].filter(Boolean).join(" · "),
    tag: `reminder-${r.id}`,
    kind: "reminder" as const,
  };
}

function log(line: string) {
  try {
    const path = logPath();
    mkdirSync(dirname(path), { recursive: true });
    // Keep it small: start over past 256 KB.
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      // new file
    }
    const entry = `${new Date().toISOString()} ${line}\n`;
    if (size > 256 * 1024) writeFileSync(path, entry);
    else appendFileSync(path, entry);
  } catch {
    // logging must never break a tick
  }
}
