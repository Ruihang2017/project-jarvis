import { useEffect, useState } from "react";
import { useApp } from "./App";
import { call } from "./api";
import { Button, Icon, Note } from "./ui";
import { keyKeeper } from "./platform";

/** What Edward can run on today. A model on your own computer and other services are planned (P). */
export type AiChoice = "chatgpt" | "apiKey";

export const aiChoice = (state: { signedIn: boolean; apiKey: boolean }): AiChoice | null => (!state.signedIn ? null : state.apiKey ? "apiKey" : "chatgpt");

/** What each choice means, in the words the dialog and the first-run step share. */
export const AI_FACTS: Record<AiChoice, { name: string; facts: string[] }> = {
  chatgpt: {
    name: "ChatGPT plan",
    facts: ["Nothing extra to pay: it uses your plan's allowance", "Web search and pictures included", "Needs a plan that includes Codex"],
  },
  apiKey: {
    name: "OpenAI API key",
    facts: ["No ChatGPT plan needed", "You pay OpenAI for what Edward uses", "Web search works; pictures need a ChatGPT plan for now"],
  },
};

/**
 * Settings → Change, and "Use an API key" in the first-run step: choose what Edward runs on (P).
 * One at a time. Nothing is switched until the new sign-in works: a wrong key leaves things as
 * they were, and so does closing the browser's ChatGPT sign-in.
 */
