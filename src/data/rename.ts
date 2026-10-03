/**
 * Moves the data from %LOCALAPPDATA%\Jarvis to %LOCALAPPDATA%\Edward after the rename (D33).
 * Runs once, on the first interactive start, before anything opens the data. The background tick
 * never runs it: until the move, every part of Edward keeps using the old folder (settings.appDataDir).
 *
 * The folder is renamed in place (same disk: instant, nothing copied). A directory junction is left
 * at the old path because Codex stores absolute paths to its conversation files; through the
 * junction those paths keep working, so earlier conversations still open.
 */
import { existsSync, lstatSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportTask, importTask, installTask, LEGACY_TASK_NAME, removeTask } from "../background/task.js";
import { LEGACY_AUMID, unregisterNotifications } from "../background/notify.js";
import { defaultDataDir, envVar, legacyDataDir } from "../settings.js";
import { backupData } from "./backup.js";

export type RenameResult =
  | { status: "not-needed" }
  | { status: "moved"; from: string; to: string; backup: string; taskMoved: boolean; junction: boolean }
  | { status: "failed"; from: string; message: string };

/** What the move does outside the folder itself; replaceable in tests. */
export interface RenameSystem {
  exportLegacyTask(): Promise<string | null>;
  removeLegacyTask(): Promise<unknown>;
  restoreLegacyTask(xml: string): Promise<unknown>;
  unregisterLegacyNotifications(): Promise<unknown>;
  installTask(): Promise<{ ok: boolean; message: string }>;
}

export const windowsSystem: RenameSystem = {
  exportLegacyTask: () => exportTask(LEGACY_TASK_NAME),
  removeLegacyTask: () => removeTask(LEGACY_TASK_NAME),
  restoreLegacyTask: (xml) => importTask(LEGACY_TASK_NAME, xml),
  unregisterLegacyNotifications: () => unregisterNotifications(LEGACY_AUMID),
  installTask,
};

const isJunction = (p: string) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/** Whether there is old data waiting to be moved. */
export function renamePending(): boolean {
  const from = legacyDataDir();
  return !envVar("DATA_DIR") && !!from && existsSync(from) && !isJunction(from) && !existsSync(defaultDataDir());
}

export async function moveFromJarvis(system: RenameSystem = windowsSystem): Promise<RenameResult> {
  if (!renamePending()) return { status: "not-needed" };
  const from = legacyDataDir()!;
  const to = defaultDataDir();

  // While Edward doesn't exist yet, appDataDir() is the old folder, so the backup lands inside it and moves along.
  let backup: string;
  try {
    backup = backupData("before-rename");
  } catch (e) {
    return { status: "failed", from, message: `couldn't back up first: ${e instanceof Error ? e.message : String(e)}` };
  }

  // The old task would open the database every minute; take it down for the move.
  const taskXml = await system.exportLegacyTask();
  if (taskXml) await system.removeLegacyTask();

  try {
    renameSync(from, to);
  } catch (e) {
    if (taskXml) await system.restoreLegacyTask(taskXml);
    const code = (e as NodeJS.ErrnoException).code;
    const busy = code === "EBUSY" || code === "EPERM" || code === "EACCES";
    return {
      status: "failed",
      from,
      message: busy
        ? "a file in it is in use. Close the old Jarvis (and anything open in that folder), then start Edward again"
        : `couldn't rename the folder: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  let junction = true;
  try {
    symlinkSync(to, from, "junction");
  } catch {
    junction = false; // conversations from before the move may not open; everything else works
  }
  await system.unregisterLegacyNotifications();
  let taskMoved = false;
  if (taskXml) taskMoved = (await system.installTask()).ok;
  try {
    writeFileSync(join(to, "renamed-from-jarvis.txt"), `Moved from ${from} on ${new Date().toISOString()}.\r\n${junction ? `${from} now points here.\r\n` : ""}`);
  } catch {
    // a note for the curious, nothing depends on it
  }
  return { status: "moved", from, to, backup: join(to, backup.slice(from.length)), taskMoved, junction };
}

/** One or two lines for the terminal or the app. */
export function renameMessage(r: RenameResult): string[] {
  if (r.status === "not-needed") return [];
  if (r.status === "failed") return [`Your data is still in ${r.from}: ${r.message}.`];
  return [
    `Moved your data from ${r.from} to ${r.to} (backup first: ${r.backup}).`,
    ...(r.taskMoved ? ["Background reminders now run as Edward."] : []),
    ...(r.junction ? [] : ["Couldn't leave a link at the old folder, so conversations from before the move may not reopen."]),
  ];
}
