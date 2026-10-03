/**
 * Background check of the Google connection, run from `edward tick`. A refresh every few hours
 * keeps the grant in use (Google drops refresh tokens unused for 6 months) and spots an expired
 * or revoked connection early: one notification per expiry, not one per minute.
 */
import type { Toast } from "../background/notify.js";
import type { GoogleAuth } from "./auth.js";

export const CHECK_EVERY_MS = 6 * 3_600_000;

export const EXPIRED_TOAST: Toast = {
  title: "Google connection expired",
  body: "Open Edward and run /connect google to reconnect.",
  tag: "google",
  kind: "info",
};

export type HealthResult = "none" | "skipped" | "ok" | "invalid" | "notified" | "error";

/** `who` names the account in the notification when several are connected (A1). */
export async function backgroundCheck(auth: GoogleAuth, notify: (t: Toast) => Promise<boolean>, now = new Date(), who?: { id: string; label: string }): Promise<HealthResult> {
  let s = auth.state();
  if (!s) return "none";
  if (!s.invalidAt) {
    const last = Math.max(Date.parse(s.checkedAt ?? "") || 0, Date.parse(s.attemptedAt ?? "") || 0);
    if (now.getTime() - last < CHECK_EVERY_MS) return "skipped";
    auth.update({ attemptedAt: now.toISOString() });
    let result: "ok" | "invalid" | "none";
    try {
      result = await auth.check();
    } catch {
      return "error"; // offline or Google unreachable: try again next window
    }
    if (result !== "invalid") return result;
    s = auth.state();
    if (!s) return "none";
  }
  if (s.invalidAt && s.notifiedAt !== s.invalidAt) {
    auth.update({ notifiedAt: s.invalidAt }); // mark first: a slow toast must not repeat next minute
    await notify(who ? { ...EXPIRED_TOAST, title: `Google connection expired: ${who.label}`, tag: `google-${who.id}` } : EXPIRED_TOAST);
    return "notified";
  }
  return "invalid";
}
