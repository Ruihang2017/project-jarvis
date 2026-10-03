import { useState } from "react";
import type { BillInfo, BillSettings } from "../../../shared/api";
import { useApp, Shell } from "../App";
import { call, useData } from "../api";
import { Button, Card, Confirm, Icon, IconButton, Loading, Note, Segmented, Spot, Tag } from "../ui";

const Stat = ({ value, what, tone }: { value: string; what: string; tone?: string }) => (
  <div className="stack" style={{ gap: 2 }}>
    <div style={{ fontFamily: "var(--disp)", fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em", color: tone }}>{value}</div>
    <div className="muted">{what}</div>
  </div>
);

export function Bills() {
  const { go, toast } = useApp();
  const { data, error, reload } = useData(() => call("bills"));
  const [scanning, setScanning] = useState(false);
  const act = async (id: number, action: "accept" | "ignore" | "paid") => {
    toast(await call("billAction", id, action));
    reload();
  };
  const scan = async () => {
    setScanning(true);
    toast(await call("billScan"));
    setScanning(false);
    reload();
  };
  const next = data?.toPay.find((b) => b.dueDate);
  return (
    <Shell
      title="Bills"
      sub="Found in your email. Edward reminds you; paying is yours to do."
      actions={
        <>
          <Button icon="refresh" onClick={scan} disabled={!data?.canScan || scanning}>
            {scanning ? "Looking…" : "Check my mail now"}
          </Button>
          <Button kind="ghost" onClick={() => go("bills-month")}>
            This month
          </Button>
        </>
      }
    >
      {!data ? (
        error ? <Note tone="rose">{error}</Note> : <Loading />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <Card className="between" style={{ padding: "18px 26px", overflow: "hidden" }}>
            <div className="row" style={{ gap: 56 }}>
              <Stat value={data.toPayTotal} what="still to pay" />
              <Stat value={next ? next.due.replace(/^Due /, "").split(",")[0]! : "Nothing due"} what={next ? `next one: ${next.payee}` : "no tracked bills"} tone={next && next.daysLeft !== null && next.daysLeft <= 3 ? "var(--apricot-ink)" : undefined} />
              <Stat value={String(data.pending.length)} what={`new bill${data.pending.length === 1 ? "" : "s"} to check`} />
            </div>
            <Spot name="spot-bills" size={118} alt="Paper bills on a desk spike beside a dish of coins" />
          </Card>
          {!data.canScan && (
            <Note tone="blue" icon="mail">
              Bills are found in your Gmail. Connect Google in Settings and Edward looks through new mail once a day.
            </Note>
          )}
          <div className="grid-2" style={{ alignItems: "start" }}>
            <div className="stack">
              <div className="between">
                <h2>New, check these</h2>
                <Tag tone="blue">Nothing is tracked until you say so</Tag>
              </div>
              {!data.pending.length && <p className="muted">Nothing new to check.</p>}
              {data.pending.map((b) => (
                <div key={b.id} className="stack" style={{ gap: 10, padding: 14, border: `1px solid ${b.flags.length ? "var(--apricot-line)" : "var(--line)"}`, borderRadius: 14, background: "var(--surface)" }}>
                  <div className="between" style={{ alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{b.payee}</div>
                      <div className="muted">
                        {b.due} · {b.category.toLowerCase()}
                      </div>
                    </div>
                    <div style={{ fontFamily: "var(--disp)", fontSize: 20, fontWeight: 600 }}>{b.amount}</div>
                  </div>
                  {b.flags.map((f) => (
                    <div key={f} className="row" style={{ alignItems: "flex-start", color: "var(--apricot-ink)", fontSize: 13, fontWeight: 500 }}>
                      <Icon name="warn" size={15} width={2} />
                      <span>{f}</span>
                    </div>
                  ))}
                  <div className="row">
                    {b.flags.length || b.needsCheck ? (
                      <Button kind="soft" icon="eye" onClick={() => go("bill", b.id)}>
                        Look closer
                      </Button>
                    ) : (
                      <>
                        <Button kind="soft" icon="check" onClick={() => act(b.id, "accept")}>
                          Track it
                        </Button>
                        <Button kind="ghost" onClick={() => go("bill", b.id)}>
                          Look closer
                        </Button>
                      </>
                    )}
                    <Button kind="ghost" onClick={() => act(b.id, "ignore")}>
                      Not a bill
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Card className="pad stack" style={{ gap: 6 }}>
              <div className="between">
                <h2>To pay</h2>
                <span className="muted">Tick one off when you've paid it</span>
              </div>
              {[...data.toPay, ...data.autopay].map((b) => (
                <div key={b.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 100px 44px", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
                  <button type="button" className="list-btn" style={{ padding: 0 }} onClick={() => go("bill", b.id)}>
                    <b>{b.payee}</b>
                    <span style={{ fontSize: 12.5, fontWeight: b.daysLeft !== null && b.daysLeft <= 3 ? 600 : 400, color: b.daysLeft !== null && b.daysLeft <= 3 ? "var(--apricot-ink)" : "var(--ink2)" }}>
                      {b.due}
                      {b.autopay ? " · automatic" : ""} · {b.category.toLowerCase()}
                    </span>
                  </button>
                  <div style={{ textAlign: "right", fontWeight: 600 }}>{b.amount}</div>
                  {b.autopay ? <span /> : <IconButton icon="check" label={`Mark ${b.payee} as paid`} onClick={() => act(b.id, "paid")} />}
                </div>
              ))}
              {!data.toPay.length && !data.autopay.length && <p className="muted">Nothing to pay right now.</p>}
              {data.paidThisMonth.length > 0 && (
                <div className="stack" style={{ gap: 4, paddingTop: 12, marginTop: 8, borderTop: "1px solid var(--line)" }}>
                  <div className="between">
                    <h3>Paid this month</h3>
                    <span className="muted">
                      {data.paidThisMonth.length} · {data.paidTotal}
                    </span>
                  </div>
                  {data.paidThisMonth.map((b) => (
                    <div key={b.id} className="between muted" style={{ minHeight: 36 }}>
                      <span className="row">
                        <Icon name="check" size={16} width={2} color="var(--sage-ink)" />
                        <b style={{ color: "var(--ink)" }}>{b.payee}</b>
                      </span>
                      <b>{b.amount}</b>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
          <Note>Edward never pays, never signs in to a bank, and keeps no account, card or reference numbers, not even part of one. To pay, use your own banking app.</Note>
        </div>
      )}
    </Shell>
  );
}

export function BillReview({ id }: { id: number }) {
  const { go, toast } = useApp();
  const { data, error, reload } = useData(() => call("billHistory", id), [id]);
  const [edit, setEdit] = useState<{ amount: string; due: string; payee: string } | null>(null);
  const b = data?.bill;
  const form = edit ?? (b ? { amount: b.amountCents !== null ? (b.amountCents / 100).toFixed(2) : "", due: b.dueDate ?? "", payee: b.payee } : { amount: "", due: "", payee: "" });
  const save = async () => {
    if (!b || !edit) return;
    for (const [field, value, old] of [["payee", edit.payee, b.payee], ["amount", edit.amount, b.amountCents !== null ? (b.amountCents / 100).toFixed(2) : ""], ["due", edit.due, b.dueDate ?? ""]] as const) {
      if (value === old) continue;
      const r = await call("billEdit", b.id, field, value);
      if (!r.ok) return toast(r);
    }
    toast({ ok: true, message: "Saved" });
    setEdit(null);
    reload();
  };
  const act = async (action: "accept" | "ignore" | "paid") => {
    if (!b) return;
    toast(await call("billAction", b.id, action));
    go("bills");
  };
  const warn = b && (b.flags.length > 0 || b.needsCheck);
  return (
    <Shell
      title={b?.status === "pending" ? "Check this bill" : "Bill"}
      sub={b ? b.title : ""}
      actions={
        <Button kind="ghost" icon="left" onClick={() => go("bills")}>
          All bills
        </Button>
      }
    >
      {!data || !b ? (
        error ? <Note tone="rose">{error}</Note> : <Loading />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 440px", gap: 16, alignItems: "start" }}>
          <div className="stack" style={{ gap: 16 }}>
            <Card className="pad stack" style={{ borderColor: warn ? "var(--apricot-line)" : undefined }}>
              <div className="row" style={{ color: warn ? "var(--apricot-ink)" : "var(--sage-ink)" }}>
                <Icon name={warn ? "warn" : "shield"} size={20} width={2} />
                <h2 style={{ color: "inherit" }}>{warn ? "Take care with this one" : "Nothing unusual found"}</h2>
              </div>
              <div className="row" style={{ alignItems: "flex-start", fontSize: 13.5 }}>
                <Icon name={b.needsCheck ? "warn" : "check"} size={17} width={2} color={b.needsCheck ? "var(--apricot-ink)" : "var(--sage-ink)"} />
                <span>{b.needsCheck ? "The amount or due date couldn't be found in the email itself. Check them against the email." : "The amount and due date really are in the email."}</span>
              </div>
              {b.flags.map((f) => (
                <div key={f} className="row" style={{ alignItems: "flex-start", fontSize: 13.5, color: "var(--apricot-ink)", fontWeight: 600 }}>
                  <Icon name="warn" size={17} width={2} />
                  <span>{f}</span>
                </div>
              ))}
              {warn && <p className="muted pretty">If in doubt, call the company on a number you already have, not one from this email.</p>}
            </Card>
            <Card className="pad stack">
              <div className="label">{b.payee}'s earlier bills</div>
              {data.earlier.length ? (
                data.earlier.map((e) => (
                  <div key={e.id} className="between" style={{ fontSize: 13.5 }}>
                    <span>{e.due}</span>
                    <b>{e.amount}</b>
                  </div>
                ))
              ) : (
                <p className="muted">This is the first bill from {b.payee} that Edward has seen.</p>
              )}
              <div className="muted">
                Sent from {b.senderDomain}
                {data.usualDomains.length > 0 && !data.usualDomains.includes(b.senderDomain) ? `; earlier bills came from ${data.usualDomains.join(", ")}` : ""}
              </div>
            </Card>
            <Note>How you pay is up to you. Edward will not show, store or act on the payment details in an email.</Note>
          </div>
          <Card className="pad stack" style={{ gap: 14 }}>
            <h2>What Edward read</h2>
            <div className="field">
              <label htmlFor="payee">Payee</label>
              <input id="payee" className="input" value={form.payee} onChange={(e) => setEdit({ ...form, payee: e.target.value })} />
            </div>
            <div className="grid-2" style={{ gap: 12 }}>
              <div className="field">
                <label htmlFor="amount">Amount</label>
                <input id="amount" className="input" inputMode="decimal" value={form.amount} onChange={(e) => setEdit({ ...form, amount: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="due">Due</label>
                <input id="due" className="input" type="date" value={form.due} onChange={(e) => setEdit({ ...form, due: e.target.value })} />
              </div>
            </div>
            {edit && (
              <div className="row">
                <Button kind="primary" onClick={save}>
                  Save changes
                </Button>
                <Button kind="ghost" onClick={() => setEdit(null)}>
                  Undo
                </Button>
              </div>
            )}
            <div className="row" style={{ flexWrap: "wrap", paddingTop: 12, borderTop: "1px solid var(--line)" }}>
              {b.status === "pending" ? (
                <>
                  <Button kind={warn ? "secondary" : "primary"} icon="check" onClick={() => act("accept")}>
                    {warn ? "Track it anyway" : "Track it"}
                  </Button>
                  <Button kind="ghost" onClick={() => act("ignore")}>
                    Not a bill, ignore it
                  </Button>
                </>
              ) : b.status === "tracked" ? (
                <Button kind="primary" icon="check" onClick={() => act("paid")}>
                  I've paid it
                </Button>
              ) : (
                <Tag tone={b.status === "paid" ? "sage" : undefined}>{b.status === "paid" ? "Paid" : b.status === "autopay" ? "Paid automatically" : "Ignored"}</Tag>
              )}
            </div>
          </Card>
        </div>
      )}
    </Shell>
  );
}

const REMIND: [number, string][] = [
  [7, "7 days before"],
  [3, "3 days before"],
  [1, "1 day before"],
  [0, "On the day"],
];

export function BillsMonth() {
  const { go, toast } = useApp();
  const [month, setMonth] = useState(() => new Date().toLocaleDateString("sv").slice(0, 7));
  const { data } = useData(() => call("billMonth", month), [month]);
  const bills = useData(() => call("bills"));
  const [forget, setForget] = useState(false);
  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number) as [number, number];
    const d = new Date(y, m - 1 + n, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const s = bills.data?.settings;
  const setBills = async (patch: Partial<BillSettings>) => {
    await call("updateSettings", { billSettings: patch });
    bills.reload();
  };
  const remind = s?.remind === "off" ? [] : (s?.remind ?? []);
  const status = (b: BillInfo) => (b.status === "paid" ? <Tag tone="sage">Paid</Tag> : b.status === "autopay" ? <Tag>Automatic</Tag> : <Tag tone={b.daysLeft !== null && b.daysLeft <= 3 ? "apricot" : undefined}>To pay</Tag>);
  return (
    <Shell
      title={data?.label ?? "This month"}
      sub="Bills this month"
      actions={
        <>
          <IconButton icon="left" label="Previous month" onClick={() => shift(-1)} />
          <IconButton icon="right" label="Next month" onClick={() => shift(1)} />
          <Button icon="download" onClick={async () => toast(await call("billExport", month))} disabled={!data?.bills.length}>
            Export as CSV
          </Button>
          <Button kind="ghost" icon="left" onClick={() => go("bills")}>
            Bills
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 380px", gap: 16, alignItems: "start" }}>
        <Card className="pad stack" style={{ gap: 22 }}>
          {!data ? (
            <Loading />
          ) : !data.bills.length ? (
            <div className="empty">
              <Spot name="spot-bills" size={140} />
              <h2>No bills for {data.label}</h2>
              <p>Bills you track or mark as paid are counted here.</p>
            </div>
          ) : (
            <>
              <div className="row" style={{ alignItems: "baseline", gap: 14 }}>
                <div style={{ fontFamily: "var(--disp)", fontSize: 40, fontWeight: 600, letterSpacing: "-0.025em" }}>{data.total}</div>
                <div className="muted" style={{ fontSize: 14 }}>
                  across {data.bills.length} bill{data.bills.length === 1 ? "" : "s"} · {data.paid} paid, {data.toPay} to go
                </div>
              </div>
              <div className="stack" style={{ gap: 10 }}>
                {data.byCategory.map((c) => (
                  <div key={c.category} style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr) 90px", alignItems: "center", gap: 12 }}>
                    <div>{c.category}</div>
                    <div style={{ height: 12, borderRadius: 999, background: "var(--soft)" }}>
                      <div style={{ width: `${Math.max(3, c.share)}%`, height: 12, borderRadius: 999, background: "var(--blue)" }} />
                    </div>
                    <div style={{ textAlign: "right", fontWeight: 600 }}>{c.amount}</div>
                  </div>
                ))}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                <thead>
                  <tr className="label" style={{ textAlign: "left" }}>
                    <th style={{ padding: "6px 0", fontWeight: 600 }}>Payee</th>
                    <th style={{ fontWeight: 600 }}>Kind</th>
                    <th style={{ fontWeight: 600 }}>Due</th>
                    <th style={{ fontWeight: 600, textAlign: "right" }}>Amount</th>
                    <th style={{ fontWeight: 600, textAlign: "right" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bills.map((b) => (
                    <tr key={b.id} style={{ borderTop: "1px solid var(--line)", height: 44 }}>
                      <td style={{ fontWeight: 600 }}>{b.payee}</td>
                      <td className="muted">{b.category}</td>
                      <td className="muted">{b.dueDate ? new Date(`${b.dueDate}T00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "—"}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{b.amount}</td>
                      <td style={{ textAlign: "right" }}>{status(b)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Card>
        <Card className="pad stack" style={{ gap: 18 }}>
          <h2>How bills work</h2>
          {!s ? (
            <Loading />
          ) : (
            <>
              <div className="stack" style={{ gap: 8 }}>
                <div>
                  <b>Look for bills</b>
                  <div className="muted">Edward checks your mail the first time it opens each day.</div>
                </div>
                <Segmented label="Look for bills" value={s.scan} onChange={(v) => setBills({ scan: v })} options={[{ value: "daily", label: "Every day" }, { value: "manual", label: "Only when I ask" }]} />
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <div>
                  <b>New bills</b>
                  <div className="muted pretty">Ask about every new bill, or track bills from payees you've confirmed before.</div>
                </div>
                <Segmented label="New bills" value={s.confirm} onChange={(v) => setBills({ confirm: v })} options={[{ value: "always", label: "Always ask me" }, { value: "known", label: "Trust known payees" }]} />
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <div>
                  <b>Remind me</b>
                  <div className="muted">At 09:00, also when Edward is closed.</div>
                </div>
                <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                  {REMIND.map(([d, label]) => (
                    <button
                      type="button"
                      key={d}
                      className="pill"
                      aria-pressed={remind.includes(d)}
                      onClick={() => {
                        const next = remind.includes(d) ? remind.filter((x) => x !== d) : [...remind, d];
                        void setBills({ remind: next.length ? next : "off" });
                      }}
                    >
                      {label}
                    </button>
                  ))}
                  <button type="button" className="pill" aria-pressed={s.remind === "off"} onClick={() => void setBills({ remind: "off" })}>
                    Never
                  </button>
                </div>
              </div>
              <div className="stack" style={{ gap: 8, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
                <Button kind="danger" icon="trash" onClick={() => setForget(true)}>
                  Forget all bills
                </Button>
                <div className="muted">Removes the list from this computer. Your email isn't touched.</div>
              </div>
            </>
          )}
        </Card>
      </div>
      {forget && (
        <Confirm
          danger
          title="Forget all bills?"
          yes="Forget them"
          onAnswer={async (yes) => {
            setForget(false);
            if (yes) {
              toast(await call("forgetBills"));
              bills.reload();
            }
          }}
        >
          Every bill, confirmed payee and scan record Edward has stored is deleted. Your emails are not touched, and the next daily check starts fresh.
        </Confirm>
      )}
    </Shell>
  );
}
