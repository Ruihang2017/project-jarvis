/**
 * Data version and upgrades (P1). memory.db carries `schema:version` in its meta table; an older
 * value means upgrade steps must run, and the data is backed up before the first one does.
 * Tables themselves are created by each store (CREATE TABLE IF NOT EXISTS); migrations are for
 * changes to existing tables.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { memoryDbPath } from "../memory/store.js";
import { backupData } from "./backup.js";

/** Bump when a migration is added. */
export const DATA_VERSION = 1;

export interface Migration {
  /** The version the data has after this step. */
  to: number;
  describe: string;
  run(db: DatabaseSync): void;
}

/** Ordered upgrade steps. Version 1 is the baseline, so there are none yet. */
export const MIGRATIONS: Migration[] = [];

export interface DataCheck {
  /** Version found; null for a new or pre-versioning database. */
  from: number | null;
  to: number;
  /** Where the pre-upgrade backup went, when steps ran. */
  backup?: string;
  applied: string[];
  /** The data was written by a newer Edward than this one: left untouched. */
  newer: boolean;
}

const KEY = "schema:version";

export function readDataVersion(path = memoryDbPath()): number | null {
  if (!existsSync(path)) return null;
  const db = new DatabaseSync(path);
  try {
    db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(KEY) as { value: string } | undefined;
    return row ? Number(row.value) : null;
  } finally {
    db.close();
  }
}

/**
 * Brings the data up to this build's version. Call once at startup, before the stores open.
 * `o` exists for tests (a scratch database, a pretend target version and steps).
 */
export function ensureDataVersion(o: { path?: string; version?: number; migrations?: Migration[]; backup?: (reason: string) => string } = {}): DataCheck {
  const path = o.path ?? memoryDbPath();
  const target = o.version ?? DATA_VERSION;
  const steps = (o.migrations ?? MIGRATIONS).slice().sort((a, b) => a.to - b.to);
  const fresh = !existsSync(path);
  const from = readDataVersion(path);
  mkdirSync(dirname(path), { recursive: true });

  if (from !== null && from > target) return { from, to: from, applied: [], newer: true };

  const todo = from === null ? [] : steps.filter((m) => m.to > from && m.to <= target);
  let backup: string | undefined;
  // Back up before changing existing data (never needed for a brand-new database).
  if (todo.length && !fresh) backup = (o.backup ?? ((reason) => backupData(reason)))(`before-v${target}`);

  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const applied: string[] = [];
    const set = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    for (const m of todo) {
      // One transaction per step: a failure leaves the data at the last completed version.
      db.exec("BEGIN");
      try {
        m.run(db);
        set.run(KEY, String(m.to));
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw new Error(`data upgrade to v${m.to} failed (${m.describe}): ${e instanceof Error ? e.message : String(e)}${backup ? ` — your data was backed up to ${backup}` : ""}`);
      }
      applied.push(`v${m.to}: ${m.describe}`);
    }
    set.run(KEY, String(target));
    return { from, to: target, backup, applied, newer: false };
  } finally {
    db.close();
  }
}
