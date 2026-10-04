/**
 * The voice call's connection (V). The window makes the WebRTC offer (microphone and speaker stay in
 * the window); this process answers it with OpenAI's realtime interface, using the user's key, so the
 * key never reaches the window. Only the SDP and the session settings are sent here; the audio itself
 * flows between the window and OpenAI.
 */
import { loadVoiceKey, sessionConfig } from "../../src/voice/voice.js";

const CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const MODELS_URL = "https://api.openai.com/v1/models";

export class VoiceError extends Error {}

/** Sends the window's offer and returns OpenAI's answer (SDP). */
export async function answerCall(offer: string, o: { voice?: string; model?: string }, http: typeof fetch = fetch): Promise<string> {
  const key = await loadVoiceKey();
  if (!key) throw new VoiceError("Add your OpenAI API key in Settings → Voice first.");
  if (!/^v=0/.test(offer.trim())) throw new VoiceError("bad offer");
  const form = new FormData();
  form.set("sdp", offer);
  form.set("session", JSON.stringify(sessionConfig(o)));
  const res = await http(CALLS_URL, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form });
  const text = await res.text();
  if (!res.ok) throw new VoiceError(problem(res.status, text));
  return text;
}

/** Whether OpenAI accepts the key (used before saving it). */
export async function checkKey(key: string, http: typeof fetch = fetch): Promise<void> {
  const res = await http(MODELS_URL, { headers: { authorization: `Bearer ${key.trim()}` } });
  if (!res.ok) throw new VoiceError(problem(res.status, await res.text()));
}

function problem(status: number, body: string): string {
  let msg = "";
  try {
    msg = JSON.parse(body).error?.message ?? "";
  } catch {
    // not JSON
  }
  if (status === 401) return "OpenAI didn't accept the key. Check it in Settings → Voice.";
  if (status === 429) return "OpenAI says the account is out of credit or over its rate limit.";
  return `OpenAI said ${status}${msg ? `: ${msg.slice(0, 200)}` : ""}`;
}
