import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppState, Ask, ChatEntry, Mode, Result } from "../../shared/api";
import { call, edward } from "./api";
import { art, Button, Confirm, Icon, ModeBar } from "./ui";
import { VoiceCall, type VoicePhase } from "./voice";
import { Today } from "./pages/Today";
import { Chat, History } from "./pages/Chat";
import { Calendar } from "./pages/Calendar";
import { Mail } from "./pages/Mail";
import { BillReview, Bills, BillsMonth } from "./pages/Bills";
import { Reminders } from "./pages/Reminders";
import { Lists } from "./pages/Lists";
import { Memory } from "./pages/Memory";
import { Pictures } from "./pages/Pictures";
import { Modes, Privacy } from "./pages/Trust";
import { Data, Doctor, GooglePage, Settings } from "./pages/Care";
import { Setup } from "./pages/Setup";

export type Route = { page: string; id?: number };

interface Ctx {
  state: AppState;
  route: Route;
  go: (page: string, id?: number) => void;
  refresh: () => void;
  toast: (r: Result | string) => void;
  setMode: (m: Mode) => void;
  chat: {
    entries: ChatEntry[];
    asks: Ask[];
    busy: boolean;
    label: string;
    send: (text: string) => void;
    reset: (entries: ChatEntry[]) => void;
  };
  /** Voice (V): a call with the realtime model, kept while moving between pages. */
  voice: { phase: VoicePhase; start: () => void; stop: () => void };
}

const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

const NAV: ([string, string, string] | null)[] = [
  ["today", "Today", "sun"],
  ["chat", "Chat", "chat"],
  null,
  ["calendar", "Calendar", "calendar"],
  ["mail", "Mail", "mail"],
  ["bills", "Bills", "bill"],
  ["reminders", "Reminders", "bell"],
  ["lists", "Lists", "check"],
  ["memory", "Memory", "book"],
  ["pictures", "Pictures", "image"],
  null,
  ["privacy", "Privacy", "shield"],
  ["settings", "Settings", "gear"],
];

/** Which sidebar entry a page belongs to. */
const SECTION: Record<string, string> = {
  history: "chat", commands: "chat", bill: "bills", "bills-month": "bills", modes: "privacy", google: "settings", doctor: "settings", data: "settings",
};

