/**
 * Backups (P1): a consistent copy of the database plus settings and Google connection state, in
 * <data dir>/backups/<time>-<reason>/. Generated images and conversations are left out (large).
 * The Google token is left out too: it only decrypts on this computer under this Windows account.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { memoryDbPath } from "../memory/store.js";
import { appDataDir } from "../settings.js";

export const KEEP_BACKUPS = 10;
const COPIED = ["settings.json", "google.json", "accounts.json"];

export const backupsDir = () => join(appDataDir(), "backups");

const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, "-").slice(0, 19);

/** Makes a backup and returns its folder. `reason` becomes part of the folder name ("manual", "before-v2"). */
export function backupData(reason = "manual", now = new Date()): string {
  const dir = join(backupsDir(), `${stamp(now)}-${reason.replace(/[^A-Za-z0-9-]+/g, "-")}`);
  mkdirSync(dir, { recursive: true });
  const dbPath = memoryDbPath();
  if (existsSync(dbPath)) {
    // VACUUM INTO writes a consistent snapshot even while the REPL or the background tick has the database open.
    const db = new DatabaseSync(dbPath);
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      db.exec(`VACUUM INTO '${join(dir, "memory.db").replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }
  }
  for (const name of COPIED) {
    const src = join(appDataDir(), name);
    if (existsSync(src)) copyFileSync(src, join(dir, name));
  }
  // Each account's connection state (A1); its token stays out, as above.
  const accounts = join(appDataDir(), "accounts");
  if (existsSync(accounts)) {
    for (const id of readdirSync(accounts)) {
      const state = join(accounts, id, "google.json");
      if (id.startsWith(".") || !existsSync(state)) continue;
      mkdirSync(join(dir, "accounts", id), { recursive: true });
      copyFileSync(state, join(dir, "accounts", id, "google.json"));
    }
  }
  prune();
  return dir;
}

/** Backup folders, newest first. */
export function listBackups(): { path: string; name: string; at: Date }[] {
  if (!existsSync(backupsDir())) return [];
  return readdirSync(backupsDir(), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ path: join(backupsDir(), e.name), name: e.name, at: statSync(join(backupsDir(), e.name)).mtime }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

function prune() {
  for (const old of listBackups().slice(KEEP_BACKUPS)) rmSync(old.path, { recursive: true, force: true });
}
