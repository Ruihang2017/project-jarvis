import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

// PowerShell 5.1 defaults to the OEM code page on pipes; force UTF-8 both ways so CJK text survives.
const PS_UTF8 = "[Console]::InputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8;";

function run(cmd: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(cmd, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolvePromise(stdout);
    });
    if (input !== undefined) child.stdin!.end(input, "utf8");
  });
}

const powershell = (script: string, input?: string) =>
  run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS_UTF8 + script], input);

export async function readClipboard(): Promise<string> {
  switch (process.platform) {
    case "win32":
      // Write-Output appends a newline to the raw text; drop exactly one.
      return (await powershell("Get-Clipboard -Raw")).replace(/\r?\n$/, "");
    case "darwin":
      return run("pbpaste", []);
    default:
      return process.env.WAYLAND_DISPLAY ? run("wl-paste", ["--no-newline"]) : run("xclip", ["-selection", "clipboard", "-o"]);
  }
}

export async function writeClipboard(text: string): Promise<void> {
  if (!text) throw new Error("nothing to copy (empty text)"); // Set-Clipboard rejects empty values
  switch (process.platform) {
    case "win32":
      // Text goes through stdin, never the command line, so nothing needs escaping.
      await powershell("Set-Clipboard -Value ([Console]::In.ReadToEnd())", text);
      return;
    case "darwin":
      await run("pbcopy", [], text);
      return;
    default:
      await (process.env.WAYLAND_DISPLAY ? run("wl-copy", [], text) : run("xclip", ["-selection", "clipboard"], text));
  }
}

export type OpenTarget = { kind: "url"; value: string } | { kind: "path"; value: string };

/** Classifies and validates what `open` may launch: web/mail URLs, or existing local paths. */
export function resolveOpenTarget(target: string, baseDir: string): OpenTarget {
  const t = target.trim();
  if (/^(https?:\/\/|mailto:)/i.test(t)) return { kind: "url", value: t };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) throw new Error(`refusing to open non-web URL scheme: ${t}`);
  const expanded = t.replace(/^~(?=$|[\\/])/, homedir());
  const path = resolve(baseDir, expanded); // absolute paths pass through; also normalizes separators
  if (!existsSync(path)) throw new Error(`no such file or folder: ${path}`);
  return { kind: "path", value: path };
}

/** Opens a URL or path with the OS default handler (browser, associated app, file explorer). */
export function openWithDefaultApp(value: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", value]]
      : [process.platform === "darwin" ? "open" : "xdg-open", [value]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}
