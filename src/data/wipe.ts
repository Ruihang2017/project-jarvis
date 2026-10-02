/**
 * "Delete everything" (P1). Runs outside the REPL (`jarvis delete-data`): Windows can't delete a
 * database that is open. Only ever deletes inside Jarvis's own data directory.
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { config } from "../config.js";
import { appDataDir } from "../settings.js";

/** Files and folders in the data directory that hold the user's data. */
const DATA_ENTRIES = ["memory.db", "memory.db-wal", "memory.db-shm", "settings.json", "google.json", "google-token.bin", "images", "images.jsonl", "logs", "backups", "exports", "tick-heartbeat.txt", "tick.vbs"];
/** Kept unless `all`: the ChatGPT sign-in, the user's own Google Cloud client file, and files they made in assist mode. */
const KEPT = ["codex-home/auth.json", "codex-home/config.toml", "google-client.json", "workspace"];
const CODEX_KEEP = new Set(["auth.json", "config.toml", "installation_id"]);

const inside = (parent: string, child: string) => {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/** A sanity check before removing a whole directory: it must look like Jarvis's data directory. */
export function looksLikeDataDir(dir: string): boolean {
  if (!existsSync(dir)) return false;
  // Never a drive root, a top-level folder or the home directory, whatever an environment variable says.
  const full = resolve(dir);
  if (full.split(/[\\/]/).filter(Boolean).length < 3 || full === resolve(homedir())) return false;
  const marker = ["memory.db", "settings.json", "codex-home", "google.json", "tick.vbs"].some((f) => existsSync(join(dir, f)));
  return marker && (/^jarvis$/i.test(basename(resolve(dir))) || Boolean(process.env.JARVIS_DATA_DIR));
}

export interface WipeOptions {
  /** Also remove the ChatGPT sign-in, google-client.json and the workspace: the whole directory. */
  all?: boolean;
  /** Revokes Jarvis's Google access (best effort); called before the token is deleted. */
  disconnectGoogle?: () => Promise<unknown>;
  /** Removes the background scheduled task. */
  removeTask?: () => Promise<unknown>;
}

export interface WipeReport {
  deleted: string[];
  kept: string[];
  problems: string[];
}

export async function wipeData(o: WipeOptions = {}): Promise<WipeReport> {
  const dir = appDataDir();
  const report: WipeReport = { deleted: [], kept: [], problems: [] };
  const attempt = async (what: string, f: () => Promise<unknown> | unknown) => {
    try {
      await f();
    } catch (e) {
      report.problems.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  if (o.disconnectGoogle) await attempt("revoking Google access", o.disconnectGoogle);
  if (o.removeTask) await attempt("removing the background task", o.removeTask);

  const remove = (path: string, label: string) => {
    if (!existsSync(path)) return;
    try {
      rmSync(path, { recursive: true, force: true });
      report.deleted.push(label);
    } catch (e) {
      report.problems.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (o.all) {
    if (!looksLikeDataDir(dir)) {
      report.problems.push(`${dir} doesn't look like Jarvis's data directory; nothing was deleted`);
      return report;
    }
    remove(dir, dir);
    return report;
  }

  for (const name of DATA_ENTRIES) remove(join(dir, name), name);
  // Conversations live in Codex's home. Touch it only when it is Jarvis's own, inside the data
  // directory — never a CODEX_HOME that an environment variable points somewhere else.
  const home = config.codexHome;
  if (inside(dir, home) && existsSync(home)) {
    for (const e of readdirSync(home)) if (!CODEX_KEEP.has(e)) remove(join(home, e), `codex-home/${e}`);
  } else if (existsSync(home)) {
    report.kept.push(`${home} (conversations: outside the Jarvis data directory, not touched)`);
  }
  for (const k of KEPT) if (existsSync(join(dir, k))) report.kept.push(k);
  return report;
}
