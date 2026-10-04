// Lists in Google Tasks (F3): client against a fake Tasks API, and the four tools.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "edward-tasks-test-"));
process.env.EDWARD_DATA_DIR = dir;

const { TasksClient, sortTasks, dueValue, TASKS_SCOPES } = await import("../src/google/tasks.js");
const { TASKS_TOOLS, describeTasksCall } = await import("../src/google/tasks-tools.js");
const { googleInstructions, ALL_SCOPES } = await import("../src/google/instructions.js");
const { fakeAccounts } = await import("./fake-accounts.js");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const throws = async (name: string, f: () => unknown, match: string) => {
  try {
    await f();
    ok(name, false, "did not throw");
  } catch (e) {
    ok(name, String(e).includes(match), String(e));
  }
};

// --- a fake Google Tasks ---
type T = { id: string; title: string; notes?: string; due?: string; status: string; completed?: string; hidden?: boolean };
const lists = new Map<string, { title: string; tasks: T[] }>([["L0", { title: "My Tasks", tasks: [] }]]);
let n = 0;
const calls: string[] = [];
const scopes = { current: [...ALL_SCOPES] };
const auth = {
  state: () => ({ email: "me@gmail.com", scopes: scopes.current, connectedAt: "x" }),
  api: async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : {};
    calls.push(`${method} ${u.pathname.replace("/tasks/v1", "")}`);
    const path = u.pathname.replace("/tasks/v1/", "").split("/").map(decodeURIComponent);
    if (path[0] === "users") {
      if (method === "POST") {
        const id = `L${++n}`;
        lists.set(id, { title: body.title, tasks: [] });
        return { id, title: body.title };
      }
      return { items: [...lists].map(([id, l]) => ({ id, title: l.title })) };
    }
    const list = lists.get(path[1]!)!;
    if (path.length === 3 && method === "GET") {
      const done = u.searchParams.get("showCompleted") === "true";
      const min = u.searchParams.get("completedMin");
      return { items: list.tasks.filter((t) => (done ? !min || t.status !== "completed" || (t.completed ?? "") >= min : t.status !== "completed")) };
    }
    if (path.length === 3 && method === "POST") {
      const t: T = { id: `t${++n}`, title: body.title, notes: body.notes, due: body.due, status: "needsAction" };
      list.tasks.push(t);
      return t;
    }
    const t = list.tasks.find((x) => x.id === path[3])!;
    if (method === "DELETE") {
      list.tasks = list.tasks.filter((x) => x !== t);
      return undefined;
    }
    Object.assign(t, body);
    if (body.status === "completed") t.completed = new Date().toISOString();
    if (body.due === null) delete t.due;
    return t;
  },
};
const c = new TasksClient(auth as never);

// --- client ---
eq("lists", (await c.lists()).map((l) => l.title), ["My Tasks"]);
eq("find by name, any case, or the start of it", [(await c.findList("my tasks"))?.id, (await c.findList("my"))?.id, await c.findList("Shopping")], ["L0", "L0", undefined]);
const shop = (await c.findList("Shopping", true))!;
eq("made when missing", [shop.title, (await c.lists()).length], ["Shopping", 2]);
const milk = await c.add(shop.id, { title: "Milk", due: "2026-10-06" });
eq("due sent as midnight UTC, read back as a date", [lists.get(shop.id)!.tasks[0]!.due, milk.due], [dueValue("2026-10-06"), "2026-10-06"]);
await c.add(shop.id, { title: "Eggs" });
const bread = await c.add(shop.id, { title: "Bread", due: "2026-10-05" });
await c.update(shop.id, milk.id, { done: true });
eq("open first by due date (undated last), then done", (await c.tasks(shop.id)).map((t) => `${t.title}${t.done ? "✓" : ""}`), ["Bread", "Eggs", "Milk✓"]);
lists.get(shop.id)!.tasks.push({ id: "old", title: "Old cheese", status: "completed", completed: "2026-01-01T00:00:00Z", hidden: true });
ok("items ticked off long ago aren't shown", !(await c.tasks(shop.id)).some((t) => t.title === "Old cheese"));
await c.update(shop.id, bread.id, { due: null });
ok("due date removed", !(await c.tasks(shop.id)).find((t) => t.id === bread.id)!.due);
await c.update(shop.id, milk.id, { done: false });
eq("untick", (await c.tasks(shop.id)).find((t) => t.id === milk.id)!.done, false);
eq("sort helper keeps done last", sortTasks([{ id: "a", listId: "x", title: "a", done: true, completedAt: "2" }, { id: "b", listId: "x", title: "b", done: false }]).map((t) => t.id), ["b", "a"]);

