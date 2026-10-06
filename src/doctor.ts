/**
 * Self-check (P1): `/doctor` in the REPL and `edward doctor` on the command line. Each line says
 * what was checked, whether it is fine, and what to do if it isn't.
 */
import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { styleText } from "node:util";
import { backgroundSupported, taskStatus } from "./background/task.js";
import { codexEnv, config, INSTALL_CODEX } from "./config.js";
import { DATA_VERSION, readDataVersion } from "./data/version.js";
import { shortScope } from "./google/auth.js";
import { missingFeatures } from "./google/instructions.js";
import { guardOutgoing } from "./privacy/outgoing.js";
import { MODES, type Session } from "./session.js";
import { appDataDir } from "./settings.js";

export type Status = "ok" | "warn" | "fail";

export interface Check {
  name: string;
  status: Status;
  detail: string;
}

/** "0.159.3" from `codex --version`; null when Codex can't be run. */
export function codexVersion(bin = config.codexBin): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, ["--version"], { windowsHide: true, timeout: 15_000, env: codexEnv({}, bin) }, (err, stdout) => {
      resolve(err ? null : (/(\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null));
    });
  });
}

/** Same major.minor as the verified release is fine; anything else may work but hasn't been tried. */
export function compareCodex(found: string | null, tested = config.testedCodex): Check {
  if (!found) return { name: "Codex", status: "fail", detail: `not found — install it (${INSTALL_CODEX}, or npm i -g @openai/codex) and open Edward again` };
  const minor = (v: string) => v.split(".").slice(0, 2).join(".");
  if (minor(found) === minor(tested)) return { name: "Codex", status: "ok", detail: found };
  return { name: "Codex", status: "warn", detail: `${found} — Edward was verified with ${tested}; if something misbehaves, that is the first thing to suspect` };
}

/** Proves the privacy guard is in the path by sending a made-up card number through it. */
export function guardSelfTest(): Check {
  const out = JSON.stringify(guardOutgoing().request("turn/start", { threadId: "self-test", input: [{ type: "text", text: "card 4111 1111 1111 1111, ending 4409" }] }));
  const leaked = out.includes("4111") || out.includes("4409");
  return leaked
    ? { name: "Privacy guard", status: "fail", detail: "a test card number passed through unredacted — do not use Edward until this is fixed" }
    : { name: "Privacy guard", status: "ok", detail: "a test card number was removed before sending" };
}

function dataDirCheck(): Check {
  const dir = appDataDir();
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, `.doctor-${process.pid}`);
    writeFileSync(probe, "");
    rmSync(probe);
    return { name: "Data folder", status: "ok", detail: dir };
  } catch (e) {
    return { name: "Data folder", status: "fail", detail: `${dir} isn't writable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function dataVersionCheck(): Check {
  const v = readDataVersion();
  if (v === null) return { name: "Data version", status: "ok", detail: `new (will be v${DATA_VERSION})` };
  if (v > DATA_VERSION) return { name: "Data version", status: "warn", detail: `v${v}, newer than this Edward (v${DATA_VERSION}) — update Edward` };
  return { name: "Data version", status: "ok", detail: `v${v}` };
}

async function backgroundCheck(): Promise<Check> {
  if (!backgroundSupported()) return { name: "Background", status: "warn", detail: "background reminders need Windows or macOS" };
  const s = await taskStatus();
  if (!s.installed) return { name: "Background", status: "warn", detail: "off — reminders only appear while Edward is open; /background on" };
  if (s.problems.length) return { name: "Background", status: "fail", detail: s.problems.join("; ") };
  const age = s.heartbeat ? Math.round((Date.now() - s.heartbeat.getTime()) / 1000) : null;
  if (age === null || age > 300) return { name: "Background", status: "warn", detail: `task installed but last ran ${age === null ? "never" : `${Math.round(age / 60)} min ago`} — /background on again` };
  return { name: "Background", status: "ok", detail: `on, last ran ${age}s ago` };
}

/** One check per connected Google account (A1). */
async function googleChecks(session: Session): Promise<Check[]> {
  const acc = session.accounts;
  const list = acc.connected();
  if (!list.length) return [{ name: "Google", status: "ok", detail: "not connected (optional) — /connect google" }];
  const checks: Check[] = [];
  for (const a of list) {
    const name = list.length > 1 ? `Google · ${acc.label(a)}` : "Google";
    const s = acc.state(a)!;
    const who = s.email ?? "connected";
    try {
      if ((await acc.auth(a).check()) !== "ok") {
        checks.push({ name, status: "fail", detail: `${who}: the connection expired or was revoked — /connect google ${s.email ?? a.id}` });
        continue;
      }
    } catch (e) {
      checks.push({ name, status: "warn", detail: `couldn't reach Google: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    const missing = missingFeatures(s);
    checks.push(
      missing.length
        ? { name, status: "warn", detail: `${who}; no permission yet for ${missing.join(" and ")} — /connect google ${s.email ?? a.id}` }
        : { name, status: "ok", detail: `${who} · ${s.scopes.map(shortScope).filter((x) => x !== "openid").join(", ")}` },
    );
  }
  return checks;
}

/** All checks. With a session, also ChatGPT sign-in, Google and the current mode. */
export async function runDoctor(session?: Session): Promise<Check[]> {
  const node = Number(process.versions.node.split(".")[0]);
  const checks: Check[] = [
    node >= 24 ? { name: "Node.js", status: "ok", detail: process.versions.node } : { name: "Node.js", status: "fail", detail: `${process.versions.node} — Edward needs Node 24 or newer` },
    compareCodex(await codexVersion()),
  ];
  if (session) {
    try {
      const { account } = await session.client.request<{ account: { type: string; email?: string } | null }>("account/read", { refreshToken: false });
      checks.push(account?.type === "chatgpt" ? { name: "ChatGPT", status: "ok", detail: `signed in${account.email ? ` as ${account.email}` : ""}` } : { name: "ChatGPT", status: "fail", detail: "not signed in — restart Edward to sign in" });
    } catch (e) {
      checks.push({ name: "ChatGPT", status: "fail", detail: `couldn't ask Codex: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  checks.push(dataDirCheck(), dataVersionCheck(), await backgroundCheck());
  if (session) checks.push(...(await googleChecks(session)));
  checks.push(guardSelfTest());
  if (session) {
    checks.push(
      MODES[session.mode].guarded
        ? { name: "Mode", status: "ok", detail: `${session.mode} — Codex's own commands and file reading are off` }
        : { name: "Mode", status: "warn", detail: `${session.mode} — what Codex reads itself bypasses the privacy guard; /mode chat when you're done` },
    );
  }
  return checks;
}

const COLOR: Record<Status, "green" | "yellow" | "red"> = { ok: "green", warn: "yellow", fail: "red" };

/** "[ok]   Codex          0.159.3" — plain ASCII tags, so every terminal lines them up. */
export function formatChecks(checks: Check[]): string[] {
  const width = Math.max(...checks.map((c) => c.name.length));
  const lines = checks.map((c) => `${styleText(COLOR[c.status], `[${c.status}]`.padEnd(6))} ${c.name.padEnd(width)}  ${c.detail}`);
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  lines.push(fails ? `${fails} problem${fails === 1 ? "" : "s"} to fix${warns ? `, ${warns} warning${warns === 1 ? "" : "s"}` : ""}` : warns ? `Working, with ${warns} warning${warns === 1 ? "" : "s"}` : "Everything looks fine");
  return lines;
}
