/**
 * What voice costs on the user's OpenAI key (V). OpenAI reports the tokens each spoken reply used
 * (`response.done`) and how long each transcription was; Edward adds them up per day and prices
 * them with the table below. An estimate of Edward's own voice use, not the account's bill: that
 * needs an admin key, which Edward doesn't ask for. Only numbers are kept, never what was said.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { localDate, nextDate } from "../google/calendar.js";
import { memoryDbPath } from "../memory/store.js";

/** US dollars per 1M tokens, from openai.com/api/pricing (2026-10-05). */
export const PRICES: Record<string, { text: number; cachedText: number; textOut: number; audio: number; cachedAudio: number; audioOut: number }> = {
  "gpt-realtime-2.1-mini": { text: 0.6, cachedText: 0.06, textOut: 2.4, audio: 10, cachedAudio: 0.3, audioOut: 20 },
  "gpt-realtime-mini": { text: 0.6, cachedText: 0.06, textOut: 2.4, audio: 10, cachedAudio: 0.3, audioOut: 20 },
  "gpt-realtime-2.1": { text: 4, cachedText: 0.4, textOut: 24, audio: 32, cachedAudio: 0.4, audioOut: 64 },
};
/** Transcription (gpt-transcribe), per minute. */
export const TRANSCRIBE_PER_MIN = 0.0045;
/** An unknown model is priced like the dearest one: better to over- than under-state. */
const FALLBACK = PRICES["gpt-realtime-2.1"]!;

export interface Counts {
  textIn: number;
  cachedTextIn: number;
  audioIn: number;
  cachedAudioIn: number;
  textOut: number;
  audioOut: number;
  /** Seconds of speech transcribed. */
  transcribed: number;
}

const ZERO: Counts = { textIn: 0, cachedTextIn: 0, audioIn: 0, cachedAudioIn: 0, textOut: 0, audioOut: 0, transcribed: 0 };
const KEYS = Object.keys(ZERO) as (keyof Counts)[];
const COLUMN: Record<keyof Counts, string> = { textIn: "text_in", cachedTextIn: "cached_text_in", audioIn: "audio_in", cachedAudioIn: "cached_audio_in", textOut: "text_out", audioOut: "audio_out", transcribed: "transcribed_s" };

/** A count from the window: a whole, non-negative, plausible number, else 0. */
const n = (v: unknown, max = 10_000_000) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : 0);
const o = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Counts from a realtime `response.done` event's `response.usage`. Cached tokens are part of the input ones. */
export function fromResponseUsage(usage: unknown): Counts {
  const u = o(usage);
  const inp = o(u.input_token_details);
  const cached = o(inp.cached_tokens_details);
  const out = o(u.output_token_details);
  const cachedText = n(cached.text_tokens);
  const cachedAudio = n(cached.audio_tokens);
  return {
    ...ZERO,
    textIn: Math.max(0, n(inp.text_tokens) - cachedText),
    cachedTextIn: cachedText,
    audioIn: Math.max(0, n(inp.audio_tokens) - cachedAudio),
    cachedAudioIn: cachedAudio,
    textOut: n(out.text_tokens),
    audioOut: n(out.audio_tokens),
  };
}

/** Seconds from a transcription's `usage` ({ type: "duration", seconds }); token-billed transcriptions aren't counted. */
export function fromTranscriptionUsage(usage: unknown): Counts {
  const u = o(usage);
  return { ...ZERO, transcribed: u.type === "duration" ? n(u.seconds, 86_400) : 0 };
}

export function costOf(model: string, c: Counts): number {
  const p = PRICES[model] ?? FALLBACK;
  return (c.textIn * p.text + c.cachedTextIn * p.cachedText + c.audioIn * p.audio + c.cachedAudioIn * p.cachedAudio + c.textOut * p.textOut + c.audioOut * p.audioOut) / 1_000_000 + (c.transcribed / 60) * TRANSCRIBE_PER_MIN;
}

export class SpendStore {
  private db: DatabaseSync;

  constructor(path = memoryDbPath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS voice_spend (day TEXT NOT NULL, model TEXT NOT NULL, ${KEYS.map((k) => `${COLUMN[k]} INTEGER NOT NULL DEFAULT 0`).join(", ")}, PRIMARY KEY (day, model))`);
  }

  add(model: string, c: Counts, now = new Date()) {
    if (KEYS.every((k) => !c[k])) return;
    const cols = KEYS.map((k) => COLUMN[k]);
    this.db
      .prepare(`INSERT INTO voice_spend (day, model, ${cols.join(", ")}) VALUES (?, ?, ${cols.map(() => "?").join(", ")}) ON CONFLICT(day, model) DO UPDATE SET ${cols.map((c) => `${c} = ${c} + excluded.${c}`).join(", ")}`)
      .run(localDate(now), model.slice(0, 60), ...KEYS.map((k) => c[k]));
  }

  /** Estimated US dollars spent today and in the last 30 days (today included). */
  totals(now = new Date()): { today: number; last30: number } {
    const today = localDate(now);
    const from = nextDate(today, -29);
    const rows = this.db.prepare(`SELECT day, model, ${KEYS.map((k) => `${COLUMN[k]} AS ${k}`).join(", ")} FROM voice_spend WHERE day >= ? AND day <= ?`).all(from, today) as unknown as (Counts & { day: string; model: string })[];
    let t = 0;
    let all = 0;
    for (const r of rows) {
      const cost = costOf(r.model, r);
      all += cost;
      if (r.day === today) t += cost;
    }
    return { today: t, last30: all };
  }

  close() {
    this.db.close();
  }
}

/** "$0.42", "under 1¢", "$0.00" */
export function dollars(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return "under 1¢";
  return `$${usd.toFixed(2)}`;
}
