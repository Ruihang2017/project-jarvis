import { useEffect, useMemo, useRef, useState } from "react";
import type { Ask, Attachment, ChatEntry, ThreadInfo } from "../../../shared/api";
import { useApp, Shell } from "../App";
import { call, useData } from "../api";
import { Markdown } from "../markdown";
import { Button, Card, Icon, IconButton, Loading, Spot, Tag } from "../ui";

const GROUPS: [string, [string, string][]][] = [
  ["Conversation", [["/new", "Start a new conversation"], ["/resume", "Continue an earlier one"], ["/mode", "What Codex may do here"], ["/settings", "Model, effort and limits"]]],
  ["What Edward looks after", [["/brief", "Today at a glance"], ["/calendar", "Your calendar"], ["/mail", "Unread mail"], ["/bills", "Bills found in your email"], ["/remind", "Reminders"], ["/lists", "Shopping list, home jobs, to-dos"], ["/memory", "What Edward remembers"], ["/images", "Pictures Edward made"]]],
  ["Setup and care", [["/google", "Google connection"], ["/region", "Dates and currency"], ["/web", "Web search on or off"], ["/background", "Reminders when closed"], ["/data", "Back up and export"], ["/doctor", "Check everything works"]]],
];
const CYCLE = ["chat", "manual", "semi-auto"] as const;

