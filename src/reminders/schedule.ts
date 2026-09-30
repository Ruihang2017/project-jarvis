/**
 * Time maths for reminders. Times are stored as local wall-clock strings "YYYY-MM-DDTHH:MM"
 * (no offset), so "every day at 09:00" stays at 09:00 across daylight-saving changes.
 */

export type RepeatKind = "daily" | "weekdays" | "weekly" | "monthly";

/**
 * null = one-off. weekly carries weekdays (0 = Sunday … 6 = Saturday); monthly carries the day of
 * month so a 31st reminder returns to the 31st after being clamped to a shorter month.
 */
export type Repeat = { kind: "daily" } | { kind: "weekdays" } | { kind: "weekly"; days: number[] } | { kind: "monthly"; day: number } | null;

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");

export function toLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocal(s: string): Date {
  const m = LOCAL_RE.exec(s);
  if (!m) throw new Error(`bad local time "${s}" (want YYYY-MM-DDTHH:MM)`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

export function isLocal(s: unknown): s is string {
  if (typeof s !== "string" || !LOCAL_RE.test(s)) return false;
  const d = fromLocal(s);
  return toLocal(d) === s || d.getHours() !== Number(s.slice(11, 13)); // tolerate a DST-gap hour
}

/** Serialises a repeat rule for storage: "daily", "weekdays", "weekly:1,3", "monthly:31". */
export function encodeRepeat(r: Repeat): string | null {
  if (!r) return null;
  if (r.kind === "weekly") return `weekly:${[...new Set(r.days)].sort().join(",")}`;
  if (r.kind === "monthly") return `monthly:${r.day}`;
  return r.kind;
}

export function decodeRepeat(s: string | null): Repeat {
  if (!s) return null;
  if (s === "daily" || s === "weekdays") return { kind: s };
  if (s.startsWith("monthly:")) return { kind: "monthly", day: Math.min(31, Math.max(1, Number(s.slice(8)) || 1)) };
  if (s.startsWith("weekly:")) return { kind: "weekly", days: s.slice(7).split(",").map(Number).filter((n) => n >= 0 && n <= 6) };
  return null;
}

/**
 * The first occurrence strictly after `after`, keeping the time of day of `due`.
 * Monthly keeps the day of month of `due`, clamped to shorter months (31 → 30/28).
 */
export function nextOccurrence(due: string, repeat: Repeat, after: string): string | null {
  if (!repeat) return null;
  const base = fromLocal(due);
  const hh = base.getHours();
  const mm = base.getMinutes();
  const at = (y: number, mo: number, d: number) => new Date(y, mo, d, hh, mm);
  const limit = fromLocal(after);

  if (repeat.kind === "monthly") {
    const dom = repeat.day;
    for (let i = 1; i < 1200; i++) {
      const y = base.getFullYear();
      const mo = base.getMonth() + i - 1;
      const last = new Date(y, mo + 1, 0).getDate();
      const cand = at(y, mo, Math.min(dom, last));
      if (cand > limit) return toLocal(cand);
    }
    return null;
  }

  const allowed =
    repeat.kind === "daily" ? [0, 1, 2, 3, 4, 5, 6] : repeat.kind === "weekdays" ? [1, 2, 3, 4, 5] : repeat.days.length ? repeat.days : [base.getDay()];
  for (let i = 1; i < 800; i++) {
    const cand = at(base.getFullYear(), base.getMonth(), base.getDate() + i);
    if (allowed.includes(cand.getDay()) && cand > limit) return toLocal(cand);
  }
  return null;
}

/** "Thu 10-01 09:00" (adds the year when it isn't this year). */
export function formatDue(s: string, now = new Date()): string {
  const d = fromLocal(s);
  const year = d.getFullYear() !== now.getFullYear() ? `${d.getFullYear()}-` : "";
  return `${DAY_NAMES[d.getDay()]} ${year}${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function describeRepeat(r: Repeat): string {
  if (!r) return "";
  switch (r.kind) {
    case "daily":
      return "every day";
    case "weekdays":
      return "weekdays";
    case "weekly":
      return `every ${r.days.map((d) => DAY_NAMES[d]).join("/")}`;
    case "monthly":
      return `monthly on the ${r.day}${ordinal(r.day)}`;
  }
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

/** "2h 5m" style lateness, or "" if under two minutes. */
export function lateness(due: string, now = new Date()): string {
  const mins = Math.round((now.getTime() - fromLocal(due).getTime()) / 60_000);
  if (mins < 2) return "";
  if (mins < 60) return `${mins}m late`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ${mins % 60}m late`;
  return `${Math.floor(mins / 1440)}d late`;
}

/** Parses "10m", "1h", "90" (minutes) for snooze. */
export function parseDuration(s: string | undefined, fallbackMinutes = 10): number | null {
  if (!s) return fallbackMinutes;
  const m = /^(\d+)\s*(m|min|h|hr|d)?$/i.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "m").toLowerCase();
  return unit.startsWith("h") ? n * 60 : unit === "d" ? n * 1440 : n;
}
