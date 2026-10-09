import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";
import { appDataDir, envVar } from "./settings.js";

export const config = {
  model: envVar("MODEL") ?? "gpt-6-luna",
  effort: envVar("EFFORT") ?? "low",
  // Threads run here so the agent never touches a real project directory.
  workspace: envVar("WORKSPACE") ?? join(appDataDir(), "workspace"),
  // Separate CODEX_HOME: own login, config and thread history; nothing inherited from ~/.codex.
  codexHome: envVar("CODEX_HOME") ?? join(appDataDir(), "codex-home"),
  codexBin: envVar("CODEX_BIN") ?? findCodex(),
  // The Codex release Edward was last verified against (0.156 through 0.159 all worked). The desktop
  // app's installer carries this one (app/codex.lock.json; a test keeps the two the same).
  testedCodex: "0.159.3",
};

/** True when Edward is using the Codex that came inside its own installer. */
export const codexBuiltIn = () => config.codexBin === bundledCodex();

/** How to get Codex, for messages (D44: the website and the first start say the same). */
export const INSTALL_CODEX = process.platform === "win32" ? "winget install -e --id OpenAI.Codex" : "curl -fsSL https://chatgpt.com/codex/install.sh | sh";
/** Where the user types it. */
export const SHELL_NAME = process.platform === "win32" ? "PowerShell" : "Terminal";

/**
 * Folders a Mac's Codex is usually in. An app opened from the Dock or Finder gets a short PATH
 * (/usr/bin:/bin:…) without them: OpenAI's installer, Homebrew on Apple silicon, Homebrew on Intel
 * and npm, and a few places Node version managers use.
 */
export function macBinDirs(home = homedir()): string[] {
  return [posix.join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", posix.join(home, ".npm-global", "bin"), posix.join(home, ".volta", "bin"), posix.join(home, "bin")];
}

interface Lookup {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  home?: string;
  /** The program this is running in: Edward's own when it is the desktop app. */
  execPath?: string;
  /** What the user's login shell says `codex` is; the last resort on a Mac. */
  askShell?: (shell: string) => string | null;
}

function askLoginShell(shell: string): string | null {
  try {
    // -i and -l so the shell reads the same files as a new Terminal window does; they may print things too.
    const out = execFileSync(shell, ["-ilc", "command -v codex"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")).pop() ?? null;
  } catch {
    return null;
  }
}

/**
 * The Codex that came inside the desktop app's installer (D53), or null: next to Edward's own
 * program, where the installer puts it. The background job is the same program run as Node, so it
 * finds the same one. The terminal version runs in plain Node and has none.
 */
export function bundledCodex(o: Lookup = {}): string | null {
  const platform = o.platform ?? process.platform;
  const exe = o.execPath ?? process.execPath;
  const at =
    platform === "win32" ? win32.join(win32.dirname(exe), "resources", "codex", "bin", "codex.exe")
    : platform === "darwin" ? posix.join(posix.dirname(exe), "..", "Resources", "codex", "bin", "codex")
    : null;
  return at && (o.exists ?? existsSync)(at) ? at : null;
}

/**
 * The Codex inside the installer when there is one: its version is the one Edward was verified with,
 * whatever else the computer has. Otherwise "codex" from PATH. When PATH doesn't have it: on Windows,
 * where OpenAI's installer puts it (a program started from the Start menu right after installing
 * Codex may still have the old PATH); on a Mac, the usual folders, then the login shell.
 */
export function findCodex(o: Lookup = {}): string {
  const platform = o.platform ?? process.platform;
  const env = o.env ?? process.env;
  const exists = o.exists ?? existsSync;
  const inside = bundledCodex(o);
  if (inside) return inside;
  const dirs = (env.PATH ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
  if (platform === "win32") {
    const onPath = dirs.some((d) => exists(win32.join(d, "codex.exe")) || exists(win32.join(d, "codex.cmd")));
    const standalone = win32.join(env.LOCALAPPDATA ?? "", "Programs", "OpenAI", "Codex", "bin", "codex.exe");
    return !onPath && exists(standalone) ? standalone : "codex";
  }
  if (platform !== "darwin" || dirs.some((d) => exists(posix.join(d, "codex")))) return "codex";
  const usual = macBinDirs(o.home).map((d) => posix.join(d, "codex")).find(exists);
  if (usual) return usual;
  const asked = (o.askShell ?? askLoginShell)(env.SHELL || "/bin/zsh");
  return asked && exists(asked) ? asked : "codex";
}

/**
 * The environment Codex runs in. On a Mac its own folder and the usual ones are added to PATH: an
 * npm-installed Codex starts with `node`, which the short PATH of a Dock-started app doesn't have.
 */
export function codexEnv(extra: NodeJS.ProcessEnv = {}, bin = config.codexBin, platform = process.platform, env = process.env, home = homedir()): NodeJS.ProcessEnv {
  if (platform !== "darwin") return { ...env, ...extra };
  const have = (env.PATH ?? "").split(":").filter(Boolean);
  const more = [...(bin.includes("/") ? [posix.dirname(bin)] : []), ...macBinDirs(home)].filter((d) => !have.includes(d));
  return { ...env, PATH: [...have, ...new Set(more)].join(":"), ...extra };
}

export const PERSONA = `You are Edward, a personal assistant used from a terminal.
Help with everyday tasks: answering questions, drafting and editing text, planning, quick calculations, explanations.
Be concise and direct. Prefer short answers; expand only when asked.
Format for a terminal: plain text or light Markdown, no tables wider than 80 columns.
For anything time-sensitive (news, weather, prices, schedules, recent events), search the web rather than relying on memory, and cite sources as Markdown links.
Do not run shell commands or modify files unless the user explicitly asks.
When the user asks for a picture, use image generation. Edward saves each generated image and opens it for the user automatically, and the tool result may not be visible to you: unless the tool reports an explicit error, assume it succeeded and never say it failed or couldn't be displayed.`;