/** The message box: Enter sends, Shift+Enter is a new line, / lists commands, Shift+Tab changes mode. */
export function Composer({ onSent, placeholder = "Ask Edward, or type / for commands", palette: forcePalette }: { onSent?: () => void; placeholder?: string; palette?: boolean }) {
  const { state, chat, setMode, refresh, voice } = useApp();
  const [text, setText] = useState(forcePalette ? "/" : "");
  const [attached, setAttached] = useState<Attachment[]>(state.attachments);
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setAttached(state.attachments);
  }, [state.attachments]);
  useEffect(() => {
    if (forcePalette) box.current?.focus();
  }, [forcePalette]);
  const showPalette = text.startsWith("/") && !text.includes(" ");
  const matches = useMemo(() => GROUPS.flatMap(([, items]) => items).filter(([c]) => c.startsWith(text.trim() || "/")), [text]);
  useEffect(() => {
    setSel(0);
  }, [text]);
  const grow = () => {
    const t = box.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 180)}px`;
  };
  useEffect(grow, [text]);

  const submit = (value = text) => {
    const v = value.trim();
    if (!v || (chat.busy && !v.startsWith("/"))) return;
    chat.send(v);
    setText("");
    setAttached([]);
    if (!v.startsWith("/")) onSent?.();
    setTimeout(refresh, 300);
  };

  return (
    <div className="composer">
      {showPalette && matches.length > 0 && (
        <div className="palette" role="listbox" aria-label="Commands">
          {GROUPS.map(([name, items]) => {
            const shown = items.filter(([c]) => matches.some(([m]) => m === c));
            if (!shown.length) return <div key={name} />;
            return (
              <div key={name} className="stack" style={{ gap: 2 }}>
                <div className="label" style={{ padding: "0 10px 6px" }}>
                  {name}
                </div>
                {shown.map(([cmd, what]) => (
                  <button type="button" role="option" key={cmd} aria-selected={matches[sel]?.[0] === cmd} onMouseDown={(e) => (e.preventDefault(), submit(cmd))}>
                    <span className="cmd">{cmd}</span>
                    <span className="what">{what}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {attached.length > 0 && (
        <div className="attached">
          {attached.map((a) => (
            <div className="chip-img" key={a.path}>
              <img src={a.url} alt="" />
              <span className="ellipsis" style={{ maxWidth: 160 }}>
                {a.name}
              </span>
              <button type="button" className="icon-btn" style={{ width: 32, height: 32 }} aria-label={`Remove ${a.name}`} onClick={() => void call("removeAttachment", a.path).then(setAttached)}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          <Tag tone="apricot" icon="warn">
            Pictures aren't checked by the privacy guard
          </Tag>
        </div>
      )}
      <div className="row" style={{ gap: 6, alignItems: "flex-end" }}>
        <label htmlFor="message" className="sr">
          Message
        </label>
        <textarea
          id="message"
          ref={box}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if ([...e.clipboardData.items].some((i) => i.type.startsWith("image/"))) {
              e.preventDefault();
              void call("attachClipboard").then(setAttached);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Tab" && e.shiftKey) {
              e.preventDefault();
              if (chat.busy) return;
              const i = CYCLE.indexOf(state.mode as (typeof CYCLE)[number]);
              setMode(CYCLE[(i + 1) % CYCLE.length]!);
              return;
            }
            if (showPalette && matches.length) {
              if (e.key === "ArrowDown") return e.preventDefault(), setSel((sel + 1) % matches.length);
              if (e.key === "ArrowUp") return e.preventDefault(), setSel((sel - 1 + matches.length) % matches.length);
              if (e.key === "Enter") return e.preventDefault(), submit(matches[sel]![0]);
              if (e.key === "Escape") return setText("");
            }
            if (e.key === "Escape" && chat.busy) return void call("interrupt");
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <IconButton icon="clip" label="Attach a picture" onClick={() => void call("attachFiles").then(setAttached)} />
        <IconButton
          icon="mic"
          label={voice.phase === "off" ? "Talk to Edward (voice)" : "Stop voice"}
          aria-pressed={voice.phase !== "off"}
          onClick={() => (voice.phase === "off" ? voice.start() : voice.stop())}
          style={voice.phase !== "off" ? { background: "var(--blue)", color: "#fff" } : undefined}
        />
        {chat.busy ? (
          <button type="button" className="send stop" aria-label="Stop the reply" title="Stop (Esc)" onClick={() => void call("interrupt")}>
            <Icon name="stop" size={16} />
          </button>
        ) : (
          <button type="button" className="send" aria-label="Send" onClick={() => submit()} disabled={!text.trim()}>
            <Icon name="send" size={18} />
          </button>
        )}
      </div>
      {forcePalette && (
        <div className="row muted" style={{ justifyContent: "center", gap: 18, fontSize: 12.5, paddingBottom: 4 }}>
          <span>Up and Down to choose</span>
          <span>Enter to run</span>
          <span>Shift + Tab changes mode</span>
          <span>Esc stops a reply</span>
        </div>
      )}
    </div>
  );
}

export function Chat({ palette }: { palette?: boolean }) {
  const { chat, go, state } = useApp();
  const end = useRef<HTMLDivElement>(null);
  // Braces matter: Chromium's scrollIntoView returns a Promise, and React would call an effect's
  // return value as its cleanup ("destroy_ is not a function").
  useEffect(() => {
    void end.current?.scrollIntoView({ block: "end" });
  }, [chat.entries, chat.asks, chat.busy]);
  const title = useMemo(() => {
    const first = chat.entries.find((e) => e.kind === "user");
    return first && first.kind === "user" ? unmark(first.text.split("\n")[0]!).slice(0, 70) : "New conversation";
  }, [chat.entries]);
  const empty = chat.entries.length === 0 && !chat.busy;
  return (
    <Shell
      title={title}
      fixed
      actions={
        <>
          <IconButton icon="history" label="Earlier conversations" onClick={() => go("history")} />
          <Button icon="plus" onClick={() => void call("newConversation").then(() => chat.reset([]))} disabled={chat.busy}>
            New
          </Button>
        </>
      }
    >
      <div className="chat">
        <div className="chat-scroll">
          <div className="chat-col">
            {state.mode !== "chat" && (
              <div className="note apricot">
                <Icon name="warn" size={18} width={2} />
                <div className="grow">
                  <b>{state.mode === "auto" ? "Auto" : state.mode === "manual" ? "Manual" : "Semi-auto"} mode.</b> Codex can read files and run commands itself here, and what it reads that way doesn't pass the privacy guard.
                </div>
                <button type="button" className="btn ghost small" onClick={() => void call("setMode", "chat")} style={{ color: "var(--apricot-ink)" }}>
                  Back to Chat mode
                </button>
              </div>
            )}
            {empty ? (
              <div className="empty" style={{ flex: 1, minHeight: 320 }}>
                <Spot name="spot-bell" size={190} alt="A small brass bell beside a cup of tea" />
                <div style={{ fontFamily: "var(--disp)", fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--ink)" }}>What can I do for you?</div>
                <p className="pretty" style={{ maxWidth: 460, fontSize: 15 }}>
                  Just type. Edward answers, looks things up, keeps track of your day, and makes pictures.
                </p>
              </div>
            ) : (
              chat.entries.map((e) => <Entry key={e.id} e={e} />)
            )}
            {chat.asks.map((a) => (
              <AskCard key={a.id} ask={a} />
            ))}
            {chat.busy && chat.asks.length === 0 && (
              <div className="thinking">
                <span className="dots">
                  <i />
                  <i />
                  <i />
                </span>
                {chat.label || "Thinking…"}
              </div>
            )}
            <div ref={end} />
          </div>
        </div>
        <Composer palette={palette} />
      </div>
    </Shell>
  );
}

function Entry({ e }: { e: ChatEntry }) {
  switch (e.kind) {
    case "user":
      return (
        <>
          {e.images.length > 0 && (
            <div className="bubble-imgs">
              {e.images.map((i) => (
                <img key={i.path} src={i.url} alt={i.name} />
              ))}
            </div>
          )}
          {e.text && <div className="bubble">{withRemoved(e.text)}</div>}
        </>
      );
    case "assistant":
      return (
        <div className="reply">
          <img src="./icon.png" alt="" />
          <div className="md">
            <Markdown text={e.text} />
            {e.streaming && <span className="caret" />}
          </div>
        </div>
      );
    case "activity":
      return (
        <div className="activity">
          <Icon name={e.icon} size={15} color="var(--ink3)" />
          <div className="grow">
            <div>{e.text}</div>
            {e.detail && <div className="detail">{e.detail.join("\n")}</div>}
          </div>
        </div>
      );
    case "image":
      return (
        <div className="picture">
          <div className="frame">
            <img src={e.url} alt={e.revised ?? e.prompt} />
          </div>
          <div className="row">
            <Button icon="eye" onClick={() => void call("pictureAction", e.path, "open")}>
              Open
            </Button>
            <Button icon="copy" onClick={() => void call("pictureAction", e.path, "copy")}>
              Copy
            </Button>
            <Button icon="folder" onClick={() => void call("pictureAction", e.path, "folder")}>
              Show in folder
            </Button>
          </div>
        </div>
      );
    case "notice":
      return (
        <div className={`notice-line ${e.tone}`}>
          <Icon name={e.tone === "guard" ? "shield" : e.tone === "info" ? "bell" : "warn"} size={14} width={2} />
          {e.text}
        </div>
      );
  }
}

/** "[removed: card number]" from the privacy guard, drawn as a chip. */
function withRemoved(text: string) {
  return text.split(/(\[removed: [^\]]+\])/).map((part, i) => {
    const m = /^\[removed: ([^\]]+)\]$/.exec(part);
    return m ? (
      <span key={i} className="removed-chip">
        <Icon name="lock" size={12} width={2} />
        {m[1]} removed
      </span>
    ) : (
      part
    );
  });
}

function AskCard({ ask }: { ask: Ask }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const answer = (decision: "accept" | "acceptForSession" | "decline" | "cancel") => void call("answer", ask.id, { decision });
  const risky = ask.kind === "command" || ask.kind === "file" || ask.kind === "permissions";
  const sending = /send this email/i.test(ask.title);
  return (
    <section className={`ask ${risky ? "risky" : ""}`} aria-label={ask.title}>
      <div className="between">
        <div className="row">
          <Icon name={ask.kind === "command" ? "terminal" : ask.kind === "file" ? "file" : ask.kind === "question" ? "chat" : "shield"} size={18} color="var(--ink2)" />
          <h3 style={{ fontSize: 17 }}>{ask.title}</h3>
        </div>
        {ask.kind === "tool" && <Tag tone="blue">Edward asks every time</Tag>}
      </div>
      {ask.summary && <p className="pretty" style={{ whiteSpace: "pre-wrap" }}>{ask.summary}</p>}
      {ask.preview && <pre className={ask.kind === "command" ? "code" : ""}>{ask.preview}</pre>}
      {ask.questions?.map((q) => (
        <fieldset key={q.id} className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>{q.question}</legend>
          {q.options.length ? (
            <div className="row" style={{ flexWrap: "wrap" }}>
              {q.options.map((o) => (
                <button type="button" key={o} className="pill" aria-pressed={answers[q.id] === o} onClick={() => setAnswers({ ...answers, [q.id]: o })}>
                  {o}
                </button>
              ))}
            </div>
          ) : (
            <input className="input" aria-label={q.question} value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
          )}
        </fieldset>
      ))}
      <div className="row" style={{ flexWrap: "wrap" }}>
        {ask.kind === "question" ? (
          <>
            <Button kind="primary" onClick={() => void call("answer", ask.id, { answers })}>
              Send
            </Button>
            <Button kind="ghost" onClick={() => answer("cancel")}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button kind="primary" icon={sending ? "send" : "check"} onClick={() => answer("accept")}>
              {sending ? "Send" : ask.kind === "tool" ? "Yes" : "Allow once"}
            </Button>
            {(ask.kind !== "tool" || ask.allowAlways) && (
              <Button onClick={() => answer("acceptForSession")}>{ask.kind === "tool" ? "Always, until Edward closes" : "Always allow, until Edward closes"}</Button>
            )}
            <Button kind="ghost" onClick={() => answer("decline")}>
              {sending ? "Don't send" : "No"}
            </Button>
            {ask.kind !== "tool" && (
              <Button kind="ghost" onClick={() => answer("cancel")}>
                Stop the reply
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** Plain-text form of the guard's markers, for titles and previews. */
const unmark = (s: string) => s.replace(/\[removed: ([^\]]+)\]/g, "($1 removed)");

export function History() {
  const { go, chat, toast } = useApp();
  const { data, error } = useData(() => call("conversations"));
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<ThreadInfo | null>(null);
  const list = (data ?? []).filter((t) => !q || `${t.title} ${t.preview}`.toLowerCase().includes(q.toLowerCase()));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPicked((p) => p ?? list[0] ?? null);
  }, [data]);
  const open = async (t: ThreadInfo) => {
    try {
      chat.reset(await call("openConversation", t.id));
      go("chat");
    } catch (e) {
      toast({ ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  };
  const groups = groupByDay(list);
  return (
    <Shell
      title="Conversations"
      sub="Pick one to carry on where you left off"
      fixed
      actions={
        <Button kind="primary" icon="plus" onClick={() => void call("newConversation").then(() => (chat.reset([]), go("chat")))}>
          New conversation
        </Button>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "420px minmax(0, 1fr)", gap: 16, height: "100%" }}>
        <Card className="stack" style={{ padding: 14, gap: 4, overflow: "auto" }}>
          <div className="search">
            <Icon name="search" size={16} />
            <label className="sr" htmlFor="q">
              Search conversations
            </label>
            <input id="q" placeholder="Search conversations" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {error && <p className="muted">{error}</p>}
          {!data && !error && <Loading />}
          {data && !list.length && <p className="muted" style={{ padding: 14 }}>No conversations yet.</p>}
          {groups.map(([label, items]) => (
            <div key={label} className="stack" style={{ gap: 2 }}>
              <div className="label" style={{ padding: "8px 14px 0" }}>
                {label}
              </div>
              {items.map((t) => (
                <button type="button" key={t.id} className="list-btn" aria-pressed={picked?.id === t.id} onClick={() => setPicked(t)} onDoubleClick={() => void open(t)}>
                  <span className="between">
                    <b className="ellipsis">{unmark(t.title)}</b>
                    <span className="muted" style={{ flexShrink: 0 }}>
                      {when(t.updatedAt)}
                    </span>
                  </span>
                  <span className="muted ellipsis">{unmark(t.preview)}</span>
                </button>
              ))}
            </div>
          ))}
        </Card>
        <Card className="pad stack" style={{ gap: 18 }}>
          {picked ? (
            <>
              <div className="between" style={{ alignItems: "flex-start" }}>
                <div>
                  <h2 style={{ fontSize: 20 }}>{unmark(picked.title)}</h2>
                  <div className="muted">{new Date(picked.updatedAt).toLocaleString("en-AU")}</div>
                </div>
                <Button kind="primary" icon="right" onClick={() => void open(picked)}>
                  Continue
                </Button>
              </div>
              <div style={{ padding: 18, borderRadius: 14, background: "var(--bg)", whiteSpace: "pre-wrap" }}>{unmark(picked.preview)}</div>
              <div className="note" style={{ marginTop: "auto" }}>
                <Icon name="lock" size={15} />
                Conversations are kept on this computer by Codex. Anything the privacy guard removed is not in them.
              </div>
            </>
          ) : (
            <div className="empty">
              <Spot name="spot-rest" size={150} />
              <p>Your conversations will be listed here.</p>
            </div>
          )}
        </Card>
      </div>
    </Shell>
  );
}

function when(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false });
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function groupByDay(list: ThreadInfo[]): [string, ThreadInfo[]][] {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  const out: [string, ThreadInfo[]][] = [["Today", []], ["Yesterday", []], ["Earlier", []]];
  for (const t of list) {
    const d = new Date(t.updatedAt).toDateString();
    out[d === today ? 0 : d === yesterday ? 1 : 2]![1].push(t);
  }
  return out.filter(([, items]) => items.length);
}
