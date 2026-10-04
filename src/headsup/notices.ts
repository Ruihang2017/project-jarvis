/**
 * Heads-up bookkeeping (H, D42/D43): which proactive notices were already shown, and when a check
 * last ran. Shared by the background tick, the REPL and the desktop app through memory.db, so a
 * notice shows once whichever of them gets there first. Keys are ids and times only, no text.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { memoryDbPath } from "../memory/store.js";

const KEEP_DAYS = 60;

export class NoticeStore {
  private db: DatabaseSync;

  constructor(path = memoryDbPath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.db.exec("CREATE TABLE IF NOT EXISTS notices (key TEXT PRIMARY KEY, at TEXT NOT NULL)");
  }

  /** True only for the first caller with this key (the tick, the REPL and the app may race). */
  claim(key: string, now = new Date()): boolean {
    const res = this.db.prepare("INSERT OR IGNORE INTO notices (key, at) VALUES (?, ?)").run(key, now.toISOString());
    return Number(res.changes) === 1;
  }

  has(key: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM notices WHERE key = ?").get(key));
  }

  /** True at most once every `minutes` for `name`, across processes: for checks that call Google. */
  every(name: string, minutes: number, now = new Date()): boolean {
    const cutoff = new Date(now.getTime() - minutes * 60_000 + 1000).toISOString();
    const res = this.db
      .prepare("INSERT INTO notices (key, at) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at WHERE notices.at < ?")
      .run(`every:${name}`, now.toISOString(), cutoff);
    return Number(res.changes) === 1;
  }

  /** Forgets notices older than two months (their events are long past). */
  prune(now = new Date()) {
    const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString();
    this.db.prepare("DELETE FROM notices WHERE at < ? AND key NOT LIKE 'every:%'").run(cutoff);
  }

  close() {
    this.db.close();
  }
}
