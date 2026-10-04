/** Shared pieces of Edward's design language (design/gen/lib.mjs is the board version of the same). */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Mode } from "../../shared/api";

const PATHS: Record<string, string> = {
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8",
  moon: "M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z",
  chat: "M4 5.5h16V16H10l-4.5 3.5V16H4z",
  calendar: "M6 5h12a2.5 2.5 0 0 1 2.5 2.5v10A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5v-10A2.5 2.5 0 0 1 6 5zM3.5 10h17M8 3v4M16 3v4",
  mail: "M5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9A2.5 2.5 0 0 1 5.5 5zM3.5 7l8.5 6.5L20.5 7",
  bill: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  bell: "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0",
  book: "M5 4.5h10.5A2.5 2.5 0 0 1 18 7v13H7.5A2.5 2.5 0 0 1 5 17.5zM5 17.5A2.5 2.5 0 0 1 7.5 15H18",
  image: "M5.5 4.5h13A2.5 2.5 0 0 1 21 7v10a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17V7a2.5 2.5 0 0 1 2.5-2.5zM8.5 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM4 17l5-4.5 3.5 3 3-2.5 4.5 4",
  shield: "M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6zM9 12l2.2 2.2L15.2 10",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8",
  clock: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2",
  check: "m5 12.5 4.5 4.5L19 7.5",
  warn: "M12 4 2.8 19.5h18.4zM12 10v4.5M12 17v.5",
  x: "m6 6 12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  search: "M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM16 16l4.5 4.5",
  send: "M4 12 20 4.5 14.5 20l-3-6.5z",
  stop: "M7 7h10v10H7z",
  clip: "M8 12.5 14 6.5a3 3 0 0 1 4.2 4.2l-7.7 7.7a5 5 0 0 1-7-7L10 5",
  mic: "M12 3.5a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-5 0V6A2.5 2.5 0 0 1 12 3.5zM6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3.5",
  chevron: "m7 10 5 5 5-5",
  right: "m10 7 5 5-5 5",
  left: "m14 7-5 5 5 5",
  link: "M14 5h5v5M19 5l-8 8M17 14v4.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H10",
  lock: "M7.5 10.5h9a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18v-5a2.5 2.5 0 0 1 2.5-2.5zM8 10.5V8a4 4 0 0 1 8 0v2.5",
  key: "M8 11a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM11 12l8.5-8.5M16 7l3 3M13.5 9.5l2 2",
  heart: "M3.5 12h4l2-5 3.5 10 2.5-5h5",
  box: "M3.5 8 12 3.5 20.5 8v8L12 20.5 3.5 16zM3.5 8 12 12.5 20.5 8M12 12.5v8",
  globe: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17",
  folder: "M3.5 6.5h6l2 2.5h9v10.5h-17z",
  copy: "M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8",
  download: "M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 19.5h14",
  trash: "M5 7h14M9.5 7V4.5h5V7M7 7l.8 12.5h8.4L17 7",
  pencil: "M4.5 19.5 5.5 15 16 4.5l3.5 3.5L9 18.5z",
  history: "M4 12a8 8 0 1 0 2.5-5.8L4 8.5M4 4.5v4h4M12 8v4.5l3 1.5",
  terminal: "M5.5 4.5h13A2.5 2.5 0 0 1 21 7v10a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17V7a2.5 2.5 0 0 1 2.5-2.5zM7 9.5l3 2.5-3 2.5M12.5 15H17",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  spark: "M12 3.5 13.8 10l6.7 2-6.7 2L12 20.5 10.2 14l-6.7-2 6.7-2z",
  file: "M6.5 3.5h8l4 4v13h-12zM14.5 3.5v4h4",
  refresh: "M19.5 12a7.5 7.5 0 1 1-2.3-5.4L19.5 9M19.5 4.5V9H15",
  users: "M9 5.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2.5 19.5a6.5 6.5 0 0 1 13 0M16 5.8a3.5 3.5 0 0 1 0 6.4M18 14.5a6.5 6.5 0 0 1 3.5 5",
};

export function Icon({ name, size = 18, width = 1.6, color = "currentColor" }: { name: string; size?: number; width?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d={PATHS[name] ?? PATHS.spark} />
    </svg>
  );
}

export const art = (name: string) => `./art/${name}.jpg`;

export function Spot({ name, size, alt = "" }: { name: string; size: number; alt?: string }) {
  return <img className="spot" src={art(name)} alt={alt} width={size} height={size} />;
}

