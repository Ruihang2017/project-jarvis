import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** EDWARD_<name>, or the JARVIS_<name> it was called before the rename (still honoured). */
export function envVar(name: string): string | undefined {
  return process.env[`EDWARD_${name}`] || process.env[`JARVIS_${name}`] || undefined;
}

/** Where the data lived before the rename; moved to {@link defaultDataDir} on the first interactive start. */
export function legacyDataDir(): string | undefined {
  if (process.platform !== "win32") return undefined;
  return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Jarvis");
}

/**
 * Per-user app data directory (machine-local, not synced):
 * Windows %LOCALAPPDATA%\Edward, macOS ~/Library/Application Support/Edward, Linux $XDG_DATA_HOME/edward.
 * Until the data has been moved (data/rename.ts), an existing %LOCALAPPDATA%\Jarvis is used instead.
 */
export function appDataDir(): string {
  const chosen = envVar("DATA_DIR");
  if (chosen) return chosen;
  const dir = defaultDataDir();
  const legacy = legacyDataDir();
  return !existsSync(dir) && legacy && existsSync(legacy) ? legacy : dir;
}

/** The data directory when no environment variable chooses one. */
export function defaultDataDir(): string {
  switch (process.platform) {
    case "win32":
      return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Edward");
    case "darwin":
      return join(homedir(), "Library", "Application Support", "Edward");
    default:
      return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "edward");
  }
}

export interface Settings {
  /** Where generated images are saved; default <appDataDir>/images. */
  imagesDir?: string;
  /** Open generated images in the default viewer; default true. */
  autoOpenImages?: boolean;
  /** Inline Sixel thumbnails: "auto" asks the terminal at startup (default). */
  inlinePreview?: "auto" | "on" | "off";
  /** Automatic memory extraction after conversations; default true. Explicit "remember" always works. */
  memoryLearning?: boolean;
  /** Whether Edward already suggested /background on after the first reminder. */
  backgroundSuggested?: boolean;
  /** Daily brief time "HH:MM" (default 08:30) and days (default weekdays). */
  briefTime?: string;
  briefDays?: "weekdays" | "daily" | "off";
  /** Bills (N5, D25): scan Gmail on the first start each day (default) or only when asked. */
  billsScan?: "daily" | "manual";
  /** Every new bill needs the user's OK (default), or bills from payees confirmed before are tracked automatically. */
  billsConfirm?: "always" | "known";
  /** Days before the due date to remind (default [3, 0]); "off" shows bills only in /bills and the brief. */
  billsRemindDays?: number[] | "off";
  /** Region (P2): numeric date order and home currency; detected from the system locale when unset. */
  dateOrder?: "dmy" | "mdy";
  currency?: string;
  /** Web search by the model (default on). Off closes a way for injected text to send data out in a search (P3). */
  webSearch?: "on" | "off";
  /** Whether the getting-started tips were shown (first run). */
  onboarded?: boolean;
}

const settingsPath = () => join(appDataDir(), "settings.json");

export function loadSettings(): Settings {
  try {
    return JSON.parse(readFileSync(settingsPath(), "utf8")) as Settings;
  } catch {
    return {}; // missing or unreadable: defaults
  }
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  for (const k of Object.keys(next) as (keyof Settings)[]) if (next[k] === undefined) delete next[k];
  mkdirSync(appDataDir(), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2) + "\n");
  return next;
}

/** Resolved images directory (env > settings > default), created on demand. */
export function imagesDir(): string {
  const dir = envVar("IMAGES_DIR") ?? loadSettings().imagesDir ?? join(appDataDir(), "images");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
