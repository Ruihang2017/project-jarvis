import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Per-user app data directory (machine-local, not synced):
 * Windows %LOCALAPPDATA%\Jarvis, macOS ~/Library/Application Support/Jarvis, Linux $XDG_DATA_HOME/jarvis.
 */
export function appDataDir(): string {
  if (process.env.JARVIS_DATA_DIR) return process.env.JARVIS_DATA_DIR;
  switch (process.platform) {
    case "win32":
      return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Jarvis");
    case "darwin":
      return join(homedir(), "Library", "Application Support", "Jarvis");
    default:
      return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "jarvis");
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
  /** Whether Jarvis already suggested /background on after the first reminder. */
  backgroundSuggested?: boolean;
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
  const dir = process.env.JARVIS_IMAGES_DIR ?? loadSettings().imagesDir ?? join(appDataDir(), "images");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
