import { spawn } from "node:child_process";
import { homedir } from "node:os";

export function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

/** Shortens paths under the home directory to `~/…` for display. */
export function tildify(path: string): string {
  const home = homedir();
  const norm = (p: string) => p.replace(/\\/g, "/");
  const p = norm(path);
  const h = norm(home);
  return p.toLowerCase().startsWith(h.toLowerCase()) ? "~" + p.slice(h.length) : p;
}

export function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
}

/** Codex wraps shell commands as `"…powershell.exe" -Command '…'`; show just the script. */
export function displayCommand(command: string): string {
  const m = /^"?[^"]*?(?:powershell|pwsh)(?:\.exe)?"?\s+(?:-NoProfile\s+)?-Command\s+(['"])([\s\S]*)\1\s*$/i.exec(command);
  return m ? m[2]!.replace(/\\"/g, '"') : command;
}

/** Counts added/removed lines in a unified diff, ignoring file headers. */
export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}
