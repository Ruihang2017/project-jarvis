import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { appDataDir, envVar } from "./settings.js";

export const config = {
  model: envVar("MODEL") ?? "gpt-6-luna",
  effort: envVar("EFFORT") ?? "low",
  // Threads run here so the agent never touches a real project directory.
  workspace: envVar("WORKSPACE") ?? join(appDataDir(), "workspace"),
  // Separate CODEX_HOME: own login, config and thread history; nothing inherited from ~/.codex.
  codexHome: envVar("CODEX_HOME") ?? join(appDataDir(), "codex-home"),
  codexBin: envVar("CODEX_BIN") ?? findCodex(),
  // The Codex release Edward was last verified against (0.156 through 0.159 all worked).
  testedCodex: "0.159.3",
};

/** How to get Codex, for messages (D44: the website and the first start say the same). */
export const INSTALL_CODEX = "winget install -e --id OpenAI.Codex";

/**
 * "codex" from PATH; on Windows, where OpenAI's installer puts it when PATH doesn't have it (a program
 * started from the Start menu right after installing Codex may still have the old PATH).
 */
function findCodex(): string {
  if (process.platform !== "win32") return "codex";
  const onPath = (process.env.PATH ?? "").split(delimiter).some((d) => d && (existsSync(join(d, "codex.exe")) || existsSync(join(d, "codex.cmd"))));
  const standalone = join(process.env.LOCALAPPDATA ?? "", "Programs", "OpenAI", "Codex", "bin", "codex.exe");
  return !onPath && existsSync(standalone) ? standalone : "codex";
}

export const PERSONA = `You are Edward, a personal assistant used from a terminal.
Help with everyday tasks: answering questions, drafting and editing text, planning, quick calculations, explanations.
Be concise and direct. Prefer short answers; expand only when asked.
Format for a terminal: plain text or light Markdown, no tables wider than 80 columns.
For anything time-sensitive (news, weather, prices, schedules, recent events), search the web rather than relying on memory, and cite sources as Markdown links.
Do not run shell commands or modify files unless the user explicitly asks.
When the user asks for a picture, use image generation. Edward saves each generated image and opens it for the user automatically, and the tool result may not be visible to you: unless the tool reports an explicit error, assume it succeeded and never say it failed or couldn't be displayed.`;
