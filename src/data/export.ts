/**
 * "Export everything" (P1): what Edward has stored about the user, as files they can read. Nothing
 * here holds account, card or ID numbers — the stores never accept them (S1).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";
import { MemoryStore, memoryDbPath } from "../memory/store.js";
import { appDataDir, imagesDir } from "../settings.js";

const TABLES = ["memories", "summaries", "reminders", "bills", "payees", "mail_digests", "trips", "voice_spend"];

export interface ExportResult {
  dir: string;
  files: string[];
}

export function exportAll(dir: string, now = new Date()): ExportResult {
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const write = (name: string, content: string) => {
    writeFileSync(join(dir, name), content);
    files.push(name);
  };

  const dbPath = memoryDbPath();
  if (existsSync(dbPath)) {
    const memory = new MemoryStore(dbPath);
    try {
      write("memories.md", memory.exportMarkdown());
    } finally {
      memory.close();
    }
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const existing = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
      for (const t of TABLES) if (existing.has(t)) write(`${t}.json`, JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all(), null, 2) + "\n");
    } finally {
      db.close();
    }
  }
  const settings = join(appDataDir(), "settings.json");
  if (existsSync(settings)) write("settings.json", readFileSync(settings, "utf8"));

  write(
    "README.txt",
    [
      `Edward export — ${now.toISOString().slice(0, 10)}`,
      "",
      "memories.md / memories.json   what Edward remembers about you",
      "summaries.json                summaries of past conversations",
      "reminders.json                reminders, including finished ones",
      "bills.json, payees.json       bills found in your email and the payees you confirmed",
      "mail_digests.json             the last few mail summaries",
      "trips.json                    trips found in booking emails",
      "settings.json                 your settings",
      "",
      "Not copied here (they stay where they are):",
      `  conversations      ${join(config.codexHome, "sessions")}`,
      `  generated images   ${imagesDir()}`,
      "",
      "Account, card and ID numbers and passwords are never stored by Edward, so none are in these files.",
      "",
    ].join("\n"),
  );
  return { dir, files };
}

/** Size in bytes of a file or folder (0 if missing). */
export function sizeOf(path: string): number {
  if (!existsSync(path)) return 0;
  const s = statSync(path);
  if (!s.isDirectory()) return s.size;
  let total = 0;
  for (const e of readdirSync(path, { withFileTypes: true })) total += sizeOf(join(path, e.name));
  return total;
}
