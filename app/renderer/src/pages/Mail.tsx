import { useEffect, useState } from "react";
import type { MailMessage, MailSummary } from "../../../shared/api";
import { useApp, Shell } from "../App";
import { call, useData } from "../api";
import { Button, Card, IconButton, Loading, Note, Spot, Tag } from "../ui";
import { NotConnected } from "./Calendar";

export function Mail() {
  const { go, chat } = useApp();
  const { data, error, reload, loading } = useData(() => call("mail"));
  const [picked, setPicked] = useState<MailSummary | null>(null);
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setPicked((p) => p ?? data?.unread[0] ?? null);
  }, [data]);
  useEffect(() => {
    if (!picked) return;
    setMessage(null);
    setProblem(null);
    call("mailMessage", picked.id).then(setMessage, (e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  }, [picked]);
  const ask = (text: string) => {
    chat.send(text);
    go("chat");
  };
  return (
    <Shell
      title="Mail"
      sub="Unread in your Primary tab from the last 24 hours"
      fixed
      actions={
        <>
          <IconButton icon="refresh" label="Check again" onClick={reload} disabled={loading} />
          <Button kind="primary" icon="chat" onClick={() => ask("Anything important in my mail today?")} disabled={!data?.connected}>
            Ask about my mail
          </Button>
        </>
      }
    >
      {!data && !error ? (
        <Loading />
      ) : !data?.connected ? (
        <NotConnected what="your mail" />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "400px minmax(0, 1fr)", gap: 16, height: "100%" }}>
          <Card className="stack" style={{ padding: 12, gap: 4, overflow: "auto" }}>
            {data.problem && (
              <Note tone="apricot" icon="warn">
                {data.problem}
              </Note>
            )}
            {!data.unread.length && !data.problem && (
              <div className="empty">
                <Spot name="spot-rest" size={140} alt="An armchair with a blanket" />
                <h2>No unread mail</h2>
                <p>Nothing new in Primary since yesterday.</p>
              </div>
            )}
            {data.unread.map((m) => (
              <button type="button" key={m.id} className="list-btn" aria-pressed={picked?.id === m.id} onClick={() => setPicked(m)}>
                <span className="between">
                  <b className="row ellipsis" style={{ gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--blue)", flexShrink: 0 }} />
                    {m.from}
                  </b>
                  <span className="muted" style={{ flexShrink: 0 }}>
                    {m.date}
                  </span>
                </span>
                <span style={{ fontWeight: 500 }} className="ellipsis">
                  {m.subject}
                </span>
                <span className="muted ellipsis">{m.snippet}</span>
                {m.looksLikeBill && (
                  <span style={{ marginTop: 4 }}>
                    <Tag tone="apricot" icon="bill">
                      Looks like a bill
                    </Tag>
                  </span>
                )}
              </button>
            ))}
            <div style={{ marginTop: "auto" }}>
              <Note icon="eye">Edward can read and search your mail and write drafts. It can't delete, archive or mark anything.</Note>
            </div>
          </Card>
          <Card className="stack" style={{ padding: 24, gap: 16, overflow: "auto" }}>
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
                <div className="between" style={{ alignItems: "flex-start" }}>
                  <div className="grow">
                    <div style={{ fontFamily: "var(--disp)", fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em" }}>{message.subject}</div>
                    <div className="muted">
                      {message.from} · {message.date}
                    </div>
                  </div>
                </div>
                <div className="pretty" style={{ fontSize: 15, whiteSpace: "pre-wrap", maxWidth: 680, overflowWrap: "anywhere" }}>
                  {message.body.trim() || "(This email has no text.)"}
                </div>
                {message.removed.length > 0 && (
                  <Note tone="sage" icon="shield">
                    This email contains {message.removed.join(" and ")}. If you ask Edward about it, those are removed before the model sees it. The email in Gmail is untouched.
                  </Note>
                )}
                <div className="row" style={{ marginTop: "auto", flexWrap: "wrap", paddingTop: 16, borderTop: "1px solid var(--line)" }}>
                  <Button kind="primary" icon="pencil" onClick={() => ask(`Draft a reply to the email from ${picked.from} about "${picked.subject}".`)}>
                    Draft a reply
                  </Button>
                  <Button onClick={() => ask(`Summarise the email conversation from ${picked.from} about "${picked.subject}".`)}>Summarise</Button>
                  <Button icon="calendar" onClick={() => ask(`Is there a date or appointment in the email from ${picked.from} about "${picked.subject}" that I should add to my calendar?`)}>
                    Anything for my calendar?
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </Shell>
  );
}
