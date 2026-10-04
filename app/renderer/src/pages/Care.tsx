import { useState } from "react";
import { useApp, Shell } from "../App";
import { call, useData } from "../api";
import type { AccountInfo } from "../../../shared/api";
import { Button, Card, Confirm, Icon, IconButton, Loading, Note, Segmented, Spot, Tag, Toggle } from "../ui";

const Row = ({ name, help, children }: { name: string; help?: React.ReactNode; children?: React.ReactNode }) => (
  <div className="between" style={{ minHeight: 52, gap: 16 }}>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontWeight: 600 }}>{name}</div>
      {help && <div className="muted pretty">{help}</div>}
    </div>
    <div style={{ flexShrink: 0 }}>{children}</div>
  </div>
);
const Hr = () => <div style={{ height: 1, background: "var(--line)" }} />;

function SettingsLink({ icon, text, page }: { icon: string; text: string; page: string }) {
  const { go } = useApp();
  return (
    <button type="button" className="btn" onClick={() => go(page)} style={{ justifyContent: "flex-start", border: 0, background: "var(--bg)", minHeight: 48 }}>
      <Icon name={icon} color="var(--blue-ink)" />
      <span className="grow" style={{ textAlign: "left" }}>
        {text}
      </span>
      <Icon name="right" size={16} color="var(--ink3)" />
    </button>
  );
}

