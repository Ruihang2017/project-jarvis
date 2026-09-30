import { execFile } from "node:child_process";

/** App identity for Windows notifications, registered per user (HKCU, no admin) so toasts say "Jarvis". */
export const AUMID = "Jarvis.Assistant";

export interface Toast {
  title: string;
  body: string;
  /** Replaces an earlier toast with the same tag instead of stacking. */
  tag?: string;
}

// Reads the toast as JSON from stdin (UTF-8), so CJK text never passes through the command line or
// a script file (PowerShell 5.1 would read those in the ANSI code page).
const PS_SHOW = `
[Console]::InputEncoding = [Text.Encoding]::UTF8
$t = [Console]::In.ReadToEnd() | ConvertFrom-Json
$key = 'HKCU:\\Software\\Classes\\AppUserModelId\\${AUMID}'
if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
New-ItemProperty -Path $key -Name DisplayName -Value 'Jarvis' -PropertyType String -Force | Out-Null
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$esc = { param($s) [Security.SecurityElement]::Escape([string]$s) }
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast scenario='reminder'><visual><binding template='ToastGeneric'><text>$(& $esc $t.title)</text><text>$(& $esc $t.body)</text></binding></visual><actions><action content='OK' arguments='dismiss' activationType='system'/></actions></toast>")
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
if ($t.tag) { $toast.Tag = [string]$t.tag }
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${AUMID}').Show($toast)
`;

/** Shows a desktop notification. Resolves false (never throws) if it couldn't be shown. */
export function showToast(t: Toast): Promise<boolean> {
  return new Promise((resolve) => {
    const [cmd, args] =
      process.platform === "win32"
        ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", PS_SHOW]]
        : process.platform === "darwin"
          ? ["osascript", ["-e", `display notification ${JSON.stringify(t.body)} with title ${JSON.stringify(t.title)}`]]
          : ["notify-send", [t.title, t.body]];
    const child = execFile(cmd, args as string[], { windowsHide: true, timeout: 15_000 }, (err) => resolve(!err));
    if (process.platform === "win32") child.stdin?.end(JSON.stringify(t), "utf8");
  });
}
