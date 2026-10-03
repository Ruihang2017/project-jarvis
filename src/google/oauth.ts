/**
 * Google OAuth for an installed (desktop) app: loopback redirect + PKCE, no third-party server.
 * https://developers.google.com/identity/protocols/oauth2/native-app
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { runtime } from "../runtime.js";
import { appDataDir } from "../settings.js";

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export type Http = typeof fetch;

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

/** Google errors worth telling apart; `invalid_grant` means the sign-in expired or was revoked. */
export class GoogleAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const clientPath = () => join(appDataDir(), "google-client.json");

/** A client to sign in with: the user's own file, or the one built into the app. */
export const hasClient = () => existsSync(clientPath()) || Boolean(runtime.googleClient);

/**
 * The desktop client: the file downloaded from Google Cloud (docs/guides/google-cloud-setup.md) when
 * there is one, otherwise the one built into the app (D37; not in the repository).
 */
export function loadClient(path = clientPath()): OAuthClient {
  let json: { installed?: { client_id?: string; client_secret?: string }; web?: unknown };
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === "ENOENT";
    if (missing && path === clientPath() && runtime.googleClient) return runtime.googleClient;
    throw new GoogleAuthError("no_client", missing ? `missing ${path} — create a Desktop app client in Google Cloud and save its JSON there` : `can't read ${path}: ${(e as Error).message}`);
  }
  if (json.web) throw new GoogleAuthError("no_client", `${path} is a "Web application" client; Edward needs a "Desktop app" client`);
  const c = json.installed;
  if (!c?.client_id || !c.client_secret) throw new GoogleAuthError("no_client", `${path} has no client_id/client_secret`);
  return { clientId: c.client_id, clientSecret: c.client_secret };
}

const base64url = (b: Buffer) => b.toString("base64url");

/** PKCE (RFC 7636, S256). */
export function pkcePair(verifier = base64url(randomBytes(32))) {
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) };
}

export const newState = () => base64url(randomBytes(16));

export function authUrl(client: OAuthClient, o: { redirectUri: string; scopes: string[]; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: o.scopes.join(" "),
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: "S256",
    access_type: "offline", // we want a refresh token
    prompt: "consent", // …every time, even on reconnect
    include_granted_scopes: "true", // adding a scope keeps the ones already granted
  });
  return `${AUTH_URL}?${q}`;
}

/** Parses the browser's redirect to the loopback server. */
export function parseCallback(url: string, state: string): { code: string } | { error: string } {
  const q = new URL(url, "http://127.0.0.1").searchParams;
  if (q.get("state") !== state) return { error: "state mismatch (stale or forged sign-in link)" };
  const error = q.get("error");
  if (error) return { error: error === "access_denied" ? "you declined access" : error };
  const code = q.get("code");
  return code ? { code } : { error: "no authorization code in the redirect" };
}

const PAGE = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>Edward</title>` +
  `<body style="font:16px system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px">` +
  `<h1 style="font-size:1.4rem">${title}</h1><p>${text}</p></body>`;

/**
 * Listens on 127.0.0.1 (random port) for Google's redirect. Resolves with the authorization code;
 * rejects on error, timeout or abort. Other paths (favicon) get a 404 and are ignored.
 */
export async function listenForCode(state: string, o: { timeoutMs: number; signal?: AbortSignal }) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  const code = new Promise<string>((resolve, reject) => {
    const done = (err?: Error, value?: string) => {
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", onAbort);
      server.close();
      server.closeAllConnections();
      if (err) reject(err);
      else resolve(value!);
    };
    const timer = setTimeout(() => done(new GoogleAuthError("timeout", `no answer from the browser within ${Math.round(o.timeoutMs / 60000)} min`)), o.timeoutMs);
    const onAbort = () => done(new GoogleAuthError("cancelled", "cancelled"));
    o.signal?.addEventListener("abort", onAbort);
    server.on("request", (req, res) => {
      const url = req.url ?? "/";
      if (new URL(url, "http://127.0.0.1").pathname !== "/") {
        res.writeHead(404).end();
        return;
      }
      const r = parseCallback(url, state);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", connection: "close" });
      if ("code" in r) {
        res.end(PAGE("Edward is connected to Google", "You can close this tab and go back to the terminal."));
        done(undefined, r.code);
      } else {
        res.end(PAGE("Edward couldn't connect", `${r.error.replace(/[<>&]/g, "")}. Go back to the terminal and try <code>/connect google</code> again.`));
        done(new GoogleAuthError("denied", r.error));
      }
    });
  });
  return { redirectUri: `http://127.0.0.1:${port}`, code };
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

async function tokenRequest(http: Http, params: Record<string, string>): Promise<TokenResponse> {
  const res = await http(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    const code = body.error ?? `http_${res.status}`;
    throw new GoogleAuthError(code, `Google token request failed: ${code}${body.error_description ? ` (${body.error_description})` : ""}`);
  }
  return body as TokenResponse;
}

export const exchangeCode = (http: Http, client: OAuthClient, code: string, verifier: string, redirectUri: string) =>
  tokenRequest(http, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });

export const refreshAccess = (http: Http, client: OAuthClient, refreshToken: string) =>
  tokenRequest(http, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });

/** Revokes the grant at Google (refresh token revokes all access for this app). */
export async function revoke(http: Http, token: string): Promise<boolean> {
  const res = await http(REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  return res.ok;
}

/**
 * The id_token comes straight from Google's token endpoint over TLS, so reading it unverified is fine.
 * `hd` is the Google Workspace domain; personal accounts have none.
 */
export function claimsFromIdToken(idToken: string | undefined): { email?: string; hd?: string } {
  try {
    const payload = JSON.parse(Buffer.from(idToken!.split(".")[1]!, "base64url").toString("utf8"));
    return { email: typeof payload.email === "string" ? payload.email : undefined, hd: typeof payload.hd === "string" && payload.hd ? payload.hd : undefined };
  } catch {
    return {};
  }
}

export const emailFromIdToken = (idToken: string | undefined) => claimsFromIdToken(idToken).email;
