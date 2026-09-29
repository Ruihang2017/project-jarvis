#!/usr/bin/env node
import { Session } from "./session.js";
import { repl, runTurn } from "./ui.js";
import { openBrowser } from "./util.js";

// `jarvis` → interactive REPL; `jarvis "question"` → one-shot streamed answer.
async function main() {
  const prompt = process.argv.slice(2).join(" ").trim();

  const session = new Session();
  try {
    let { account } = await session.init();
    if (!account) {
      console.log("Jarvis needs its own ChatGPT sign-in (one time). Opening your browser…");
      await session.login((url) => {
        console.log(`If it doesn't open, visit:\n  ${url}\n`);
        openBrowser(url);
      });
      ({ account } = await session.init());
    }
    if (account?.type !== "chatgpt") {
      console.error(`Expected a ChatGPT account, got: ${account?.type ?? "none"}`);
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

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
