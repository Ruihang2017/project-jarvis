/** Command-line entry points that aren't the REPL: `jarvis doctor`, `jarvis delete-data`. */
import { createInterface } from "node:readline/promises";
import { styleText } from "node:util";
import { removeTask, taskStatus } from "./background/task.js";
import { dirname, resolve } from "node:path";
import { wipeData } from "./data/wipe.js";
import { formatChecks, runDoctor } from "./doctor.js";
import { GoogleAuth } from "./google/auth.js";
import { Session } from "./session.js";
import { appDataDir } from "./settings.js";
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

/** Deletes what Jarvis stored. Asks the user to type DELETE; `--all` removes the whole data folder. */
export async function deleteDataCli(args: string[]): Promise<void> {
  const all = args.includes("--all");
  const unknown = args.filter((a) => a !== "--all");
  if (unknown.length) {
    console.log("usage: jarvis delete-data [--all]");
    process.exitCode = 1;
    return;
  }
  const dir = appDataDir();
  console.log(`This deletes what Jarvis has stored in ${tildify(dir)}:`);
  console.log("  memories, reminders, bills, settings, backups, exports, logs, generated images and conversations;");
  console.log("  Jarvis's Google access is revoked and the background task is removed.");
  console.log(all ? styleText("yellow", "  --all: also your ChatGPT sign-in, google-client.json and the workspace folder (the whole data folder).") : "  Kept: your ChatGPT sign-in, google-client.json and files in the workspace folder (use --all to remove those too).");
  console.log("  Your emails, calendar and Google account are not touched. Close Jarvis first if it is open.");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Type DELETE to go ahead: ").catch(() => "");
  rl.close();
  if (answer.trim() !== "DELETE") {
    console.log(dim("[nothing deleted]"));
    return;
  }
  const google = new GoogleAuth();
  const report = await wipeData({
    all,
    disconnectGoogle: async () => {
      if (google.state()) await google.disconnect();
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
