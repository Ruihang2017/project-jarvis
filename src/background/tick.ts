/**
 * `edward tick`: run every minute by the scheduled task. Fires due reminders as notifications and
 * exits. Deliberately light: no Codex, no model calls; the only network call is a Google token
 * refresh every few hours when Google is connected.
 */
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { lateness } from "../reminders/schedule.js";
import { ReminderStore, type Fired } from "../reminders/store.js";
import { describeRepeat, formatDue } from "../reminders/schedule.js";
import { appDataDir } from "../settings.js";
import { showToast } from "./notify.js";
import { heartbeatPath } from "./task.js";
import { briefDue, briefGoogle, composeBrief, markBriefShown } from "./brief.js";
import { MemoryStore } from "../memory/store.js";
import { Accounts } from "../accounts/accounts.js";
import { backgroundCheck } from "../google/health.js";
import { BillStore } from "../bills/store.js";
import { claimDueNotices, noticeToast } from "../bills/remind.js";
import { readDataVersion, DATA_VERSION } from "../data/version.js";

const logPath = () => join(appDataDir(), "logs", "tick.log");

export async function runTick(now = new Date()): Promise<Fired[]> {
  mkdirSync(appDataDir(), { recursive: true });
  writeFileSync(heartbeatPath(), now.toISOString());
  // Data written by a newer Edward, or not yet upgraded by this one: leave it alone until the REPL has dealt with it.
  const version = readDataVersion();
  if (version !== null && version !== DATA_VERSION) {
    log(`skipped: data is v${version}, this build expects v${DATA_VERSION}`);
    return [];
  }
  const store = new ReminderStore();
  let fired: Fired[] = [];
  try {
    fired = store.claimDue(now);
    for (const f of fired) await showToast(reminderToast(f, now));
  } catch (e) {
    log(`reminders failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  }
  const bills = new BillStore();
  try {
    for (const n of claimDueNotices(bills, now)) await showToast(noticeToast(n));
  } catch (e) {
    log(`bills failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    await maybeBrief(store, bills, now);
  } catch (e) {
    log(`brief failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  } finally {
    store.close();
    bills.close();
  }
  const accounts = new Accounts();
  const many = accounts.connected().length > 1;
  for (const a of accounts.connected()) {
    try {
      await backgroundCheck(accounts.auth(a), showToast, now, many ? { id: a.id, label: accounts.label(a) } : undefined);
    } catch (e) {
      log(`google check failed (${a.id}): ${e instanceof Error ? e.message : String(e)}`); // message only: never token data
    }
  }
  return fired;
}

/** Morning brief as a notification, once per brief day; skipped when there's nothing to say. */
async function maybeBrief(reminders: ReminderStore, bills: BillStore, now: Date) {
  const memory = new MemoryStore();
  try {
    if (!briefDue(memory, "toast", now)) return;
    markBriefShown(memory, "toast"); // mark first: a slow toast must not repeat next minute
    const brief = composeBrief(memory, reminders, now, await briefGoogle(new Accounts(), now), bills);
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
