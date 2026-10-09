import { useEffect, useState } from "react";
import { useApp } from "./App";
import { call } from "./api";
import { Button, Icon, Note } from "./ui";
import { keyKeeper } from "./platform";

/** What Edward can run on. A model on your own computer is planned (P). */
export type AiChoice = "chatgpt" | "apiKey" | "custom";

export const aiChoice = (state: { signedIn: boolean; apiKey: boolean; custom?: unknown }): AiChoice | null => (!state.signedIn ? null : state.custom ? "custom" : state.apiKey ? "apiKey" : "chatgpt");

/** What the two OpenAI choices mean, in the words the dialog and the first-run step share. */
export const AI_FACTS: Record<"chatgpt" | "apiKey", { name: string; facts: string[] }> = {
  chatgpt: {
    name: "ChatGPT plan",
    facts: ["Nothing extra to pay: it uses your plan's allowance", "Web search and pictures included", "Needs a plan that includes Codex"],
  },
  apiKey: {
    name: "OpenAI API key",
    facts: ["No ChatGPT plan needed", "You pay OpenAI for what Edward uses", "Web search works; pictures need a ChatGPT plan for now"],
  },
};

/** Services with a known address. Any other that speaks OpenAI's Responses format works with its own address. */
const SERVICES: { id: string; name: string; baseUrl: string; list?: { name: string; url: string }; example?: string; note?: string }[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    list: { name: "OpenRouter's model list", url: "https://openrouter.ai/models" },
    example: "qwen/qwen-plus",
    note: "Free ones end in :free, and some of those keep what you send.",
  },
  {
    id: "qwen",
    name: "Qwen (Alibaba Cloud)",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    list: { name: "Model Studio's model list", url: "https://www.alibabacloud.com/help/en/model-studio/models" },
    example: "qwen-plus",
  },
  { id: "other", name: "Other", baseUrl: "" },
];

const hostOf = (address: string) => {
  try {
    return new URL(address).host;
  } catch {
    return "";
  }
};

type Step = "choose" | "key" | "service";

/**
 * Settings → Change, and the first-run step: choose what Edward runs on (P). One at a time. Nothing
 * is switched until the new choice works: a wrong key, address or model leaves things as they were,
 * and so does closing the browser's ChatGPT sign-in.
 */
