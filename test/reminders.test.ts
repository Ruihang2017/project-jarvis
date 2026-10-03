process.env.TZ = "Australia/Sydney"; // DST starts 2026-10-04 02:00 → 03:00

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeRepeat, formatDue, isLocal, lateness, nextOccurrence, parseDuration, toLocal, fromLocal } from "../src/reminders/schedule.js";
import { ReminderStore } from "../src/reminders/store.js";

const results: [string, boolean, string?][] = [];
const eq = (name: string, got: unknown, want: unknown) =>
  results.push([name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`]);

// --- schedule ---
eq("daily across DST keeps 09:00", nextOccurrence("2026-10-03T09:00", { kind: "daily" }, "2026-10-03T09:00"), "2026-10-04T09:00");
eq("daily after DST day", nextOccurrence("2026-10-04T09:00", { kind: "daily" }, "2026-10-04T09:00"), "2026-10-05T09:00");
eq("DST: 24h between 09:00s is 23h real", (fromLocal("2026-10-04T09:00").getTime() - fromLocal("2026-10-03T09:00").getTime()) / 3_600_000, 23);
eq("weekdays: Fri → Mon", nextOccurrence("2026-10-02T08:00", { kind: "weekdays" }, "2026-10-02T08:00"), "2026-10-05T08:00");
eq("weekly Mon/Wed: Mon → Wed", nextOccurrence("2026-10-05T08:00", { kind: "weekly", days: [1, 3] }, "2026-10-05T08:00"), "2026-10-07T08:00");
eq("weekly Mon/Wed: Wed → next Mon", nextOccurrence("2026-10-07T08:00", { kind: "weekly", days: [1, 3] }, "2026-10-07T08:00"), "2026-10-12T08:00");
eq("monthly 31st → Nov 30", nextOccurrence("2026-10-31T09:00", { kind: "monthly", day: 31 }, "2026-10-31T09:00"), "2026-11-30T09:00");
eq("monthly 31st: Nov 30 → Dec 31 (no drift)", nextOccurrence("2026-11-30T09:00", { kind: "monthly", day: 31 }, "2026-11-30T09:00"), "2026-12-31T09:00");
eq("monthly 31st → Feb 28", nextOccurrence("2027-01-31T09:00", { kind: "monthly", day: 31 }, "2027-01-31T09:00"), "2027-02-28T09:00");
eq("missed days are skipped", nextOccurrence("2026-09-25T09:00", { kind: "daily" }, "2026-09-30T10:00"), "2026-10-01T09:00");
eq("one-off has no next", nextOccurrence("2026-10-01T09:00", null, "2026-10-01T09:00"), null);
eq("isLocal valid", isLocal("2026-10-01T09:00"), true);
eq("isLocal rejects Feb 30", isLocal("2026-02-30T09:00"), false);
eq("isLocal rejects junk", isLocal("tomorrow 9am"), false);
eq("isLocal tolerates DST gap 02:30", isLocal("2026-10-04T02:30"), true);
eq("formatDue", formatDue("2026-10-01T09:00", new Date(2026, 8, 30)), "Thu 10-01 09:00");
eq("formatDue other year", formatDue("2027-01-02T07:05", new Date(2026, 8, 30)), "Sat 2027-01-02 07:05");
eq("describeRepeat weekly", describeRepeat({ kind: "weekly", days: [1, 3] }), "every Mon/Wed");
eq("describeRepeat monthly", describeRepeat({ kind: "monthly", day: 22 }), "monthly on the 22nd");
eq("lateness 2h", lateness("2026-10-01T09:00", new Date(2026, 9, 1, 11, 5)), "2h 5m late");
eq("lateness on time", lateness("2026-10-01T09:00", new Date(2026, 9, 1, 9, 1)), "");
eq("parseDuration", [parseDuration("10m"), parseDuration("1h"), parseDuration("90"), parseDuration(undefined), parseDuration("soon")], [10, 60, 90, 10, null]);

// --- store ---
const path = join(tmpdir(), `edward-rem-test-${Date.now()}.db`);
const a = new ReminderStore(path);
const b = new ReminderStore(path); // a second process (e.g. background tick)
const now = new Date(2026, 9, 1, 9, 0); // Thu 2026-10-01 09:00

const once = a.add({ text: "交报销", dueAt: "2026-10-01T08:59" });
const daily = a.add({ text: "看周报", dueAt: "2026-10-01T09:00", repeat: { kind: "daily" } });
const later = a.add({ text: "明天的事", dueAt: "2026-10-02T09:00" });

const first = a.claimDue(now);
const second = b.claimDue(now);
eq("claim returns due ones once", first.map((f) => f.reminder.id).sort(), [once.id, daily.id].sort());
eq("second process gets nothing", second.length, 0);
eq("one-off becomes fired", a.get(once.id)?.status, "fired");
eq("repeating advances to tomorrow", a.get(daily.id)?.dueAt, "2026-10-02T09:00");
eq("occurrence reported", first.find((f) => f.reminder.id === daily.id)?.occurrence, "2026-10-01T09:00");
eq("future one untouched", a.get(later.id)?.status, "scheduled");
eq("upcoming order", a.upcoming().map((r) => r.id), [daily.id, later.id]);

a.snooze(once.id, 10, now);
eq("snooze revives fired one-off", a.get(once.id)?.status, "scheduled");
eq("not due before snooze ends", a.claimDue(new Date(2026, 9, 1, 9, 5)).length, 0);
eq("fires after snooze", b.claimDue(new Date(2026, 9, 1, 9, 11)).map((f) => f.reminder.id), [once.id]);
eq("snoozed one-off fired again", a.get(once.id)?.status, "fired");

a.snooze(daily.id, 30, new Date(2026, 9, 1, 9, 5)); // snooze today's occurrence
const snoozedFire = a.claimDue(new Date(2026, 9, 1, 9, 40));
eq("snoozed repeating fires once", snoozedFire.map((f) => f.occurrence), ["2026-10-01T09:35"]);
eq("then keeps regular schedule", a.get(daily.id)?.dueAt, "2026-10-02T09:00");

const missed = a.add({ text: "漏掉的", dueAt: "2026-09-28T09:00", repeat: { kind: "daily" } });
const m = a.claimDue(now).find((f) => f.reminder.id === missed.id);
eq("missed repeating fires once, late", [m?.occurrence, lateness(m!.occurrence, now) !== ""], ["2026-09-28T09:00", true]);
eq("missed repeating jumps to future", a.get(missed.id)?.dueAt, "2026-10-02T09:00");

a.setStatus(later.id, "cancelled");
eq("cancelled never fires", a.claimDue(new Date(2026, 9, 3)).some((f) => f.reminder.id === later.id), false);
eq("recentlyFired lists one-offs", a.recentlyFired(24 * 365 * 5).map((r) => r.id).includes(once.id), true);

// --- notification text (background tick) ---
const { reminderToast } = await import("../src/background/tick.js");
const dailyNow = a.get(daily.id)!;
eq(
  "toast for repeating shows next",
  reminderToast({ reminder: dailyNow, occurrence: "2026-10-01T09:00" }, new Date(2026, 9, 1, 9, 0)),
  { title: "⏰ 看周报", body: `09:00 · next ${formatDue(dailyNow.dueAt, new Date(2026, 9, 1))} (every day)`, tag: `reminder-${daily.id}`, kind: "reminder" },
);
eq(
  "toast for missed one-off shows lateness",
  reminderToast({ reminder: a.get(once.id)!, occurrence: "2026-10-01T08:59" }, new Date(2026, 9, 1, 11, 0)).body,
  "08:59 · 2h 1m late",
);

a.close();
b.close();
for (const e of ["", "-wal", "-shm"]) rmSync(path + e, { force: true });

console.log(results.map(([n, ok, info]) => `${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  → " + info}`).join("\n"));
if (results.some(([, ok]) => !ok)) process.exitCode = 1;