type Toast = { id: number; text: string; tone: "ok" | "fail" | "info" };

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [route, setRoute] = useState<Route>({ page: "today" });
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [asks, setAsks] = useState<Ask[]>([]);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [badges, setBadges] = useState<{ bills: number; mail: number }>({ bills: 0, mail: 0 });
  const toastId = useRef(0);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("off");
  const voiceCall = useRef<VoiceCall | null>(null);

  const refresh = useCallback(() => void call("state").then(setState), []);
  const toast = useCallback((r: Result | string) => {
    const t: Toast = typeof r === "string" ? { id: ++toastId.current, text: r, tone: "info" } : { id: ++toastId.current, text: r.message, tone: r.ok ? "ok" : "fail" };
    if (!t.text) return;
    setToasts((x) => [...x.slice(-3), t]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== t.id)), t.tone === "fail" ? 9000 : 6000);
  }, []);
  const go = useCallback((page: string, id?: number) => setRoute({ page, id }), []);

  useEffect(() => {
    const off = edward.on((e) => {
      switch (e.type) {
        case "state":
          setState(e.state);
          break;
        case "entry":
          setEntries((list) => (list.some((x) => x.id === e.entry.id) ? list.map((x) => (x.id === e.entry.id ? e.entry : x)) : [...list, e.entry]));
          break;
        case "delta":
          setEntries((list) => list.map((x) => (x.id === e.id && x.kind === "assistant" ? { ...x, text: x.text + e.text } : x)));
          break;
        case "turn":
          setBusy(e.busy);
          setLabel(e.label ?? "");
          break;
        case "ask":
          setAsks((a) => [...a, e.ask]);
          voiceCall.current?.say("I need your OK on the screen.");
          break;
        case "voiceSay":
          voiceCall.current?.say(e.text);
          break;
        case "askDone":
          setAsks((a) => a.filter((x) => x.id !== e.id));
          break;
        case "notice":
          toast(e.lines.join("\n"));
          break;
        case "navigate": {
          const [page = "today", id] = e.to.split(":");
          setRoute({ page, id: id ? Number(id) : undefined });
          break;
        }
      }
    });
    void edward.ready().then(() => {
      refresh();
      void call("transcript").then(setEntries);
    });
    return off;
  }, [refresh, toast]);

  // Counts for the sidebar: new bills to check, unread mail.
  useEffect(() => {
    if (!state?.signedIn) return;
    void call("bills").then((b) => setBadges((x) => ({ ...x, bills: b.pending.length })), () => {});
    if (state.google.connected) void call("mail").then((m) => setBadges((x) => ({ ...x, mail: m.unread.length })), () => {});
  }, [state?.signedIn, state?.google.connected, route.page]);

  const setMode = useCallback(
    (m: Mode) => {
      if (m === "auto" && state?.mode !== "auto") return setConfirmAuto(true);
      void call("setMode", m).then((r) => (r.ok ? refresh() : toast(r)));
    },
    [state?.mode, refresh, toast],
  );

  const send = useCallback((text: string) => {
    void call("send", text);
  }, []);

  const startVoice = useCallback(async () => {
    const info = await call("voiceInfo");
    if (!info.hasKey) {
      toast({ ok: false, message: "Add your OpenAI API key in Settings → Voice first." });
      setRoute({ page: "settings" });
      return;
    }
    voiceCall.current ??= new VoiceCall({ phase: setVoicePhase, heard: (t) => void call("voiceHeard", t), problem: (m) => toast({ ok: false, message: m }) });
    await voiceCall.current.start();
  }, [toast]);
  const stopVoice = useCallback(() => voiceCall.current?.stop(), []);
  const voice = useMemo(() => ({ phase: voicePhase, start: () => void startVoice(), stop: stopVoice }), [voicePhase, startVoice, stopVoice]);

  const ctx = useMemo<Ctx | null>(
    () => (state ? { state, route, go, refresh, toast, setMode, chat: { entries, asks, busy, label, send, reset: setEntries }, voice } : null),
    [state, route, go, refresh, toast, setMode, entries, asks, busy, label, send, voice],
  );

  if (!state || !ctx) {
    return (
      <div className="app" style={{ alignItems: "center", justifyContent: "center", backgroundImage: `url(${art("wash-blue")})` }}>
        <div className="row" style={{ gap: 14 }}>
          <img src="./icon.png" alt="" width={44} height={44} style={{ borderRadius: 12 }} />
          <h1 style={{ fontSize: 28 }}>Edward</h1>
        </div>
      </div>
    );
  }

  const needsSetup = !state.signedIn || state.firstRun;
  return (
    <AppCtx.Provider value={ctx}>
      {needsSetup ? (
        <Setup />
      ) : (
        <div className="app" style={{ backgroundImage: `url(${art("wash-blue")})` }}>
          <Sidebar badges={badges} />
          <Page />
        </div>
      )}
      {voicePhase !== "off" && <VoiceBar phase={voicePhase} onStop={stopVoice} />}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div className="toast" key={t.id} role="status">
            <Icon name={t.tone === "fail" ? "warn" : t.tone === "ok" ? "check" : "bell"} size={18} color={t.tone === "fail" ? "var(--rose-ink)" : t.tone === "ok" ? "var(--sage-ink)" : "var(--blue-ink)"} width={2} />
            <div className="grow">{t.text}</div>
            <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} aria-label="Close" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
      {confirmAuto && (
        <Confirm
          danger
          title="Turn on Auto mode?"
          yes="Turn on Auto"
          no={`Stay in ${state.mode === "chat" ? "Chat" : state.mode === "manual" ? "Manual" : "Semi-auto"}`}
          onAnswer={(yes) => {
            setConfirmAuto(false);
            if (yes) void call("setMode", "auto").then((r) => (r.ok ? refresh() : toast(r)));
          }}
        >
          Codex will run commands and change files without asking, with your full permissions on this computer, and what it reads won't pass the privacy guard. Edward stays in Auto until you switch back.
        </Confirm>
      )}
    </AppCtx.Provider>
  );
}

