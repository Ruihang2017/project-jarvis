/**
 * One Google sign-in (N2), shared by the REPL, the app and the background tick. Each connected
 * account has its own folder (accounts/<id>/, see src/accounts/accounts.ts); before A1 the single
 * account lived in the data folder itself, which is still the default here.
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
  claimsFromIdToken,
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
  /** Google Workspace domain ("hd" claim); personal Gmail accounts have none. Such accounts are refused (D34). */
  hostedDomain?: string;
}

export const tokenPath = (dir = appDataDir()) => join(dir, "google-token.bin");
export const statePath = (dir = appDataDir()) => join(dir, "google.json");

export function readState(dir = appDataDir()): GoogleState | null {
  try {
    return JSON.parse(readFileSync(statePath(dir), "utf8")) as GoogleState;
  } catch {
    return null;
  }
}

function writeState(s: GoogleState, dir: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(dir),JSON.stringify(s, null, 2) + "\n");
}

export function updateState(patch: Partial<GoogleState>, dir = appDataDir()): GoogleState | null {
  const s = readState(dir);
  if (!s) return null;
  const next = { ...s, ...patch };
  writeState(next, dir);
  return next;
}

/** "calendar.events" for "https://www.googleapis.com/auth/calendar.events". */
export const shortScope = (s: string) => s.replace("https://www.googleapis.com/auth/", "");

const EARLY_REFRESH_MS = 60_000;

export class GoogleAuth {
  private access?: { token: string; expiresAt: number };
  private client?: OAuthClient;

  /** `dir` holds this account's token and state; the data folder itself for the pre-A1 single account. */
  constructor(
    private http: Http = fetch,
    readonly dir: string = appDataDir(),
  ) {}

  /** null when never connected (or disconnected). */
  state(): GoogleState | null {
    return existsSync(tokenPath(this.dir)) ? readState(this.dir) : null;
  }

  /** Records something about this sign-in (background checks, notifications). */
  update(patch: Partial<GoogleState>): GoogleState | null {
    return updateState(patch, this.dir);
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
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(tokenPath(this.dir), await protect(t.refresh_token));
    this.access = { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
    const now = new Date().toISOString();
    const claims = claimsFromIdToken(t.id_token);
    const next: GoogleState = { email: claims.email, hostedDomain: claims.hd, scopes: t.scope?.split(" ").filter(Boolean) ?? wanted, connectedAt: now, checkedAt: now };
    writeState(next, this.dir);
    return next;
  }

  /** A valid access token, refreshing when needed. Throws GoogleAuthError("not_connected" | "invalid_grant" | …). */
  async accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt - EARLY_REFRESH_MS > Date.now()) return this.access.token;
    const s = this.state();
    if (!s) throw new GoogleAuthError("not_connected", "Google isn't connected; run /connect google");
    if (s.invalidAt) throw new GoogleAuthError("invalid_grant", "the Google connection expired; run /connect google");
    const refreshToken = await unprotect(readFileSync(tokenPath(this.dir)));
    try {
      const t = await refreshAccess(this.http, this.getClient(), refreshToken);
      this.access = { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
      this.update({ checkedAt: new Date().toISOString() });
      return t.access_token;
    } catch (e) {
      if (e instanceof GoogleAuthError && e.code === "invalid_grant") {
        this.access = undefined;
        this.update({ invalidAt: new Date().toISOString() });
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
    if (existsSync(tokenPath(this.dir))) {
      try {
        revoked = await revoke(this.http, await unprotect(readFileSync(tokenPath(this.dir))));
      } catch {
        // offline or already revoked: still forget it locally
      }
    }
    rmSync(tokenPath(this.dir), { force: true });
    rmSync(statePath(this.dir), { force: true });
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
