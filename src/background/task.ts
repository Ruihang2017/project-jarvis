/**
 * The background runner: `edward tick` every minute (and at sign-in), with no resident process, and
 * it survives restarts. On Windows a per-user scheduled task, through a hidden-window VBS launcher;
 * on a Mac a per-user launchd agent (~/Library/LaunchAgents). Neither needs an administrator.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appDataDir } from "../settings.js";
import { runtime, type TickCommand } from "../runtime.js";

export const TASK_NAME = "Edward\\Tick";
/** The task registered before the rename (D33); data/rename.ts replaces it. */
export const LEGACY_TASK_NAME = "Jarvis\\Tick";
/** The launchd agent's name on a Mac. */
export const AGENT_LABEL = "com.edward.tick";
/** What the user sees it called. */
export const taskLabel = () => (process.platform === "darwin" ? AGENT_LABEL : TASK_NAME);
export const backgroundSupported = () => process.platform === "win32" || process.platform === "darwin";
const launcherPath = () => join(appDataDir(), "tick.vbs");
const agentPath = () => join(homedir(), "Library", "LaunchAgents", `${AGENT_LABEL}.plist`);
export const heartbeatPath = () => join(appDataDir(), "tick-heartbeat.txt");

/** dist/index.js of this checkout (works whether we're running from src via tsx or from dist). */
export function cliEntry(): string {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  return join(root, "dist", "index.js");
}

function run(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((done) => {
    execFile(cmd, args, { windowsHide: true, encoding: "utf8" }, (err, stdout, stderr) =>
      done({ ok: !err, out: (stdout + stderr).trim() }),
    );
  });
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** DOMAIN\user of the current user; a logon trigger without one means "any user", which needs admin. */
const currentUser = () => [process.env.USERDOMAIN, process.env.USERNAME].filter(Boolean).join("\\");

function taskXml(launcher: string): string {
  const start = new Date(Date.now() + 60_000).toISOString().slice(0, 19);
  const user = xmlEscape(currentUser());
  // Battery settings matter: the defaults skip runs on battery, which would silence reminders on a laptop.
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Edward: fires due reminders and the daily brief. Remove with /background off.</Description></RegistrationInfo>
  <Triggers>
    <TimeTrigger><StartBoundary>${start}</StartBoundary><Enabled>true</Enabled><Repetition><Interval>PT1M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition></TimeTrigger>
    <LogonTrigger><Enabled>true</Enabled><UserId>${user}</UserId></LogonTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>${user}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT2M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>wscript.exe</Command><Arguments>//B //Nologo "${xmlEscape(launcher)}"</Arguments></Exec></Actions>
</Task>`;
}

/** Writes the hidden launcher and registers (or replaces) the task. */
export async function installTask(): Promise<{ ok: boolean; message: string }> {
  if (!backgroundSupported()) return { ok: false, message: "background reminders need Windows or macOS" };
  // The desktop app runs its own executable as plain Node (runtime.tick); the terminal version, node + dist/index.js.
  const tick = runtime.tick ?? { exe: process.execPath, args: [cliEntry(), "tick"] };
  const script = tick.args.find((a) => /\.[cm]?js$/i.test(a));
  if (script && !existsSync(script)) return { ok: false, message: `${script} not found — run npm run build first` };
  if (process.platform === "darwin") return installAgent(tick);
  const launcher = launcherPath();
  // Window style 0 = hidden; False = don't wait. Quotes doubled for VBScript string literals.
  const cmdline = [tick.exe, ...tick.args].map((a) => (a === "tick" ? a : `"${a}"`)).join(" ").replace(/"/g, '""');
  const env = Object.entries(tick.env ?? {}).map(([k, v]) => `sh.Environment("Process")("${k}") = "${v.replace(/"/g, '""')}"\r\n`).join("");
  writeFileSync(launcher, `Set sh = CreateObject("WScript.Shell")\r\n${env}sh.Run "${cmdline}", 0, False\r\n`, "latin1");
  const xmlFile = join(tmpdir(), `edward-task-${process.pid}.xml`);
  writeFileSync(xmlFile, "﻿" + taskXml(launcher), "utf16le"); // schtasks wants UTF-16 with BOM
  const res = await run("schtasks", ["/Create", "/TN", TASK_NAME, "/XML", xmlFile, "/F"]);
  return { ok: res.ok, message: res.ok ? "registered" : res.out };
}

