import { refuseSensitive } from "../privacy/guard.js";
import { stripControl } from "../util.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { memoryDbPath } from "../memory/store.js";
import { decodeRepeat, encodeRepeat, fromLocal, nextOccurrence, toLocal, type Repeat } from "./schedule.js";

export type ReminderStatus = "scheduled" | "fired" | "done" | "cancelled";

export interface Reminder {
  id: number;
  text: string;
  /** Next occurrence, local "YYYY-MM-DDTHH:MM". */
  dueAt: string;
  repeat: Repeat;
  status: ReminderStatus;
  snoozedUntil: string | null;
  memoryId: number | null;
  threadId: string | null;
  createdAt: string;
  firedAt: string | null;
  fireCount: number;
}

/** A reminder that just went off, with the occurrence that fired (before rescheduling). */
export interface Fired {
  reminder: Reminder;
  occurrence: string;
}

/**
 * Reminders live in memory.db next to memories, on their own connection: the REPL and the
 * background `jarvis tick` may both open it, so every write is a compare-and-set.
 */
export class ReminderStore {
  private db: DatabaseSync;

  constructor(path = memoryDbPath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY,
        text TEXT NOT NULL,
        due_at TEXT NOT NULL,
        repeat TEXT,
        status TEXT NOT NULL DEFAULT 'scheduled',
        snoozed_until TEXT,
        memory_id INTEGER,
        thread_id TEXT,
        created_at TEXT NOT NULL,
        fired_at TEXT,
        fire_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS reminders_due ON reminders(status, due_at);
    `);
  }

  add(r: { text: string; dueAt: string; repeat?: Repeat; memoryId?: number | null; threadId?: string | null }): Reminder {
    fromLocal(r.dueAt); // validates
    r = { ...r, text: stripControl(r.text) };
    refuseSensitive(r.text);
    const res = this.db
      .prepare("INSERT INTO reminders (text, due_at, repeat, memory_id, thread_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(r.text.trim(), r.dueAt, encodeRepeat(r.repeat ?? null), r.memoryId ?? null, r.threadId ?? null, new Date().toISOString());
    return this.get(Number(res.lastInsertRowid))!;
  }

  get(id: number): Reminder | undefined {
    const row = this.db.prepare("SELECT * FROM reminders WHERE id = ?").get(id);
    return row ? toReminder(row) : undefined;
  }

  /** Scheduled reminders, soonest first (by snooze time when snoozed). */
  upcoming(limit = 50): Reminder[] {
    return this.db
      .prepare("SELECT * FROM reminders WHERE status = 'scheduled' ORDER BY COALESCE(snoozed_until, due_at) LIMIT ?")
      .all(limit)
      .map(toReminder);
  }

  /** One-off reminders that went off within the last `hours`. */
  recentlyFired(hours = 24): Reminder[] {
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();
    return this.db
      .prepare("SELECT * FROM reminders WHERE status = 'fired' AND fired_at >= ? ORDER BY fired_at DESC")
      .all(since)
      .map(toReminder);
  }

  /**
   * Claims every reminder due at or before `now` and advances it: one-offs become "fired",
   * repeating ones move to their next future occurrence. Safe to call from several processes;
   * each occurrence is returned to exactly one caller.
   */
  claimDue(now = new Date()): Fired[] {
    const nowLocal = toLocal(now);
    const due = this.db
      .prepare("SELECT * FROM reminders WHERE status = 'scheduled' AND COALESCE(snoozed_until, due_at) <= ?")
      .all(nowLocal)
      .map(toReminder);
    const fired: Fired[] = [];
    const stamp = now.toISOString();
    for (const r of due) {
      const occurrence = r.snoozedUntil ?? r.dueAt;
      // Repeating: keep the regular slot if it's still ahead (a snooze fired), else skip to the next
      // future one (also skips occurrences missed while the machine was off). One-off: done.
      const nextDue = r.repeat ? (r.dueAt > nowLocal ? r.dueAt : nextOccurrence(r.dueAt, r.repeat, nowLocal)) : null;
      const res = this.db
        .prepare(
          `UPDATE reminders SET status = ?, due_at = ?, snoozed_until = NULL, fired_at = ?, fire_count = fire_count + 1
           WHERE id = ? AND status = 'scheduled' AND due_at = ? AND COALESCE(snoozed_until, '') = ?`,
        )
        .run(nextDue ? "scheduled" : "fired", nextDue ?? r.dueAt, stamp, r.id, r.dueAt, r.snoozedUntil ?? "");
      if (Number(res.changes) === 1) fired.push({ reminder: this.get(r.id)!, occurrence });
    }
    return fired;
  }

  /** Fires again after `minutes` (also revives a one-off that already fired). */
  snooze(id: number, minutes: number, now = new Date()): Reminder | undefined {
    const until = toLocal(new Date(now.getTime() + minutes * 60_000));
    this.db
      .prepare("UPDATE reminders SET status = 'scheduled', snoozed_until = ? WHERE id = ? AND status IN ('scheduled', 'fired')")
      .run(until, id);
    return this.get(id);
  }

  setStatus(id: number, status: ReminderStatus): Reminder | undefined {
    this.db.prepare("UPDATE reminders SET status = ? WHERE id = ?").run(status, id);
    return this.get(id);
  }

  close() {
    this.db.close();
  }
}

function toReminder(r: any): Reminder {
  return {
    id: r.id,
    text: r.text,
    dueAt: r.due_at,
    repeat: decodeRepeat(r.repeat),
    status: r.status,
    snoozedUntil: r.snoozed_until,
    memoryId: r.memory_id,
    threadId: r.thread_id,
    createdAt: r.created_at,
    firedAt: r.fired_at,
    fireCount: r.fire_count,
  };
}
