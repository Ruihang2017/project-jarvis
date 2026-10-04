// The week grid's placement of a day's events (app/renderer/src/layout.ts, F2a).
const { layoutDay } = await import("../app/renderer/src/layout.js");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const D = "2026-10-05";
const ev = (id: string, from: string, to: string, end = D) => ({ id, startAt: `${D}T${from}`, endAt: `${end}T${to}` });
const show = (list: ReturnType<typeof layoutDay<{ id: string; startAt: string; endAt: string }>>) => list.map((p) => `${p.item.id}:${p.from}-${p.to}@${p.lane}/${p.lanes}`);

eq("one event: one lane", show(layoutDay(D, [ev("a", "09:30", "10:00")])), ["a:570-600@0/1"]);
eq("back to back share a lane", show(layoutDay(D, [ev("a", "09:00", "10:00"), ev("b", "10:00", "11:00")])), ["a:540-600@0/1", "b:600-660@0/1"]);
eq("overlapping side by side", show(layoutDay(D, [ev("b", "09:30", "11:00"), ev("a", "09:00", "10:00")])), ["a:540-600@0/2", "b:570-660@1/2"]);
eq("three overlapping, a freed lane is reused", show(layoutDay(D, [ev("a", "09:00", "12:00"), ev("b", "09:00", "10:00"), ev("c", "10:30", "11:00")])), ["a:540-720@0/2", "b:540-600@1/2", "c:630-660@1/2"]);
eq("runs past midnight: stops at the end of the day", show(layoutDay(D, [ev("a", "22:00", "02:00", "2026-10-06")])), ["a:1320-1440@0/1"]);
eq("zero-length still gets 15 minutes", show(layoutDay(D, [ev("a", "08:00", "08:00")])), ["a:480-495@0/1"]);
eq("nothing", layoutDay(D, []), []);

console.log(results.map(([n, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${n}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
