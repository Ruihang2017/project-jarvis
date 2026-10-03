/**
 * The background task's entry in the desktop app. The scheduled task runs Edward's own executable
 * with ELECTRON_RUN_AS_NODE=1 and this script: plain Node, no window, the same tick as `edward tick`.
 */
import { join } from "node:path";
import { runtime } from "../../src/runtime.js";
import { runTick } from "../../src/background/tick.js";

runtime.iconPath = join(import.meta.dirname, "..", "icon.png");
await runTick();
