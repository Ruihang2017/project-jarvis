/**
 * What Edward runs on (P, D49): Codex signed in with a ChatGPT plan, or with an OpenAI API key.
 *
 * The key never travels over the JSON-RPC channel: that one passes the privacy guard, and a key is
 * nothing the model should ever be near. Codex's own `login --with-api-key` reads it from stdin, so
 * it is never on a command line either (other users can read those). The desktop app keeps one
 * encrypted copy for voice (src/voice/voice.ts), which talks to OpenAI itself.
 */
import { spawn } from "node:child_process";
import { codexEnv, config } from "../config.js";
import { looksLikeKey } from "../voice/voice.js";

/**
 * Passed to every Codex Edward starts. "auto": a new sign-in is kept encrypted (codex-home/secrets,
 * its key in the system's credential store) and an older plain auth.json is still read, so nobody
 * is signed out by an update (checked with Codex 0.159.3).
 */
export const CREDENTIAL_STORE = ["-c", 'cli_auth_credentials_store="auto"'];

const MODELS_URL = "https://api.openai.com/v1/models";

export { looksLikeKey as looksLikeOpenAiKey };

/** "rejected": OpenAI says the key is wrong. "unreachable": couldn't ask. */
export type KeyCheck = "ok" | "rejected" | "unreachable";

/**
 * Asks OpenAI whether it knows the key, before anything is switched. Only the key is sent. A key
 * that may not list models (403) is still a real key.
 */
export async function checkOpenAiKey(key: string, http: typeof fetch = fetch): Promise<KeyCheck> {
  try {
    const res = await http(MODELS_URL, { headers: { authorization: `Bearer ${key.trim()}` }, signal: AbortSignal.timeout(15_000) });
    return res.status === 401 ? "rejected" : "ok";
  } catch {
    return "unreachable";
  }
}

/** Runs a program with text on its stdin; resolves with its exit code and what it printed. */
export type RunWithInput = (bin: string, args: string[], env: NodeJS.ProcessEnv, input: string) => Promise<{ code: number | null; output: string }>;

const runWithInput: RunWithInput = (bin, args, env, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, output }));
    child.stdin.end(input);
  });

/** Signs Codex (the one in `codexHome`) in with the key. Throws without repeating the key. */
export async function saveKeyInCodex(key: string, codexHome: string, run: RunWithInput = runWithInput): Promise<void> {
  const k = key.trim();
  if (!looksLikeKey(k)) throw new Error("That doesn't look like an OpenAI API key (it starts with sk-).");
  const { code, output } = await run(config.codexBin, ["login", "--with-api-key", ...CREDENTIAL_STORE], codexEnv({ CODEX_HOME: codexHome }), `${k}\n`);
  if (code !== 0) throw new Error(`Codex couldn't save the key (${code ?? "stopped"}): ${output.split(k).join("…").trim().slice(0, 200)}`);
}
