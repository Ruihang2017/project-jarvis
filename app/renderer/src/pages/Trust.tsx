import type { Mode } from "../../../shared/api";
import { useApp, Shell } from "../App";
import { call } from "../api";
import { Button, Card, Icon, MODES, Spot, Tag, Toggle } from "../ui";

function Pillar({ icon, title, sub, items, itemIcon }: { icon: string; title: string; sub: string; items: string[]; itemIcon: string }) {
  return (
    <Card className="pad stack">
      <div className="row" style={{ gap: 12 }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 12, background: "var(--sage-soft)", color: "var(--sage-ink)" }}>
          <Icon name={icon} size={20} />
        </span>
        <h2>{title}</h2>
      </div>
      <p className="muted pretty">{sub}</p>
      <div className="stack" style={{ gap: 8 }}>
        {items.map((t) => (
          <div key={t} className="row" style={{ alignItems: "flex-start" }}>
            <Icon name={itemIcon} size={17} width={2} color="var(--sage-ink)" />
            <span>{t}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function Privacy() {
  const { go, state, refresh } = useApp();
  return (
    <Shell
      title="Privacy"
      sub="What Edward will not do, enforced by code before anything reaches the AI"
      actions={
        <Button kind="ghost" onClick={() => go("modes")}>
          Permission modes
        </Button>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <Card className="row" style={{ padding: "20px 28px", gap: 24 }}>
          <Spot name="spot-privacy" size={140} alt="A small wooden box with a brass padlock and a key" />
          <div className="stack" style={{ gap: 8, maxWidth: 640 }}>
            <div style={{ fontFamily: "var(--disp)", fontSize: 30, fontWeight: 600, lineHeight: 1.12, letterSpacing: "-0.02em", textWrap: "balance" }}>Your account, card and ID numbers never leave this computer.</div>
            <p className="pretty" style={{ fontSize: 15, color: "var(--ink2)" }}>
              They are taken out before a single word goes to the AI, and Edward keeps no copy, not even the last four digits. This is a filter in the program, not a request to the model to behave.
            </p>
          </div>
          <div className="stack" style={{ marginLeft: "auto", alignItems: "flex-end", gap: 8 }}>
            <Tag tone={state.mode === "chat" ? "sage" : "apricot"} icon={state.mode === "chat" ? "shield" : "warn"}>
              {state.mode === "chat" ? "Guard is on" : "Guard covers chat only"}
            </Tag>
            <span className="muted">Checked at start-up with a test number</span>
          </div>
        </Card>
        <div className="grid-3">
          <Pillar icon="lock" title="Never sent to the AI" sub="Removed from what you type, from emails and calendar entries, and from every answer a tool gives." itemIcon="x" items={["Card numbers", "Bank account and BSB numbers", "Bill and customer reference numbers", "Tax file, Medicare, passport and licence numbers", "Passwords, PINs and sign-in keys"]} />
          <Pillar icon="box" title="Never stored" sub="Memory, reminders and bills refuse anything that looks like one of these, whole or in part." itemIcon="check" items={["No field anywhere for an account or card", "Nothing in the logs", "Google sign-in is kept encrypted by Windows", "Everything else stays in one folder you can open, export or delete"]} />
          <Pillar icon="shield" title="Never done" sub="Edward is a butler that reminds. It has no tools for these, so no instruction can make it." itemIcon="x" items={["Paying a bill", "Signing in to a bank", "Following instructions written inside an email", "Sending an email without showing it to you first", "Inviting people to calendar events"]} />
        </div>
        <Card className="pad stack" style={{ background: "#fffbf7", borderColor: "#f3d9c2" }}>
          <div className="row" style={{ color: "var(--apricot-ink)" }}>
            <Icon name="warn" size={18} width={2} />
            <h3 style={{ color: "inherit" }}>Where the guard stops</h3>
          </div>
          <div className="grid-4" style={{ fontSize: 13.5, color: "var(--ink2)", gap: 20 }}>
            <div>
              <b style={{ color: "var(--ink)" }}>Bare numbers.</b> A number with no word near it saying what it is can slip through.
            </div>
            <div>
              <b style={{ color: "var(--ink)" }}>Pictures aren't checked.</b> A photo of a card is sent as it is. Don't attach one.
            </div>
            <div>
              <b style={{ color: "var(--ink)" }}>Other modes.</b> In Manual, Semi-auto and Auto, Codex can read files itself, past the guard.
            </div>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div className="grow">
                <b style={{ color: "var(--ink)" }}>Web search.</b> Off closes a way for email text to leak in a search.
              </div>
              <Toggle on={state.webSearch} label="Web search" onChange={async (on) => (await call("updateSettings", { webSearch: on }), refresh())} />
            </div>
          </div>
        </Card>
      </div>
    </Shell>
  );
}

const DETAILS: Record<Mode, { can: string[]; cannot: string[]; warn?: string }> = {
  chat: { can: ["Everything goes through the privacy guard", "Edward's own tools, each asking first"], cannot: ["Codex can't run commands", "Codex can't read your files or pictures"] },
  manual: { can: ["Run commands, after you say yes", "Change files, after you say yes"], cannot: ["Nothing happens without asking"], warn: "What Codex reads by itself doesn't pass the privacy guard." },
  "semi-auto": { can: ["Edit files in the working folder freely", "Everything else still asks"], cannot: ["No changes outside that folder without asking"], warn: "What Codex reads by itself doesn't pass the privacy guard." },
  auto: { can: ["Commands and file changes without asking"], cannot: ["Not in the Shift + Tab cycle", "Asks you to confirm when you turn it on"], warn: "Nothing is checked with you first." },
};

export function Modes() {
  const { state, setMode } = useApp();
  return (
    <Shell title="Permission modes" sub="What Codex may do on this computer. The mode is always shown at the top right.">
      <div className="stack" style={{ gap: 16 }}>
        <div className="grid-4">
          {MODES.map((m) => {
            const d = DETAILS[m.value];
            const current = m.value === state.mode;
            return (
              <Card key={m.value} className="pad stack" style={{ gap: 14, ...(current ? { borderColor: "#b9c9f3", boxShadow: "0 0 0 3px var(--blue-soft), var(--shadow)" } : {}) }}>
                <div className="between">
                  <div className="row">
                    <span style={{ width: 11, height: 11, borderRadius: "50%", background: m.dot }} />
                    <h2>{m.label}</h2>
                  </div>
                  {current && (
                    <Tag tone="sage" icon="check">
                      On now
                    </Tag>
                  )}
                </div>
                <p className="muted pretty" style={{ minHeight: 60, fontSize: 14 }}>
                  {m.help}
                </p>
                <div className="stack" style={{ gap: 8, fontSize: 13.5 }}>
                  {d.can.map((t) => (
                    <div className="row" key={t} style={{ alignItems: "flex-start" }}>
                      <Icon name="check" size={16} width={2} color="var(--sage-ink)" />
                      {t}
                    </div>
                  ))}
                  {d.cannot.map((t) => (
                    <div className="row muted" key={t} style={{ alignItems: "flex-start", fontSize: 13.5 }}>
                      <Icon name="x" size={16} width={2} color="var(--ink3)" />
                      {t}
                    </div>
                  ))}
                </div>
                {d.warn && (
                  <div className="note apricot" style={{ fontWeight: 500 }}>
                    <Icon name="warn" size={15} width={2} />
                    {d.warn}
                  </div>
                )}
                <div style={{ marginTop: "auto" }}>
                  {current ? (
                    <Button kind="soft" wide disabled>
                      Current mode
                    </Button>
                  ) : (
                    <Button kind={m.value === "auto" ? "danger" : "secondary"} wide onClick={() => setMode(m.value)}>
                      Switch to {m.label}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
        <Card className="pad stack">
          <h2>Switching</h2>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Tag tone="sage">Chat</Tag>
            <Icon name="right" size={16} color="var(--ink3)" />
            <Tag tone="apricot">Manual</Tag>
            <Icon name="right" size={16} color="var(--ink3)" />
            <Tag tone="apricot">Semi-auto</Tag>
            <span className="muted">with</span>
            <span className="mono" style={{ padding: "3px 10px", border: "1px solid var(--line)", borderRadius: 8, background: "var(--bg)" }}>
              Shift + Tab
            </span>
            <span className="muted">in the message box</span>
          </div>
          <p className="muted pretty">Auto is only reachable from this page or the mode menu, and always asks you to confirm. Edward's own tools that change something outside Edward ask first in every mode.</p>
        </Card>
      </div>
    </Shell>
  );
}
