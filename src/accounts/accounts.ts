/**
 * Connected accounts (A1, D34): several personal Google accounts now; Microsoft personal accounts
 * come next (A2). accounts.json holds the list — nothing secret: the address, a name, a colour and
 * what each account is used for. Each account's sign-in lives in its own folder, accounts/<id>/,
 * encrypted as before (N2).
 *
 * Work accounts are refused in code, not by asking the model (D34): a Google Workspace account (it
 * carries an "hd" domain) and any address in the user's own blockedDomains list.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { appDataDir, loadSettings } from "../settings.js";
import { GoogleAuth, readState, statePath, tokenPath, type GoogleState } from "../google/auth.js";
import { GoogleAuthError, type Http } from "../google/oauth.js";
import { hasCalendarAccess } from "../google/calendar.js";
import { hasGmailAccess } from "../google/gmail.js";
import { hasTasksAccess } from "../google/tasks.js";

export type Provider = "google";
/** Lists (F3) live in one account at a time: there is no per-account switch for them. */
export type Feature = "mail" | "calendar" | "tasks";

export interface Account {
  /** "g1", "g2" …; never reused while the account exists. */
  id: string;
  provider: Provider;
  email?: string;
  /** What the user calls it ("Personal", "Family"); the address when unset. */
  name?: string;
  /** Shown next to its mail and events. */
  color: string;
  /** Use this account's mail / calendar (both on when connected). */
  mail: boolean;
  calendar: boolean;
  addedAt: string;
}

interface Stored {
  accounts: Account[];
  /** Default account for new emails and for new events. */
  sendFrom?: string;
  calendarIn?: string;
  /** Account that keeps the lists (Google Tasks). */
  tasksIn?: string;
}

export const COLORS = ["#2A52BE", "#C8742C", "#4F8A6B", "#B5536A", "#6B5BB5", "#2C8C99"];

const filePath = () => join(appDataDir(), "accounts.json");
export const accountDir = (id: string) => join(appDataDir(), "accounts", id);

/** Why this sign-in must not be connected, or null when it may (D34). */
export function refusal(email: string | undefined, hostedDomain: string | undefined, blocked = loadSettings().blockedDomains ?? []): string | null {
  if (hostedDomain) return `${email ?? "This account"} is a Google Workspace account (${hostedDomain}), usually from work or school. Edward connects personal accounts only.`;
  const domain = email?.split("@")[1]?.toLowerCase();
  const hit = domain && blocked.map((d) => d.trim().toLowerCase().replace(/^@/, "")).find((d) => d && (domain === d || domain.endsWith(`.${d}`)));
  if (hit) return `${email} is on your list of domains Edward must not connect (${hit}).`;
  return null;
}

export interface ConnectResult {
  account: Account;
  state: GoogleState;
  /** false when the address was already connected (signed in again). */
  added: boolean;
}

export class Accounts {
  private auths = new Map<string, GoogleAuth>();

  constructor(private readonly http: Http = fetch) {}

  private read(): Stored {
    try {
      const s = JSON.parse(readFileSync(filePath(), "utf8")) as Stored;
      return { ...s, accounts: Array.isArray(s.accounts) ? s.accounts : [] };
    } catch {
      return this.fromSingleAccount();
    }
  }

