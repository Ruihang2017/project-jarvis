import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { iconPath } from "./icon.js";
import { runtime } from "../runtime.js";

/** App identity for Windows notifications, registered per user (HKCU, no admin) so toasts say "Edward". */
export const AUMID = "Edward.Assistant";
/** The registration made before the rename (D33); removed when the data is moved. */
export const LEGACY_AUMID = "Jarvis.Assistant";

export interface Toast {
  title: string;
  body: string;
  /** Replaces an earlier toast with the same tag instead of stacking. */
  tag?: string;
  /**
   * reminder: stays on screen until handled, with Windows' own Snooze (5/10/30/60 min) and Dismiss
   * buttons — handled by the OS, no callback into Edward. info: an ordinary toast (daily brief).
   */
  kind?: "reminder" | "info";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Toast XML (exported for tests). Body lines become separate text rows (Windows shows up to 3). */
export function toastXml(t: Toast, icon = iconPath()): string {
  const lines = t.body.split("\n").filter(Boolean).slice(0, 2);
  const logo = icon && existsSync(icon) ? `<image placement="appLogoOverride" hint-crop="none" src="${esc(pathToFileURL(icon).href)}"/>` : "";
  const texts = [t.title, ...lines].map((x) => `<text>${esc(x)}</text>`).join("");
  const actions =
    t.kind === "info"
      ? ""
      : `<actions><input id="snoozeTime" type="selection" defaultInput="10">` +
        `<selection id="5" content="5 min"/><selection id="10" content="10 min"/><selection id="30" content="30 min"/><selection id="60" content="1 hour"/>` +
        `</input><action activationType="system" arguments="snooze" hint-inputId="snoozeTime" content=""/>` +
        `<action activationType="system" arguments="dismiss" content=""/></actions>`;
  const scenario = t.kind === "info" ? "" : ` scenario="reminder"`;
  return `<toast${scenario}><visual><binding template="ToastGeneric">${texts}${logo}</binding></visual>${actions}</toast>`;
}

// Reads {xml, tag, icon} as JSON from stdin (UTF-8), so CJK text never passes through the command
// line or a script file (PowerShell 5.1 would read those in the ANSI code page).
const PS_SHOW = `
[Console]::InputEncoding = [Text.Encoding]::UTF8
$t = [Console]::In.ReadToEnd() | ConvertFrom-Json
$key = 'HKCU:\\Software\\Classes\\AppUserModelId\\${AUMID}'
if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
New-ItemProperty -Path $key -Name DisplayName -Value 'Edward' -PropertyType String -Force | Out-Null
if ($t.icon) { New-ItemProperty -Path $key -Name IconUri -Value $t.icon -PropertyType String -Force | Out-Null }
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml([string]$t.xml)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
if ($t.tag) { $toast.Tag = [string]$t.tag }
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${AUMID}').Show($toast)
`;

/** Removes the per-user registration that names Edward's notifications (uninstall). Resolves false if it wasn't there. */
export function unregisterNotifications(aumid = AUMID): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve(false);
    execFile("reg", ["delete", `HKCU\\Software\\Classes\\AppUserModelId\\${aumid}`, "/f"], { windowsHide: true, timeout: 15_000 }, (err) => resolve(!err));
  });
}

/**
 * A string literal for AppleScript. Backslash and the quote are escaped, a line break is written as
 * \n, and other control characters (which would end the script line) become spaces.
 */
export function appleString(s: string): string {
  const safe = [...s].map((ch) => {
    const code = ch.codePointAt(0)!;
    if (ch === "\n") return "\\n";
    if (code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029) return " ";
    return ch === "\\" || ch === '"' ? `\\${ch}` : ch;
  });
  return `"${safe.join("")}"`;
}

/**
 * The script for a Mac notification (exported for tests): the title, the first body line as the
 * subtitle when there are more, then up to two lines. macOS has no snooze button to offer, so a
 * reminder looks like any other notification there.
 */
export function appleNotification(t: Toast): string {
  const [first = "", ...rest] = t.body.split("\n").filter(Boolean);
  const body = rest.length ? rest.slice(0, 2).join("\n") : first;
  return `display notification ${appleString(body)} with title ${appleString(t.title)}${rest.length ? ` subtitle ${appleString(first)}` : ""}`;
}

/** Shows a desktop notification. Resolves false (never throws) if it couldn't be shown. */
export function showToast(t: Toast): Promise<boolean> {
  // Screenshot checks run the app with made-up data; nothing may pop up on the user's screen.
  if (runtime.silent) return Promise.resolve(false);
  // The desktop app on a Mac shows it itself, so it carries Edward's name and icon.
  if (runtime.notify) {
    try {
      if (runtime.notify(t)) return Promise.resolve(true);
    } catch {
      // the system's own way, below
    }
  }
  return new Promise((resolve) => {
    const [cmd, args] =
      process.platform === "win32"
        ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", PS_SHOW]]
        : process.platform === "darwin"
          ? // The script goes in on stdin: a command line can be seen by every user of the computer.
            ["/usr/bin/osascript", ["-"]]
          : ["notify-send", [t.title, t.body]];
    const child = execFile(cmd, args as string[], { windowsHide: true, timeout: 15_000 }, (err) => resolve(!err));
    if (process.platform === "win32") {
      const icon = iconPath();
      child.stdin?.end(JSON.stringify({ xml: toastXml(t), tag: t.tag, icon: icon && existsSync(icon) ? icon : undefined }), "utf8");
    } else if (process.platform === "darwin") child.stdin?.end(appleNotification(t), "utf8");
  });
}
