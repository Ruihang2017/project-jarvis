/**
 * Lists and to-dos in Google Tasks (F3, D40): the shopping list, things to fix at home, to-dos. They
 * show up in the Google Tasks app on the phone. Google keeps only a date for "due", no time of day:
 * Edward's own reminders do times. Nothing is kept on this computer.
 */
import { stripControl } from "../util.js";
import { GoogleAuthError, type GoogleAuth } from "./auth.js";

export const TASKS_SCOPES = ["https://www.googleapis.com/auth/tasks"];
const API = "https://tasks.googleapis.com/tasks/v1";

export const hasTasksAccess = (scopes: string[] | undefined) => TASKS_SCOPES.every((s) => scopes?.includes(s));

/** Lists Edward offers from the start (made in Google Tasks the first time they're needed). */
export const STARTER_LISTS = ["Shopping", "Home"];

export interface TaskList {
  id: string;
  title: string;
}

export interface Task {
  id: string;
  listId: string;
  title: string;
  notes?: string;
  /** YYYY-MM-DD, or none. */
  due?: string;
  done: boolean;
  /** When it was ticked off (ISO). */
  completedAt?: string;
  /** A sub-item's parent task id. */
  parent?: string;
}

interface ApiTask {
  id: string;
  title?: string;
  notes?: string;
  due?: string;
  status?: string;
  completed?: string;
  parent?: string;
  deleted?: boolean;
  hidden?: boolean;
}

export function toTask(t: ApiTask, listId: string): Task {
  return {
    id: t.id,
    listId,
    title: stripControl(t.title ?? "").trim() || "(untitled)",
    notes: t.notes ? stripControl(t.notes).trim() || undefined : undefined,
    due: t.due ? t.due.slice(0, 10) : undefined,
    done: t.status === "completed",
    completedAt: t.completed,
    parent: t.parent,
  };
}

/** Google wants a due date as midnight UTC of that day. */
export const dueValue = (date: string) => `${date}T00:00:00.000Z`;

/** Open items first (soonest due first, undated after), then done ones, most recent first. */
export function sortTasks(list: Task[]): Task[] {
  const open = list.filter((t) => !t.done).sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const done = list.filter((t) => t.done).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  return [...open, ...done];
}

export class TasksClient {
  constructor(private readonly auth: GoogleAuth) {}

  ensureAccess() {
    const s = this.auth.state();
    if (!s) throw new GoogleAuthError("not_connected", "Google isn't connected — run /connect google");
    if (s.invalidAt) throw new GoogleAuthError("invalid_grant", "the Google connection expired — run /connect google");
    if (!hasTasksAccess(s.scopes)) throw new GoogleAuthError("no_scope", "lists need one more Google permission — sign in to Google again (/connect google)");
  }

  async lists(): Promise<TaskList[]> {
    this.ensureAccess();
    const res = await this.auth.api<{ items?: { id: string; title?: string }[] }>(`${API}/users/@me/lists?maxResults=100`);
    return (res.items ?? []).map((l) => ({ id: l.id, title: stripControl(l.title ?? "").trim() || "(untitled)" }));
  }

  async createList(title: string): Promise<TaskList> {
    this.ensureAccess();
    const l = await this.auth.api<{ id: string; title?: string }>(`${API}/users/@me/lists`, { method: "POST", body: JSON.stringify({ title }) });
    return { id: l.id, title: l.title ?? title };
  }

  /** A list by name (any case); made when `create` and it doesn't exist yet. */
  async findList(name: string, create = false): Promise<TaskList | undefined> {
    const want = name.trim().toLowerCase();
    const lists = await this.lists();
    const hit = lists.find((l) => l.title.toLowerCase() === want) ?? lists.find((l) => l.title.toLowerCase().startsWith(want));
    if (hit || !create || !name.trim()) return hit;
    return this.createList(name.trim());
  }

  /**
   * The open items on a list, and those ticked off in the last week. (Google's apps hide an item as
   * soon as it's ticked, so hidden items are asked for and old ones dropped here.)
   */
  async tasks(listId: string, now = new Date()): Promise<Task[]> {
    this.ensureAccess();
    const q = new URLSearchParams({ maxResults: "100", showCompleted: "true", showHidden: "true", completedMin: new Date(now.getTime() - DONE_SHOWN_MS).toISOString() });
    const open = new URLSearchParams({ maxResults: "100", showCompleted: "false" });
    const base = `${API}/lists/${encodeURIComponent(listId)}/tasks`;
    const [recent, todo] = await Promise.all([this.auth.api<{ items?: ApiTask[] }>(`${base}?${q}`), this.auth.api<{ items?: ApiTask[] }>(`${base}?${open}`)]);
    const seen = new Map<string, ApiTask>();
    for (const t of [...(todo.items ?? []), ...(recent.items ?? []).filter((x) => x.status === "completed")]) if (!t.deleted) seen.set(t.id, t);
    return sortTasks([...seen.values()].map((t) => toTask(t, listId)));
  }

  async add(listId: string, item: { title: string; notes?: string; due?: string }): Promise<Task> {
    this.ensureAccess();
    const body = { title: item.title, ...(item.notes ? { notes: item.notes } : {}), ...(item.due ? { due: dueValue(item.due) } : {}) };
    return toTask(await this.auth.api<ApiTask>(`${API}/lists/${encodeURIComponent(listId)}/tasks`, { method: "POST", body: JSON.stringify(body) }), listId);
  }

  /** Changes the fields given; `due: null` removes the date. */
  async update(listId: string, taskId: string, patch: { title?: string; notes?: string; due?: string | null; done?: boolean }): Promise<Task> {
    this.ensureAccess();
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.title = patch.title;
    if (patch.notes !== undefined) body.notes = patch.notes;
    if (patch.due !== undefined) body.due = patch.due ? dueValue(patch.due) : null;
    if (patch.done !== undefined) {
      body.status = patch.done ? "completed" : "needsAction";
      if (!patch.done) body.completed = null;
    }
    const url = `${API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`;
    return toTask(await this.auth.api<ApiTask>(url, { method: "PATCH", body: JSON.stringify(body) }), listId);
  }

  async remove(listId: string, taskId: string): Promise<void> {
    this.ensureAccess();
    await this.auth.api(`${API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
  }
}

/** Ticked-off items stay in view this long. */
const DONE_SHOWN_MS = 7 * 86_400_000;
