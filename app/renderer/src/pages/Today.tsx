import type { EventInfo } from "../../../shared/api";
import { useApp, Shell } from "../App";
import { call, useData } from "../api";
import { art, Card, Icon, Loading, Note } from "../ui";
import { Composer } from "./Chat";

const SUGGESTIONS = ["What's on tomorrow?", "Any important mail today?", "Remind me at 5pm to call the dentist", "What bills are still unpaid this month?"];

function CardHead({ icon, title, page }: { icon: string; title: string; page: string }) {
  const { go } = useApp();
  return (
    <div className="between">
      <div className="row">
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 10, background: "var(--blue-soft)", color: "var(--blue-ink)" }}>
          <Icon name={icon} size={17} />
        </span>
        <h3>{title}</h3>
      </div>
      <button type="button" className="icon-btn" aria-label={`Open ${title}`} onClick={() => go(page)} style={{ marginRight: -10 }}>
        <Icon name="right" />
      </button>
    </div>
  );
}

const TimeRow = ({ time, title, sub }: { time: string; title: string; sub?: string }) => (
  <div className="row" style={{ alignItems: "baseline", gap: 12 }}>
    <div style={{ width: 52, flexShrink: 0, fontSize: 13, fontWeight: 600, color: "var(--blue-ink)" }}>{time}</div>
    <div className="grow">
      <div style={{ fontWeight: 500 }}>{title}</div>
      {sub && <div className="muted">{sub}</div>}
    </div>
  </div>
);

const eventSub = (e: EventInfo) => [e.end && `until ${e.end}`, e.location].filter(Boolean).join(" · ");

export function Today() {
  const { go, chat, state } = useApp();
  const { data } = useData(() => call("today"), [state.google.connected]);
  const evening = data?.evening ?? new Date().getHours() >= 18;
  return (
    <Shell title="Today" sub={data?.date ?? ""} fixed>
      <div className="stack" style={{ height: "100%", gap: 16 }}>
        <section className="hero" aria-label="Today at a glance" style={{ height: 270, background: evening ? "#131b33" : undefined }}>
          <img src={art(evening ? "hero-evening" : "hero-morning")} alt="" style={{ objectPosition: evening ? "center 45%" : "center 40%" }} />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: evening
                ? "linear-gradient(270deg, rgba(14,20,40,0.82) 0%, rgba(14,20,40,0.55) 38%, rgba(14,20,40,0) 64%)"
                : "linear-gradient(90deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.82) 34%, rgba(255,255,255,0) 66%)",
            }}
          />
          <div style={{ position: "relative", height: "100%", padding: "28px 38px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 10, maxWidth: 560, marginLeft: evening ? "auto" : 0, color: evening ? "#fff" : undefined }}>
            <div className="label" style={{ color: evening ? "#c9d4f2" : undefined }}>
              Today at a glance
            </div>
            <div style={{ fontFamily: "var(--disp)", fontSize: 40, fontWeight: 600, lineHeight: 1.08, letterSpacing: "-0.025em" }}>{data?.greeting ?? " "}</div>
            <div className="pretty" style={{ fontSize: 16, color: evening ? "#e3e9f8" : "var(--ink2)" }}>
              {data?.summary ?? ""}
            </div>
          </div>
        </section>

        {!data ? (
          <Loading what="Getting today ready" />
        ) : (
          <div className="grid-4" style={{ flex: 1, minHeight: 0 }}>
            <Card className="pad stack">
              <CardHead icon="calendar" title="Calendar" page="calendar" />
              {!data.google ? (
                <ConnectHint />
              ) : data.calendarProblem ? (
                <Note tone="apricot" icon="warn">
                  {data.calendarProblem}
                </Note>
              ) : data.events.length ? (
                <div className="stack">{data.events.slice(0, 4).map((e) => <TimeRow key={e.id} time={e.start} title={e.title} sub={eventSub(e)} />)}</div>
              ) : (
                <p className="muted">Nothing else today.</p>
              )}
              {data.tomorrow.length > 0 && (
                <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                  <div className="muted">Tomorrow</div>
                  <div style={{ fontWeight: 500 }}>
                    {data.tomorrow[0]!.title}, {data.tomorrow[0]!.start}
                    {data.tomorrow.length > 1 ? ` and ${data.tomorrow.length - 1} more` : ""}
                  </div>
                </div>
              )}
            </Card>
            <Card className="pad stack">
              <CardHead icon="bill" title="Bills" page="bills" />
              {data.bills.length ? (
                <div className="stack">
                  {data.bills.map((b) => (
                    <div className="between" key={b.id} style={{ alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 500 }}>{b.payee}</div>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: b.daysLeft !== null && b.daysLeft <= 3 ? "var(--apricot-ink)" : "var(--ink2)" }}>{b.due}</div>
                      </div>
                      <div style={{ fontWeight: 600 }}>{b.amount}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">No bills due in the next two weeks.</p>
              )}
              {data.newBills > 0 && (
                <button type="button" className="btn" onClick={() => go("bills")} style={{ marginTop: "auto", justifyContent: "space-between", border: 0, background: "var(--apricot-soft)", color: "var(--apricot-ink)" }}>
                  {data.newBills} new bill{data.newBills === 1 ? "" : "s"} to check
                  <Icon name="right" size={16} />
                </button>
              )}
            </Card>
            <Card className="pad stack">
              <CardHead icon="mail" title="Mail" page="mail" />
              {!data.google ? (
                <ConnectHint />
              ) : data.mailProblem ? (
                <Note tone="apricot" icon="warn">
                  {data.mailProblem}
                </Note>
              ) : data.mail.length ? (
                <div className="stack">
                  {data.mail.map((m) => (
                    <div key={m.id}>
                      <div style={{ fontWeight: 500 }} className="ellipsis">
                        {m.from}
                      </div>
                      <div className="muted ellipsis">{m.subject}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">No unread mail in Primary since yesterday.</p>
              )}
              {data.mailCount > 0 && (
                <div className="muted" style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                  {data.mailCount === 20 ? "20+" : data.mailCount} unread in Primary since yesterday
                </div>
              )}
            </Card>
            <Card className="pad stack">
              <CardHead icon="bell" title="Reminders" page="reminders" />
              {data.reminders.length ? (
                <div className="stack">{data.reminders.slice(0, 4).map((r) => <TimeRow key={r.id} time={r.due} title={r.text} sub={r.repeat ?? undefined} />)}</div>
              ) : (
                <p className="muted">Nothing for the rest of today.</p>
              )}
              <div className="row muted" style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                <Icon name="moon" size={16} color="var(--ink3)" />
                {state.background ? "Reminders also arrive when Edward is closed" : "Reminders only arrive while Edward is open"}
              </div>
            </Card>
          </div>
        )}

        <div className="stack" style={{ flexShrink: 0, gap: 10 }}>
          <Composer onSent={() => go("chat")} placeholder="Ask Edward anything, or tell it what to do" />
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {SUGGESTIONS.map((s) => (
              <button
                type="button"
                key={s}
                className="pill"
                style={{ background: "rgba(255,255,255,0.86)", fontWeight: 500 }}
                onClick={() => {
                  chat.send(s);
                  go("chat");
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}

function ConnectHint() {
  const { go } = useApp();
  return (
    <div className="stack">
      <p className="muted pretty">Connect your Google account to see your calendar and mail here.</p>
      <div>
        <button type="button" className="btn small" onClick={() => go("google")}>
          Connect Google
        </button>
      </div>
    </div>
  );
}