// --- tools ---
const accounts = fakeAccounts([{ auth: auth as never, email: "me@gmail.com" }]);
const ctx = { accounts } as never;
const tool = (name: string) => TASKS_TOOLS.find((t) => t.name === name)!;
const add = await tool("tasks_add").prepare({ list: "Home", items: ["Fix the kitchen tap", "Paint the fence"], due: "2026-10-10" }, ctx);
eq("add: summary", add.summary, "add to Home: Fix the kitchen tap, Paint the fence");
const added = await add.execute();
ok("add: makes the Home list, both items with handles", (await c.findList("Home")) !== undefined && /\[t\d+\] ☐ Fix the kitchen tap \(due Sat 10-10\)/.test(added) && added.includes("Paint the fence"), added);
const shown = await (await tool("tasks_show").prepare({}, ctx)).execute();
ok("show: every list with its open items", shown.startsWith("List items") && shown.includes("Shopping") && shown.includes("☐ Eggs") && shown.includes("Home") && !shown.includes("Milk✓"), shown);
const tap = /\[(t\d+)\] ☐ Fix the kitchen tap/.exec(added)![1]!;
const done = await (await tool("tasks_update").prepare({ item: tap, done: true }, ctx)).execute();
ok("update: ticked off", done.includes("☑ Fix the kitchen tap"), done);
const del = await tool("tasks_delete").prepare({ items: [tap] }, ctx);
ok("delete asks, never 'always'", tool("tasks_delete").approval === "ask" && del.allowAlways === false && del.summary.includes("Fix the kitchen tap"));
await del.execute();
ok("delete: gone from Google", !lists.get((await c.findList("Home"))!.id)!.tasks.some((t) => t.title === "Fix the kitchen tap"));
await throws("unknown handle", () => tool("tasks_update").prepare({ item: "t999", done: true }, ctx), "tasks_show first");
await throws("bad date", () => tool("tasks_add").prepare({ list: "Home", items: ["x"], due: "next week" }, ctx), "YYYY-MM-DD");
await throws("a card number is never put on a list (D24)", () => tool("tasks_add").prepare({ list: "Home", items: ["Pay with card 4111 1111 1111 1111"] }, ctx), "");
ok("…and nothing was added", !lists.get((await c.findList("Home"))!.id)!.tasks.some((t) => t.title.includes("4111")));
eq("activity line", describeTasksCall("tasks_add", { list: "Shopping", items: ["Milk", "Eggs"] }, true), "☑ added to Shopping: Milk, Eggs");

// --- without the permission ---
scopes.current = ALL_SCOPES.filter((s) => !TASKS_SCOPES.includes(s));
await throws("no permission yet → sign in again", () => tool("tasks_show").prepare({}, ctx), "/connect google");
ok("instructions say so", googleInstructions(accounts).includes("Lists (shopping list, to-dos) need one more Google permission"));
scopes.current = [...ALL_SCOPES];
ok("instructions explain lists when granted", googleInstructions(accounts).includes("tasks_add to add"));

rmSync(dir, { recursive: true, force: true });
console.log(results.map(([nm, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${nm}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
