/**
 * `jarvis setup` (P2): a step-by-step first-run wizard. Every step can be skipped and the wizard
 * can be run again at any time; steps that are already done just say so.
 *
 * The steps talk to the world through `SetupEnv`, so tests can walk every branch without Codex,
 * a browser or the scheduler.
 */
import type { Check } from "./doctor.js";
import type { DateOrder, Region } from "./region.js";

export interface SetupIO {
  say(line: string): void;
  /** One line from the user; null when input is closed (then the step is skipped, never assumed). */
  ask(question: string): Promise<string | null>;
}

export interface SetupEnv {
  node: string;
  codex(): Promise<Check>;
  /** The signed-in ChatGPT account's email ("" if unknown), or null when not signed in. */
  account(): Promise<string | null>;
  signIn(): Promise<void>;
  background: { supported: boolean; installed(): Promise<boolean>; install(): Promise<{ ok: boolean; message: string }> };
  google: {
    /** Where google-client.json has to go. */
    clientPath: string;
    hasClient(): boolean;
    /** Connected account's email, or null. */
    connected(): string | null;
    /** Features whose permission is missing ("calendar", "Gmail"). */
    missing(): string[];
    connect(): Promise<string>;
  };
  region: { current(): Region; set(r: Partial<Region>): void };
  doctor(): Promise<string[]>;
}

export const GUIDE = "docs/google-cloud-setup.md in the Jarvis repository";

const yes = (answer: string | null, fallback: boolean) => (answer === null ? false : answer.trim() === "" ? fallback : /^y(es)?$/i.test(answer.trim()));

export async function runSetup(io: SetupIO, env: SetupEnv): Promise<boolean> {
  const step = (n: number, title: string) => io.say(`\n${n}/6  ${title}`);
  const attempt = async (what: string, f: () => Promise<unknown>) => {
    try {
      await f();
      return true;
    } catch (e) {
      io.say(`  ${what} didn't work: ${e instanceof Error ? e.message : String(e)}`);
      io.say("  You can run `jarvis setup` again later.");
      return false;
    }
  };

  io.say("Jarvis setup — about 5 minutes. Press Enter to accept the suggestion in [brackets]; every step can be skipped.");

  step(1, "Node.js and Codex");
  if (Number(env.node.split(".")[0]) < 24) {
    io.say(`  Node.js ${env.node} is too old: Jarvis needs Node 24 or newer.`);
    return false;
  }
  io.say(`  Node.js ${env.node}`);
  const codex = await env.codex();
  io.say(`  Codex ${codex.detail}`);
  if (codex.status === "fail") return false;

  step(2, "ChatGPT sign-in");
  let account = await env.account();
  if (account === null) {
    io.say("  Jarvis uses your own ChatGPT account, through Codex. Signing in opens your browser.");
    if (yes(await io.ask("  Sign in now? [Y/n] "), true) && (await attempt("Signing in", env.signIn))) account = await env.account();
    if (account === null) {
      io.say("  Not signed in. Jarvis can't answer until you are; run `jarvis setup` again when ready.");
      return false;
    }
  }
  io.say(`  Signed in${account ? ` as ${account}` : ""}.`);

  step(3, "Background reminders");
  if (!env.background.supported) io.say("  Only available on Windows for now; reminders will appear while Jarvis is open.");
  else if (await env.background.installed()) io.say("  Already on.");
  else {
    io.say("  A small scheduled task checks once a minute, so reminders appear even when Jarvis is closed.");
    if (yes(await io.ask("  Turn it on? [Y/n] "), true)) {
      const r = await env.background.install();
      io.say(r.ok ? "  On." : `  Couldn't turn it on: ${r.message}. Try /background on later.`);
    } else io.say("  Skipped. /background on turns it on later.");
  }

  step(4, "Google account (optional): calendar and Gmail");
  const connected = env.google.connected();
  if (connected !== null && !env.google.missing().length) io.say(`  Connected${connected ? ` as ${connected}` : ""}.`);
  else if (!env.google.hasClient()) {
    io.say("  Google requires every app to be registered, so you need your own free Google Cloud project (about 15 minutes, no card).");
    io.say(`  Guide: ${GUIDE}`);
    io.say(`  Then save the downloaded file as: ${env.google.clientPath}`);
    io.say("  Skipped for now. Run `jarvis setup` again, or /connect google inside Jarvis, once the file is there.");
  } else {
    io.say(connected !== null ? `  Connected, but without permission for ${env.google.missing().join(" and ")}.` : "  Lets Jarvis read your calendar and mail, add events, and send drafts — each only after you approve.");
    if (yes(await io.ask("  Connect now? This opens your browser. [Y/n] "), true)) {
      await attempt("Connecting", async () => io.say(`  Connected as ${await env.google.connect()}.`));
    } else io.say("  Skipped. /connect google does it later.");
  }

  step(5, "Region");
  const r = env.region.current();
  const describe = (x: Region) => `numeric dates are ${x.dateOrder === "dmy" ? "day/month/year" : "month/day/year"}, amounts are in ${x.currency} unless stated`;
  io.say(`  Detected: ${describe(r)}.`);
  const keep = await io.ask("  Is that right? [Y/n] ");
  if (keep !== null && !yes(keep, true)) {
    const order = (await io.ask("  Date order — dmy or mdy: "))?.trim().toLowerCase();
    const currency = (await io.ask("  Currency code, e.g. USD, EUR, GBP: "))?.trim().toUpperCase();
    const next: Partial<Region> = {};
    if (order === "dmy" || order === "mdy") next.dateOrder = order as DateOrder;
    if (currency && /^[A-Z]{3}$/.test(currency)) next.currency = currency;
    if (Object.keys(next).length) {
      env.region.set(next);
      io.say(`  Saved: ${describe(env.region.current())}.`);
    } else io.say("  Nothing changed. /region changes it later.");
  }

  step(6, "Check");
  for (const line of await env.doctor()) io.say(`  ${line}`);
  io.say("\nDone. Start Jarvis by running:  jarvis");
  return true;
}

/** Shown once on the first start, and by /start. */
export const GETTING_STARTED = [
  "Getting started",
  "  Just type. Jarvis answers, searches the web, and makes images.",
  '  Try: "remind me at 5pm to call the dentist" · "what\'s on tomorrow?" · "any important mail today?"',
  "  /connect google   calendar and Gmail (needs your own Google Cloud project; `jarvis setup` walks you through it)",
  "  /background on    reminders even when Jarvis is closed",
  "  /mode             what Codex may do on this computer — Shift+Tab switches, the prompt always shows it",
  "  /doctor           check that everything works · /help lists every command",
  "  Privacy: account, card and ID numbers and passwords are removed before anything reaches the AI, and never stored.",
];
