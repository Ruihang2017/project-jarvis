import { useState } from "react";
import type { TaskItem } from "../../../shared/api";
import { useApp, Shell } from "../App";
import { call, useData } from "../api";
import { AccountChip, Button, Card, Icon, IconButton, Loading, Note, Spot } from "../ui";

/** Lists in Google Tasks (F3): the shopping list, things to fix at home, to-dos. */
export function Lists() {
  const { go, chat, toast } = useApp();
  const [listId, setListId] = useState<string | undefined>(undefined);
  const { data, error, reload } = useData(() => call("lists", listId), [listId]);
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [newList, setNewList] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = data?.selected;
  const title = data?.lists.find((l) => l.id === selected)?.title ?? "";
  const run = async (p: Promise<{ ok: boolean; message: string }>) => {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.ok || r.message) toast(r);
    reload();
    return r;
  };
  const makeList = async (name: string) => {
    const r = await call("listCreate", name);
    toast(r);
    if (r.id) setListId(r.id);
    else reload();
  };
  const open = (data?.items ?? []).filter((t) => !t.done);
  const done = (data?.items ?? []).filter((t) => t.done);
  return (
    <Shell
      title="Lists"
      sub={data?.account ? `In Google Tasks, so they're on your phone too${data.lists.length ? "" : ""}` : "Shopping list, things to fix at home, to-dos"}
      actions={
        <Button kind="primary" icon="chat" onClick={() => (chat.send("What's on my lists?"), go("chat"))} disabled={!data?.account}>
          Ask about my lists
        </Button>
      }
    >
      {!data && !error ? (
        <Loading />
      ) : !data?.account ? (
        <Card className="pad">
          <div className="row" style={{ gap: 28, padding: "20px 12px" }}>
            <Spot name="spot-key" size={140} />
            <div className="stack" style={{ maxWidth: 540 }}>
              <h2 style={{ fontSize: 22 }}>{data?.needsPermission ? "One more Google permission" : "Connect your Google account"}</h2>
              <p className="muted pretty" style={{ fontSize: 14 }}>
                {data?.needsPermission
                  ? "Lists are kept in Google Tasks, so you can see the shopping list on your phone. Sign in to Google again and allow Tasks."
                  : "Lists are kept in Google Tasks. Connect a personal Google account first."}
              </p>
              <div>
                <Button kind="primary" icon="key" onClick={() => go("google")}>
                  {data?.needsPermission ? "Sign in again" : "Connect Google"}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
          <Card className="stack" style={{ padding: 12, gap: 4 }}>
            {data.lists.map((l) => (
              <button key={l.id} type="button" className="list-btn" aria-pressed={l.id === selected} onClick={() => setListId(l.id)}>
                <span className="between">
                  <b>{l.title}</b>
                  <span className="muted">{l.open || ""}</span>
                </span>
              </button>
            ))}
            {data.suggested.map((s) => (
              <button key={s} type="button" className="list-btn" onClick={() => void makeList(s)}>
                <span className="row muted" style={{ gap: 8 }}>
                  <Icon name="plus" size={14} />
                  {s}
                </span>
              </button>
            ))}
            {newList === null ? (
              <Button small kind="ghost" icon="plus" onClick={() => setNewList("")}>
                New list
              </Button>
            ) : (
              <form
                className="row"
                style={{ gap: 6, padding: 4 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newList.trim()) void makeList(newList.trim());
                  setNewList(null);
                }}
              >
                <input className="input grow" autoFocus placeholder="List name" value={newList} onChange={(e) => setNewList(e.target.value)} />
                <Button small kind="primary" type="submit">
                  Make
                </Button>
              </form>
            )}
            <div style={{ paddingTop: 8 }}>
              {data.account.accountLabel && <AccountChip label={`Kept in ${data.account.accountLabel}`} color={data.account.color} />}
            </div>
          </Card>
          <Card className="stack" style={{ padding: 20, gap: 12 }}>
            {data.problem && (
              <Note tone="apricot" icon="warn">
                {data.problem}
              </Note>
            )}
            {selected ? (
              <>
                <h2 style={{ fontSize: 22 }}>{title}</h2>
                <form
                  className="row"
                  style={{ gap: 8 }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!text.trim()) return;
                    const r = await run(call("listAdd", selected, { title: text, due: due || undefined }));
                    if (r.ok) (setText(""), setDue(""));
                  }}
                >
                  <input className="input grow" autoFocus placeholder={title.toLowerCase() === "shopping" ? "Add something to buy" : "Add an item"} value={text} onChange={(e) => setText(e.target.value)} />
                  <input className="input" type="date" aria-label="Due date (optional)" value={due} onChange={(e) => setDue(e.target.value)} style={{ width: 150 }} />
                  <Button kind="primary" type="submit" disabled={busy || !text.trim()}>
                    Add
                  </Button>
                </form>
                {!open.length && !done.length && <p className="muted">Nothing here yet.</p>}
                <div className="stack" style={{ gap: 2 }}>
                  {open.map((t) => (
                    <Item
                      key={t.id}
                      t={t}
                      editing={editing?.id === t.id ? editing.title : null}
                      onEdit={(v) => setEditing(v === null ? null : { id: t.id, title: v })}
                      onSave={() => editing && (void run(call("listUpdate", selected, t.id, { title: editing.title })), setEditing(null))}
                      onToggle={() => void run(call("listUpdate", selected, t.id, { done: true }))}
                      onDue={(d) => void run(call("listUpdate", selected, t.id, { due: d || null }))}
                      onRemove={() => void run(call("listRemove", selected, t.id))}
                    />
                  ))}
                </div>
                {done.length > 0 && (
                  <div className="stack" style={{ gap: 2, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      Ticked off this week
                    </span>
                    {done.map((t) => (
                      <Item key={t.id} t={t} editing={null} onEdit={() => {}} onSave={() => {}} onToggle={() => void run(call("listUpdate", selected, t.id, { done: false }))} onDue={() => {}} onRemove={() => void run(call("listRemove", selected, t.id))} />
                    ))}
                  </div>
                )}
                <Note tone="blue" icon="chat">
                  You can also just say it: "add milk and eggs to the shopping list", "the kitchen tap is leaking, put it on Home". A list item has a date at most; for a reminder at a time, ask for one.
                </Note>
              </>
            ) : (
              <p className="muted">Make a list on the left to start.</p>
            )}
          </Card>
        </div>
      )}
    </Shell>
  );
}