export function AiAccount({ start = "choose", onClose }: { start?: "choose" | "key"; onClose: () => void }) {
  const { state, refresh, toast } = useApp();
  const current = aiChoice(state);
  const [step, setStep] = useState(start);
  const [pick, setPick] = useState<AiChoice>(current === "chatgpt" ? "apiKey" : "chatgpt");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [busy, onClose]);

  const finish = async (work: Promise<{ ok: boolean; message: string }>) => {
    setBusy(true);
    setProblem("");
    const r = await work;
    setBusy(false);
    refresh();
    if (!r.ok) return setProblem(r.message);
    toast(r);
    onClose();
  };

  const choices: { id: AiChoice; sub: string; text: string }[] = [
    { id: "chatgpt", sub: current === "chatgpt" && state.email ? `Signed in as ${state.email}` : "Sign in with your browser", text: "Uses the allowance of the plan you already pay for. Web search and pictures included." },
    { id: "apiKey", sub: "No ChatGPT plan needed", text: "You pay OpenAI for what Edward uses. Web search works; pictures need a ChatGPT plan for now." },
  ];
  const later = [
    { name: "A model on your own computer", text: "Ollama or LM Studio, here or on another computer of yours. Nothing is sent to a company. No web search or pictures." },
    { name: "Another AI service", text: "Claude, Qwen and others, with their address and your key." },
  ];

  return (
    <div className="modal-back" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={step === "choose" ? "What should Edward run on?" : "Use an OpenAI API key"} style={{ maxWidth: 580, gap: 14, maxHeight: "100%", overflow: "auto" }}>
        {step === "choose" ? (
          <>
            <div>
              <h2>What should Edward run on?</h2>
              <p className="muted" style={{ fontSize: 14 }}>
                One at a time. Your conversations, memory, reminders and Google accounts stay as they are.
              </p>
            </div>
            <div role="radiogroup" aria-label="What Edward runs on" className="stack" style={{ gap: 10 }}>
              {choices.map((c) => (
                <button type="button" key={c.id} role="radio" aria-checked={pick === c.id} className="choice" disabled={busy} onClick={() => (setPick(c.id), setProblem(""))}>
                  <span className="dot" />
                  <span className="grow">
                    <span className="row" style={{ gap: 8 }}>
                      <b style={{ fontSize: 15 }}>{AI_FACTS[c.id].name}</b>
                      {current === c.id && <span className="tag sage">In use</span>}
                    </span>
                    <span className="muted" style={{ display: "block" }}>
                      {c.sub}
                    </span>
                    <span style={{ display: "block", marginTop: 6, fontSize: 13.5 }}>{c.text}</span>
                  </span>
                </button>
              ))}
              {later.map((l) => (
                <button type="button" key={l.name} role="radio" aria-checked={false} className="choice" disabled>
                  <span className="dot" />
                  <span className="grow">
                    <span className="row" style={{ gap: 8 }}>
                      <b style={{ fontSize: 15, color: "var(--ink2)" }}>{l.name}</b>
                      <span className="tag">Not yet</span>
                    </span>
                    <span className="muted" style={{ display: "block", marginTop: 4, fontSize: 13.5 }}>
                      {l.text}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {problem && (
              <div role="alert">
                <Note tone="rose" icon="warn">
                  {problem}
                </Note>
              </div>
            )}
            <Note tone="sage" icon="shield">
              Whichever you choose, card and account numbers, passwords and ID numbers are removed before anything leaves this computer.
            </Note>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <Button onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              {pick === "apiKey" ? (
                <Button kind="primary" onClick={() => (setProblem(""), setStep("key"))}>
                  {current === "apiKey" ? "Use another key" : "Continue"}
                </Button>
              ) : (
                <Button kind="primary" icon="link" disabled={busy || current === "chatgpt"} onClick={() => void finish(call("signIn"))}>
                  {busy ? "Waiting for the browser…" : current === "chatgpt" ? "In use" : "Sign in with ChatGPT"}
                </Button>
              )}
            </div>
          </>
        ) : (
          <form
            className="stack"
            style={{ gap: 14 }}
            onSubmit={(e) => {
              e.preventDefault();
              // A key that didn't work stays in the field, to be corrected.
              void finish(call("aiUseKey", key));
            }}
          >
            <div>
              <h2>Use an OpenAI API key</h2>
              <p className="muted" style={{ fontSize: 14 }}>
                Edward asks OpenAI about the key once before it switches.
              </p>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <label htmlFor="ai-key" style={{ fontWeight: 600 }}>
                API key
              </label>
              <input id="ai-key" className="input mono" type="password" autoComplete="off" spellCheck={false} autoFocus placeholder="sk-…" value={key} disabled={busy} onChange={(e) => (setKey(e.target.value), setProblem(""))} />
              <span className="muted">It starts with sk-. Make one at platform.openai.com under API keys, and give its project a monthly budget.</span>
            </div>
            {problem && (
              <div role="alert">
                <Note tone="rose" icon="warn">
                  {problem}
                </Note>
              </div>
            )}
            <div className="stack" style={{ gap: 12, padding: 16, borderRadius: 14, background: "var(--soft)" }}>
              <b>What changes</b>
              {(
                [
                  ["bill", "OpenAI bills you for what Edward uses.", "Replies, and also the mail summary, bill scan and trips. Usage and cost are on your OpenAI account page."],
                  ["image", "No pictures for now.", "Codex only makes them on a ChatGPT plan."],
                  ["mic", "Voice uses this key too.", "There is no second key to enter."],
                  ...(current === "chatgpt" ? [["users", "You are signed out of ChatGPT in Edward.", "Switching back is one sign-in in your browser."]] : []),
                ] as [string, string, string][]
              ).map(([icon, lead, rest]) => (
                <div className="row" key={lead} style={{ alignItems: "flex-start", gap: 12, fontSize: 13.5 }}>
                  <Icon name={icon} size={18} width={1.8} color="var(--blue-ink)" />
                  <span>
                    <b>{lead}</b> {rest}
                  </span>
                </div>
              ))}
            </div>
            <div className="row muted" style={{ alignItems: "flex-start" }}>
              <Icon name="lock" size={16} width={1.8} />
              <span>The key stays on this computer, {keyKeeper}. Edward's window doesn't keep it and the AI never sees it.</span>
            </div>
            <div className="between">
              <Button onClick={() => (start === "key" ? onClose() : (setProblem(""), setStep("choose")))} disabled={busy}>
                {start === "key" ? "Cancel" : "Back"}
              </Button>
              <Button kind="primary" type="submit" disabled={busy || !key.trim()}>
                {busy ? "Checking with OpenAI…" : "Check key and switch"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
