process.env.TZ = "Australia/Sydney";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-bg-test-"));
process.env.JARVIS_DATA_DIR = dir; // settings.json for the brief schedule lives here

const { MemoryStore, addDays, today } = await import("../src/memory/store.js");
const { ReminderStore } = await import("../src/reminders/store.js");
const { toLocal } = await import("../src/reminders/schedule.js");
const { briefDue, composeBrief, markBriefShown, nextBriefAt } = await import("../src/background/brief.js");
const { toastXml } = await import("../src/background/notify.js");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// --- toast XML ---
const rx = toastXml({ title: "⏰ 交报销 <&>", body: "09:00 · 2h late\nsecond\nthird", kind: "reminder" }, "");
ok("reminder toast: scenario + system snooze/dismiss", rx.includes('scenario="reminder"') && rx.includes('arguments="snooze"') && rx.includes('arguments="dismiss"') && rx.includes('defaultInput="10"'), rx);
ok("toast escapes text", rx.includes("交报销 &lt;&amp;&gt;"), rx);
eq("toast keeps title + 2 body lines", (rx.match(/<text>/g) ?? []).length, 3);
const ix = toastXml({ title: "☀ brief", body: "a", kind: "info" }, "");
ok("info toast: no scenario, no actions", !ix.includes("scenario") && !ix.includes("<actions>"), ix);
const withIcon = toastXml({ title: "t", body: "b" }, join(dir, "missing.png"));
ok("missing icon is omitted", !withIcon.includes("<image"), withIcon);
writeFileSync(join(dir, "icon.png"), "x");
ok("existing icon becomes appLogoOverride file URL", toastXml({ title: "t", body: "b" }, join(dir, "icon.png")).includes('placement="appLogoOverride" hint-crop="none" src="file:///'));

// --- brief ---
const mem = new MemoryStore(join(dir, "memory.db"));
const rem = new ReminderStore(join(dir, "memory.db"));
const now = new Date();
const inAnHour = new Date(now.getTime() + 3_600_000);
const sameDay = toLocal(inAnHour).slice(0, 10) === today();
if (sameDay) rem.add({ text: "交报销", dueAt: toLocal(inAnHour) });
rem.add({ text: "下周的事", dueAt: `${addDays(5)}T09:00` });
mem.add({ kind: "event", text: "东京出差", validUntil: addDays(2), source: "explicit" });
mem.add({ kind: "event", text: "很远的事", validUntil: addDays(20), source: "explicit" });
mem.add({ kind: "fact", text: "健康信息", source: "extracted", status: "pending", sensitivity: "health" });

const brief = composeBrief(mem, rem, now);
ok("brief lists today's reminders", !sameDay || brief.lines.some((l) => l.startsWith("⏰") && l.includes("交报销")), JSON.stringify(brief.lines));
ok("brief skips later reminders", !brief.lines.some((l) => l.includes("下周的事")), JSON.stringify(brief.lines));
ok("brief lists events within 3 days", brief.lines.some((l) => l.startsWith("📌") && l.includes("东京出差")), JSON.stringify(brief.lines));
ok("brief skips far events", !brief.lines.some((l) => l.includes("很远的事")));
ok("brief mentions pending reviews", brief.lines.some((l) => l.startsWith("🔒 1 memory")));
eq("brief count", brief.count, (sameDay ? 1 : 0) + 2);
ok("brief title has the count", brief.title.includes(`${brief.count} things today`), brief.title);

const settings = (s: object) => writeFileSync(join(dir, "settings.json"), JSON.stringify(s));
const weekday = new Date(2026, 9, 1, 8, 29); // Thu
const saturday = new Date(2026, 9, 3, 9, 0);
settings({ briefTime: "08:30", briefDays: "weekdays" });
eq("not due before the time", briefDue(mem, "toast", weekday), false);
eq("due at the time on a weekday", briefDue(mem, "toast", new Date(2026, 9, 1, 8, 30)), true);
eq("weekdays: not on Saturday", briefDue(mem, "toast", saturday), false);
settings({ briefTime: "08:30", briefDays: "daily" });
eq("daily: Saturday too", briefDue(mem, "toast", saturday), true);
settings({ briefDays: "off" });
eq("off: never", briefDue(mem, "toast", new Date(2026, 9, 1, 12, 0)), false);
settings({});
markBriefShown(mem, "toast");
eq("shown today → not due again (toast)", briefDue(mem, "toast", new Date(new Date().setHours(23, 59))), false);
eq("repl channel is independent", briefDue(mem, "repl", new Date(new Date().setHours(23, 59))) === (new Date().getDay() % 6 !== 0), true);
settings({ briefTime: "08:30", briefDays: "weekdays" });
eq("next brief skips the weekend", nextBriefAt(new Date(2026, 9, 2, 9, 0)), "Mon 10-05 08:30");
eq("next brief later today", nextBriefAt(new Date(2026, 9, 1, 7, 0)), "Thu 10-01 08:30");

mem.close();
rem.close();
rmSync(dir, { recursive: true, force: true });

console.log(results.map(([n, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${n}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
