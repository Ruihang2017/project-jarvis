import { Session, signInOf } from "./session.js";
import { repl, runTurn } from "./ui.js";
import { openBrowser } from "./util.js";
import { ensureDataVersion } from "./data/version.js";
import { moveFromJarvis, renameMessage } from "./data/rename.js";

// `edward` → interactive REPL; `edward "question"` → one-shot streamed answer.
export async function main(args: string[]) {
  const prompt = args.join(" ").trim();

  // Before any store opens: move the data out of the old Jarvis folder (once), then upgrade it if
  // this build is newer (backing it up first).
  for (const line of renameMessage(await moveFromJarvis())) console.error(line);
  const data = ensureDataVersion();
  if (data.newer) console.error(`Warning: your Edward data (v${data.to}) is newer than this Edward — update Edward before relying on it.`);
  if (data.applied.length) console.error(`Upgraded your data to v${data.to} (${data.applied.length} step${data.applied.length === 1 ? "" : "s"}); backup: ${data.backup}`);

  const session = new Session();
  try {
    let { account } = await session.init();
    if (!account) {
      console.log("Edward needs its own ChatGPT sign-in (one time). Opening your browser…");
      await session.login((url) => {
        console.log(`If it doesn't open, visit:\n  ${url}\n`);
        openBrowser(url);
      });
      ({ account } = await session.init());
    }
    if (!signInOf(account)) {
      console.error(`Expected a ChatGPT account or an OpenAI API key, got: ${account?.type ?? "none"}`);
      process.exitCode = 1;
      return;
    }

    if (!prompt) {
      await repl(session);
      return;
    }

    const status = await runTurn(session, prompt, { prefix: false, status: false });
    if (status !== "completed") process.exitCode = 1;
  } finally {
    session.close();
  }
}

