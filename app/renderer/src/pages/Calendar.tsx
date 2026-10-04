import { useEffect, useMemo, useRef, useState } from "react";
import type { CalendarTarget, CalendarView, EventForm, EventInfo } from "../../../shared/api";
import { useApp, Shell } from "../App";
import { call, useData } from "../api";
import { layoutDay } from "../layout";
import { AccountChip, Button, Card, Confirm, IconButton, Loading, Note, Segmented, Spot, Tag, Toggle } from "../ui";

const COLORS = ["#5B7FD9", "#F0A066", "#6FA57E", "#B68AD6", "#D9748B", "#4BA3B5"];
const colorOfName = (name: string) => COLORS[Math.abs([...name].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % COLORS.length]!;

// ---------------------------------------------------------------- local dates ("YYYY-MM-DD")

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
/** Monday of the week the day is in. */
const weekStart = (s: string) => addDays(s, -((parse(s).getDay() + 6) % 7));
const monthStart = (s: string) => `${s.slice(0, 7)}-01`;
const addMonths = (s: string, n: number) => {
  const d = parse(monthStart(s));
  d.setMonth(d.getMonth() + n);
  return iso(d);
};
const today = () => iso(new Date());
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type View = "agenda" | "week" | "month";
type Panel = { kind: "event"; e: EventInfo } | { kind: "form"; form: EventForm; id?: string; calendar?: string } | null;

export function Calendar() {
  const { go, chat, toast } = useApp();
  const [view, setView] = useState<View>("agenda");
  const [anchor, setAnchor] = useState(today());
  const [panel, setPanel] = useState<Panel>(null);
  const [round, setRound] = useState(0);
  const range = useMemo(() => {
    if (view === "week") return { from: weekStart(anchor), to: addDays(weekStart(anchor), 7) };
    if (view === "month") {
      const first = weekStart(monthStart(anchor));
      return { from: first, to: addDays(first, 42) };
    }
    return null;
  }, [view, anchor]);
  const { data, error } = useData(() => (range ? call("calendarRange", range.from, range.to) : call("calendar", 7)), [view, range?.from, round]);
  const [targets, setTargets] = useState<CalendarTarget[] | null>(null);
  const many = Boolean(data?.manyAccounts);
  const colorOf = (e: EventInfo) => (many && e.color ? e.color : colorOfName(e.calendar));
  const ask = (text: string) => {
    chat.send(text);
    go("chat");
  };
  const reload = () => setRound((n) => n + 1);
  const newEvent = async (date = today(), hour?: number) => {
    const list = targets ?? (await call("calendarTargets").catch(() => []));
    setTargets(list);
    const h = hour ?? Math.min(new Date().getHours() + 1, 22);
    const start = `${date}T${pad(h)}:00`;
    setPanel({ kind: "form", form: { target: (list.find((t) => t.isDefault) ?? list[0])?.id, title: "", start, end: `${date}T${pad(h + 1)}:00` } });
  };
  const step = (n: number) => setAnchor((a) => (view === "month" ? addMonths(a, n) : addDays(a, 7 * n)));
  const heading =
    view === "week" && range
      ? `${parse(range.from).toLocaleDateString("en-AU", { day: "numeric", month: "short" })} – ${parse(addDays(range.to, -1)).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`
      : view === "month"
        ? parse(monthStart(anchor)).toLocaleDateString("en-AU", { month: "long", year: "numeric" })
        : many
          ? "From your Google Calendars, every account together"
          : "From your Google Calendar";
  return (
    <Shell
      title="Calendar"
      sub={heading}
      fixed
      actions={
        <>
          {view !== "agenda" && (
            <span className="row" style={{ gap: 4 }}>
              <IconButton icon="left" label={view === "month" ? "Previous month" : "Previous week"} onClick={() => step(-1)} />
              <Button small kind="ghost" onClick={() => setAnchor(today())}>
                Today
              </Button>
              <IconButton icon="right" label={view === "month" ? "Next month" : "Next week"} onClick={() => step(1)} />
            </span>
          )}
          <Segmented
            label="View"
            value={view}
            onChange={(v) => (setView(v), setPanel(null))}
            options={[
              { value: "agenda", label: "Agenda" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
            ]}
          />
          <Button kind="primary" icon="plus" onClick={() => void newEvent(view === "agenda" ? today() : anchor < today() || anchor >= (range?.to ?? "") ? range?.from : today())} disabled={!data?.connected}>
            New event
          </Button>
        </>
      }
    >
      {!data && !error ? (
        <Loading />
      ) : !data?.connected ? (
        <NotConnected what="your calendar" />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: 16, height: "100%", minHeight: 0 }}>
          <Card className="stack" style={{ padding: view === "agenda" ? 24 : 12, gap: 18, overflow: "auto", minHeight: 0 }}>
            {data.problem && (
              <Note tone="apricot" icon="warn">
                {data.problem}{" "}
                <button type="button" className="btn small ghost" onClick={reload}>
                  Try again
                </button>
              </Note>
            )}
            {view === "agenda" && <Agenda data={data} colorOf={colorOf} onPick={(e) => setPanel({ kind: "event", e })} />}
            {view === "week" && <WeekGrid data={data} colorOf={colorOf} onPick={(e) => setPanel({ kind: "event", e })} onSlot={(d, h) => void newEvent(d, h)} />}
            {view === "month" && (
              <MonthGrid
                data={data}
                month={anchor.slice(0, 7)}
                colorOf={colorOf}
                onPick={(e) => setPanel({ kind: "event", e })}
                onDay={(d) => (setAnchor(d), setView("week"), setPanel(null))}
              />
            )}
          </Card>
          <div className="stack" style={{ gap: 16, overflow: "auto", minHeight: 0 }}>
            {panel?.kind === "event" ? (
              <EventDetails
                e={panel.e}
                many={many}
                onClose={() => setPanel(null)}
                onEdit={() =>
                  setPanel({
                    kind: "form",
                    id: panel.e.id,
                    calendar: panel.e.calendar,
                    form: { title: panel.e.title, start: panel.e.startAt, end: panel.e.endAt, location: panel.e.location ?? "", notes: panel.e.notes ?? "" },
                  })
                }
                onDeleted={(r) => (toast(r), r.ok && (setPanel(null), reload()))}
              />
            ) : panel?.kind === "form" ? (
              <EventFormPanel
                key={panel.id ?? "new"}
                initial={panel.form}
                id={panel.id}
                calendar={panel.calendar}
                targets={targets ?? []}
                onCancel={() => setPanel(null)}
                onSaved={(r) => (toast(r), r.ok && (setPanel(null), reload()))}
              />
            ) : (
              <>
                <Card className="pad stack">
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <Spot name="spot-calendar" size={120} alt="A small desk calendar with a sprig of flowers" />
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
                    <div className="row" key={`${c.account ?? ""}/${c.name}`} style={{ minHeight: 34 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: many && c.color ? c.color : colorOfName(c.name) }} />
                      <span className="grow ellipsis">
                        {c.name}
                        {many && c.accountLabel && c.accountLabel !== c.name && <span className="muted"> · {c.accountLabel}</span>}
                      </span>
                      {c.primary && !many && <Tag>Main</Tag>}
                    </div>
                  ))}
                  <p className="muted">These follow what's ticked in Google Calendar.</p>
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- agenda

function EventRow({ e, color, onPick }: { e: EventInfo; color: string; onPick: () => void }) {
  return (
    <button type="button" className="row" onClick={onPick} style={{ alignItems: "stretch", gap: 14, padding: "12px 14px", borderRadius: 14, background: "var(--bg)", opacity: e.declined ? 0.6 : 1, border: 0, textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}>
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
    </button>
  );
}

function Agenda({ data, colorOf, onPick }: { data: CalendarView; colorOf: (e: EventInfo) => string; onPick: (e: EventInfo) => void }) {
  return (
    <>
      {data.days.map((d) => (
        <div key={d.date} className="stack" style={{ gap: 8 }}>
          <div className="label">{d.label}</div>
          {d.events.length ? d.events.map((e) => <EventRow key={e.id} e={e} color={colorOf(e)} onPick={() => onPick(e)} />) : <p className="muted">Nothing.</p>}
        </div>
      ))}
      <Note tone="blue" icon="chat">
        Click an event to change it, or New event to add one. You can also just ask: "move the dentist to 4:30". Edward never invites anyone and leaves events with other guests alone.
      </Note>
    </>
  );
}

// ---------------------------------------------------------------- week

const HOUR = 48;

function WeekGrid({ data, colorOf, onPick, onSlot }: { data: CalendarView; colorOf: (e: EventInfo) => string; onPick: (e: EventInfo) => void; onSlot: (date: string, hour: number) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7 * HOUR;
  }, []);
  const now = new Date();
  const nowDay = iso(now);
  return (
    <div className="stack" style={{ gap: 0, height: "100%", minHeight: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: `52px repeat(7, minmax(0, 1fr))`, borderBottom: "1px solid var(--line)" }}>
        <span />
        {data.days.map((d, i) => (
          <div key={d.date} style={{ padding: "6px 6px 8px", textAlign: "center", fontWeight: d.date === nowDay ? 700 : 500, color: d.date === nowDay ? "var(--blue)" : "var(--ink2)" }}>
            {WEEKDAYS[i]} {parse(d.date).getDate()}
          </div>
        ))}
        <span className="muted" style={{ fontSize: 11, padding: "2px 4px" }}>
          all day
        </span>
        {data.days.map((d) => (
          <div key={d.date} className="stack" style={{ gap: 2, padding: 2, minHeight: 24, borderLeft: "1px solid var(--line)" }}>
            {d.events
              .filter((e) => e.allDay)
              .map((e) => (
                <button key={e.id} type="button" className="ellipsis" onClick={() => onPick(e)} style={{ border: 0, borderRadius: 6, padding: "2px 6px", fontSize: 12, textAlign: "left", background: colorOf(e), color: "#fff", cursor: "pointer" }}>
                  {e.title}
                </button>
              ))}
          </div>
        ))}
      </div>
      <div ref={scroller} style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: `52px repeat(7, minmax(0, 1fr))`, position: "relative", height: 24 * HOUR }}>
          <div>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="muted" style={{ height: HOUR, fontSize: 11, textAlign: "right", paddingRight: 6, transform: "translateY(-7px)" }}>
                {h ? `${pad(h)}:00` : ""}
              </div>
            ))}
          </div>
          {data.days.map((d) => {
            const placed = layoutDay(
              d.date,
              d.events.filter((e) => !e.allDay && e.date === d.date),
            ).map((p) => ({ ...p, e: p.item }));
            const width = 100 / (placed[0]?.lanes ?? 1);
            return (
              <div key={d.date} style={{ position: "relative", borderLeft: "1px solid var(--line)" }}>
                {Array.from({ length: 24 }, (_, h) => (
                  <button
                    key={h}
                    type="button"
                    aria-label={`New event ${d.date} ${pad(h)}:00`}
                    onClick={() => onSlot(d.date, h)}
                    style={{ display: "block", width: "100%", height: HOUR, border: 0, borderTop: "1px solid var(--line)", background: "transparent", cursor: "pointer" }}
                  />
                ))}
                {d.date === nowDay && <div style={{ position: "absolute", left: 0, right: 0, top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR, height: 2, background: "var(--rose, #D9748B)" }} />}
                {placed.map(({ e, from, to, lane }) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onPick(e)}
                    title={`${e.start}–${e.end} ${e.title}`}
                    style={{
                      position: "absolute",
                      top: (from / 60) * HOUR + 1,
                      height: Math.max(18, ((to - from) / 60) * HOUR - 2),
                      left: `calc(${lane * width}% + 2px)`,
                      width: `calc(${width}% - 4px)`,
                      border: 0,
                      borderRadius: 8,
                      padding: "3px 6px",
                      background: colorOf(e),
                      color: "#fff",
                      textAlign: "left",
                      fontSize: 12,
                      lineHeight: 1.25,
                      overflow: "hidden",
                      cursor: "pointer",
                      opacity: e.declined ? 0.55 : 1,
                    }}
                  >
                    <b>{e.title}</b>
                    <div style={{ opacity: 0.9 }}>
                      {e.start}–{e.end}
                    </div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- month

function MonthGrid({ data, month, colorOf, onPick, onDay }: { data: CalendarView; month: string; colorOf: (e: EventInfo) => string; onPick: (e: EventInfo) => void; onDay: (date: string) => void }) {
  const nowDay = today();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gridTemplateRows: "24px", gridAutoRows: "minmax(96px, 1fr)", height: "100%" }}>
      {WEEKDAYS.map((w) => (
        <div key={w} className="muted" style={{ fontSize: 12, padding: "4px 6px", height: 24 }}>
          {w}
        </div>
      ))}
      {data.days.map((d) => (
        <div key={d.date} className="stack" style={{ gap: 2, padding: 4, borderTop: "1px solid var(--line)", opacity: d.date.slice(0, 7) === month ? 1 : 0.45, minWidth: 0 }}>
          <button
            type="button"
            onClick={() => onDay(d.date)}
            aria-label={`Show the week of ${d.date}`}
            style={{ alignSelf: "flex-start", border: 0, background: d.date === nowDay ? "var(--blue)" : "transparent", color: d.date === nowDay ? "#fff" : "var(--ink)", borderRadius: 99, minWidth: 24, height: 24, fontWeight: 600, cursor: "pointer" }}
          >
            {parse(d.date).getDate()}
          </button>
          {d.events.slice(0, 3).map((e) => (
            <button key={e.id} type="button" className="row ellipsis" onClick={() => onPick(e)} style={{ gap: 4, border: 0, background: "transparent", padding: "1px 2px", fontSize: 12, textAlign: "left", cursor: "pointer", color: "var(--ink)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: colorOf(e), flexShrink: 0 }} />
              <span className="ellipsis">
                {e.allDay ? "" : `${e.start} `}
                {e.title}
              </span>
            </button>
          ))}
          {d.events.length > 3 && (
            <button type="button" className="muted" onClick={() => onDay(d.date)} style={{ border: 0, background: "transparent", fontSize: 12, textAlign: "left", cursor: "pointer", padding: "0 2px" }}>
              +{d.events.length - 3} more
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- details and form

function EventDetails({ e, many, onClose, onEdit, onDeleted }: { e: EventInfo; many: boolean; onClose: () => void; onEdit: () => void; onDeleted: (r: { ok: boolean; message: string }) => void }) {
  const [confirm, setConfirm] = useState(false);
  const when = e.allDay
    ? e.endAt > e.startAt
      ? `${parse(e.startAt).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })} – ${parse(e.endAt).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}, all day`
      : `${parse(e.startAt).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}, all day`
    : `${parse(e.startAt).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}, ${e.start} to ${e.end}`;
  return (
    <Card className="pad stack" style={{ gap: 12 }}>
      <div className="between" style={{ alignItems: "flex-start" }}>
        <h2 style={{ fontSize: 21 }}>{e.title}</h2>
        <IconButton icon="x" label="Close" onClick={onClose} />
      </div>
      <div>{when}</div>
      {e.recurring && <span className="muted">Repeats. Changes here apply to this time only.</span>}
      {e.location && <div className="muted">@ {e.location}</div>}
      <div className="muted">{e.calendar}</div>
      {many && e.accountLabel && <AccountChip label={e.accountLabel} color={e.color} />}
      {e.notes && <div className="pretty" style={{ whiteSpace: "pre-wrap", fontSize: 14, maxHeight: 220, overflow: "auto", background: "var(--bg)", borderRadius: 10, padding: 10 }}>{e.notes}</div>}
      {e.editable ? (
        <div className="row" style={{ gap: 8 }}>
          <Button kind="primary" icon="pencil" onClick={onEdit}>
            Edit
          </Button>
          <Button kind="ghost" onClick={() => setConfirm(true)}>
            Delete
          </Button>
        </div>
      ) : (
        <Note icon="users">{e.guests > 0 ? "This event has other guests. Change it in Google Calendar, so they are told." : "This calendar is read-only."}</Note>
      )}
      {confirm && (
        <Confirm
          danger
          title="Delete this event?"
          yes="Delete"
          onAnswer={async (yes) => {
            setConfirm(false);
            if (yes) onDeleted(await call("eventDelete", e.id));
          }}
        >
          {e.title} · {when}
          {e.recurring ? " (this time only)" : ""}
        </Confirm>
      )}
    </Card>
  );
}

function EventFormPanel({ initial, id, calendar, targets, onCancel, onSaved }: { initial: EventForm; id?: string; calendar?: string; targets: CalendarTarget[]; onCancel: () => void; onSaved: (r: { ok: boolean; message: string }) => void }) {
  const [f, setF] = useState<EventForm>(initial);
  const [busy, setBusy] = useState(false);
  const allDay = f.start.length === 10;
  const set = (patch: Partial<EventForm>) => setF((x) => ({ ...x, ...patch }));
  const date = (at: string) => at.slice(0, 10);
  const time = (at: string) => (at.length > 10 ? at.slice(11, 16) : "09:00");
  const setAllDay = (on: boolean) =>
    set(on ? { start: date(f.start), end: date(f.end) } : { start: `${date(f.start)}T09:00`, end: `${date(f.end) || date(f.start)}T10:00` });
  const row = (label: string, child: React.ReactNode) => (
    <label className="stack" style={{ gap: 4 }}>
      <span className="muted" style={{ fontSize: 12.5 }}>
        {label}
      </span>
      {child}
    </label>
  );
  const input = { className: "input", style: { width: "100%" } };
  return (
    <Card className="pad stack" style={{ gap: 12 }}>
      <div className="between">
        <h2 style={{ fontSize: 21 }}>{id ? "Edit event" : "New event"}</h2>
        <IconButton icon="x" label="Cancel" onClick={onCancel} />
      </div>
      <form
        className="stack"
        style={{ gap: 12 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          onSaved(await call("eventSave", f, id));
          setBusy(false);
        }}
      >
        {row("Title", <input {...input} autoFocus value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="Dentist" />)}
        <label className="row" style={{ gap: 10 }}>
          <Toggle on={allDay} label="All day" onChange={setAllDay} />
          All day
        </label>
        <div style={{ display: "grid", gridTemplateColumns: allDay ? "1fr" : "1fr 110px", gap: 8 }}>
          {row("Starts", <input {...input} type="date" value={date(f.start)} onChange={(e) => set({ start: allDay ? e.target.value : `${e.target.value}T${time(f.start)}` })} />)}
          {!allDay && row("at", <input {...input} type="time" value={time(f.start)} onChange={(e) => set({ start: `${date(f.start)}T${e.target.value}` })} />)}
          {row("Ends", <input {...input} type="date" value={date(f.end)} onChange={(e) => set({ end: allDay ? e.target.value : `${e.target.value}T${time(f.end)}` })} />)}
          {!allDay && row("at", <input {...input} type="time" value={time(f.end)} onChange={(e) => set({ end: `${date(f.end)}T${e.target.value}` })} />)}
        </div>
        {row("Where", <input {...input} value={f.location ?? ""} onChange={(e) => set({ location: e.target.value })} placeholder="Optional" />)}
        {row(
          "Notes",
          <textarea className="input" rows={3} value={f.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} style={{ width: "100%", resize: "vertical", font: "inherit" }} />,
        )}
        {id
          ? row("Calendar", <span>{calendar}</span>)
          : row(
              "Calendar",
              <select {...input} value={f.target ?? ""} onChange={(e) => set({ target: e.target.value })}>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.name !== t.accountLabel ? ` · ${t.accountLabel}` : ""}
                  </option>
                ))}
              </select>,
            )}
        <div className="row" style={{ gap: 8 }}>
          <Button kind="primary" type="submit" disabled={busy || !f.title.trim()}>
            {busy ? "Saving…" : id ? "Save" : "Add"}
          </Button>
          <Button kind="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>
          Nobody is invited and no email goes out.
        </p>
      </form>
    </Card>
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
              ? "The connection expired or was withdrawn. Sign in again to see " + what + " again; reminders and memory keep working."
              : `Connect a personal Google account to see ${what} here. It goes from Google straight to this computer.`}
          </p>
          <div>
            <Button kind="primary" icon={state.google.expired ? "refresh" : "key"} onClick={() => go("google")}>
              {state.google.expired ? "Sign in again" : "Connect Google"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
