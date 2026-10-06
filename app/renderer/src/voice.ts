/**
 * A voice call with the realtime model (V). The microphone and the speaker stay here; the main
 * process answers the WebRTC offer (it holds the API key). The model only hears and speaks: each
 * finished sentence of the user's is handed to Edward as if typed, and Edward's reply comes back
 * to be read aloud.
 */
import { call } from "./api";
import { microphoneSettings } from "./platform";

export type VoicePhase = "connecting" | "listening" | "hearing" | "thinking" | "speaking" | "off";

/** Stops the call after this long with nobody talking (the session costs while it is open). */
const IDLE_MS = 5 * 60_000;

type VoiceEvent = { type: string; transcript?: string; error?: { message?: string }; usage?: unknown; response?: { usage?: unknown } };

export class VoiceCall {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private queued: string[] = [];
  phase: VoicePhase = "off";

  constructor(
    private readonly on: {
      phase: (p: VoicePhase) => void;
      heard: (text: string) => void;
      problem: (message: string) => void;
    },
  ) {}

  private set(p: VoicePhase) {
    this.phase = p;
    this.on.phase(p);
  }

  private poke() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      this.on.problem("Voice stopped after five quiet minutes.");
      this.stop();
    }, IDLE_MS);
  }

  async start(): Promise<void> {
    if (this.pc) return;
    this.set("connecting");
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const pc = (this.pc = new RTCPeerConnection());
      this.audio = new Audio();
      this.audio.autoplay = true;
      pc.ontrack = (e) => {
        if (this.audio) this.audio.srcObject = e.streams[0] ?? null;
      };
      for (const t of this.mic.getTracks()) pc.addTrack(t, this.mic);
      const dc = (this.dc = pc.createDataChannel("oai-events"));
      dc.onopen = () => {
        this.set("listening");
        this.poke();
        for (const t of this.queued.splice(0)) this.say(t);
      };
      dc.onmessage = (m) => this.event(JSON.parse(String(m.data)) as VoiceEvent);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          if (this.phase !== "off") this.on.problem("The voice connection dropped.");
          this.stop();
        }
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const r = await call("voiceConnect", offer.sdp ?? "");
      if (!r.ok || !r.sdp) throw new Error(r.message || "Couldn't start voice.");
      await pc.setRemoteDescription({ type: "answer", sdp: r.sdp });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.on.problem(/Permission|NotAllowed/i.test(msg) ? `Edward can't use the microphone. Check ${microphoneSettings}.` : msg);
      this.stop();
    }
  }

  private event(e: VoiceEvent) {
    switch (e.type) {
      // What it cost: kept as numbers for the estimate in Settings → Voice.
      case "response.done":
        if (e.response?.usage) void call("voiceUsage", { kind: "response", usage: e.response.usage }).catch(() => {});
        break;
      case "input_audio_buffer.speech_started":
        this.poke();
        // Talking over Edward stops it (the session also cancels its answer).
        if (this.phase === "speaking") this.send({ type: "output_audio_buffer.clear" });
        this.set("hearing");
        break;
      case "conversation.item.input_audio_transcription.completed": {
        if (e.usage) void call("voiceUsage", { kind: "transcription", usage: e.usage }).catch(() => {});
        const text = (e.transcript ?? "").trim();
        if (text) {
          this.set("thinking");
          this.on.heard(text);
        } else this.set("listening");
        break;
      }
      case "output_audio_buffer.started":
      case "response.output_audio.delta":
        if (this.phase !== "speaking") this.set("speaking");
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        if (this.phase === "speaking") this.set("listening");
        this.poke();
        break;
      case "error":
        if (e.error?.message) this.on.problem(e.error.message);
        break;
    }
  }

  private send(event: object) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(event));
  }

  /** Reads `text` aloud (Edward's reply). */
  say(text: string) {
    if (!text.trim() || this.phase === "off") return;
    if (this.dc?.readyState !== "open") {
      this.queued.push(text);
      return;
    }
    this.send({ type: "response.create", response: { conversation: "none", input: [], output_modalities: ["audio"], instructions: `Say exactly this, and nothing else:\n\n${text}` } });
    this.set("speaking");
  }

  stop() {
    clearTimeout(this.idle);
    this.queued = [];
    this.dc?.close();
    this.pc?.close();
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    if (this.audio) this.audio.srcObject = null;
    this.dc = null;
    this.pc = null;
    this.mic = null;
    this.audio = null;
    if (this.phase !== "off") this.set("off");
  }
}
