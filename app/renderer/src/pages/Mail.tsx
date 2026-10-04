import { useEffect, useRef, useState } from "react";
import type { ComposeCheck, ComposeDraft, MailListView, MailMessage, MailOriginal, MailPage, MailSummary } from "../../../shared/api";
import { useApp, Shell } from "../App";
import { call, useData } from "../api";
import { AccountChip, Button, Card, Confirm, Icon, IconButton, Loading, Note, Segmented, Spot, Tag } from "../ui";
import { NotConnected } from "./Calendar";

const VIEWS: { value: MailListView; label: string; sub: string }[] = [
  { value: "inbox", label: "Inbox", sub: "Your inbox, the last 30 days" },
  { value: "unread", label: "Unread", sub: "Unread in your Primary tab from the last 24 hours" },
  { value: "search", label: "Search", sub: "Search all your mail" },
];

export function Mail() {
  const { go, chat, toast } = useApp();
  const [listView, setListView] = useState<MailListView>("inbox");
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [page, setPage] = useState<MailPage | null>(null);
  const [items, setItems] = useState<MailSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [listProblem, setListProblem] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [picked, setPicked] = useState<MailSummary | null>(null);
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [view, setView] = useState<"original" | "text">("original");
  const [pictures, setPictures] = useState(false);
  const [original, setOriginal] = useState<MailOriginal | null>(null);
  const [compose, setCompose] = useState<ComposeDraft | null>(null);
  const startCompose = async (from?: { id: string; mode: "reply" | "replyAll" | "forward" }) => {
    try {
      setCompose(await call("mailCompose", from));
    } catch (e) {
      toast({ ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  };
  // A new list whenever the view, the search or "check again" changes.
  useEffect(() => {
    let live = true;
    setItems([]);
    setPage(null);
    setListProblem(null);
    if (listView === "search" && !searched) return;
    setLoading(true);
    call("mailList", { view: listView, query: searched }).then(
      (p) => {
        if (!live) return;
        setPage(p);
        setItems(p.items);
        setPicked((x) => (x && p.items.some((m) => m.id === x.id) ? x : (p.items[0] ?? null)));
        setLoading(false);
      },
      (e: unknown) => live && (setListProblem(e instanceof Error ? e.message : String(e)), setLoading(false)),
    );
    return () => {
      live = false;
    };
  }, [listView, searched, round]);
  const loadMore = async () => {
    if (!page?.cursor || loading) return;
    setLoading(true);
    try {
      const next = await call("mailList", { view: listView, query: searched, cursor: page.cursor });
      setPage(next);
      setItems((list) => [...list, ...next.items.filter((m) => !list.some((x) => x.id === m.id))]);
    } catch (e) {
      setListProblem(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  };
  useEffect(() => {
    if (!picked) return;
    setMessage(null);
    setProblem(null);
    setPictures(false);
    call("mailMessage", picked.id).then(setMessage, (e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  }, [picked]);
  // The email as designed, in a sandboxed frame; pictures from the web only when asked for.
  useEffect(() => {
    setOriginal(null);
    if (!message?.hasHtml) return;
    let live = true;
    call("mailOriginal", message.id, pictures).then((o) => live && setOriginal(o), () => {});
    return () => {
      live = false;
    };
  }, [message, pictures]);
  const asSent = view === "original" && Boolean(message?.hasHtml);
  const ask = (text: string) => {
    chat.send(text);
    go("chat");
  };
  const many = Boolean(page?.manyAccounts);
  const connected = page ? page.connected : true;
  const problemText = listProblem ?? page?.problem;
  return (
    <Shell
      title="Mail"
      sub={VIEWS.find((v) => v.value === listView)!.sub}
      fixed
      actions={
        <>
          <Segmented label="Which mail" value={listView} onChange={setListView} options={VIEWS} />
          <IconButton icon="refresh" label="Check again" onClick={() => setRound((n) => n + 1)} disabled={loading} />
          <Button icon="pencil" onClick={() => void startCompose()} disabled={!connected}>
            New email
          </Button>
          <Button kind="primary" icon="chat" onClick={() => ask("Anything important in my mail today?")} disabled={!connected}>
            Ask about my mail
          </Button>
        </>
      }
    >
      {!connected ? (
        <NotConnected what="your mail" />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "400px minmax(0, 1fr)", gap: 16, height: "100%" }}>
          <Card className="stack" style={{ padding: 12, gap: 4, overflow: "auto" }}>
            {listView === "search" && (
              <form
                className="search"
                style={{ marginBottom: 6 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  setSearched(query.trim());
                }}
              >
                <Icon name="search" size={16} />
                <label className="sr" htmlFor="mail-q">
                  Search mail
                </label>
                <input id="mail-q" autoFocus placeholder='Words, or from:alice, subject:invoice, has:attachment' value={query} onChange={(e) => setQuery(e.target.value)} />
              </form>
            )}
            {problemText && (
              <Note tone="apricot" icon="warn">
                {problemText}
              </Note>
            )}
            {!items.length && loading && <Loading />}
            {!items.length && !loading && !problemText && (listView !== "search" || searched) && (
              <div className="empty">
                <Spot name="spot-rest" size={140} alt="An armchair with a blanket" />
                <h2>{listView === "search" ? "Nothing found" : listView === "unread" ? "No unread mail" : "Your inbox is empty"}</h2>
                <p>{listView === "search" ? "Try other words." : listView === "unread" ? "Nothing new in Primary since yesterday." : "Nothing in the last 30 days."}</p>
              </div>
            )}
            {items.map((m) => (
              <button type="button" key={m.id} className="list-btn" aria-pressed={picked?.id === m.id} onClick={() => setPicked(m)}>
                <span className="between">
                  <span className="row ellipsis" style={{ gap: 8, fontWeight: m.unread ? 700 : 500 }}>
                    <span aria-label={m.unread ? "Unread" : undefined} style={{ width: 8, height: 8, borderRadius: "50%", background: m.unread ? "var(--blue)" : "transparent", flexShrink: 0 }} />
                    {m.from}
                  </span>
                  <span className="muted" style={{ flexShrink: 0 }}>
                    {m.date}
                  </span>
                </span>
                <span style={{ fontWeight: m.unread ? 600 : 400 }} className="ellipsis">
                  {m.subject}
                </span>
                <span className="muted ellipsis">{m.snippet}</span>
                {many && m.accountLabel && <AccountChip label={m.accountLabel} color={m.color} />}
                {m.looksLikeBill && (
                  <span style={{ marginTop: 4 }}>
                    <Tag tone="apricot" icon="bill">
                      Looks like a bill
                    </Tag>
                  </span>
                )}
              </button>
            ))}
            {page?.cursor && (
              <LoadMore loading={loading} onVisible={loadMore} />
            )}
            <div style={{ marginTop: "auto", paddingTop: 8 }}>
              <Note icon="eye">Edward can read and search your mail and write drafts. It can't delete, archive or mark anything, so opening an email here leaves it unread in Gmail.</Note>
            </div>
          </Card>
          {compose ? (
            <Compose key={`${compose.mode}-${compose.inReplyTo ?? ""}`} start={compose} onClose={() => setCompose(null)} />
          ) : (
          <Card className="stack" style={{ padding: 24, gap: 16, overflow: asSent ? "hidden" : "auto" }}>
            {!picked ? (
              <p className="muted">Pick an email to read it.</p>
            ) : problem ? (
              <Note tone="apricot" icon="warn">
                {problem}
              </Note>
            ) : !message ? (
              <Loading what="Opening" />
            ) : (
              <>
                <div className="between" style={{ alignItems: "flex-start", gap: 16 }}>
                  <div className="grow">
                    <div style={{ fontFamily: "var(--disp)", fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em" }}>{message.subject}</div>
                    <div className="muted">
                      {message.from} · {message.date}
                    </div>
                    {many && picked.accountLabel && <AccountChip label={`To ${picked.accountLabel}`} color={picked.color} />}
                  </div>
                  {message.hasHtml && (
                    <Segmented
                      label="How to show this email"
                      value={view}
                      onChange={setView}
                      options={[
                        { value: "original", label: "As sent" },
                        { value: "text", label: "Text" },
                      ]}
                    />
                  )}
                </div>
                {asSent && original?.remote && !original.shown && (
                  <div className="note apricot" style={{ alignItems: "center" }}>
                    <span className="grow" style={{ minWidth: 220 }}>
                      Pictures from the web are hidden. Loading them can tell the sender you opened this email.
                    </span>
                    <Button small kind="primary" icon="image" onClick={() => setPictures(true)}>
                      Show pictures
                    </Button>
                    <Button
                      small
                      kind="ghost"
                      onClick={async () => {
                        await call("updateSettings", { mailPictures: true });
                        setPictures(true);
                      }}
                    >
                      Always show
                    </Button>
                  </div>
                )}
                {asSent ? (
                  original ? (
                    <iframe
                      key={original.url}
                      title={`Email: ${message.subject}`}
                      src={original.url}
                      sandbox="allow-popups allow-popups-to-escape-sandbox"
                      referrerPolicy="no-referrer"
                      style={{ flex: 1, minHeight: 240, width: "100%", border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }}
                    />
                  ) : (
                    <Loading what="Opening" />
                  )
                ) : (
                  <div className="pretty" style={{ fontSize: 15, whiteSpace: "pre-wrap", maxWidth: 680, overflowWrap: "anywhere" }}>
                    {message.body.trim() || "(This email has no text.)"}
                  </div>
                )}
                {message.removed.length > 0 && (
                  <Note tone="sage" icon="shield">
                    This email contains {message.removed.join(" and ")}. If you ask Edward about it, those are removed before the model sees it. The email in Gmail is untouched.
                  </Note>
                )}
                <div className="row" style={{ marginTop: asSent ? 0 : "auto", flexWrap: "wrap", paddingTop: 16, borderTop: "1px solid var(--line)" }}>
                  <Button kind="primary" icon="pencil" onClick={() => void startCompose({ id: picked.id, mode: "reply" })}>
                    Reply
                  </Button>
                  <Button onClick={() => void startCompose({ id: picked.id, mode: "replyAll" })}>Reply all</Button>
                  <Button onClick={() => void startCompose({ id: picked.id, mode: "forward" })}>Forward</Button>
                  <Button onClick={() => ask(`Summarise the email conversation from ${picked.from} about "${picked.subject}".`)}>Summarise</Button>
                  <Button icon="calendar" onClick={() => ask(`Is there a date or appointment in the email from ${picked.from} about "${picked.subject}" that I should add to my calendar?`)}>
                    Anything for my calendar?
                  </Button>
                </div>
              </>
            )}
          </Card>
          )}
        </div>
      )}
    </Shell>
  );
}

const MODE_TITLE: Record<ComposeDraft["mode"], string> = { new: "New email", reply: "Reply", replyAll: "Reply all", forward: "Forward" };

/** Writing an email by hand. Nothing here goes to the model unless "Ask Edward to write" is used. */
function Compose({ start, onClose }: { start: ComposeDraft; onClose: () => void }) {
  const { state, toast } = useApp();
  const [d, setD] = useState(start);
  const [busy, setBusy] = useState("");
  const [check, setCheck] = useState<ComposeCheck | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const set = (patch: Partial<ComposeDraft>) => setD((x) => ({ ...x, ...patch }));
  const accounts = state.google.accounts.filter((a) => a.mailWorks);
  const field = (label: string, key: "to" | "cc" | "subject", placeholder = "") => (
    <label className="row" style={{ gap: 12, borderBottom: "1px solid var(--line)", padding: "6px 0" }}>
      <span className="muted" style={{ width: 64, flexShrink: 0 }}>
        {label}
      </span>
      <input className="grow" style={{ border: 0, outline: "none", background: "transparent", font: "inherit", padding: "6px 0" }} value={d[key]} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value })} />
    </label>
  );
  const send = async () => {
    setBusy("check");
    const c = await call("mailCheck", d).catch((e: unknown) => ({ problems: [e instanceof Error ? e.message : String(e)], firstTime: [], from: "" }));
    setBusy("");
    if (c.problems.length) return toast({ ok: false, message: c.problems.join(" ") });
    setCheck(c);
  };
  const write = async () => {
    setBusy("write");
    const r = await call("mailWrite", d, notes ?? "");
    setBusy("");
    toast(r);
    if (!r.ok || !r.body) return;
    // A new email gets the text; a reply or forward keeps what it quotes below it.
    set({ body: d.mode === "new" ? r.body : `${r.body}${d.body.startsWith("\n") ? d.body : `\n\n${d.body}`}` });
    setNotes(null);
  };
  return (
    <Card className="stack" style={{ padding: 24, gap: 10, overflow: "auto" }}>
      <div className="between">
        <h2 style={{ fontSize: 22 }}>{MODE_TITLE[d.mode]}</h2>
        <IconButton icon="x" label="Discard" onClick={onClose} />
      </div>
      <label className="row" style={{ gap: 12, borderBottom: "1px solid var(--line)", padding: "6px 0" }}>
        <span className="muted" style={{ width: 64, flexShrink: 0 }}>
          From
        </span>
        {accounts.length > 1 && d.mode === "new" ? (
          <select className="grow" style={{ border: 0, background: "transparent", font: "inherit", padding: "6px 0" }} value={d.from} onChange={(e) => set({ from: e.target.value })}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name ? `${a.name} <${a.email}>` : a.email}
              </option>
            ))}
          </select>
        ) : (
          <span>{accounts.find((a) => a.id === d.from)?.email ?? d.from}</span>
        )}
      </label>
      {field("To", "to", "Name <someone@example.com>, …")}
      {field("Cc", "cc")}
      {field("Subject", "subject")}
      <textarea
        aria-label="Message"
        value={d.body}
        onChange={(e) => set({ body: e.target.value })}
        autoFocus={d.mode !== "forward"}
        style={{ flex: 1, minHeight: 240, resize: "none", border: "1px solid var(--line)", borderRadius: 12, padding: 14, font: "inherit", fontSize: 15, lineHeight: 1.5, background: "var(--bg)" }}
      />
      {notes !== null && (
        <form
          className="row"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            void write();
          }}
        >
          <input className="input grow" autoFocus placeholder="What should it say? e.g. thanks, Friday 3pm works, ask about parking" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button kind="primary" type="submit" disabled={busy === "write"}>
            {busy === "write" ? "Writing…" : "Write"}
          </Button>
        </form>
      )}
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <Button kind="primary" icon="send" disabled={Boolean(busy)} onClick={() => void send()}>
          {busy === "send" ? "Sending…" : "Send"}
        </Button>
        <Button
          disabled={Boolean(busy)}
          onClick={async () => {
            setBusy("draft");
            const r = await call("mailSaveDraft", d);
            setBusy("");
            toast(r);
            if (r.draftId) set({ draftId: r.draftId });
          }}
        >
          Save draft
        </Button>
        <Button icon="chat" disabled={Boolean(busy)} onClick={() => setNotes((n) => (n === null ? "" : null))}>
          Ask Edward to write
        </Button>
        <span className="grow" />
        <span className="muted" style={{ fontSize: 12.5 }}>
          Only "Ask Edward to write" sends anything to the model.
        </span>
      </div>
      {check && (
        <Confirm
          title="Send this email?"
          yes="Send"
          onAnswer={async (yes) => {
            setCheck(null);
            if (!yes) return;
            setBusy("send");
            const r = await call("mailSend", d);
            setBusy("");
            toast(r);
            if (r.ok) onClose();
          }}
        >
          <div className="stack" style={{ gap: 4 }}>
            <span>From: {check.from}</span>
            <span>To: {d.to}</span>
            {d.cc.trim() && <span>Cc: {d.cc}</span>}
            <span>Subject: {d.subject}</span>
            {check.firstTime.map((a) => (
              <span key={a} style={{ color: "var(--apricot-ink)" }}>
                ⚠ First email to {a}
              </span>
            ))}
          </div>
        </Confirm>
      )}
    </Card>
  );
}

/** At the end of a list: loads the next page when it scrolls into view (or when clicked). */
function LoadMore({ loading, onVisible }: { loading: boolean; onVisible: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const latest = useRef(onVisible);
  latest.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) latest.current();
    });
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  return (
    <button ref={ref} type="button" className="btn ghost small" style={{ alignSelf: "center", margin: "6px 0" }} disabled={loading} onClick={() => latest.current()}>
      {loading ? "Loading…" : "Load more"}
    </button>
  );
}
