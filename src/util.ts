import { homedir } from "node:os";

export { openWithDefaultApp as openBrowser } from "./system.js";

/**
 * Removes terminal control characters from text Jarvis didn't write (email, calendar, model
 * output): ESC and the other C0/C1 codes can clear the screen, rewrite what is already shown
 * (a fake approval prompt), or write to the clipboard; bidi overrides can make a name or address
 * read differently from what it is. Newlines and tabs stay.
 */
export function stripControl(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, "");
}

/** stripControl over every string in a JSON value (requests from Codex: commands, questions, tool arguments). */
export function stripControlDeep<T>(value: T): T {
  if (typeof value === "string") return stripControl(value) as T;
  if (Array.isArray(value)) return value.map(stripControlDeep) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripControlDeep(v)])) as T;
  return value;
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