export async function removeTask(name?: string): Promise<{ ok: boolean; message: string }> {
  if (process.platform === "darwin") return removeAgent();
  if (process.platform !== "win32") return { ok: true, message: "wasn't installed" };
  // Without a name: Edward's task, and the old Jarvis one too if the data hasn't been moved yet.
  if (!name && (await run("schtasks", ["/Query", "/TN", LEGACY_TASK_NAME])).ok) await run("schtasks", ["/Delete", "/TN", LEGACY_TASK_NAME, "/F"]);
  const res = await run("schtasks", ["/Delete", "/TN", name ?? TASK_NAME, "/F"]);
  const gone = res.ok || /cannot find|does not exist/i.test(res.out);
  return { ok: gone, message: res.ok ? "removed" : gone ? "wasn't installed" : res.out };
}

/** The registered task's definition as XML, or null if there is no such task (used to put it back if a move fails). */
export async function exportTask(name: string): Promise<string | null> {
  if (process.platform !== "win32") return null;
  const res = await run("schtasks", ["/Query", "/TN", name, "/XML", "ONE"]);
  return res.ok && res.out.includes("<Task") ? res.out : null;
}

/** Registers a task from XML that exportTask returned. */
export async function importTask(name: string, xml: string): Promise<boolean> {
  const xmlFile = join(tmpdir(), `edward-task-restore-${process.pid}.xml`);
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '<?xml version="1.0" encoding="UTF-16"?>\n');
  writeFileSync(xmlFile, "﻿" + body, "utf16le"); // schtasks wants UTF-16 with BOM
  return (await run("schtasks", ["/Create", "/TN", name, "/XML", xmlFile, "/F"])).ok;
}

export interface TaskStatus {
  installed: boolean;
  enabled?: boolean;
  lastRun?: string;
  lastResult?: string;
  nextRun?: string;
  /** Last time a tick actually ran (from its heartbeat file). */
  heartbeat?: Date;
  /** What the installed task runs: the launcher script in the data folder (Windows), the agent's file (Mac). */
  launcher?: string;
  /** The data folder of the Edward that installed it. */
  home?: string;
  /** Problems that would stop ticks from working (moved Node, missing build). */
  problems: string[];
}

/** Whether the installed task was set up by the Edward that uses this data folder (not a test's, not a second copy's). */
export const taskBelongsTo = (task: TaskStatus, dir: string) => task.installed && Boolean(task.home) && resolve(task.home!).toLowerCase() === resolve(dir).toLowerCase();