export function AiAccount({ start = "choose", onClose }: { start?: Step; onClose: () => void }) {
  const { state, refresh, toast, chat } = useApp();
  const current = aiChoice(state);
  const [step, setStep] = useState<Step>(start);
  const [pick, setPick] = useState<AiChoice>(current === "chatgpt" ? "apiKey" : "chatgpt");
  const [key, setKey] = useState("");
  const [service, setService] = useState("openrouter");
  const [address, setAddress] = useState("https://openrouter.ai/api/v1");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [busy, onClose]);

  /** `fresh`: the switch crosses between OpenAI and another service, which starts a new conversation. */
  const finish = async (work: Promise<{ ok: boolean; message: string }>, fresh: boolean) => {
    setBusy(true);
    setProblem("");
    const r = await work;
    setBusy(false);
    refresh();
    if (!r.ok) return setProblem(r.message);
    if (fresh) chat.reset([]);
    toast(r);
    onClose();
  };

  const choices: { id: AiChoice; sub: string; text: string; tag?: string }[] = [
    { id: "chatgpt", sub: current === "chatgpt" && state.email ? `Signed in as ${state.email}` : "Sign in with your browser", text: "Uses the allowance of the plan you already pay for. Web search and pictures included." },
    { id: "apiKey", sub: "No ChatGPT plan needed", text: "You pay OpenAI for what Edward uses. Web search works; pictures need a ChatGPT plan for now." },
    {
      id: "custom",
      tag: "Experimental",
      sub: current === "custom" && state.custom ? `${state.custom.model} on ${state.custom.host}` : "OpenRouter, Qwen on Alibaba Cloud, and others",
      text: "Claude, Qwen, Gemini and more, with the service's address and your key. What Edward sends goes to that service instead of OpenAI. No web search or pictures.",
    },
  ];
  const names: Record<AiChoice, string> = { ...{ chatgpt: AI_FACTS.chatgpt.name, apiKey: AI_FACTS.apiKey.name }, custom: "Another AI service" };
  const title = step === "choose" ? "What should Edward run on?" : step === "key" ? "Use an OpenAI API key" : "Use another AI service";
  const host = hostOf(address);
  const chosen = SERVICES.find((s) => s.id === service)!;
  const problemNote = problem && (
    <div role="alert">
      <Note tone="rose" icon="warn">
        {problem}
      </Note>
    </div>
  );
  const facts = (rows: [string, string, string][]) => (
    <div className="stack" style={{ gap: 12, padding: 16, borderRadius: 14, background: "var(--soft)" }}>
      <b>What changes</b>
      {rows.map(([icon, lead, rest]) => (
        <div className="row" key={lead} style={{ alignItems: "flex-start", gap: 12, fontSize: 13.5 }}>
          <Icon name={icon} size={18} width={1.8} color="var(--blue-ink)" />
          <span>
            <b>{lead}</b> {rest}
          </span>
        </div>
      ))}
    </div>
  );
  const back = (
    <Button onClick={() => (start === step ? onClose() : (setProblem(""), setStep("choose")))} disabled={busy}>
      {start === step ? "Cancel" : "Back"}
    </Button>
  );

  return (
    <div className="modal-back" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: 580, gap: 14, maxHeight: "100%", overflow: "auto" }}>
        {step === "choose" && (
          <>
            <div>
              <h2>{title}</h2>
              <p className="muted" style={{ fontSize: 14 }}>
                One at a time. Your memory, reminders and Google accounts stay as they are.
              </p>
            </div>
            <div role="radiogroup" aria-label="What Edward runs on" className="stack" style={{ gap: 10 }}>
              {choices.map((c) => (
                <button type="button" key={c.id} role="radio" aria-checked={pick === c.id} className="choice" disabled={busy} onClick={() => (setPick(c.id), setProblem(""))}>
                  <span className="dot" />
                  <span className="grow">
                    <span className="row" style={{ gap: 8 }}>
                      <b style={{ fontSize: 15 }}>{names[c.id]}</b>
                      {current === c.id && <span className="tag sage">In use</span>}
                      {c.tag && <span className="tag apricot">{c.tag}</span>}
                    </span>
                    <span className="muted" style={{ display: "block" }}>
                      {c.sub}
                    </span>
                    <span style={{ display: "block", marginTop: 6, fontSize: 13.5 }}>{c.text}</span>
                  </span>
                </button>
              ))}
              <button type="button" role="radio" aria-checked={false} className="choice" disabled>
                <span className="dot" />
                <span className="grow">
                  <span className="row" style={{ gap: 8 }}>
                    <b style={{ fontSize: 15, color: "var(--ink2)" }}>A model on your own computer</b>
                    <span className="tag">Not yet</span>
                  </span>
                  <span className="muted" style={{ display: "block", marginTop: 4, fontSize: 13.5 }}>
                    Ollama or LM Studio, here or on another computer of yours. Nothing is sent to a company. No web search or pictures.
                  </span>
                </span>
              </button>
            </div>
            {problemNote}
            <Note tone="sage" icon="shield">
              Whichever you choose, card and account numbers, passwords and ID numbers are removed before anything leaves this computer.
            </Note>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <Button onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              {pick === "chatgpt" ? (
                <Button kind="primary" icon="link" disabled={busy || current === "chatgpt"} onClick={() => void finish(call("signIn"), current === "custom")}>
                  {busy ? "Waiting for the browser…" : current === "chatgpt" ? "In use" : "Sign in with ChatGPT"}
                </Button>
              ) : (
                <Button kind="primary" onClick={() => (setProblem(""), setStep(pick === "apiKey" ? "key" : "service"))}>
                  {current === pick ? (pick === "apiKey" ? "Use another key" : "Change the service") : "Continue"}
                </Button>
              )}
            </div>
          </>
        )}
        {step === "key" && (
          <form
            className="stack"
            style={{ gap: 14 }}
            onSubmit={(e) => {
              e.preventDefault();
              // A key that didn't work stays in the field, to be corrected.
              void finish(call("aiUseKey", key), current === "custom");
            }}
          >
            <div>
              <h2>{title}</h2>
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
            {problemNote}
            {facts([
              ["bill", "OpenAI bills you for what Edward uses.", "Replies, and also the mail summary, bill scan and trips. Usage and cost are on your OpenAI account page."],
              ["image", "No pictures for now.", "Codex only makes them on a ChatGPT plan."],
              ["mic", "Voice uses this key too.", "There is no second key to enter."],
              ...(current === "chatgpt" ? ([["users", "You are signed out of ChatGPT in Edward.", "Switching back is one sign-in in your browser."]] as [string, string, string][]) : []),
            ])}
            <div className="row muted" style={{ alignItems: "flex-start" }}>
              <Icon name="lock" size={16} width={1.8} />
              <span>The key stays on this computer, {keyKeeper}. Edward's window doesn't keep it and the AI never sees it.</span>
            </div>
            <div className="between">
              {back}
              <Button kind="primary" type="submit" disabled={busy || !key.trim()}>
                {busy ? "Checking with OpenAI…" : "Check key and switch"}
              </Button>
            </div>
          </form>
        )}
        {step === "service" && (
          <form
            className="stack"
            style={{ gap: 14 }}
            onSubmit={(e) => {
              e.preventDefault();
              void finish(call("aiUseService", { baseUrl: address, model, key }), current !== "custom");
            }}
          >
            <div>
              <h2>{title}</h2>
              <p className="muted" style={{ fontSize: 14 }}>
                Any service that speaks OpenAI's Responses format. Edward tries it once before it switches.
              </p>
            </div>
            <div className="seg" role="group" aria-label="Service">
              {SERVICES.map((s) => (
                <button type="button" key={s.id} aria-pressed={service === s.id} disabled={busy} onClick={() => (setService(s.id), setAddress(s.baseUrl), setProblem(""))}>
                  {s.name}
                </button>
              ))}
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <label htmlFor="ai-address" style={{ fontWeight: 600 }}>
                Address
              </label>
              <input id="ai-address" className="input mono" spellCheck={false} placeholder="https://…/v1" value={address} disabled={busy} onChange={(e) => (setAddress(e.target.value), setProblem(""))} />
              {service === "qwen" && <span className="muted">This is the international address. In mainland China it is https://dashscope.aliyuncs.com/compatible-mode/v1.</span>}
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <label htmlFor="ai-model" style={{ fontWeight: 600 }}>
                Model
              </label>
              <input id="ai-model" className="input mono" spellCheck={false} value={model} disabled={busy} onChange={(e) => (setModel(e.target.value), setProblem(""))} />
              <span className="muted">
                {chosen.list ? (
                  <>
                    Copy a name from{" "}
                    <a href={chosen.list.url} target="_blank" rel="noreferrer noopener">
                      {chosen.list.name}
                    </a>
                    , like <span className="mono">{chosen.example}</span>.
                  </>
                ) : (
                  "The name the service lists for the model."
                )}{" "}
                {chosen.note} Pick one that can call tools: Edward's calendar, mail and reminders depend on it.
              </span>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <label htmlFor="ai-service-key" style={{ fontWeight: 600 }}>
                API key
              </label>
              <input id="ai-service-key" className="input mono" type="password" autoComplete="off" spellCheck={false} value={key} disabled={busy} onChange={(e) => (setKey(e.target.value), setProblem(""))} />
            </div>
            {problemNote}
            {facts([
              ["globe", `What Edward sends goes to ${host || "that service"}, not to OpenAI.`, "Your questions, and the mail and calendar entries Edward reads for you, after the privacy guard has taken out card and account numbers and passwords. Its terms apply, and it bills you."],
              ["search", "No web search and no pictures.", "Those are OpenAI's."],
              ["chat", "It starts a new conversation.", "Earlier ones stay in the list, to read."],
            ])}
            <div className="row muted" style={{ alignItems: "flex-start" }}>
              <Icon name="lock" size={16} width={1.8} />
              <span>The key stays on this computer, encrypted. Edward's window doesn't keep it and the AI never sees it.</span>
            </div>
            <div className="between">
              {back}
              <Button kind="primary" type="submit" disabled={busy || !key.trim() || !model.trim() || !address.trim()}>
                {busy ? `Trying ${host || "it"}…` : "Try it and switch"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
