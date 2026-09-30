#!/usr/bin/env node
// Entry point. Subcommands load only what they need: `tick` runs every minute from the scheduled
// task, so it skips the Codex client and the UI.
const args = process.argv.slice(2);

try {
  if (args[0] === "tick" && args.length === 1) {
    const { runTick } = await import("./background/tick.js");
    await runTick();
  } else {
    const { main } = await import("./app.js");
    await main(args);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

export {}; // top-level await needs a module
