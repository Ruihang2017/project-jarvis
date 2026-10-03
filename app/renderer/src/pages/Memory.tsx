import { useState } from "react";
import type { MemoryInfo } from "../../../shared/api";
import { useApp, Shell } from "../App";
import { call, useData } from "../api";
import { Button, Card, Icon, IconButton, Loading, Spot, Toggle } from "../ui";

export function Memory() {
  const { toast } = useApp();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const { data, reload } = useData(() => call("memory", query || undefined), [query]);
  const [adding, setAdding] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const run = async (p: Promise<{ ok: boolean; message: string }>) => {
    toast(await p);
    reload();
  };
  const row = (m: MemoryInfo) =>
    editing?.id === m.id ? (
      <form
        key={m.id}
        className="list-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(call("memoryEdit", m.id, editing.text)).then(() => setEditing(null));
        }}
      >
        <label className="sr" htmlFor={`m${m.id}`}>
          Edit memory
        </label>
        <input id={`m${m.id}`} className="input" autoFocus value={editing.text} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} />
        <Button kind="primary" small type="submit">
          Save
        </Button>
        <Button kind="ghost" small onClick={() => setEditing(null)}>
          Cancel
        </Button>
      </form>
    ) : (
      <div key={m.id} className="list-row" style={{ padding: "6px 6px 6px 16px" }}>
        <div className="grow">
          <div style={{ fontWeight: 500 }}>{m.text}</div>
          <div className="muted">
            {m.kind} · {m.source}, {m.createdAt}
            {m.tier === "short" ? " · for now" : ""}
          </div>
        </div>
        <IconButton icon="pencil" label="Edit" onClick={() => setEditing({ id: m.id, text: m.text })} />
        <IconButton icon="trash" label="Forget" onClick={() => void run(call("memoryForget", m.id))} />
      </div>
    );
  const all = data ? [...data.long, ...data.short] : [];
  return (
    <Shell
      title="Memory"
      sub="What Edward remembers about you, kept on this computer"
      actions={
        <>
          <Button icon="history" onClick={() => void run(call("memoryUndo"))}>
            Undo last change
          </Button>
          <Button icon="download" onClick={() => void run(call("memoryExport"))}>
            Export
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 16, alignItems: "start" }}>
        <Card className="pad stack" style={{ gap: 14 }}>
          <div className="row">
            <form
              className="search grow"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(q);
              }}
            >
              <Icon name="search" size={16} />
              <label className="sr" htmlFor="mq">
                Search memory
              </label>
              <input id="mq" placeholder="Search what Edward remembers" value={q} onChange={(e) => (setQ(e.target.value), !e.target.value && setQuery(""))} />
            </form>
            <Button kind="primary" icon="plus" onClick={() => setAdding("")}>
              Add something
            </Button>
          </div>
          {adding !== null && (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                void run(call("memoryAdd", adding)).then(() => setAdding(null));
              }}
            >
              <label className="sr" htmlFor="new-memory">
                Something to remember
              </label>
              <input id="new-memory" className="input" autoFocus placeholder="I prefer appointments before noon" value={adding} onChange={(e) => setAdding(e.target.value)} />
              <Button kind="primary" type="submit" disabled={!adding.trim()}>
                Remember
              </Button>
              <Button kind="ghost" onClick={() => setAdding(null)}>
                Cancel
              </Button>
            </form>
          )}
          {!data ? (
            <Loading />
          ) : (
            <>
              {!query && data.core.length > 0 && (
                <div style={{ padding: "16px 18px", borderRadius: 14, background: "var(--blue-soft)" }}>
                  <div className="label" style={{ color: "var(--blue-ink)" }}>
                    Always in mind
                  </div>
                  <div className="pretty" style={{ fontSize: 15 }}>
                    {data.core.slice(0, 6).map((m) => m.text.replace(/\.$/, "")).join(". ")}.
                  </div>
                </div>
              )}
              {all.length ? (
                <div className="stack" style={{ gap: 8 }}>
                  {all.map(row)}
                </div>
              ) : (
                <div className="empty">
                  <Spot name="spot-memory" size={140} alt="An open notebook with a pressed leaf" />
                  <h2>{query ? "Nothing matches" : "Nothing remembered yet"}</h2>
                  <p>{query ? "Try other words." : "Tell Edward “remember that…” in any conversation, or add something here."}</p>
                </div>
              )}
            </>
          )}
        </Card>
        <div className="stack" style={{ gap: 16 }}>
          <Card className="pad stack">
            <div className="between">
              <h2>Learn from conversations</h2>
              {data && <Toggle on={data.learning} label="Learn from conversations" onChange={async (on) => (await call("updateSettings", { learning: on }), reload())} />}
            </div>
            <p className="muted pretty">After a conversation Edward notes things worth keeping. Sensitive ones wait here for your OK.</p>
            {data && data.pending.length > 0 && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="label">To review · {data.pending.length}</div>
                {data.pending.map((m) => (
                  <div key={m.id} className="stack" style={{ gap: 8, padding: "12px 14px", border: "1px solid var(--line)", borderRadius: 14 }}>
                    <div style={{ fontWeight: 500 }}>{m.text}</div>
                    <div className="row" style={{ gap: 6 }}>
                      <Button kind="primary" small onClick={() => void run(call("memoryReview", m.id, true))}>
                        Keep
                      </Button>
                      <Button small onClick={() => void run(call("memoryReview", m.id, false))}>
                        Don't keep
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card className="row" style={{ padding: "18px 20px", gap: 16 }}>
            <Spot name="spot-memory" size={92} />
            <div>
              <h3>Never in here</h3>
              <p className="muted pretty">Account, card and ID numbers and passwords. If you ask Edward to remember one, it refuses.</p>
            </div>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