export async function taskStatus(): Promise<TaskStatus> {
  if (process.platform === "darwin") return agentStatus();
  if (process.platform !== "win32") return { installed: false, problems: [] };
  let q = await run("schtasks", ["/Query", "/TN", TASK_NAME, "/V", "/FO", "LIST"]);
  // Before the data is moved (data/rename.ts) the task still has its old name.
  if (!q.ok) q = await run("schtasks", ["/Query", "/TN", LEGACY_TASK_NAME, "/V", "/FO", "LIST"]);
  const problems: string[] = [];
  if (!q.ok) return { installed: false, problems };
  const field = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, "mi").exec(q.out)?.[1]?.trim();
  // Read the launcher the task actually runs (not this process's data dir, which env vars can move).
  const launcherFile = /"([^"]+\.vbs)"/i.exec(field("Task To Run") ?? "")?.[1] ?? launcherPath();
  const launcher = existsSync(launcherFile) ? readFileSync(launcherFile, "latin1") : "";
  const paths = [...launcher.matchAll(/""([^"]+?)""/g)].map((m) => m[1]!);
  for (const p of paths) if (!existsSync(p)) problems.push(`missing ${p} — run /background on again`);
  if (!launcher) problems.push("launcher missing — run /background on again");
  let heartbeat: Date | undefined;
  try {
    heartbeat = new Date(readFileSync(join(dirname(launcherFile), "tick-heartbeat.txt"), "utf8").trim());
  } catch {
    // never ran
  }
  return {
    installed: true,
    enabled: field("Scheduled Task State") !== "Disabled",
    lastRun: field("Last Run Time"),
    lastResult: field("Last Result"),
    nextRun: field("Next Run Time"),
    heartbeat,
    launcher: launcherFile,
    home: dirname(launcherFile),
    problems,
  };
}

// ------------------------------------------------------------------ macOS: a launchd agent

const plistEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const plistUnescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * The agent's definition (exported for tests): the tick every 60 seconds and when the user signs in.
 * EDWARD_TICK_HOME only records which data folder's Edward installed it; the tick doesn't read it.
 */
export function agentPlist(tick: TickCommand, home: string): string {
  const str = (s: string) => `<string>${plistEscape(s)}</string>`;
  const env = Object.entries({ ...tick.env, EDWARD_TICK_HOME: home }).map(([k, v]) => `    <key>${plistEscape(k)}</key>${str(v)}`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>${str(AGENT_LABEL)}
  <key>ProgramArguments</key>
  <array>
${[tick.exe, ...tick.args].map((a) => `    ${str(a)}`).join("\n")}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env.join("\n")}
  </dict>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`;
}

/** The program with its arguments, and the environment, from a definition agentPlist wrote. */
export function readAgentPlist(xml: string): { args: string[]; env: Record<string, string> } {
  const args = [...(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml)?.[1] ?? "").matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => plistUnescape(m[1]!));
  const env: Record<string, string> = {};
  const block = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(xml)?.[1] ?? "";
  for (const m of block.matchAll(/<key>([\s\S]*?)<\/key>\s*<string>([\s\S]*?)<\/string>/g)) env[plistUnescape(m[1]!)] = plistUnescape(m[2]!);
  return { args, env };
}

const LAUNCHCTL = "/bin/launchctl";
/** The signed-in user's own launchd domain. */
const agentDomain = () => `gui/${process.getuid?.() ?? 0}`;

async function installAgent(tick: TickCommand): Promise<{ ok: boolean; message: string }> {
  mkdirSync(dirname(agentPath()), { recursive: true });
  writeFileSync(agentPath(), agentPlist(tick, appDataDir()));
  // Unload the one already there (an older build's, or another path); "not found" is fine.
  await run(LAUNCHCTL, ["bootout", `${agentDomain()}/${AGENT_LABEL}`]);
  let res = await run(LAUNCHCTL, ["bootstrap", agentDomain(), agentPath()]);
  // launchd can still be letting go of the old one for a moment.
  for (let i = 0; i < 4 && !res.ok; i++) {
    await new Promise((r) => setTimeout(r, 500));
    res = await run(LAUNCHCTL, ["bootstrap", agentDomain(), agentPath()]);
  }
  return { ok: res.ok, message: res.ok ? "registered" : res.out };
}

async function removeAgent(): Promise<{ ok: boolean; message: string }> {
  const had = existsSync(agentPath());
  await run(LAUNCHCTL, ["bootout", `${agentDomain()}/${AGENT_LABEL}`]);
  rmSync(agentPath(), { force: true });
  return { ok: true, message: had ? "removed" : "wasn't installed" };
}

async function agentStatus(): Promise<TaskStatus> {
  const problems: string[] = [];
  if (!existsSync(agentPath())) return { installed: false, problems };
  const { args, env } = readAgentPlist(readFileSync(agentPath(), "utf8"));
  for (const p of args.filter((a) => a.startsWith("/"))) if (!existsSync(p)) problems.push(`missing ${p} — run /background on again`);
  const loaded = await run(LAUNCHCTL, ["print", `${agentDomain()}/${AGENT_LABEL}`]);
  if (!loaded.ok) problems.push("not loaded — run /background on again");
  const home = env.EDWARD_TICK_HOME ?? appDataDir();
  let heartbeat: Date | undefined;
  try {
    heartbeat = new Date(readFileSync(join(home, "tick-heartbeat.txt"), "utf8").trim());
  } catch {
    // never ran
  }
  return {
    installed: true,
    enabled: loaded.ok,
    lastResult: /last exit code = (\S+)/.exec(loaded.out)?.[1],
    heartbeat,
    launcher: agentPath(),
    home,
    problems,
  };
}
