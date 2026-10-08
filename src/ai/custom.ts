/**
 * Another AI service (P, D51): any service that speaks OpenAI's Responses format (OpenRouter, Qwen on
 * Alibaba Cloud, a company's own gateway), with the user's address, model name and key.
 *
 * Codex does the talking: it is started with the service as its model provider and reads the key
 * from its environment. The key is never on a command line and never on the JSON-RPC channel; at
 * rest it is encrypted like the Google sign-ins. Everything still passes the privacy guard on its way
 * to Codex. What changes is where Codex sends it: to that service instead of OpenAI.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { protect, unprotect } from "../google/dpapi.js";
import { appDataDir, loadSettings, updateSettings } from "../settings.js";
import { CREDENTIAL_STORE } from "./account.js";

export interface CustomAi {
  /** For display: "OpenRouter", or the host. Worked out from the address, never typed. */
  name: string;
  /** https://host/path, no trailing slash; Codex adds /responses. */
  baseUrl: string;
  model: string;
}

/** The environment variable Codex reads the key from. Codex keeps names with KEY in them away from the commands it runs. */
export const KEY_ENV = "EDWARD_AI_KEY";

const keyPath = () => join(appDataDir(), "ai-key.bin");

/** The service in the settings, if one was chosen. */
export function customAi(): CustomAi | null {
  const ai = loadSettings().ai;
  return ai && typeof ai.baseUrl === "string" && typeof ai.model === "string" && checkAddress(ai.baseUrl).url === ai.baseUrl && validModel(ai.model) ? { name: nameOf(ai.baseUrl), baseUrl: ai.baseUrl, model: ai.model } : null;
}

/** An address Edward will use: https (plain http only for this computer), no sign-in details, no query. */
export function checkAddress(raw: string): { url?: string; problem?: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { problem: "That isn't a web address. It looks like https://openrouter.ai/api/v1." };
  }
  if (u.username || u.password) return { problem: "Leave sign-in details out of the address: the key has its own field." };
  if (u.search || u.hash) return { problem: "The address can't have a ? or # part." };
  const here = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && here)) return { problem: "The address must start with https://." };
  return { url: u.origin + u.pathname.replace(/\/+$/, "") };
}

/** A model name as services write them: qwen-plus, qwen/qwen-plus, ~anthropic/claude-sonnet-latest. */
export const validModel = (m: string) => /^[A-Za-z0-9~][A-Za-z0-9._:/~@+-]{0,119}$/.test(m);

export const hostOf = (baseUrl: string) => new URL(baseUrl).host;

export function nameOf(baseUrl: string): string {
  const host = new URL(baseUrl).hostname;
  if (host === "openrouter.ai") return "OpenRouter";
  if (host.endsWith(".aliyuncs.com")) return "Qwen (Alibaba Cloud)";
  if (host === "api.openai.com") return "OpenAI";
  return host;
}

/**
 * Tries the service once before anything is switched: one tiny request, which shows that the address
 * speaks the Responses format, that the key is accepted and that the model exists. Nothing of the
 * user's is in it.
 */
export async function checkService(ai: { baseUrl: string; model: string }, key: string, http: typeof fetch = fetch): Promise<{ ok: boolean; message: string }> {
  const host = hostOf(ai.baseUrl);
  let res: Response;
  try {
    res = await http(`${ai.baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${key.trim()}`, "content-type": "application/json" },
      body: JSON.stringify({ model: ai.model, input: "Reply with the word: ok", max_output_tokens: 32 }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    return { ok: false, message: `Couldn't reach ${host}. Check the address and your connection. Nothing was changed.` };
  }
  if (res.ok) return { ok: true, message: "" };
  if (res.status === 401 || res.status === 403) return { ok: false, message: `${host} didn't accept the key. Nothing was changed.` };
  if (res.status === 404) return { ok: false, message: `${host} has nothing at ${new URL(ai.baseUrl).pathname}/responses. Edward needs a service that speaks OpenAI's Responses format; check the address (and the model name). Nothing was changed.` };
  let said = "";
  try {
    const body = (await res.json()) as { error?: { message?: unknown } | string; message?: unknown };
    const m = typeof body.error === "string" ? body.error : (body.error?.message ?? body.message);
    // Another computer's words: plain, short, and never the key.
    if (typeof m === "string") said = m.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").split(key.trim()).join("…").slice(0, 200);
  } catch {
    // not JSON
  }
  return { ok: false, message: `${host} said ${res.status}${said ? `: ${said}` : ""}. Nothing was changed.` };
}

/** Remembers the service and keeps its key, encrypted. */
export async function saveCustom(ai: { baseUrl: string; model: string }, key: string): Promise<void> {
  mkdirSync(appDataDir(), { recursive: true });
  writeFileSync(keyPath(), await protect(key.trim()));
  updateSettings({ ai: { baseUrl: ai.baseUrl, model: ai.model } });
}

/** Another model of the same service. */
export function setCustomModel(model: string): void {
  const ai = customAi();
  if (ai && validModel(model)) updateSettings({ ai: { baseUrl: ai.baseUrl, model } });
}

/** Back to OpenAI: forgets the service and deletes its key. */
export function clearCustom(): void {
  updateSettings({ ai: undefined });
  rmSync(keyPath(), { force: true });
}

const toml = (s: string) => JSON.stringify(s); // a TOML basic string, for the characters checkAddress and validModel allow

/** What Codex is started with to use the service. */
export function providerArgs(ai: CustomAi): string[] {
  return [
    ...CREDENTIAL_STORE,
    "-c", 'model_provider="edward"',
    "-c", `model_providers.edward.name=${toml(ai.name)}`,
    "-c", `model_providers.edward.base_url=${toml(ai.baseUrl)}`,
    "-c", `model_providers.edward.env_key="${KEY_ENV}"`,
    "-c", 'model_providers.edward.wire_api="responses"',
    "-c", `model=${toml(ai.model)}`,
  ];
}

/**
 * The service to start Codex with, and its key for Codex's environment. null when none is chosen.
 * Throws when one is chosen but its key can't be read: the caller must not quietly use OpenAI then.
 */
export async function customLaunch(): Promise<{ ai: CustomAi; args: string[]; env: Record<string, string> } | null> {
  const ai = customAi();
  if (!ai) return null;
  if (!existsSync(keyPath())) throw new Error(`the key for ${ai.name} is missing`);
  return { ai, args: providerArgs(ai), env: { [KEY_ENV]: await unprotect(readFileSync(keyPath())) } };
}