function Item({
  t,
  editing,
  onEdit,
  onSave,
  onToggle,
  onDue,
  onRemove,
}: {
  t: TaskItem;
  editing: string | null;
  onEdit: (title: string | null) => void;
  onSave: () => void;
  onToggle: () => void;
  onDue: (date: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="row" style={{ gap: 10, padding: "8px 6px", borderRadius: 10, minHeight: 44 }}>
      <button
        type="button"
        role="checkbox"
        aria-checked={t.done}
        aria-label={t.done ? `Untick ${t.title}` : `Tick off ${t.title}`}
        onClick={onToggle}
        style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${t.done ? "var(--sage-ink, #4F8A6B)" : "var(--line-strong, #B8C2D6)"}`, background: t.done ? "var(--sage-ink, #4F8A6B)" : "transparent", display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0, padding: 0 }}
      >
        {t.done && <Icon name="check" size={14} width={2.6} color="#fff" />}
      </button>
      {editing !== null ? (
        <form
          className="grow"
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
        >
          <input className="input" style={{ width: "100%" }} autoFocus value={editing} onChange={(e) => onEdit(e.target.value)} onBlur={onSave} onKeyDown={(e) => e.key === "Escape" && onEdit(null)} />
        </form>
      ) : (
        <span className="grow" onDoubleClick={() => !t.done && onEdit(t.title)} style={{ textDecoration: t.done ? "line-through" : undefined, color: t.done ? "var(--ink3)" : undefined, minWidth: 0, overflowWrap: "anywhere" }} title={t.done ? undefined : "Double-click to rename"}>
          {t.title}
          {t.notes && <span className="muted" style={{ display: "block", fontSize: 12.5 }}>{t.notes}</span>}
        </span>
      )}
      {!t.done &&
        (t.due ? (
          <label className="row" style={{ gap: 4, fontSize: 12.5, color: t.overdue ? "var(--rose-ink, #B5536A)" : "var(--ink2)" }}>
            {t.overdue ? "Overdue · " : ""}
            {t.dueLabel}
            <input type="date" aria-label={`Due date of ${t.title}`} value={t.due} onChange={(e) => onDue(e.target.value)} style={{ width: 22, border: 0, background: "transparent", color: "transparent", cursor: "pointer" }} />
          </label>
        ) : (
          <input type="date" aria-label={`Due date of ${t.title}`} className="muted" value="" onChange={(e) => onDue(e.target.value)} style={{ width: 22, border: 0, background: "transparent", color: "transparent", cursor: "pointer" }} title="Add a date" />
        ))}
      <IconButton icon="x" label={`Remove ${t.title}`} onClick={onRemove} />
    </div>
  );
}
