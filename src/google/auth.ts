/**
 * The Google connection (N2): one personal account, shared by the REPL and the background tick.
 *
 * - google-token.bin: the refresh token, DPAPI-encrypted (never logged, never printed)
 * - google.json: non-secret state (email, granted scopes, when it was connected/checked/expired)
 * - access tokens live in memory only and are refreshed shortly before they expire
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appDataDir } from "../settings.js";
import { protect, unprotect } from "./dpapi.js";
import {
  authUrl,
  emailFromIdToken,
  exchangeCode,
  GoogleAuthError,
  listenForCode,
  loadClient,
  newState,
  pkcePair,
  refreshAccess,
  revoke,
  type Http,
  type OAuthClient,
} from "./oauth.js";

/** Always requested: lets /google show which account is connected. Features add theirs (N3 calendar, N4 Gmail). */
export const IDENTITY_SCOPES = ["openid", "email"];

export interface GoogleState {
  email?: string;
  scopes: string[];
  connectedAt: string;
  /** Last successful token refresh (the background tick checks a few times a day). */
  checkedAt?: string;
  /** Last background check attempt, successful or not (throttles retries while offline). */
  attemptedAt?: string;
  /** Set when Google rejected the refresh token (revoked, password change, or Testing-mode expiry). */
  invalidAt?: string;
  /** invalidAt value already announced by a background notification (once per expiry). */
  notifiedAt?: string;
}

export const tokenPath = () => join(appDataDir(), "google-token.bin");
const statePath = () => join(appDataDir(), "google.json");

export function readState(): GoogleState | null {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8")) as GoogleState;
  } catch {
    return null;
  }
}

function writeState(s: GoogleState) {
  mkdirSync(appDataDir(), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(s, null, 2) + "\n");
}

export function updateState(patch: Partial<GoogleState>): GoogleState | null {
  const s = readState();
  if (!s) return null;
  const next = { ...s, ...patch };
  writeState(next);
  return next;
}

/** "calendar.events" for "https://www.googleapis.com/auth/calendar.events". */
export const shortScope = (s: string) => s.replace("https://www.googleapis.com/auth/", "");

const EARLY_REFRESH_MS = 60_000;

export class GoogleAuth {
  private access?: { token: string; expiresAt: number };
  private client?: OAuthClient;

  constructor(private http: Http = fetch) {}

  /** null when never connected (or disconnected). */
  state(): GoogleState | null {
    return existsSync(tokenPath()) ? readState() : null;
  }

  private getClient(): OAuthClient {
    return (this.client ??= loadClient());
  }

  /**
   * Browser sign-in. Asks for `scopes` plus what was granted before, so reconnecting never drops
   * a permission. `open` launches the browser (and should print the URL in case it doesn't).
   */
  async connect(scopes: string[], open: (url: string) => void, o: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<GoogleState> {
    const client = this.getClient();
    const wanted = [...new Set([...IDENTITY_SCOPES, ...(this.state()?.scopes ?? []), ...scopes])];
    const state = newState();
    const { verifier, challenge } = pkcePair();
    const listener = await listenForCode(state, { timeoutMs: o.timeoutMs ?? 5 * 60_000, signal: o.signal });
    open(authUrl(client, { redirectUri: listener.redirectUri, scopes: wanted, state, challenge }));
    const code = await listener.code;
    const t = await exchangeCode(this.http, client, code, verifier, listener.redirectUri);
    if (!t.refresh_token) throw new GoogleAuthError("no_refresh_token", "Google didn't return a refresh token; try /connect google again");
    mkdirSync(appDataDir(), { recursive: true });
    writeFileSync(tokenPath(), await protect(t.refresh_token));
    this.access = { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
    const now = new Date().toISOString();
    const next: GoogleState = { email: emailFromIdToken(t.id_token), scopes: t.scope?.split(" ").filter(Boolean) ?? wanted, connectedAt: now, checkedAt: now };
    writeState(next);
    return next;
  }

  /** A valid access token, refreshing when needed. Throws GoogleAuthError("not_connected" | "invalid_grant" | …). */
  async accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt - EARLY_REFRESH_MS > Date.now()) return this.access.token;
    const s = this.state();
    if (!s) throw new GoogleAuthError("not_connected", "Google isn't connected; run /connect google");
    if (s.invalidAt) throw new GoogleAuthError("invalid_grant", "the Google connection expired; run /connect google");
    const refreshToken = await unprotect(readFileSync(tokenPath()));
    try {
      const t = await refreshAccess(this.http, this.getClient(), refreshToken);
      this.access = { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
      updateState({ checkedAt: new Date().toISOString() });
      return t.access_token;
    } catch (e) {
      if (e instanceof GoogleAuthError && e.code === "invalid_grant") {
        this.access = undefined;
        updateState({ invalidAt: new Date().toISOString() });
        throw new GoogleAuthError("invalid_grant", "the Google connection expired or was revoked; run /connect google");
      }
      throw e;
    }
  }

  /** Refreshes once to prove the connection works. Network problems throw; a dead grant returns "invalid". */
  async check(): Promise<"ok" | "invalid" | "none"> {
    if (!this.state()) return "none";
    this.access = undefined; // force a real refresh
    try {
      await this.accessToken();
      return "ok";
    } catch (e) {
      if (e instanceof GoogleAuthError && e.code === "invalid_grant") return "invalid";
      throw e;
    }
  }

  /** Revokes at Google (best effort) and deletes the local token and state. */
  async disconnect(): Promise<{ revoked: boolean }> {
    let revoked = false;
    if (existsSync(tokenPath())) {
      try {
        revoked = await revoke(this.http, await unprotect(readFileSync(tokenPath())));
      } catch {
        // offline or already revoked: still forget it locally
      }
    }
    rmSync(tokenPath(), { force: true });
    rmSync(statePath(), { force: true });
    this.access = undefined;
    return { revoked };
  }

  /** Authorized JSON request to a Google API (used from N3 on). Retries once after a 401. */
  async api<T>(url: string, init: RequestInit = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${await this.accessToken()}`);
      if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      const res = await this.http(url, { ...init, headers });
      if (res.status === 401 && attempt === 0) {
        this.access = undefined;
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        let msg = text;
        try {
          msg = JSON.parse(text).error?.message ?? text;
        } catch {
          // not JSON
        }
        throw new GoogleAuthError(`http_${res.status}`, `Google API ${res.status}: ${msg.slice(0, 300)}`);
      }
      return (text ? JSON.parse(text) : undefined) as T;
    }
  }
}

export { GoogleAuthError };
