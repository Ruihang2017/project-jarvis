import type { ComingUp, EventInfo, TripInfo, WeekView } from "../../../shared/api";
import { useApp, Shell } from "../App";
import { call, useData } from "../api";
import { art, Card, Icon, Loading, Note } from "../ui";
import { Composer } from "./Chat";
import { digestMail, openMailLater } from "./Mail";

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
  const { data, reload } = useData(() => call("today"), [state.google.connected]);
  const evening = data?.evening ?? new Date().getHours() >= 18;
  // A heads-up card above the others: the page scrolls rather than squeezing them.
  const banner = Boolean(data?.comingUp || data?.week || data?.trips);
  return (
    <Shell title="Today" sub={data?.date ?? ""} fixed={!banner}>
      <div className="stack" style={{ height: banner ? undefined : "100%", gap: 16 }}>
        <section className="hero" aria-label="Today at a glance" style={{ height: banner ? 196 : 270, flexShrink: 0, background: evening ? "#131b33" : undefined }}>
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

        {data?.trips && <TripsCard found={data.trips.found} next={data.trips.next} onChange={reload} />}
        {data?.week && <WeekCard w={data.week} />}
        {data?.comingUp && <ComingUpCard c={data.comingUp} />}

        {!data ? (
          <Loading what="Getting today ready" />
        ) : (
          <div className="grid-4" style={{ flex: 1, minHeight: banner ? 300 : 0 }}>
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
              ) : data.digest ? (
                <div className="stack" style={{ gap: 8 }}>
                  <div style={{ fontWeight: 600 }}>{data.digest.headline}</div>
                  {!data.digest.items.length && data.digest.rest && <div className="muted">{data.digest.rest}</div>}
                  {[...data.digest.items.filter((i) => i.group === "act"), ...data.digest.items.filter((i) => i.group !== "act")].slice(0, 3).map((i) => (
                    <button
                      type="button"
                      key={i.id}
                      className="list-btn"
                      style={{ padding: "4px 8px", margin: "0 -8px" }}
                      onClick={() => {
                        openMailLater(digestMail(i));
                        go("mail");
                      }}
                    >
                      <span style={{ fontWeight: i.group === "act" ? 500 : 400, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {i.line}
                      </span>
                    </button>
                  ))}
                </div>
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
              {data.digest ? (
                <div className="muted" style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                  Summary of mail since {data.digest.since} · {data.mailCount === 20 ? "20+" : data.mailCount} unread
                </div>
              ) : data.mailCount > 0 && (
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

const KIND_LABEL = { flight: "Flight", hotel: "Stay", car: "Car hire", train: "Train" };
const BUFFER_OPTIONS = [
  { value: 60, label: "1 h" },
  { value: 90, label: "1½ h" },
  { value: 120, label: "2 h" },
  { value: 180, label: "3 h" },
];

/** Trips (H2): bookings just found in email, and the next trip within a week. */
function TripsCard({ found, next, onChange }: { found: TripInfo[]; next?: TripInfo; onChange: () => void }) {
  const { go, toast } = useApp();
  const act = async (id: number, action: "calendar" | "dismiss" | "confirm" | "packing") => {
    const r = await call("tripAction", id, action);
    toast(r);
    if (r.ok && action === "packing") go("lists");
    else onChange();
  };
  const openMail = (t: TripInfo) => {
    openMailLater({ id: t.mailId, threadId: "", from: "", subject: t.title, snippet: "", date: "", looksLikeBill: false, unread: false });
    go("mail");
  };
  return (
    <Card className="pad stack" style={{ flexShrink: 0, gap: 12, borderLeft: "4px solid var(--sage, #4f8a6b)" }}>
      {next && (
        <div className="between" style={{ alignItems: "flex-start", gap: 16 }}>
          <div className="stack" style={{ gap: 4, minWidth: 0 }}>
            <div className="label">Next trip · {next.when}</div>
            <div style={{ fontFamily: "var(--disp)", fontSize: 19, fontWeight: 600 }} className="ellipsis">
              {next.title}
            </div>
            {next.where && (
              <div className="row muted" style={{ gap: 6 }}>
                <Icon name="pin" size={15} />
                <span className="ellipsis">{next.where}</span>
                {next.mapUrl && (
                  <a href={next.mapUrl} target="_blank" rel="noreferrer noopener">
                    Map
                  </a>
                )}
              </div>
            )}
            {next.weather && <div className="muted">Weather there: {next.weather}</div>}
            {next.leaveBy && (
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <span>
                  Leave by <b>{next.leaveBy}</b>, allowing
                </span>
                {BUFFER_OPTIONS.map((o) => (
                  <button
                    type="button"
                    key={o.value}
                    className="pill"
                    aria-pressed={next.bufferMin === o.value}
                    style={{ fontWeight: next.bufferMin === o.value ? 700 : 400 }}
                    onClick={async () => {
                      await call("tripBuffer", next.id, o.value);
                      onChange();
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="row" style={{ gap: 8, flexShrink: 0 }}>
            {next.status !== "added" && (
              <button type="button" className="btn small" onClick={() => void act(next.id, "calendar")}>
                <Icon name="calendar" size={15} /> Add to calendar
              </button>
            )}
            <button type="button" className="btn small" onClick={() => void act(next.id, "packing")}>
              <Icon name="check" size={15} /> Packing list
            </button>
            <button type="button" className="btn small" onClick={() => openMail(next)}>
              <Icon name="mail" size={15} /> Email
            </button>
          </div>
        </div>
      )}
      {found.filter((t) => t.id !== next?.id).length > 0 && (
        <div className="stack" style={{ gap: 6, borderTop: next ? "1px solid var(--line)" : undefined, paddingTop: next ? 10 : 0 }}>
          <div className="label">Found in your email</div>
          {found
            .filter((t) => t.id !== next?.id)
            .map((t) => (
              <div key={t.id} className="between" style={{ gap: 12 }}>
                <div className="ellipsis">
                  <b>{KIND_LABEL[t.kind]}</b> {t.title.replace(/^(Flight|Train|Stay:|Car hire:?)\s*/, "")} · {t.when}
                  {t.needsCheck && <span className="muted"> · please check the details in the email</span>}
                </div>
                <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                  {t.needsCheck && (
                    <button type="button" className="btn small" onClick={() => void act(t.id, "confirm")}>
                      Details are right
                    </button>
                  )}
                  <button type="button" className="btn small" onClick={() => void act(t.id, "calendar")}>
                    Add to calendar
                  </button>
                  <button type="button" className="btn small" onClick={() => openMail(t)}>
                    Email
                  </button>
                  <button type="button" className="btn small" onClick={() => void act(t.id, "dismiss")}>
                    Not a trip
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
    </Card>
  );
}

/** Weekly review (H3): the seven days from tomorrow, on the review day. */
function WeekCard({ w }: { w: WeekView }) {
  const { go, chat } = useApp();
  const extras = [...w.bills.map((b) => `Bill: ${b}`), ...w.todo.map((x) => `To do: ${x}`), ...w.reminders.map((r) => `Reminder: ${r}`)];
  return (
    <Card className="pad stack" style={{ flexShrink: 0, gap: 12, borderLeft: "4px solid var(--apricot)" }}>
      <div className="between">
        <div>
          <div className="label">Next week</div>
          <div style={{ fontFamily: "var(--disp)", fontSize: 19, fontWeight: 600 }}>{w.headline}</div>
        </div>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            chat.send("Help me plan the coming week: look at my calendar, bills and lists for the next seven days and suggest what to do when.");
            go("chat");
          }}
        >
          <Icon name="chat" size={15} /> Plan my week
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 8 }}>
        {w.days.map((d) => (
          <div key={d.date} className="stack" style={{ gap: 2, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--blue-ink)" }}>{d.label}</div>
            {d.events.slice(0, 3).map((e, i) => (
              <div key={i} className="ellipsis" style={{ fontSize: 13 }}>
                {e}
              </div>
            ))}
            {d.events.length > 3 && <div className="muted" style={{ fontSize: 12.5 }}>+{d.events.length - 3} more</div>}
            {!d.events.length && <div className="muted" style={{ fontSize: 13 }}>Free</div>}
          </div>
        ))}
      </div>
      {extras.length > 0 && (
        <div className="muted ellipsis" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          {extras.slice(0, 3).join(" · ")}
          {extras.length > 3 ? ` · and ${extras.length - 3} more` : ""}
        </div>
      )}
    </Card>
  );
}

/** Meeting heads-up (H1): the next event with a place, people or related email. */
function ComingUpCard({ c }: { c: ComingUp }) {
  const { go, chat } = useApp();
  const e = c.event;
  return (
    <Card className="pad" style={{ flexShrink: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr) auto", gap: 24, alignItems: "start", borderLeft: "4px solid var(--blue)" }}>
      <div className="stack" style={{ gap: 6 }}>
        <div className="label">Coming up · {c.when}</div>
        <div style={{ fontFamily: "var(--disp)", fontSize: 21, fontWeight: 600, lineHeight: 1.2 }} className="ellipsis">
          {e.start} {e.title}
        </div>
        {e.location && (
          <div className="row muted" style={{ gap: 6 }}>
            <Icon name="pin" size={15} />
            <span className="ellipsis">{e.location}</span>
            {c.mapUrl && (
              <a href={c.mapUrl} target="_blank" rel="noreferrer noopener" style={{ flexShrink: 0 }}>
                Map
              </a>
            )}
          </div>
        )}
        {c.withWhom && (
          <div className="row muted" style={{ gap: 6 }}>
            <Icon name="users" size={15} />
            <span className="ellipsis">With {c.withWhom}</span>
          </div>
        )}
      </div>
      <div className="stack" style={{ gap: 4, minWidth: 0 }}>
        {c.related.length > 0 && <div className="muted">Related email</div>}
        {c.related.map((m) => (
          <button
            type="button"
            key={m.id}
            className="list-btn"
            style={{ padding: "4px 8px" }}
            onClick={() => {
              openMailLater(m);
              go("mail");
            }}
          >
            <div className="ellipsis" style={{ fontWeight: 500 }}>
              {m.from} — {m.subject}
            </div>
          </button>
        ))}
        {c.notes.map((n) => (
          <div key={n} className="muted ellipsis">
            <Icon name="book" size={14} /> {n}
          </div>
        ))}
        {!c.related.length && !c.notes.length && <div className="muted">Nothing in your mail about it in the last 30 days.</div>}
      </div>
      <button
        type="button"
        className="btn small"
        onClick={() => {
          chat.send(`Help me get ready for "${e.title}" at ${e.start} today.`);
          go("chat");
        }}
      >
        <Icon name="chat" size={15} /> Help me get ready
      </button>
    </Card>
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
