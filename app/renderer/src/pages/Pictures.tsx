import { useEffect, useState } from "react";
import type { PictureInfo } from "../../../shared/api";
import { useApp, Shell } from "../App";
import { call, useData } from "../api";
import { Button, Card, Loading, Spot, Toggle } from "../ui";

export function Pictures() {
  const { toast, chat, go } = useApp();
  const { data, reload } = useData(() => call("pictures"));
  const [picked, setPicked] = useState<PictureInfo | null>(null);
  useEffect(() => {
    setPicked((p) => p ?? data?.pictures[0] ?? null);
  }, [data]);
  const act = async (action: "open" | "copy" | "folder", path = picked?.path ?? "") => toast(await call("pictureAction", path, action));
  return (
    <Shell
      title="Pictures"
      sub="Everything Edward has made for you"
      actions={
        <Button icon="folder" onClick={() => act("folder", data?.folder ?? "")}>
          Open the folder
        </Button>
      }
    >
      {!data ? (
        <Loading />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 400px", gap: 16, alignItems: "start" }}>
          <div className="stack" style={{ gap: 14 }}>
            {data.pictures.length > 0 && (
              <div className="grid-3" style={{ gap: 14 }}>
                {data.pictures.map((p) => (
                  <button
                    type="button"
                    key={p.path}
                    aria-pressed={picked?.path === p.path}
                    aria-label={p.prompt}
                    onClick={() => setPicked(p)}
                    onDoubleClick={() => act("open", p.path)}
                    style={{ padding: 0, border: 0, borderRadius: 16, overflow: "hidden", background: "var(--soft)", boxShadow: picked?.path === p.path ? "0 0 0 3px var(--blue)" : "var(--shadow)" }}
                  >
                    <img src={p.url} alt="" style={{ display: "block", width: "100%", aspectRatio: "1 / 1", objectFit: "cover" }} />
                  </button>
                ))}
              </div>
            )}
            <div className="row" style={{ gap: 4, padding: "0 16px 0 0", border: "1px dashed #b8c1d1", borderRadius: 16 }}>
              <div style={{ margin: "10px 16px" }}>
                <Spot name="spot-paints" size={84} alt="A watercolour tin and a jar of brushes" />
              </div>
              <div className="grow">
                <b>{data.pictures.length ? "Ask for another picture in any conversation" : "No pictures yet. Ask for one in any conversation"}</b>
                <div className="muted">"Draw a fox asleep in the snow" · "Make this photo look like a watercolour"</div>
              </div>
              <Button
                kind="soft"
                onClick={() => {
                  go("chat");
                  chat.send("Draw a calm watercolour of a harbour at sunrise");
                }}
              >
                Try one
              </Button>
            </div>
          </div>
          <Card className="stack" style={{ padding: 16 }}>
            {picked ? (
              <>
                <img src={picked.url} alt={picked.prompt} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 14 }} />
                <div>
                  <b>{picked.createdAt}</b>
                  {picked.size && <span className="muted"> · {picked.size}</span>}
                  <div className="muted pretty">"{picked.prompt}"</div>
                </div>
                <div className="row">
                  <Button kind="primary" icon="eye" onClick={() => act("open")}>
                    Open
                  </Button>
                  <Button icon="copy" onClick={() => act("copy")}>
                    Copy
                  </Button>
                  <Button icon="folder" onClick={() => act("folder")}>
                    Show in folder
                  </Button>
                </div>
              </>
            ) : (
              <div className="empty">
                <Spot name="spot-paints" size={140} />
              </div>
            )}
            <div className="stack" style={{ gap: 4, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
              <div className="between">
                <b>Open pictures when they're made</b>
                <Toggle on={data.autoOpen} label="Open pictures when they are made" onChange={async (on) => (await call("updateSettings", { autoOpenImages: on }), reload())} />
              </div>
              <div className="between">
                <div style={{ minWidth: 0 }}>
                  <b>Saved in</b>
                  <div className="mono muted ellipsis">{data.folder}</div>
                </div>
                <Button onClick={async () => (await call("chooseImagesFolder"), reload())}>Change</Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </Shell>
  );
}