function Sidebar({ badges }: { badges: { bills: number; mail: number } }) {
  const { route, go, state } = useApp();
  const section = SECTION[route.page] ?? route.page;
  const g = state.google;
  return (
    <nav className="nav" aria-label="Sections">
      <div className="brand">
        <img src="./icon.png" alt="" />
        <b>Edward</b>
      </div>
      <div className="nav-list">
        {NAV.map((n, i) => {
          if (!n) return <div className="nav-sep" key={i} />;
          const [page, name, icon] = n;
          const badge = page === "bills" && badges.bills ? <span className="badge apricot">{badges.bills} new</span> : page === "mail" && badges.mail ? <span className="badge">{badges.mail}</span> : null;
          return (
            <button type="button" key={page} className="nav-item" aria-current={section === page ? "page" : undefined} onClick={() => go(page)}>
              <Icon name={icon} />
              <span>{name}</span>
              {badge}
            </button>
          );
        })}
      </div>
      <div className="nav-status">
        <div>
          <span>AI</span>
          <span className={state.signedIn ? "on" : "off"}>{!state.signedIn ? "Not signed in" : state.apiKey ? "API key" : "ChatGPT plan"}</span>
        </div>
        <div>
          <span>Google</span>
          <span className={g.expired ? "bad" : g.connected ? "on" : "off"}>{g.expired ? "Sign in again" : g.connected ? (g.accounts.length > 1 ? `${g.accounts.length} accounts` : "Connected") : "Not connected"}</span>
        </div>
        <div>
          <span>Background</span>
          <span className={state.background ? "on" : "off"}>{state.background ? "On" : "Off"}</span>
        </div>
      </div>
    </nav>
  );
}

/** A page: title on the left, the mode on the right, the page's own content below. */
export function Shell({ title, sub, actions, children, fixed }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; fixed?: boolean }) {
  const { state, setMode } = useApp();
  return (
    <main className="main">
      <header className="header">
        <div className="titles">
          <h1>{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        <div className="actions">
          {actions}
          <ModeBar mode={state.mode} onChange={setMode} />
        </div>
      </header>
      <div className={`body ${fixed ? "fixed" : ""}`}>{children}</div>
    </main>
  );
}

/** A page that fails to draw shows what went wrong instead of a blank window. */
class PageGuard extends Component<{ page: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  componentDidUpdate(prev: { page: string }) {
    if (prev.page !== this.props.page && this.state.error) this.setState({ error: null });
  }
  componentDidCatch(e: unknown) {
    console.error(`page ${this.props.page} failed:`, e);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="main">
        <div className="empty" style={{ flex: 1 }}>
          <img className="spot" src={art("spot-umbrella")} alt="" width={150} height={150} />
          <h2>This page couldn't be shown</h2>
          <p className="mono">{this.state.error}</p>
        </div>
      </main>
    );
  }
}

function Page() {
  const { route } = useApp();
  return (
    <PageGuard page={route.page}>
      <PageBody />
    </PageGuard>
  );
}

function PageBody() {
  const { route } = useApp();
  switch (route.page) {
    case "chat":
      return <Chat />;
    case "commands":
      return <Chat palette />;
    case "history":
      return <History />;
    case "calendar":
      return <Calendar />;
    case "mail":
      return <Mail />;
    case "bills":
      return <Bills />;
    case "bill":
      return <BillReview id={route.id!} />;
    case "bills-month":
      return <BillsMonth />;
    case "reminders":
      return <Reminders />;
    case "lists":
      return <Lists />;
    case "memory":
      return <Memory />;
    case "pictures":
      return <Pictures />;
    case "privacy":
      return <Privacy />;
    case "modes":
      return <Modes />;
    case "settings":
      return <Settings />;
    case "google":
      return <GooglePage />;
    case "doctor":
      return <Doctor />;
    case "data":
      return <Data />;
    default:
      return <Today />;
  }
}

const VOICE_WORDS: Record<VoicePhase, string> = {
  connecting: "Starting voice…",
  listening: "Listening",
  hearing: "Hearing you…",
  thinking: "Edward is thinking…",
  speaking: "Edward is speaking",
  off: "",
};

/** While voice is on: what it is doing, the privacy reminder, and Stop. */
function VoiceBar({ phase, onStop }: { phase: VoicePhase; onStop: () => void }) {
  return (
    <div className="voice-bar" role="status" aria-live="polite">
      <span className="voice-dot" data-phase={phase} aria-hidden />
      <div className="grow">
        <b>{VOICE_WORDS[phase]}</b>
        <div className="muted" style={{ fontSize: 12 }}>
          What you say isn't checked by the privacy guard: don't say card or account numbers or passwords.
        </div>
      </div>
      <Button small kind="primary" icon="x" onClick={onStop}>
        Stop
      </Button>
    </div>
  );
}