export function Settings() {
  const { refresh, toast } = useApp();
  const { data, reload } = useData(() => call("settings"));
  const [currency, setCurrency] = useState<string | null>(null);
  const set = async (patch: Parameters<typeof call<"updateSettings">>[1]) => {
    await call("updateSettings", patch);
    reload();
    refresh();
  };
  const model = data?.models.find((m) => m.id === data.model);
  return (
    <Shell title="Settings">
      {!data ? (
        <Loading />
      ) : (
        <div className="grid-3" style={{ alignItems: "start" }}>
          <Card className="pad stack">
            <h2>The assistant</h2>
            <Row name="Model">
              <select className="input" aria-label="Model" value={data.model} onChange={(e) => set({ model: e.target.value })} style={{ width: 180 }}>
                {data.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
                {!data.models.length && <option value={data.model}>{data.model}</option>}
              </select>
            </Row>
            <Row name="How hard it thinks" help="Higher is slower and uses more of your plan." />
            <Segmented label="Reasoning effort" value={data.effort} onChange={(v) => set({ effort: v })} options={(model?.efforts.length ? model.efforts : ["low", "medium", "high"]).map((e) => ({ value: e, label: e[0]!.toUpperCase() + e.slice(1) }))} />
            <Hr />
            <Row name="Search the web" help="Lets Edward look things up online.">
              <Toggle on={data.webSearch} label="Search the web" onChange={(v) => set({ webSearch: v })} />
            </Row>
            <Row name="Learn from conversations" help="Remember things worth keeping.">
              <Toggle on={data.learning} label="Learn from conversations" onChange={(v) => set({ learning: v })} />
            </Row>
            <Hr />
            <h3>Your ChatGPT plan</h3>
            {data.limits.length ? (
              data.limits.map((l) => (
                <div key={l.label} className="stack" style={{ gap: 6 }}>
                  <div className="between" style={{ fontSize: 13.5 }}>
                    <b>{l.label}</b>
                    <span className="muted">
                      {l.usedPercent}% used{l.resets ? ` · resets ${l.resets}` : ""}
                    </span>
                  </div>
                  <div style={{ height: 10, borderRadius: 999, background: "var(--soft)" }}>
                    <div style={{ width: `${Math.min(100, l.usedPercent)}%`, height: 10, borderRadius: 999, background: l.usedPercent > 85 ? "var(--apricot)" : "var(--blue)" }} />
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">Shown after the first reply.</p>
            )}
          </Card>
          <Card className="pad stack">
            <h2>Your day</h2>
            <Row name="Reminders when Edward is closed" help="A small Windows task, every minute.">
              <Toggle on={data.background} label="Reminders when Edward is closed" onChange={(v) => set({ background: v })} />
            </Row>
            <Row name="Morning brief" help="Events, reminders, bills and mail at a glance.">
              <input className="input" type="time" aria-label="Brief time" value={data.briefTime} onChange={(e) => e.target.value && set({ briefTime: e.target.value })} style={{ width: 120 }} />
            </Row>
            <Segmented label="Brief days" value={data.briefDays} onChange={(v) => set({ briefDays: v })} options={[{ value: "weekdays", label: "Weekdays" }, { value: "daily", label: "Daily" }, { value: "off", label: "Off" }]} />
            <Hr />
            <h3>Region</h3>
            <Row name="Dates" help={data.dateOrder === "dmy" ? "10/12 means 10 December." : "10/12 means October 12."} />
            <Segmented label="Date order" value={data.dateOrder} onChange={(v) => set({ dateOrder: v })} options={[{ value: "dmy", label: "Day / month / year" }, { value: "mdy", label: "Month / day / year" }]} />
            <Row name="Currency" help="For amounts with no currency sign.">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (currency && /^[A-Za-z]{3}$/.test(currency)) void set({ currency }).then(() => setCurrency(null));
                  else toast({ ok: false, message: "A currency is three letters, like AUD" });
                }}
              >
                <input className="input" aria-label="Currency" maxLength={3} value={currency ?? data.currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} onBlur={(e) => e.currentTarget.form?.requestSubmit()} style={{ width: 90, textTransform: "uppercase" }} />
              </form>
            </Row>
            {(data.dateOrderDetected || data.currencyDetected) && <p className="muted">{data.dateOrderDetected && data.currencyDetected ? "Both were" : "Detected settings were"} worked out from your system.</p>}
          </Card>
          <div className="stack" style={{ gap: 16 }}>
            <Card className="pad stack">
              <div className="row" style={{ gap: 16 }}>
                <Spot name="spot-compass" size={92} alt="A brass compass on a folded map" />
                <div>
                  <h2>Looking after Edward</h2>
                  <p className="muted">Connections, your data and a health check.</p>
                </div>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <SettingsLink icon="key" text="Accounts (Google)" page="google" />
                <SettingsLink icon="shield" text="Permission modes" page="modes" />
                <SettingsLink icon="bill" text="How bills work" page="bills-month" />
                <SettingsLink icon="box" text="Your data: back up, export, delete" page="data" />
                <SettingsLink icon="heart" text="Health check" page="doctor" />
              </div>
            </Card>
            <VoiceCard />
            <Card className="pad stack" style={{ gap: 6 }}>
              <h3>Pictures</h3>
              <Row name="Open pictures when they're made">
                <Toggle on={data.autoOpenImages} label="Open pictures when they are made" onChange={(v) => set({ autoOpenImages: v })} />
              </Row>
              <Row name="Show pictures in emails" help="Off: you choose per email. Pictures from the web can tell the sender you opened it.">
                <Toggle on={data.mailPictures} label="Show pictures in emails without asking" onChange={(v) => set({ mailPictures: v })} />
              </Row>
              <Row name="Saved in" help={<span className="mono" style={{ overflowWrap: "anywhere" }}>{data.imagesDir}</span>}>
                <Button onClick={async () => (await call("chooseImagesFolder"), reload())}>Change</Button>
              </Row>
            </Card>
          </div>
        </div>
      )}
    </Shell>
  );
}

/** Colours an account can have (the same list as src/accounts/accounts.ts). */
const ACCOUNT_COLORS = ["#2A52BE", "#C8742C", "#4F8A6B", "#B5536A", "#6B5BB5", "#2C8C99"];

export function GooglePage() {
  const { go, toast, refresh } = useApp();
  const { data, reload } = useData(() => call("google"));
  const [busy, setBusy] = useState("");
  const [leave, setLeave] = useState<AccountInfo | null>(null);
  const [naming, setNaming] = useState<{ id: string; name: string } | null>(null);
  const run = async (what: string, p: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(what);
    toast(await p());
    setBusy("");
    reload();
    refresh();
  };
  const PERMS: Record<string, [string, string, string]> = {
    "calendar.events": ["Calendar events", "See your events; add, move and remove them after you say yes", "Read and change"],
    "calendar.calendarlist.readonly": ["Calendar list", "Know which calendars you have", "Read only"],
    "gmail.readonly": ["Gmail", "Search and read your mail", "Read only"],
    "gmail.compose": ["Gmail drafts", "Write drafts, and send the ones you approve", "Write drafts"],
    tasks: ["Google Tasks", "Your lists: shopping, home jobs, to-dos", "Read and change"],
  };
  const many = (data?.accounts.length ?? 0) > 1;
  const signIn = (
    <Button kind="primary" icon="link" disabled={!data?.clientFile || busy === "connect"} onClick={() => run("connect", () => call("connectGoogle"))}>
      {busy === "connect" ? "Waiting for the browser…" : "Sign in with Google"}
    </Button>
  );
  return (
    <Shell
      title="Accounts"
      sub="Your personal Google accounts: mail, calendar and lists"
      actions={
        <Button kind="ghost" icon="left" onClick={() => go("settings")}>
          Settings
        </Button>
      }
    >
      {!data ? (
        <Loading />
      ) : !data.connected ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 16, alignItems: "start" }}>
          <Card className="pad stack" style={{ gap: 18, padding: 24 }}>
            <div className="row" style={{ gap: 20 }}>
              <Spot name="spot-key" size={110} alt="A brass key with a blank paper tag" />
              <div>
                <h2 style={{ fontSize: 24 }}>Connect your Google account</h2>
                <p className="muted pretty" style={{ fontSize: 14 }}>
                  Your mail and calendar travel from Google straight to this computer and nowhere else. You can add more accounts afterwards.
                </p>
              </div>
            </div>
            {data.clientFile ? (
              <>
                <p className="muted pretty">
                  Your browser opens. Google lists what Edward asks for: your calendar, reading mail, and writing drafts. While Edward is in testing, Google says it hasn't verified the app: choose
                  Advanced, then continue.
                </p>
                <div>{signIn}</div>
              </>
            ) : (
              <>
                <Step n={1} title="Create your Google Cloud project">
                  <p className="muted">A step-by-step guide with pictures. About ten minutes; it costs nothing.</p>
                  <div>
                    <Button icon="link" onClick={() => void call("openGuide")}>
                      Open the guide
                    </Button>
                  </div>
                </Step>
                <Hr />
                <Step n={2} title="Choose the file you downloaded">
                  <div className="row" style={{ padding: "6px 6px 6px 14px", border: "1px solid var(--line)", borderRadius: 12, background: "var(--bg)" }}>
                    <Icon name="file" color="var(--ink3)" />
                    <span className="grow mono">No file chosen yet</span>
                    <Button onClick={() => run("file", () => call("chooseGoogleClient"))}>Choose the file</Button>
                  </div>
                  <p className="muted">The file stays on this computer. Don't share it or put it online.</p>
                </Step>
                <Hr />
                <Step n={3} title="Sign in with Google">
                  <p className="muted">Your browser opens. Google lists what Edward asks for: your calendar, reading mail, and writing drafts.</p>
                  <div>{signIn}</div>
                </Step>
              </>
            )}
          </Card>
          <div className="stack" style={{ gap: 16 }}>
            <Card className="pad stack">
              <h2>Optional</h2>
              <p className="muted pretty">Without Google, Edward still chats, remembers, reminds and makes pictures. Calendar, mail and bills need it.</p>
            </Card>
            <Card className="pad stack">
              <h2>Personal accounts only</h2>
              <p className="muted pretty">Work and school accounts (Google Workspace) are turned away, so nothing from your employer ends up here.</p>
            </Card>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 16, alignItems: "start" }}>
          <div className="stack" style={{ gap: 16 }}>
            {data.accounts.map((a) => (
              <Card key={a.id} className="stack" style={{ padding: "18px 22px", gap: 12 }}>
                <div className="row" style={{ gap: 14 }}>
                  <span aria-hidden style={{ width: 14, height: 14, borderRadius: "50%", background: a.color, flexShrink: 0 }} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    {naming?.id === a.id ? (
                      <form
                        className="row"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const name = naming.name;
                          setNaming(null);
                          void run("name", () => call("updateAccount", a.id, { name }));
                        }}
                      >
                        <input className="input" aria-label="Name for this account" autoFocus value={naming.name} placeholder={a.email} maxLength={40} onChange={(e) => setNaming({ id: a.id, name: e.target.value })} />
                        <Button small kind="primary" type="submit">
                          Save
                        </Button>
                        <Button small kind="ghost" onClick={() => setNaming(null)}>
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontFamily: "var(--disp)", fontSize: 21, fontWeight: 600, letterSpacing: "-0.015em" }}>{a.label}</div>
                        {a.expired ? (
                          <Tag tone="apricot" icon="warn">
                            Needs signing in again
                          </Tag>
                        ) : (
                          <Tag tone="sage" icon="check">
                            Connected
                          </Tag>
                        )}
                      </div>
                    )}
                    <p className="muted">
                      {a.name ? `${a.email} · ` : ""}
                      {a.connectedAt ? `connected ${a.connectedAt}` : ""}
                      {a.checkedAt ? ` · last checked ${a.checkedAt}` : ""}
                    </p>
                  </div>
                  {naming?.id !== a.id && (
                    <IconButton icon="pencil" label={`Rename ${a.label}`} onClick={() => setNaming({ id: a.id, name: a.name ?? "" })} />
                  )}
                </div>
                <div className="row" style={{ gap: 18, flexWrap: "wrap" }}>
                  <label className="row" style={{ gap: 8 }}>
                    <Toggle on={a.mail} label={`Use mail from ${a.label}`} onChange={(v) => void run("use", () => call("updateAccount", a.id, { mail: v }))} />
                    Mail
                  </label>
                  <label className="row" style={{ gap: 8 }}>
                    <Toggle on={a.calendar} label={`Use the calendar of ${a.label}`} onChange={(v) => void run("use", () => call("updateAccount", a.id, { calendar: v }))} />
                    Calendar
                  </label>
                  <span className="row" style={{ gap: 6 }} aria-label="Colour">
                    {ACCOUNT_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Colour ${c}`}
                        aria-pressed={a.color === c}
                        onClick={() => void run("color", () => call("updateAccount", a.id, { color: c }))}
                        style={{ width: 18, height: 18, borderRadius: "50%", background: c, border: a.color === c ? "2px solid var(--ink)" : "2px solid transparent", cursor: "pointer", padding: 0 }}
                      />
                    ))}
                  </span>
                </div>
                {many && (
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    {a.mailWorks &&
                      (a.sendsMail ? (
                        <Tag tone="blue" icon="mail">
                          New emails go from here
                        </Tag>
                      ) : (
                        <Button small kind="ghost" onClick={() => run("default", () => call("setDefaultAccount", "mail", a.id))}>
                          Send new emails from here
                        </Button>
                      ))}
                    {a.calendarWorks &&
                      (a.getsEvents ? (
                        <Tag tone="blue" icon="calendar">
                          New events go here
                        </Tag>
                      ) : (
                        <Button small kind="ghost" onClick={() => run("default", () => call("setDefaultAccount", "calendar", a.id))}>
                          Put new events here
                        </Button>
                      ))}
                    {a.listsWork &&
                      (a.keepsLists ? (
                        <Tag tone="blue" icon="check">
                          Lists are kept here
                        </Tag>
                      ) : (
                        <Button small kind="ghost" onClick={() => run("default", () => call("setDefaultAccount", "tasks", a.id))}>
                          Keep lists here
                        </Button>
                      ))}
                  </div>
                )}
                {a.missing.length > 0 && (
                  <Note tone="apricot" icon="warn">
                    One more permission is needed for {a.missing.join(" and ")}. Sign in again to give it.
                  </Note>
                )}
                <div className="row" style={{ gap: 8, flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                  <Button small icon="refresh" disabled={busy === `check-${a.id}`} onClick={() => run(`check-${a.id}`, () => call("checkGoogle", a.id))}>
                    Check now
                  </Button>
                  <Button small icon="link" disabled={busy === `again-${a.id}`} onClick={() => run(`again-${a.id}`, () => call("connectGoogle", a.id))}>
                    {busy === `again-${a.id}` ? "Waiting for the browser…" : "Sign in again"}
                  </Button>
                  <span className="grow" />
                  <Button small kind="ghost" onClick={() => setLeave(a)}>
                    Remove
                  </Button>
                </div>
              </Card>
            ))}
            <Card className="row" style={{ padding: "16px 22px", gap: 16 }}>
              <Icon name="plus" color="var(--ink3)" />
              <div className="grow">
                <b>Add another account</b>
                <p className="muted">A family or second personal Gmail. In Google's list, pick the account to add.</p>
              </div>
              <Button icon="link" disabled={busy === "connect"} onClick={() => run("connect", () => call("connectGoogle"))}>
                {busy === "connect" ? "Waiting for the browser…" : "Add account"}
              </Button>
            </Card>
          </div>
          <div className="stack" style={{ gap: 16 }}>
            <Card className="pad stack" style={{ gap: 0 }}>
              <div className="between" style={{ paddingBottom: 12 }}>
                <h2>What Edward may do</h2>
              </div>
              {data.permissions.map((p) => {
                const [name, what] = PERMS[p] ?? [p, ""];
                return (
                  <div key={p} style={{ display: "grid", gap: 2, padding: "10px 0", borderTop: "1px solid var(--line)" }}>
                    <b>{name}</b>
                    <span className="muted">{what}</span>
                  </div>
                );
              })}
              <div style={{ paddingTop: 14 }}>
                <Note icon="x">Not asked for, so not possible: deleting or archiving mail, changing Gmail settings, your contacts, your Drive.</Note>
              </div>
            </Card>
            <Card className="pad stack">
              <h2>How it's kept</h2>
              <div className="row" style={{ alignItems: "flex-start", fontSize: 13.5 }}>
                <Icon name="lock" size={17} width={2} color="var(--sage-ink)" />
                Each sign-in is encrypted by Windows for your user account, and never written to a log.
              </div>
              <div className="row" style={{ alignItems: "flex-start", fontSize: 13.5 }}>
                <Icon name="check" size={17} width={2} color="var(--sage-ink)" />
                Mail and calendar data go from Google to this computer. There is no Edward server.
              </div>
              <div className="row" style={{ alignItems: "flex-start", fontSize: 13.5 }}>
                <Icon name="shield" size={17} width={2} color="var(--sage-ink)" />
                Work and school accounts (Google Workspace) are turned away.
              </div>
            </Card>
          </div>
        </div>
      )}
      {leave && (
        <Confirm
          danger
          title={`Remove ${leave.label}?`}
          yes="Remove"
          onAnswer={(yes) => {
            const id = leave.id;
            setLeave(null);
            if (yes) void run("leave", () => call("disconnectGoogle", id));
          }}
        >
          Edward's access to {leave.email ?? "this account"} is withdrawn at Google and its sign-in is deleted from this computer. The mail and calendar themselves aren't touched.
        </Confirm>
      )}
    </Shell>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
      <div style={{ fontFamily: "var(--disp)", fontSize: 22, fontWeight: 600, color: "var(--blue)", width: 22 }}>{n}</div>
      <div className="grow stack" style={{ gap: 8 }}>
        <b style={{ fontSize: 15 }}>{title}</b>
        {children}
      </div>
    </div>
  );
}

export function Doctor() {
  const { data, reload, loading } = useData(() => call("doctor"));
  const fails = data?.filter((c) => c.status === "fail").length ?? 0;
  const warns = data?.filter((c) => c.status === "warn").length ?? 0;
  const copy = async () => {
    if (!data) return;
    await navigator.clipboard.writeText(data.map((c) => `[${c.status}] ${c.name}: ${c.detail}`).join("\n"));
  };
  return (
    <Shell
      title="Health check"
      sub="Everything Edward needs, tested just now"
      actions={
        <>
          <Button icon="refresh" onClick={reload} disabled={loading}>
            Check again
          </Button>
          <Button icon="copy" onClick={copy} disabled={!data}>
            Copy the report
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 16, alignItems: "start" }}>
        <Card style={{ padding: "6px 24px 10px" }}>
          {!data ? (
            <div style={{ padding: 20 }}>
              <Loading what="Checking" />
            </div>
          ) : (
            data.map((c) => {
              const [bg, fg, icon] = c.status === "ok" ? ["var(--sage-soft)", "var(--sage-ink)", "check"] : c.status === "warn" ? ["var(--apricot-soft)", "var(--apricot-ink)", "warn"] : ["var(--rose-soft)", "var(--rose-ink)", "x"];
              return (
                <div key={c.name} style={{ display: "grid", gridTemplateColumns: "34px 140px minmax(0,1fr)", gap: 12, alignItems: "center", minHeight: 54, borderTop: "1px solid var(--line)" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "50%", background: bg, color: fg }}>
                    <Icon name={icon} size={15} width={2.4} />
                  </span>
                  <b>{c.name}</b>
                  <span className="pretty" style={{ fontSize: 13.5, color: c.status === "ok" ? "var(--ink2)" : fg, fontWeight: c.status === "ok" ? 400 : 600, overflowWrap: "anywhere" }}>
                    {c.detail}
                  </span>
                </div>
              );
            })
          )}
        </Card>
        <Card className="pad stack" style={{ alignItems: "center", textAlign: "center" }}>
          <Spot name="spot-care" size={160} alt="A watering can beside a potted plant" />
          {data && (
            <>
              <div style={{ fontFamily: "var(--disp)", fontSize: 24, fontWeight: 600 }}>{fails ? "Something needs fixing" : warns ? "Nearly everything is fine" : "Everything is fine"}</div>
              <p className="muted pretty">
                {data.length - fails - warns} checks passed{warns ? `, ${warns} to look at` : ""}
                {fails ? `, ${fails} failed` : ""}.
              </p>
            </>
          )}
          <Note>The report has no account numbers in it, but names and email subjects are yours to trim before you share it.</Note>
        </Card>
      </div>
    </Shell>
  );
}

export function Data() {
  const { toast } = useApp();
  const { data, reload } = useData(() => call("data"));
  const [step, setStep] = useState(0);
  const run = async (p: Promise<{ ok: boolean; message: string }>) => {
    toast(await p);
    reload();
  };
  return (
    <Shell
      title="Your data"
      sub="All of it is in one folder on this computer"
      actions={
        <Button icon="folder" onClick={() => void call("openDataFolder")}>
          Open the folder
        </Button>
      }
    >
      {!data ? (
        <Loading />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 400px", gap: 16, alignItems: "start" }}>
          <div className="stack" style={{ gap: 16 }}>
            <Card className="pad stack" style={{ gap: 0, padding: "22px 24px" }}>
              <div className="row" style={{ gap: 18, paddingBottom: 12 }}>
                <Spot name="spot-archive" size={92} alt="Three archive boxes" />
                <div style={{ minWidth: 0 }}>
                  <div className="mono ellipsis" style={{ fontSize: 14 }}>
                    {data.dir}
                  </div>
                  <div className="muted">
                    {data.total} in all · data version v{data.version}
                  </div>
                </div>
              </div>
              {data.parts.map((p) => (
                <div key={p.name} style={{ display: "grid", gridTemplateColumns: "200px minmax(0,1fr) 80px", gap: 12, alignItems: "center", minHeight: 42, borderTop: "1px solid var(--line)", fontSize: 13.5 }}>
                  <b>{p.name}</b>
                  <span className="muted">{p.what}</span>
                  <b style={{ textAlign: "right" }}>{p.size}</b>
                </div>
              ))}
            </Card>
            <Card className="pad stack" style={{ borderColor: "var(--rose-line)" }}>
              <div className="row" style={{ color: "var(--rose-ink)" }}>
                <Icon name="trash" />
                <h2 style={{ color: "inherit" }}>Leaving</h2>
              </div>
              <p className="muted pretty">
                <b style={{ color: "var(--ink)" }}>Delete everything.</b> Memory, reminders, bills, pictures and the Google sign-in, after withdrawing Google access and removing the background task. Your ChatGPT sign-in and your Google client file stay. Edward closes afterwards. This can't be undone.
              </p>
              <div>
                <Button kind="danger" icon="trash" onClick={() => setStep(1)}>
                  Delete everything
                </Button>
              </div>
            </Card>
          </div>
          <div className="stack" style={{ gap: 16 }}>
            <Card className="pad stack">
              <h2>Back up</h2>
              <p className="muted pretty">A copy of the database and settings. Edward also makes one by itself before every upgrade.</p>
              {data.backups.map((b) => (
                <div key={b.name} className="between" style={{ minHeight: 36, borderTop: "1px solid var(--line)", fontSize: 13.5 }}>
                  <b>{b.name}</b>
                </div>
              ))}
              <Button kind="primary" icon="copy" onClick={() => void run(call("backup"))}>
                Back up now
              </Button>
            </Card>
            <Card className="pad stack">
              <h2>Export</h2>
              <p className="muted">Everything as files you can read without Edward.</p>
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                {["memories.md", "reminders.json", "bills.json", "bills.csv", "settings.json"].map((f) => (
                  <span key={f} className="mono" style={{ padding: "3px 10px", borderRadius: 8, background: "var(--bg)" }}>
                    {f}
                  </span>
                ))}
              </div>
              <Button icon="download" onClick={() => void run(call("exportAll"))}>
                Export everything
              </Button>
            </Card>
          </div>
        </div>
      )}
      {step === 1 && (
        <Confirm danger title="Delete everything Edward has stored?" yes="Yes, continue" onAnswer={(yes) => setStep(yes ? 2 : 0)}>
          Memory, reminders, bills, pictures and the Google sign-in are deleted, Google access is withdrawn and the background task is removed. Consider exporting first.
        </Confirm>
      )}
      {step === 2 && (
        <Confirm
          danger
          title="Last check"
          yes="Delete everything now"
          onAnswer={(yes) => {
            setStep(0);
            if (yes) void call("deleteEverything").then(toast);
          }}
        >
          This can't be undone. Edward closes when it's done.
        </Confirm>
      )}
    </Shell>
  );
}

/** Settings → Voice (V): the OpenAI key, the voice, and what voice means for privacy. */
function VoiceCard() {
  const { toast, voice } = useApp();
  const { data, reload } = useData(() => call("voiceInfo"));
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  return (
    <Card className="pad stack" style={{ gap: 10 }}>
      <h3>Voice</h3>
      <p className="muted pretty">
        Talk to Edward with the microphone button next to the message box, and hear the reply. It uses OpenAI's realtime voice ({data.model}) with your own OpenAI API key, billed by OpenAI
        separately from ChatGPT, a few cents a minute.
      </p>
      <Note tone="apricot" icon="warn">
        What you say goes to OpenAI as sound and isn't checked by the privacy guard. Don't say card or account numbers or passwords. The words Edward hears still go through the guard before
        Edward answers.
      </Note>
      {data.hasKey ? (
        <Row name="OpenAI API key" help="Saved, encrypted on this computer. It isn't shown again and never goes to Codex.">
          <Button kind="ghost" onClick={async () => (toast(await call("voiceRemoveKey")), voice.stop(), reload())}>
            Remove
          </Button>
        </Row>
      ) : (
        <form
          className="row"
          style={{ gap: 8 }}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await call("voiceSaveKey", key);
            setBusy(false);
            toast(r);
            if (r.ok) (setKey(""), reload());
          }}
        >
          <input className="input grow" type="password" autoComplete="off" placeholder="OpenAI API key (sk-…)" value={key} onChange={(e) => setKey(e.target.value)} aria-label="OpenAI API key" />
          <Button kind="primary" type="submit" disabled={busy || !key.trim()}>
            {busy ? "Checking…" : "Save"}
          </Button>
        </form>
      )}
      <Row name="Edward's voice" help="marin and cedar sound the most natural.">
        <select className="input" value={data.voice} onChange={async (e) => (await call("voiceSetVoice", e.target.value), reload(), voice.phase !== "off" && toast("The new voice starts with the next call."))}>
          {data.voices.map((v) => (
            <option key={v} value={v}>
              {v[0]!.toUpperCase() + v.slice(1)}
            </option>
          ))}
        </select>
      </Row>
    </Card>
  );
}