type BtnKind = "primary" | "secondary" | "ghost" | "soft" | "danger" | "danger-fill";
export function Button({ kind = "secondary", icon, children, small, wide, ...rest }: { kind?: BtnKind; icon?: string; small?: boolean; wide?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={["btn", kind === "secondary" ? "" : kind, small ? "small" : "", wide ? "wide" : ""].join(" ")} {...rest}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, ...rest }: { icon: string; label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

export function Tag({ tone, icon, children }: { tone?: "blue" | "apricot" | "sage" | "rose"; icon?: string; children: ReactNode }) {
  return (
    <span className={`tag ${tone ?? ""}`}>
      {icon && <Icon name={icon} size={13} width={2} />}
      {children}
    </span>
  );
}

export function Note({ tone, icon = "lock", children }: { tone?: "blue" | "apricot" | "sage" | "rose"; icon?: string; children: ReactNode }) {
  return (
    <div className={`note ${tone ?? ""}`}>
      <Icon name={icon} size={16} width={1.8} />
      <div>{children}</div>
    </div>
  );
}

export function Card({ children, className = "", style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <section className={`card ${className}`} style={style}>
      {children}
    </section>
  );
}

export function Toggle({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!on)}>
      <span>
        <i />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({ options, value, label, onChange }: { options: { value: T; label: string }[]; value: T; label: string; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return (
    <div className="thinking" style={{ paddingLeft: 0 }}>
      <span className="dots">
        <i />
        <i />
        <i />
      </span>
      {what}…
    </div>
  );
}

export const MODES: { value: Mode; label: string; dot: string; note: string; tone: "sage" | "apricot" | "rose"; help: string }[] = [
  { value: "chat", label: "Chat", dot: "#2E8B57", note: "Privacy guard on", tone: "sage", help: "Edward talks and uses only its own tools. Everything goes through the privacy guard." },
  { value: "manual", label: "Manual", dot: "#C97A2B", note: "Guard covers chat only", tone: "apricot", help: "Codex may run commands and change files, asking before every step." },
  { value: "semi-auto", label: "Semi-auto", dot: "#C97A2B", note: "Guard covers chat only", tone: "apricot", help: "Like Manual, but edits inside the working folder go ahead without asking." },
  { value: "auto", label: "Auto", dot: "#B3261E", note: "Codex acts without asking", tone: "rose", help: "Codex never asks. Only for a task you'd hand over completely." },
];

/** The mode is on every page, top right (D24): the user never has to wonder which one is on. */
export function ModeBar({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const m = MODES.find((x) => x.value === mode) ?? MODES[0]!;
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="row" style={{ position: "relative" }} ref={ref}>
      <Tag tone={m.tone} icon={m.tone === "sage" ? "shield" : "warn"}>
        {m.note}
      </Tag>
      <button type="button" className="modebtn" aria-haspopup="menu" aria-expanded={open} aria-label={`Permission mode: ${m.label}. Change`} onClick={() => setOpen(!open)}>
        <span className="dot" style={{ background: m.dot }} />
        {m.label} mode
        <Icon name="chevron" size={16} color="var(--ink3)" />
      </button>
      {open && (
        <div className="menu" role="menu">
          {MODES.map((x) => (
            <button
              type="button"
              key={x.value}
              role="menuitemradio"
              aria-checked={x.value === mode}
              onClick={() => {
                setOpen(false);
                onChange(x.value);
              }}
            >
              <span className="dot" style={{ background: x.dot }} />
              <span>
                <b>{x.label}</b>
                <div className="muted pretty">{x.help}</div>
              </span>
            </button>
          ))}
          <div className="muted" style={{ padding: "6px 12px" }}>
            Shift + Tab in the message box switches between Chat, Manual and Semi-auto.
          </div>
        </div>
      )}
    </div>
  );
}

/** Small confirmation dialog. */
export function Confirm({ title, children, yes, no = "Cancel", danger, onAnswer }: { title: string; children: ReactNode; yes: string; no?: string; danger?: boolean; onAnswer: (yes: boolean) => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onAnswer(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onAnswer]);
  return (
    <div className="modal-back" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onAnswer(false)}>
      <div className={`modal ${danger ? "danger" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row" style={{ color: danger ? "var(--rose-ink)" : undefined }}>
          {danger && <Icon name="warn" size={20} width={2} />}
          <h2>{title}</h2>
        </div>
        <div className="muted pretty" style={{ fontSize: 14 }}>
          {children}
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={() => onAnswer(false)}>{no}</Button>
          <Button kind={danger ? "danger-fill" : "primary"} onClick={() => onAnswer(true)} autoFocus>
            {yes}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Which account an email or event is in: a coloured dot and its name. */
export function AccountChip({ label, color }: { label: string; color?: string }) {
  return (
    <span className="row muted" style={{ gap: 6, fontSize: 12.5 }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: color ?? "var(--ink3)", flexShrink: 0 }} />
      <span className="ellipsis">{label}</span>
    </span>
  );
}
