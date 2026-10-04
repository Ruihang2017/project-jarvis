// Tool tests: an Accounts stand-in with one or more fake Google sign-ins (no files, no network).
import type { Account, Accounts, Feature } from "../src/accounts/accounts.js";
import type { GoogleAuth } from "../src/google/auth.js";
import { hasCalendarAccess } from "../src/google/calendar.js";
import { hasGmailAccess } from "../src/google/gmail.js";
import { hasTasksAccess } from "../src/google/tasks.js";

export function fakeAccounts(entries: { auth: GoogleAuth; id?: string; email?: string; name?: string }[], defaults: { mail?: string; calendar?: string; tasks?: string } = {}): Accounts {
  const list: Account[] = entries.map((e, i) => ({ id: e.id ?? `g${i + 1}`, provider: "google", email: e.email, name: e.name, color: "#2A52BE", mail: true, calendar: true, addedAt: "" }));
  const authOf = (a: Account | string) => entries[list.findIndex((x) => x.id === (typeof a === "string" ? a : a.id))]!.auth;
  const usable = (a: Account, f: Feature) => {
    const s = authOf(a).state();
    return Boolean(s && !s.invalidAt && (f === "mail" ? hasGmailAccess(s.scopes) : f === "calendar" ? hasCalendarAccess(s.scopes) : hasTasksAccess(s.scopes)));
  };
  const self = {
    list: () => list,
    get: (id: string) => list.find((a) => a.id === id),
    find: (ref: unknown) => (typeof ref === "string" ? list.find((a) => [a.id, a.email?.toLowerCase(), a.name?.toLowerCase()].includes(ref.trim().toLowerCase())) : undefined),
    label: (a: Account) => a.name || a.email || a.id,
    auth: authOf,
    state: (a: Account | string) => authOf(a).state(),
    connected: () => list.filter((a) => authOf(a).state()),
    usable,
    for: (f: Feature) => list.filter((a) => usable(a, f)),
    primary: (f: Feature) => {
      const all = list.filter((a) => usable(a, f));
      return all.find((a) => a.id === defaults[f]) ?? all[0];
    },
    pick: (f: Feature, ref?: unknown) => {
      const all = list.filter((a) => usable(a, f));
      if (ref === undefined || ref === null || ref === "") return all;
      const a = self.find(ref);
      if (a && all.includes(a)) return [a];
      throw new Error(`no ${f} account "${String(ref)}"`);
    },
  };
  return self as unknown as Accounts;
}
