/** Command-line entry points that aren't the REPL: `edward doctor`, `edward delete-data`. */
import { moveFromJarvis, renameMessage } from "./data/rename.js";
import { createInterface } from "node:readline/promises";
import { styleText } from "node:util";
import { existsSync } from "node:fs";
import { unregisterNotifications } from "./background/notify.js";
import { installTask, removeTask, taskStatus } from "./background/task.js";
import { codexVersion, compareCodex } from "./doctor.js";
import { CALENDAR_SCOPES, GMAIL_SCOPES, missingFeatures } from "./google/instructions.js";
import { clientPath, hasClient } from "./google/oauth.js";
import { region } from "./region.js";
import { updateSettings } from "./settings.js";
import { runSetup, type SetupEnv, type SetupIO } from "./setup.js";
import { openBrowser } from "./util.js";
import { dirname, resolve } from "node:path";
import { wipeData } from "./data/wipe.js";
import { formatChecks, runDoctor } from "./doctor.js";
import { Accounts } from "./accounts/accounts.js";
import { Session } from "./session.js";
import { appDataDir, envVar } from "./settings.js";
import { tildify } from "./util.js";

const dim = (s: string) => styleText("dim", s);

/** Runs every check, including the ones that need Codex running. Exit code 1 if anything failed. */
export async function doctorCli(): Promise<void> {
  let session: Session | undefined;
  try {
    session = new Session();
    await session.init();
  } catch {
    session?.close();
    session = undefined; // Codex wouldn't start: the Codex check below says why
  }
  try {
    const checks = await runDoctor(session);
    for (const l of formatChecks(checks)) console.log(l);
    if (checks.some((c) => c.status === "fail")) process.exitCode = 1;
  } finally {
    session?.close();
  }
}

/** Deletes what Edward stored. Asks the user to type DELETE; `--all` removes the whole data folder. */
export async function deleteDataCli(args: string[]): Promise<void> {
  const all = args.includes("--all");
  const unknown = args.filter((a) => a !== "--all");
  if (unknown.length) {
    console.log("usage: edward delete-data [--all]");
    process.exitCode = 1;
    return;
  }
  const dir = appDataDir();
  console.log(`This deletes what Edward has stored in ${tildify(dir)}:`);
  console.log("  memories, reminders, bills, settings, backups, exports, logs, generated images and conversations;");
  console.log("  Edward's Google access is revoked and the background task is removed.");
  console.log(all ? styleText("yellow", "  --all: also your ChatGPT sign-in, google-client.json and the workspace folder (the whole data folder).") : "  Kept: your ChatGPT sign-in, google-client.json and files in the workspace folder (use --all to remove those too).");
  console.log("  Your emails, calendar and Google account are not touched. Close Edward first if it is open.");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Type DELETE to go ahead: ").catch(() => "");
  rl.close();
  if (answer.trim() !== "DELETE") {
    console.log(dim("[nothing deleted]"));
    return;
  }
  const accounts = new Accounts();
  const report = await wipeData({
    all,
    disconnectGoogle: async () => {
      for (const a of accounts.list()) await accounts.disconnect(a.id);
    },
    // The scheduled task is one per Windows user. Remove it only if it belongs to this data
    // folder — not when the folder was pointed elsewhere (tests, a second copy).
    removeTask: async () => {
      if (process.platform !== "win32") return;
      const task = await taskStatus();
      if (task.installed && task.launcher && resolve(dirname(task.launcher)).toLowerCase() === resolve(dir).toLowerCase()) await removeTask();
    },
  });
  for (const d of report.deleted) console.log(dim(`  deleted ${d}`));
  for (const k of report.kept) console.log(dim(`  kept ${k}`));
  for (const p of report.problems) console.log(styleText("yellow", `  problem — ${p}`));
  console.log(report.problems.length ? "Finished with problems (see above)." : "Done.");
  if (report.problems.length) process.exitCode = 1;
}

