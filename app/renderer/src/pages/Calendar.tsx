import { useState } from "react";
import type { EventInfo } from "../../../shared/api";
import { useApp, Shell } from "../App";
import { call, useData } from "../api";
import { Button, Card, Loading, Note, Segmented, Spot, Tag } from "../ui";

const COLORS = ["#5B7FD9", "#F0A066", "#6FA57E", "#B68AD6", "#D9748B", "#4BA3B5"];

function EventRow({ e, color }: { e: EventInfo; color: string }) {
  return (
    <div className="row" style={{ alignItems: "stretch", gap: 14, padding: "12px 14px", borderRadius: 14, background: "var(--bg)", opacity: e.declined ? 0.6 : 1 }}>
      <div style={{ width: 4, borderRadius: 4, background: color }} />
      <div style={{ width: 110, flexShrink: 0, fontSize: 13, fontWeight: 600, color: "var(--ink2)" }}>
        {e.allDay ? "All day" : e.start}
        {!e.allDay && <span style={{ fontWeight: 400 }}> to {e.end}</span>}
      </div>
      <div className="grow">
        <div style={{ fontWeight: 600 }}>{e.title}</div>
        <div className="muted">{[e.location, e.calendar].filter(Boolean).join(" · ")}</div>
      </div>
      {e.guests > 0 && (
        <Tag icon="users">
          {e.guests} guest{e.guests === 1 ? "" : "s"}
        </Tag>
      )}
    </div>
  );
}

export function Calendar() {
  const { go, chat } = useApp();
  const [days, setDays] = useState<"2" | "7">("2");
  const { data, error, reload } = useData(() => call("calendar", Number(days)), [days]);
  const colorOf = (name: string) => COLORS[Math.abs([...name].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % COLORS.length]!;
  const ask = (text: string) => {
    chat.send(text);
    go("chat");
  };
  return (
    <Shell
      title="Calendar"
      sub={data?.manyAccounts ? "From your Google Calendars, every account together" : "From your Google Calendar"}
      actions={
        <>
          <Segmented label="Range" value={days} onChange={setDays} options={[{ value: "2", label: "Today and tomorrow" }, { value: "7", label: "Week" }]} />
          <Button kind="primary" icon="plus" onClick={() => go("chat")} disabled={!data?.connected}>
            Add an event
          </Button>
        </>
      }
    >
      {!data && !error ? (
        <Loading />
      ) : !data?.connected ? (
        <NotConnected what="your calendar" />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 16 }}>
          <Card className="pad stack" style={{ gap: 18 }}>
            {data.problem && (
              <Note tone="apricot" icon="warn">
                {data.problem}{" "}
                <button type="button" className="btn small ghost" onClick={reload}>
                  Try again
                </button>
              </Note>
            )}
            {data.days.map((d) => (
              <div key={d.date} className="stack" style={{ gap: 8 }}>
                <div className="label">{d.label}</div>
                {d.events.length ? d.events.map((e) => <EventRow key={e.id} e={e} color={data.manyAccounts && e.color ? e.color : colorOf(e.calendar)} />) : <p className="muted">Nothing.</p>}
              </div>
            ))}
            <Note tone="blue" icon="chat">
              To add, move or remove an event, just ask: "move the dentist to 4:30". Edward shows you the change first, never invites anyone, and leaves events with other guests alone.
            </Note>
          </Card>
          <div className="stack" style={{ gap: 16 }}>
            <Card className="pad stack">
              <div style={{ display: "flex", justifyContent: "center" }}>
                <Spot name="spot-calendar" size={140} alt="A small desk calendar with a sprig of flowers" />
              </div>
              <h2>Free time</h2>
              {data.free.length ? (
                <div className="stack" style={{ gap: 8, fontSize: 13.5 }}>
                  {data.free.map((f) => (
                    <div key={f.date}>
                      <div className="faint" style={{ fontSize: 12.5 }}>
                        {f.label.split(" · ")[0]}
                      </div>
                      <div>{f.slots.slice(0, 3).join(", ")}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">No free half-hours between 9 and 6.</p>
              )}
              <Button kind="soft" onClick={() => ask("When am I free this week for an hour?")}>
                Ask about a time
              </Button>
            </Card>
            <Card className="pad stack" style={{ gap: 8 }}>
              <h2>Calendars shown</h2>
              {data.calendars.map((c) => (
                <div className="row" key={`${c.account ?? ""}/${c.name}`} style={{ minHeight: 36 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: data.manyAccounts && c.color ? c.color : colorOf(c.name) }} />
                  <span className="grow ellipsis">
                    {c.name}
                    {data.manyAccounts && c.accountLabel && c.accountLabel !== c.name && <span className="muted"> · {c.accountLabel}</span>}
                  </span>
                  {c.primary && !data.manyAccounts && <Tag>Main</Tag>}
                </div>
              ))}
              <p className="muted">These follow what's ticked in Google Calendar.</p>
            </Card>
          </div>
        </div>
      )}
    </Shell>
  );
}

export function NotConnected({ what }: { what: string }) {
  const { go, state } = useApp();
  return (
    <Card className="pad">
      <div className="row" style={{ gap: 28, padding: "20px 12px" }}>
        <Spot name={state.google.expired ? "spot-umbrella" : "spot-key"} size={150} />
        <div className="stack" style={{ maxWidth: 520 }}>
          <h2 style={{ fontSize: 22 }}>{state.google.expired ? "Google stopped answering" : "Connect your Google account"}</h2>
          <p className="muted pretty" style={{ fontSize: 14 }}>
            {state.google.expired
              ? "The connection expired or was withdrawn. Reconnect to see " + what + " again; reminders and memory keep working."
              : `Edward reads ${what} through a small Google Cloud project of your own, so nothing passes through anyone else.`}
          </p>
          <div>
            <Button kind="primary" icon={state.google.expired ? "refresh" : "key"} onClick={() => go("google")}>
              {state.google.expired ? "Reconnect Google" : "Connect Google"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