  private write(s: Stored) {
    mkdirSync(appDataDir(), { recursive: true });
    const tmp = `${filePath()}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n");
    renameSync(tmp, filePath());
  }

  /**
   * Before A1 the one Google account lived in the data folder itself. It becomes account g1: its
   * two files move into accounts/g1/ (the sign-in stays valid; nothing is asked of Google).
   */
  private fromSingleAccount(): Stored {
    const root = appDataDir();
    if (!existsSync(tokenPath(root))) return { accounts: [] };
    const state = readState(root);
    const dir = accountDir("g1");
    try {
      mkdirSync(dir, { recursive: true });
      renameSync(tokenPath(root), tokenPath(dir));
      if (existsSync(statePath(root))) renameSync(statePath(root), statePath(dir));
    } catch {
      // Another Edward process (the background tick) moved them at the same moment.
      try {
        return JSON.parse(readFileSync(filePath(), "utf8")) as Stored;
      } catch {
        return { accounts: [] };
      }
    }
    const stored: Stored = { accounts: [{ id: "g1", provider: "google", email: state?.email, color: COLORS[0]!, mail: true, calendar: true, addedAt: state?.connectedAt ?? new Date().toISOString() }] };
    this.write(stored);
    return stored;
  }

  list(): Account[] {
    return this.read().accounts;
  }

  get(id: string): Account | undefined {
    return this.list().find((a) => a.id === id);
  }

  /** By id, address or name (any case). */
  find(ref: unknown): Account | undefined {
    if (typeof ref !== "string" || !ref.trim()) return undefined;
    const r = ref.trim().toLowerCase();
    return this.list().find((a) => a.id === r || a.email?.toLowerCase() === r || a.name?.toLowerCase() === r);
  }

  label(a: Account): string {
    return a.name || a.email || a.id;
  }

  auth(a: Account | string): GoogleAuth {
    const id = typeof a === "string" ? a : a.id;
    let auth = this.auths.get(id);
    if (!auth) this.auths.set(id, (auth = new GoogleAuth(this.http, accountDir(id))));
    return auth;
  }

  state(a: Account | string): GoogleState | null {
    return this.auth(a).state();
  }

  /** Accounts with a sign-in on this computer (working or expired). */
  connected(): Account[] {
    return this.list().filter((a) => this.state(a));
  }

  /** Whether the account's mail or calendar can be used now: switched on, permission given, sign-in valid. */
  usable(a: Account, f: Feature): boolean {
    const s = this.state(a);
    if (!s || s.invalidAt) return false;
    if (f === "tasks") return hasTasksAccess(s.scopes);
    if (!a[f]) return false;
    return f === "mail" ? hasGmailAccess(s.scopes) : hasCalendarAccess(s.scopes);
  }

  /** Accounts to use for mail or calendar, in the order they were added. */
  for(f: Feature): Account[] {
    return this.list().filter((a) => this.usable(a, f));
  }

  /** Where a new email is sent from / a new event goes: the chosen default, else the first account. */
  primary(f: Feature): Account | undefined {
    const s = this.read();
    const id = f === "mail" ? s.sendFrom : f === "calendar" ? s.calendarIn : s.tasksIn;
    const all = this.for(f);
    return all.find((a) => a.id === id) ?? all[0];
  }

  /**
   * The accounts a tool should use: all usable ones, or the one the model named. Throws a message
   * the model can act on when the name matches nothing usable.
   */
  pick(f: Feature, ref?: unknown): Account[] {
    const all = this.for(f);
    if (ref === undefined || ref === null || (typeof ref === "string" && !ref.trim())) return all;
    const a = this.find(ref);
    const hit = a && all.find((x) => x.id === a.id);
    if (hit) return [hit];
    const names = all.map((x) => this.label(x)).join(", ") || "none";
    throw new Error(`no ${f} account "${String(ref)}"; ${f} accounts: ${names}`);
  }

  setDefault(f: Feature, id: string) {
    const s = this.read();
    if (!s.accounts.some((a) => a.id === id)) throw new Error(`no account ${id}`);
    this.write({ ...s, ...(f === "mail" ? { sendFrom: id } : f === "calendar" ? { calendarIn: id } : { tasksIn: id }) });
  }

  update(id: string, patch: Partial<Pick<Account, "name" | "color" | "mail" | "calendar">>): Account {
    const s = this.read();
    const a = s.accounts.find((x) => x.id === id);
    if (!a) throw new Error(`no account ${id}`);
    if (patch.name !== undefined) a.name = patch.name.trim().slice(0, 40) || undefined;
    if (patch.color !== undefined && /^#[0-9a-f]{6}$/i.test(patch.color)) a.color = patch.color;
    if (patch.mail !== undefined) a.mail = patch.mail;
    if (patch.calendar !== undefined) a.calendar = patch.calendar;
    this.write(s);
    return a;
  }

  /**
   * Signs in to Google in the browser. A new address becomes a new account; an address already
   * connected (or `o.account`) is signed in again, keeping its name and settings. A work account is
   * refused: its sign-in is revoked at Google and forgotten.
   */
  async connect(scopes: string[], open: (url: string) => void, o: { account?: string; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ConnectResult> {
    const again = o.account ? this.get(o.account) : undefined;
    if (o.account && !again) throw new Error(`no account ${o.account}`);
    // Sign in into a scratch folder first: nothing replaces a working sign-in until this one is accepted.
    const tmp = join(appDataDir(), "accounts", `.new-${randomBytes(4).toString("hex")}`);
    const fresh = new GoogleAuth(this.http, tmp);
    try {
      const wanted = [...new Set([...scopes, ...(again ? (this.state(again)?.scopes ?? []) : [])])];
      const state = await fresh.connect(wanted, open, o);
      const why = refusal(state.email, state.hostedDomain);
      if (why) {
        await fresh.disconnect();
        throw new GoogleAuthError("refused", why);
      }
      const s = this.read();
      const same = again ?? s.accounts.find((a) => a.email && state.email && a.email.toLowerCase() === state.email.toLowerCase());
      if (again && state.email && again.email && again.email.toLowerCase() !== state.email.toLowerCase()) {
        await fresh.disconnect();
        throw new GoogleAuthError("wrong_account", `you signed in as ${state.email}, but this is ${again.email}; to add another account, use Add account`);
      }
      const account: Account = same ?? { id: nextId(s.accounts), provider: "google", email: state.email, color: COLORS[s.accounts.length % COLORS.length]!, mail: true, calendar: true, addedAt: state.connectedAt };
      const dir = accountDir(account.id);
      mkdirSync(dir, { recursive: true });
      // Replacing the files is enough: Google keeps an older refresh token valid, and revoking it
      // would revoke the new one too (it revokes the whole grant).
      renameSync(tokenPath(tmp), tokenPath(dir));
      renameSync(statePath(tmp), statePath(dir));
      this.auths.delete(account.id);
      if (same) {
        if (state.email) same.email = state.email;
      } else s.accounts.push(account);
      this.write(s);
      return { account, state, added: !same };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** Revokes at Google (best effort) and forgets the account. */
  async disconnect(id: string): Promise<{ revoked: boolean }> {
    const s = this.read();
    if (!s.accounts.some((a) => a.id === id)) throw new Error(`no account ${id}`);
    const r = await this.auth(id).disconnect();
    rmSync(accountDir(id), { recursive: true, force: true });
    this.auths.delete(id);
    this.write({
      accounts: s.accounts.filter((a) => a.id !== id),
      sendFrom: s.sendFrom === id ? undefined : s.sendFrom,
      calendarIn: s.calendarIn === id ? undefined : s.calendarIn,
      tasksIn: s.tasksIn === id ? undefined : s.tasksIn,
    });
    return r;
  }
}

function nextId(list: Account[]): string {
  const used = new Set(list.map((a) => a.id));
  let n = 1;
  while (used.has(`g${n}`) || existsSync(accountDir(`g${n}`))) n++;
  return `g${n}`;
}