/** `edward setup`: the first-run wizard (src/setup.ts) wired to the real Codex, scheduler and Google. */
export async function setupCli(): Promise<void> {
  for (const line of renameMessage(await moveFromJarvis())) console.log(line);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.once("close", () => (closed = true));
  const io: SetupIO = {
    say: (line) => console.log(line),
    ask: async (q) => (closed ? null : rl.question(q).catch(() => null)),
  };
  let session: Session | undefined;
  let started = false;
  const codex = async () => {
    session ??= new Session();
    if (!started) {
      await session.init();
      started = true;
    }
    return session;
  };
  const accounts = new Accounts();
  const env: SetupEnv = {
    node: process.versions.node,
    codex: async () => compareCodex(await codexVersion()),
    account: async () => {
      const s = await codex();
      const { account } = await s.client.request<{ account: { type: string; email?: string } | null }>("account/read", { refreshToken: false });
      return account?.type === "chatgpt" ? (account.email ?? "") : null;
    },
    signIn: async () => {
      const s = await codex();
      await s.login((url) => {
        console.log(`  If your browser doesn't open, visit:\n  ${url}`);
        openBrowser(url);
      });
    },
    background: {
      supported: process.platform === "win32",
      installed: async () => (await taskStatus()).installed,
      install: installTask,
    },
    google: {
      clientPath: clientPath(),
      hasClient,
      connected: () => {
        const list = accounts.connected();
        return list.length ? list.map((a) => a.email ?? "").filter(Boolean).join(", ") : null;
      },
      missing: () => [...new Set(accounts.connected().flatMap((a) => missingFeatures(accounts.state(a))))],
      connect: async () => {
        const { state: s } = await accounts.connect([...CALENDAR_SCOPES, ...GMAIL_SCOPES], (url) => {
          console.log(`  If your browser doesn't open, visit:\n  ${url}`);
          openBrowser(url);
        });
        return s.email ?? "your Google account";
      },
    },
    region: { current: region, set: (r) => void updateSettings(r) },
    doctor: async () => formatChecks(await runDoctor(started ? session : undefined)),
  };
  try {
    if (!(await runSetup(io, env))) process.exitCode = 1;
  } finally {
    rl.close();
    session?.close();
  }
}

/**
 * `edward uninstall`: undoes what Edward set up on this computer, then offers to delete the data.
 * Machine-wide pieces (scheduled task, notification registration) are only removed when they
 * belong to this data folder — never from a copy pointed somewhere else by JARVIS_DATA_DIR.
 */
export async function uninstallCli(): Promise<void> {
  const dir = appDataDir();
  const own = !envVar("DATA_DIR");
  console.log("Uninstalling Edward from this computer:");
  const accounts = new Accounts();
  for (const a of accounts.list()) {
    const { revoked } = await accounts.disconnect(a.id).catch(() => ({ revoked: false }));
    console.log(dim(revoked ? `  revoked Edward's access to ${a.email ?? a.id}` : `  removed the local token for ${a.email ?? a.id} (check myaccount.google.com/connections to confirm access is gone)`));
  }
  if (process.platform === "win32") {
    const task = await taskStatus();
    if (task.installed && task.launcher && resolve(dirname(task.launcher)).toLowerCase() === resolve(dir).toLowerCase()) {
      const r = await removeTask();
      console.log(dim(r.ok ? "  removed the background task" : `  couldn't remove the background task: ${r.message}`));
    }
    if (own && (await unregisterNotifications())) console.log(dim("  removed the notification registration"));
  }
  console.log(`Your data is in ${tildify(dir)} (memories, reminders, bills, conversations, your ChatGPT sign-in).`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Type DELETE to remove it too, or press Enter to keep it: ").catch(() => "");
  rl.close();
  if (answer.trim() === "DELETE") {
    const report = await wipeData({ all: true });
    for (const p of report.problems) console.log(styleText("yellow", `  problem — ${p}`));
    console.log(dim(report.problems.length ? "  data not fully removed" : "  data deleted"));
  } else console.log(dim("  data kept"));
  console.log("Last step, to remove the program itself:  npm uninstall -g edward-assistant");
}
