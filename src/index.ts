#!/usr/bin/env node
const args = process.argv.slice(2);
try {
  if (args[0] === "tick" && args.length === 1) {
    const { runTick } = await import("./background/tick.js");
    await runTick();
  } else if (args[0] === "doctor" && args.length === 1) {
    const { doctorCli } = await import("./cli.js");
    await doctorCli();
  } else if (args[0] === "setup" && args.length === 1) {
    const { setupCli } = await import("./cli.js");
    await setupCli();
  } else if (args[0] === "uninstall" && args.length === 1) {
    const { uninstallCli } = await import("./cli.js");
    await uninstallCli();
  } else if (args[0] === "delete-data") {
    const { deleteDataCli } = await import("./cli.js");
    await deleteDataCli(args.slice(1));
  } else {
    const { main } = await import("./app.js");
    await main(args);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
export {}; // top-level await needs a module
