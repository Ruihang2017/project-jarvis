import { useState } from "react";
import type { ReminderInfo } from "../../../shared/api";
import { useApp, Shell } from "../App";
import { call, useData } from "../api";
import { Button, Card, Icon, IconButton, Loading, Segmented, Spot, Toggle } from "../ui";

export function Reminders() {
  const { chat, go, toast, state, refresh } = useApp();
  const { data, reload } = useData(() => call("reminders"));
  const [text, setText] = useState("");
  const [time, setTime] = useState<string | null>(null);
  const act = async (id: number, action: "done" | "cancel" | "snooze10" | "snooze60") => {
    toast(await call("reminderAction", id, action));
    reload();
  };
  const add = () => {
    const t = text.trim();
    if (!t) return;
    chat.send(/^remind/i.test(t) ? t : `Remind me ${t}`);
    setText("");
    go("chat");
  };
  const upcoming = data?.upcoming ?? [];
  const today = new Date().toLocaleDateString("sv");
  const later = upcoming.filter((r) => r.dueAt.slice(0, 10) === today);
  const coming = upcoming.filter((r) => r.dueAt.slice(0, 10) !== today);
  const row = (r: ReminderInfo, ringing = false) => (
    <div key={r.id} className="list-row" style={ringing ? { background: "var(--apricot-soft)" } : undefined}>
      <div style={{ width: 96, flexShrink: 0, fontWeight: 600, color: ringing ? "var(--apricot-ink)" : "var(--blue-ink)" }}>{r.due}</div>
      <div className="grow">
        <div style={{ fontWeight: 600 }}>{r.text}</div>
        {r.repeat && <div className="muted">{r.repeat}</div>}
      </div>
      {ringing ? (
        <div className="row" style={{ gap: 6 }}>
          <Button kind="primary" small onClick={() => act(r.id, "done")}>
            Done
          </Button>
          <Button small onClick={() => act(r.id, "snooze10")}>
            10 min
          </Button>
          <Button small onClick={() => act(r.id, "snooze60")}>
            1 hour
          </Button>
        </div>
      ) : (
        <div className="row" style={{ gap: 2 }}>
          {!r.repeat && <IconButton icon="check" label={`Done: ${r.text}`} onClick={() => act(r.id, "done")} />}
          <IconButton icon="x" label={`Cancel: ${r.text}`} onClick={() => act(r.id, "cancel")} />
        </div>
      )}
    </div>
  );
  const setBrief = async (patch: { briefTime?: string; briefDays?: "weekdays" | "daily" | "off" }) => {
    await call("updateSettings", patch);
    reload();
  };
  return (
    <Shell title="Reminders" sub="Set one by just asking, in any conversation">
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 16, alignItems: "start" }}>
        <Card className="pad stack" style={{ gap: 18 }}>
          <form
            className="row"
            style={{ gap: 8, padding: "6px 6px 6px 16px", border: "1px solid var(--line)", borderRadius: 16 }}
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <Icon name="bell" color="var(--ink3)" />
            <label htmlFor="new-reminder" className="sr">
              New reminder
            </label>
            <input id="new-reminder" value={text} onChange={(e) => setText(e.target.value)} placeholder="Remind me tomorrow at 9 to water the plants" style={{ flex: 1, minWidth: 0, minHeight: 44, border: 0, outline: 0, background: "transparent", fontSize: 15 }} />
            <Button kind="primary" type="submit" disabled={!text.trim()}>
              Add
            </Button>
          </form>
          {!data ? (
            <Loading />
          ) : !data.ringing.length && !upcoming.length ? (
            <div className="empty">
              <Spot name="spot-reminder" size={150} alt="A bedside alarm clock and a pad of sticky notes" />
              <h2>No reminders</h2>
              <p>Try "remind me on Friday at 5 to submit expenses".</p>
            </div>
          ) : (
            <>
              {data.ringing.length > 0 && (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="label">Went off recently</div>
                  {data.ringing.map((r) => row(r, true))}
                </div>
              )}
              {later.length > 0 && (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="label">Later today</div>
                  {later.map((r) => row(r))}
                </div>
              )}
              {coming.length > 0 && (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="label">Coming up</div>
                  {coming.map((r) => row(r))}
                </div>
              )}
            </>
          )}
        </Card>
        <div className="stack" style={{ gap: 16 }}>
          <Card className="pad stack" style={{ gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Spot name="spot-reminder" size={140} />
            </div>
            <div className="between">
              <h2>When Edward is closed</h2>
              <Toggle
                on={state.background}
                label="Reminders when Edward is closed"
                onChange={async (on) => {
                  await call("updateSettings", { background: on });
                  refresh();
                }}
              />
            </div>
            <p className="muted pretty">A small Windows task checks every minute and shows a notification, even after a restart.</p>
          </Card>
          <Card className="pad stack" style={{ gap: 10 }}>
            <h2>Morning brief</h2>
            <p className="muted">Events, reminders, bills and mail in one notification.</p>
            {data && (
              <>
                <div className="between">
                  <label htmlFor="brief-time">Time</label>
                  <input id="brief-time" className="input" type="time" style={{ width: 130 }} value={time ?? data.brief.time} onChange={(e) => setTime(e.target.value)} onBlur={() => time && setBrief({ briefTime: time })} />
                </div>
                <Segmented label="Brief days" value={data.brief.days} onChange={(v) => setBrief({ briefDays: v })} options={[{ value: "weekdays", label: "Weekdays" }, { value: "daily", label: "Daily" }, { value: "off", label: "Off" }]} />
                {data.brief.next && <p className="muted">Next: {data.brief.next}</p>}
              </>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  );
}
