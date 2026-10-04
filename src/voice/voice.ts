/**
 * Voice (V, D39): the user's OpenAI API key and how replies are read aloud. The realtime model
 * (gpt-realtime mini) only hears and speaks: what the user says is transcribed and goes into the
 * normal conversation through the privacy guard, and Edward's reply is read out. Spoken audio itself
 * can't be checked by the guard; the app says so before voice starts.
 *
 * The key is a credential for Edward itself (like the Google token): encrypted with DPAPI, never
 * logged, never shown again, never sent to Codex.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { protect, unprotect } from "../google/dpapi.js";
import { appDataDir } from "../settings.js";

export const VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"] as const;
export type Voice = (typeof VOICES)[number];
export const DEFAULT_VOICE: Voice = "marin";
/** The user chose the realtime "mini" (D39): same price as the older mini, newer. */
export const DEFAULT_MODEL = "gpt-realtime-2.1-mini";
export const TRANSCRIBE_MODEL = "gpt-transcribe";

export const keyPath = () => join(appDataDir(), "openai-key.bin");
export const hasVoiceKey = () => existsSync(keyPath());

/** An OpenAI API key, roughly: "sk-…" with no spaces. */
export const looksLikeKey = (k: string) => /^sk-[A-Za-z0-9_-]{20,}$/.test(k.trim());

export async function saveVoiceKey(key: string): Promise<void> {
  if (!looksLikeKey(key)) throw new Error("That doesn't look like an OpenAI API key (it starts with sk-).");
  mkdirSync(appDataDir(), { recursive: true });
  writeFileSync(keyPath(), await protect(key.trim()));
}

export async function loadVoiceKey(): Promise<string | null> {
  return hasVoiceKey() ? unprotect(readFileSync(keyPath())) : null;
}

export function removeVoiceKey(): void {
  rmSync(keyPath(), { force: true });
}

/** What the realtime session is told: it is only Edward's voice, never the one who answers. */
export const VOICE_INSTRUCTIONS =
  "You are only the voice of Edward, a personal assistant. You never answer, comment or add anything yourself. " +
  "When asked to say a text, read it aloud exactly as written, naturally, in the language it is written in.";

/** The session for a voice call: hears and transcribes, but never replies on its own. */
export function sessionConfig(o: { voice?: string; model?: string } = {}) {
  const voice = (VOICES as readonly string[]).includes(o.voice ?? "") ? o.voice : DEFAULT_VOICE;
  return {
    type: "realtime",
    model: o.model || DEFAULT_MODEL,
    instructions: VOICE_INSTRUCTIONS,
    output_modalities: ["audio"],
    audio: {
      input: {
        transcription: { model: TRANSCRIBE_MODEL },
        // It detects when the user stops talking, but doesn't answer: Edward does.
        turn_detection: { type: "server_vad", create_response: false, interrupt_response: true },
      },
      output: { voice },
    },
  };
}

const SPOKEN_LIMIT = 1200;

/**
 * A reply as something to say: no Markdown, no links or code, not too long. Long replies are cut
 * with a pointer to the screen.
 */
export function speakable(markdown: string): string {
  let t = markdown
    .replace(/```[\s\S]*?```/g, " (code on screen) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "(link on screen)")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (t.length > SPOKEN_LIMIT) {
    const cut = t.slice(0, SPOKEN_LIMIT);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("。"), cut.lastIndexOf("\n"));
    t = `${cut.slice(0, end > 200 ? end + 1 : SPOKEN_LIMIT).trim()} The rest is on the screen.`;
  }
  return t;
}

/** The data-channel event that has the realtime model say `text`, outside the conversation. */
export function sayEvent(text: string) {
  return {
    type: "response.create",
    response: {
      conversation: "none",
      input: [],
      output_modalities: ["audio"],
      instructions: `Say exactly this, and nothing else:\n\n${text}`,
    },
  };
}
