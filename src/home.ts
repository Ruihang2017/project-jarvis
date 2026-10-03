import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";

// Written once; afterwards the file is the user's to edit.
const DEFAULT_CONFIG = `# Codex config for Edward only (isolated from ~/.codex).
# Per-turn model/effort come from Edward; these are fallbacks.
model = "${config.model}"
model_reasoning_effort = "${config.effort}"

# Web search for current info (weather, news, prices): disabled | cached | indexed | live
web_search = "live"

[features]
# ChatGPT connectors MCP server; not needed for chat.
apps = false
# Sub-agent spawning; unnecessary latency for a chatbot.
multi_agent = false

# Optional: approximate location for local results (weather, "near me").
# [tools.web_search]
# location = { country = "AU", city = "Sydney", timezone = "Australia/Sydney" }
`;

/** Creates the isolated CODEX_HOME with a minimal config if missing; returns its path. */
export function ensureCodexHome(): string {
  const home = config.codexHome;
  mkdirSync(home, { recursive: true });
  const configPath = join(home, "config.toml");
  if (!existsSync(configPath)) writeFileSync(configPath, DEFAULT_CONFIG);
  return home;
}
