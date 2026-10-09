import { useEffect, useState } from "react";
import type { Check, GoogleInfo, Settings } from "../../../shared/api";
import { useApp } from "../App";
import { call } from "../api";
import { art, Button, Card, Icon, Loading, Note, Segmented, Spot, Tag, Toggle } from "../ui";
import { backgroundTask } from "../platform";
import { AiAccount, AI_FACTS } from "../AiAccount";

const STEPS = [
  ["This computer", "Codex and what Edward needs"],
  ["The AI", "A ChatGPT plan or your own key"],
  ["Reminders in the background", "Also when Edward is closed"],
  ["Google", "Calendar and Gmail, optional"],
  ["Dates and currency", "How to read 10/12 and $"],
  ["Final check", "Everything tested once"],
] as const;

/** First run (and signing in again): welcome, six short steps, then "all set". */
export function Setup() {
  const { state, refresh, toast, go, route } = useApp();
  const [stage, setStage] = useState<"welcome" | number | "done">(state.firstRun ? "welcome" : 1);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [google, setGoogle] = useState<GoogleInfo>(state.google);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  /** The dialog for choosing the AI or entering a key (step 2). */
  const [ai, setAi] = useState<"choose" | "key" | "service" | null>(null);
  // "setup-3" jumps to a step (used by the screenshot checks).
  useEffect(() => {
    const m = /^setup-(\d|done)$/.exec(route.page);
    if (m) setStage(m[1] === "done" ? "done" : Number(m[1]));
  }, [route.page]);
  useEffect(() => {
    if (typeof stage === "number" && (stage === 0 || stage === 5)) {
      setChecks(null);
      void call("doctor").then(setChecks);
    }
    if (stage === 4 && state.signedIn) void call("settings").then(setSettings);
  }, [stage, state.signedIn]);

  if (stage === "welcome") {
    return (
      <div style={{ position: "relative", height: "100%", overflow: "hidden", background: "var(--bg)" }}>
        <img src={art("hero-welcome")} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "right center" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.78) 36%, rgba(255,255,255,0) 60%)" }} />
        <div style={{ position: "relative", height: "100%", width: "46%", minWidth: 520, padding: "56px 0 56px 72px", display: "flex", flexDirection: "column", gap: 22, justifyContent: "center" }}>
          <div className="row" style={{ gap: 12 }}>
            <img src="./icon.png" alt="" width={44} height={44} style={{ borderRadius: 13 }} />
            <div style={{ fontFamily: "var(--disp)", fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>Edward</div>
          </div>
          <h1 style={{ fontSize: 54, lineHeight: 1.02, letterSpacing: "-0.03em", textWrap: "balance" }}>Someone to keep an eye on things.</h1>
          <p className="pretty" style={{ fontSize: 17, color: "var(--ink2)", maxWidth: 440 }}>
            Edward watches your calendar, mail and bills, reminds you in time, and asks before it does anything on your behalf.
          </p>
          <div className="stack" style={{ gap: 14 }}>
            {[
              ["Choose the AI", "Your ChatGPT plan, or your own OpenAI API key"],
              ["Turn on reminders", "So they arrive even when Edward is closed"],
              ["Connect Google, if you like", "Calendar and Gmail, through your own Google Cloud project"],
            ].map(([t, s], i) => (
              <div className="row" key={t} style={{ alignItems: "flex-start", gap: 14 }}>
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, flexShrink: 0, borderRadius: "50%", background: "var(--blue-soft)", color: "var(--blue-ink)", fontWeight: 700, fontSize: 13 }}>{i + 1}</span>
                <div>
                  <b>{t}</b>
                  <div className="muted">{s}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="row" style={{ gap: 16 }}>
            <Button kind="primary" icon="right" onClick={() => setStage(0)} style={{ minHeight: 52, padding: "0 26px", fontSize: 16 }}>
              Get started
            </Button>
            <span className="muted">About ten minutes</span>
          </div>
        </div>
      </div>
    );
  }

  if (stage === "done") {
    return (
      <div className="stack" style={{ height: "100%", gap: 0, background: "var(--bg)" }}>
        <div style={{ position: "relative", height: 330, flexShrink: 0, overflow: "hidden" }}>
          <img src={art("hero-garden")} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 22%" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 55%, var(--bg) 100%)" }} />
          <div style={{ position: "relative", padding: "52px 72px" }}>
            <h1 style={{ fontSize: 54, letterSpacing: "-0.03em" }}>You're all set.</h1>
            <p style={{ fontSize: 17, marginTop: 8 }}>Edward is ready, and everything was tested once.</p>
          </div>
        </div>
        <div className="grid-2" style={{ flex: 1, padding: "0 72px 44px", marginTop: -40, position: "relative" }}>
          <Card className="pad stack">
            <h2>The final check</h2>
            {(checks ?? []).map((c) => (
              <div key={c.name} className="row" style={{ minHeight: 30 }}>
                <Icon name={c.status === "ok" ? "check" : "warn"} size={17} width={2.2} color={c.status === "ok" ? "var(--sage-ink)" : "var(--apricot-ink)"} />
                <b style={{ width: 130 }}>{c.name}</b>
                <span className="muted ellipsis">{c.detail}</span>
              </div>
            ))}
            <p className="muted" style={{ marginTop: "auto" }}>
              Run it again any time from Settings, Health check.
            </p>
          </Card>
          <Card className="pad stack">
            <h2>Just type. For example</h2>
            {["Remind me at 5pm to call the dentist", "What's on tomorrow?", "Any important mail today?", "What bills are due this month?"].map((t) => (
              <div key={t} style={{ alignSelf: "flex-start", padding: "10px 16px", border: "1px solid var(--line)", borderRadius: 999 }}>
                {t}
              </div>
            ))}
            <div className="between" style={{ marginTop: "auto" }}>
              <span className="muted pretty" style={{ maxWidth: 300 }}>
                Shift + Tab changes what Codex may do. It starts in Chat, the safe one.
              </span>
              <Button
                kind="primary"
                icon="right"
                style={{ minHeight: 52, padding: "0 26px", fontSize: 16 }}
                onClick={async () => {
                  await call("finishSetup");
                  go("today");
                  refresh();
                }}
              >
                Open Edward
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const step = stage;
  const next = () => setStage(step === 5 ? "done" : step + 1);
  const body = (() => {
    switch (step) {
      case 0: {
        const codex = checks?.find((c) => c.name === "Codex");
        const node = checks?.find((c) => c.name === "Node.js");
        return (
          <Section title="This computer" lead="Edward talks to the AI through Codex, the program OpenAI makes for this. It comes with Edward: there is nothing more to install.">
            {!checks ? (
              <Loading what="Looking" />
            ) : (
              <Card className="pad stack">
                {[codex, node].filter(Boolean).map((c) => (
                  <div className="row" key={c!.name}>
                    <Icon name={c!.status === "ok" ? "check" : "warn"} width={2.2} color={c!.status === "ok" ? "var(--sage-ink)" : "var(--apricot-ink)"} />
                    <b style={{ width: 90 }}>{c!.name}</b>
                    <span className="muted">{c!.detail}</span>
                  </div>
                ))}
                {/* Only a run from source has no Codex of its own (the installer brings one, D53). */}
                {codex?.status === "fail" && codex.detail.startsWith("not found") && <Note tone="apricot" icon="warn">Install Codex from openai.com/codex, then come back and press Check again.</Note>}
              </Card>
            )}
          </Section>
        );
      }
      case 1:
        return (
          <Section title="What should Edward run on?" lead="Edward needs an AI to think with. Use the ChatGPT plan you already have, or your own OpenAI API key. You can change this later in Settings.">
            {state.signedIn ? (
              <Card className="pad between">
                <div className="row">
                  <Icon name="check" width={2.2} color="var(--sage-ink)" />
                  <b>{state.custom ? `Edward runs on ${state.custom.name}` : state.apiKey ? "Edward runs on your OpenAI API key" : `Signed in to ChatGPT${state.email ? ` as ${state.email}` : ""}`}</b>
                </div>
                <Button small onClick={() => setAi("choose")}>
                  Change
                </Button>
              </Card>
            ) : (
              <div className="grid-2">
                {(["chatgpt", "apiKey"] as const).map((id) => (
                  <Card key={id} className="pad stack" style={id === "chatgpt" ? { borderColor: "var(--blue)", boxShadow: "0 0 0 1px var(--blue), var(--shadow)" } : undefined}>
                    <div className="row">
                      <h2>{AI_FACTS[id].name}</h2>
                      {id === "chatgpt" && <Tag tone="blue">Most people</Tag>}
                    </div>
                    {AI_FACTS[id].facts.map((f) => (
                      <div className="row" key={f} style={{ alignItems: "flex-start", fontSize: 13.5 }}>
                        <Icon name="check" size={16} width={2.2} color="var(--sage-ink)" />
                        <span>{f}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: "auto", paddingTop: 6 }}>
                      {id === "chatgpt" ? (
                        <Button
                          kind="primary"
                          icon="link"
                          wide
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            toast(await call("signIn"));
                            setBusy(false);
                            refresh();
                          }}
                        >
                          {busy ? "Waiting for the browser…" : "Sign in with ChatGPT"}
                        </Button>
                      ) : (
                        <Button icon="key" wide disabled={busy} onClick={() => setAi("key")}>
                          Use an API key
                        </Button>
                      )}
                    </div>
                    <span className="muted">{id === "chatgpt" ? "Your browser opens for the sign-in. Edward never sees your password." : "The key stays on this computer."}</span>
                  </Card>
                ))}
              </div>
            )}
            {!state.signedIn && (
              <div>
                <Button kind="ghost" small disabled={busy} onClick={() => setAi("service")}>
                  Another AI service: OpenRouter, Qwen and others
                </Button>
              </div>
            )}
            {ai && <AiAccount start={ai} onClose={() => setAi(null)} />}
          </Section>
        );
      case 2:
        return (
          <Section title="Reminders in the background" lead={`${backgroundTask} checks once a minute, so reminders, bill notices and the morning brief arrive even when Edward is closed.`}>
            <Card className="pad between">
              <div>
                <b>Reminders when Edward is closed</b>
                <div className="muted">You can turn this off later in Settings.</div>
              </div>
              <Toggle on={state.background} label="Reminders when Edward is closed" onChange={async (on) => (await call("updateSettings", { background: on }), refresh())} />
            </Card>
          </Section>
        );
      case 3:
        return (
          <Section title="Connect your Google account" lead="Optional. Your mail and calendar go from Google straight to this computer. You can add more accounts later in Settings.">
            <Card className="pad stack" style={{ gap: 16 }}>
              {google.connected && !google.expired ? (
                <div className="row">
                  <Icon name="check" width={2.2} color="var(--sage-ink)" />
                  <b>Connected as {google.email}</b>
                  <span className="muted">· more accounts can be added in Settings → Accounts</span>
                </div>
              ) : (
                <>
                  {!google.clientFile && (
                  <>
                  <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
                    <b style={{ color: "var(--blue)", fontSize: 18 }}>1</b>
                    <div className="stack grow" style={{ gap: 6 }}>
                      <b>Create your Google Cloud project</b>
                      <span className="muted">A step-by-step guide. About ten minutes; it costs nothing.</span>
                      <div>
                        <Button icon="link" onClick={() => void call("openGuide")}>
                          Open the guide
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
                    <b style={{ color: "var(--blue)", fontSize: 18 }}>2</b>
                    <div className="stack grow" style={{ gap: 6 }}>
                      <b>Choose the file you downloaded</b>
                      <div className="row">
                        <Button onClick={async () => (toast(await call("chooseGoogleClient")), setGoogle(await call("google")))}>{google.clientFile ? "Choose another" : "Choose the file"}</Button>
                        {google.clientFile && (
                          <Tag tone="sage" icon="check">
                            In place
                          </Tag>
                        )}
                      </div>
                    </div>
                  </div>
                  </>
                  )}
                  <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
                    {!google.clientFile && <b style={{ color: "var(--blue)", fontSize: 18 }}>3</b>}
                    <div className="stack grow" style={{ gap: 6 }}>
                      <b>Sign in with Google</b>
                      <span className="muted pretty">
                        Personal accounts only; work and school accounts are turned away. While Edward is in testing, Google says it hasn't verified the app: choose Advanced, then continue.
                      </span>
                      <div>
                        <Button
                          kind="primary"
                          icon="link"
                          disabled={!google.clientFile || busy}
                          onClick={async () => {
                            setBusy(true);
                            toast(await call("connectGoogle"));
                            setBusy(false);
                            setGoogle(await call("google"));
                            refresh();
                          }}
                        >
                          {busy ? "Waiting for the browser…" : "Sign in with Google"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </Card>
          </Section>
        );
      case 4:
        return (
          <Section title="Dates and currency" lead="So Edward reads 10/12 and bare amounts the way you mean them. Worked out from your system; change them if they're wrong.">
            {!settings ? (
              <Loading />
            ) : (
              <Card className="pad stack" style={{ gap: 16 }}>
                <Segmented
                  label="Date order"
                  value={settings.dateOrder}
                  onChange={async (v) => setSettings(await call("updateSettings", { dateOrder: v }))}
                  options={[
                    { value: "dmy", label: "Day / month / year" },
                    { value: "mdy", label: "Month / day / year" },
                  ]}
                />
                <div className="row">
                  <b>Currency</b>
                  <Tag>{settings.currency}</Tag>
                  <span className="muted">Change it later in Settings.</span>
                </div>
              </Card>
            )}
          </Section>
        );
      default:
        return (
          <Section title="Final check" lead="Edward tests each part once.">
            <Card style={{ padding: "6px 20px" }}>
              {!checks ? (
                <div style={{ padding: 16 }}>
                  <Loading what="Checking" />
                </div>
              ) : (
                checks.map((c) => (
                  <div key={c.name} className="row" style={{ minHeight: 44, borderTop: "1px solid var(--line)" }}>
                    <Icon name={c.status === "ok" ? "check" : "warn"} size={17} width={2.2} color={c.status === "ok" ? "var(--sage-ink)" : c.status === "warn" ? "var(--apricot-ink)" : "var(--rose-ink)"} />
                    <b style={{ width: 130 }}>{c.name}</b>
                    <span className="muted">{c.detail}</span>
                  </div>
                ))
              )}
            </Card>
          </Section>
        );
    }
  })();

  const canGo = step !== 1 || state.signedIn;
  return (
    <div className="app" style={{ backgroundImage: `url(${art("wash-blue")})` }}>
      <aside className="nav" aria-label="Setup steps" style={{ width: 340, padding: "32px 22px", gap: 6 }}>
        <div className="brand" style={{ paddingBottom: 18 }}>
          <img src="./icon.png" alt="" />
          <b>Setting up Edward</b>
        </div>
        {STEPS.map(([t, s], i) => {
          const state2 = i < step ? "done" : i === step ? "now" : "todo";
          return (
            <div key={t} className="row" style={{ alignItems: "flex-start", gap: 12, padding: "10px 12px", borderRadius: 14, background: state2 === "now" ? "var(--blue-soft)" : "transparent" }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, flexShrink: 0, borderRadius: "50%", background: state2 === "done" ? "var(--sage-soft)" : state2 === "now" ? "var(--blue)" : "var(--soft)", color: state2 === "done" ? "var(--sage-ink)" : state2 === "now" ? "#fff" : "var(--ink3)", fontWeight: 700, fontSize: 13 }}>
                {state2 === "done" ? <Icon name="check" size={15} width={2.4} /> : i + 1}
              </span>
              <div>
                <b style={{ color: state2 === "todo" ? "var(--ink2)" : undefined }}>{t}</b>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {s}
                </div>
              </div>
            </div>
          );
        })}
        <div style={{ marginTop: "auto", display: "flex", justifyContent: "center" }}>
          <Spot name="spot-key" size={140} alt="A brass key with a blank paper tag" />
        </div>
      </aside>
      <main className="main" style={{ padding: "44px 64px", gap: 22, overflow: "auto" }}>
        <div className="label">Step {step + 1} of 6</div>
        <div style={{ maxWidth: 760, width: "100%" }}>{body}</div>
        <div className="between" style={{ marginTop: "auto", maxWidth: 760 }}>
          <Button kind="ghost" icon="left" onClick={() => setStage(step === 0 ? "welcome" : step - 1)}>
            Back
          </Button>
          <div className="row">
            {step === 0 && (
              <Button icon="refresh" onClick={() => (setChecks(null), void call("doctor").then(setChecks))}>
                Check again
              </Button>
            )}
            {(step === 2 || step === 3) && <Button onClick={next}>Skip for now</Button>}
            <Button kind="primary" icon="right" onClick={next} disabled={!canGo}>
              Continue
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

function Section({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 38, letterSpacing: "-0.025em" }}>{title}</h1>
        <p className="pretty" style={{ fontSize: 16, color: "var(--ink2)", maxWidth: 640, marginTop: 6 }}>
          {lead}
        </p>
      </div>
      {children}
    </div>
  );
}

