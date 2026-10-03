import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "edward-google-test-"));
process.env.JARVIS_DATA_DIR = dir; // google-client.json, google.json and the token live here

const { authUrl, emailFromIdToken, loadClient, parseCallback, pkcePair, TOKEN_URL, REVOKE_URL, GoogleAuthError } = await import("../src/google/oauth.js");
const { GoogleAuth, readState, tokenPath, updateState } = await import("../src/google/auth.js");
const { protect, unprotect } = await import("../src/google/dpapi.js");
const { backgroundCheck, CHECK_EVERY_MS } = await import("../src/google/health.js");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const rejects = async (name: string, p: Promise<unknown>, code: string) => {
  try {
    await p;
    ok(name, false, "did not reject");
  } catch (e) {
    ok(name, e instanceof GoogleAuthError && e.code === code, `got ${e instanceof GoogleAuthError ? e.code : String(e)}`);
  }
};

// --- PKCE, URLs, callback parsing ---
eq("PKCE S256 matches RFC 7636 example", pkcePair("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk").challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
ok("PKCE verifier is 43+ url-safe chars", /^[A-Za-z0-9_-]{43,128}$/.test(pkcePair().verifier));
const client = { clientId: "cid.apps.googleusercontent.com", clientSecret: "csecret" };
const u = new URL(authUrl(client, { redirectUri: "http://127.0.0.1:5000", scopes: ["openid", "email"], state: "st", challenge: "ch" }));
eq("auth URL params", Object.fromEntries(["client_id", "redirect_uri", "response_type", "scope", "state", "code_challenge", "code_challenge_method", "access_type", "prompt", "include_granted_scopes"].map((k) => [k, u.searchParams.get(k)])), {
  client_id: client.clientId,
  redirect_uri: "http://127.0.0.1:5000",
  response_type: "code",
  scope: "openid email",
  state: "st",
  code_challenge: "ch",
  code_challenge_method: "S256",
  access_type: "offline",
  prompt: "consent",
  include_granted_scopes: "true",
});
eq("callback: code", parseCallback("/?state=st&code=abc", "st"), { code: "abc" });
ok("callback: state mismatch rejected", "error" in parseCallback("/?state=other&code=abc", "st"));
eq("callback: declined", parseCallback("/?state=st&error=access_denied", "st"), { error: "you declined access" });

const jwt = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
eq("email from id_token", emailFromIdToken(jwt({ email: "me@gmail.com" })), "me@gmail.com");
eq("bad id_token → undefined", emailFromIdToken("garbage"), undefined);

// --- client file ---
const clientFile = join(dir, "google-client.json");
try {
  loadClient(clientFile);
  ok("missing client file rejected", false);
} catch (e) {
  ok("missing client file rejected", e instanceof GoogleAuthError && e.message.includes("missing"), String(e));
}
writeFileSync(clientFile, JSON.stringify({ web: { client_id: "x" } }));
try {
  loadClient(clientFile);
  ok("web client rejected", false);
} catch (e) {
  ok("web client rejected", String(e).includes("Desktop app"), String(e));
}
writeFileSync(clientFile, JSON.stringify({ installed: { client_id: client.clientId, client_secret: client.clientSecret, redirect_uris: ["http://localhost"] } }));
eq("desktop client loaded", loadClient(clientFile), client);

// --- DPAPI ---
const secret = "1//refresh-token-秘密";
const blob = await protect(secret);
ok("DPAPI output is not plaintext", !blob.includes(Buffer.from("refresh-token")), blob.toString("utf8").slice(0, 40));
eq("DPAPI round-trip", await unprotect(blob), secret);

// --- mock Google token endpoint ---
type Call = { url: string; params: URLSearchParams; headers: Headers };
const calls: Call[] = [];
let tokenReply: () => Response = () => new Response("{}", { status: 500 });
let apiReplies: Response[] = [];
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const http = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, params: new URLSearchParams(String(init?.body ?? "")), headers: new Headers(init?.headers) });
  if (url === TOKEN_URL) return tokenReply();
  if (url === REVOKE_URL) return new Response("", { status: 200 });
  return apiReplies.shift() ?? json({ ok: true });
}) as typeof fetch;

// Plays the browser: follows Google's redirect back to the loopback server.
let browser: (redirect: string, state: string) => string = (redirect, state) => `${redirect}/?state=${state}&code=CODE1`;
let opened: URL | undefined;
const open = (url: string) => {
  opened = new URL(url);
  const target = browser(opened.searchParams.get("redirect_uri")!, opened.searchParams.get("state")!);
  void fetch(target).catch(() => {});
};

const EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
const auth = new GoogleAuth(http);
eq("not connected → state null", auth.state(), null);
await rejects("accessToken without a connection", auth.accessToken(), "not_connected");

tokenReply = () => json({ access_token: "AT1", expires_in: 3600, refresh_token: "RT1", scope: `openid ${EMAIL_SCOPE}`, id_token: jwt({ email: "me@gmail.com" }) });
const s1 = await auth.connect([], open, { timeoutMs: 10_000 });
const ex = calls.find((c) => c.url === TOKEN_URL)!;
eq("redirect is loopback 127.0.0.1", /^http:\/\/127\.0\.0\.1:\d+$/.test(opened!.searchParams.get("redirect_uri")!), true);
eq("code exchanged with grant + code", [ex.params.get("grant_type"), ex.params.get("code")], ["authorization_code", "CODE1"]);
eq("verifier matches the URL's challenge", pkcePair(ex.params.get("code_verifier")!).challenge, opened!.searchParams.get("code_challenge"));
eq("same redirect_uri in exchange", ex.params.get("redirect_uri"), opened!.searchParams.get("redirect_uri"));
eq("state: email + granted scopes", [s1.email, s1.scopes], ["me@gmail.com", ["openid", EMAIL_SCOPE]]);
const tokenFile = readFileSync(tokenPath());
ok("token file is encrypted", !tokenFile.includes(Buffer.from("RT1")));
ok("google.json holds no token", !readFileSync(join(dir, "google.json"), "utf8").includes("RT1"));

calls.length = 0;
eq("access token cached in memory", await auth.accessToken(), "AT1");
eq("no network for a cached token", calls.length, 0);

tokenReply = () => json({ access_token: "AT2", expires_in: 3600 });
eq("check refreshes → ok", await auth.check(), "ok");
eq("refresh uses the decrypted refresh token", [calls[0]?.params.get("grant_type"), calls[0]?.params.get("refresh_token")], ["refresh_token", "RT1"]);
eq("fresh access token used", await auth.accessToken(), "AT2");

// api(): bearer header, 401 → refresh once and retry, error messages
calls.length = 0;
tokenReply = () => json({ access_token: "AT3", expires_in: 3600 });
apiReplies = [new Response("", { status: 401 }), json({ items: [1] })];
eq("api retries after 401", await auth.api("https://www.googleapis.com/x"), { items: [1] });
eq("api sent bearer tokens (old, then refreshed)", calls.filter((c) => c.url.endsWith("/x")).map((c) => c.headers.get("authorization")), ["Bearer AT2", "Bearer AT3"]);
apiReplies = [json({ error: { message: "Not allowed" } }, 403)];
try {
  await auth.api("https://www.googleapis.com/x");
  ok("api error surfaces Google's message", false);
} catch (e) {
  ok("api error surfaces Google's message", String(e).includes("403: Not allowed"), String(e));
}

// --- background health check ---
const toasts: string[] = [];
const notify = async (t: { title: string }) => (toasts.push(t.title), true);
const now = new Date();
eq("background: skipped right after a check", await backgroundCheck(auth, notify, now), "skipped");
const later = new Date(now.getTime() + CHECK_EVERY_MS + 1000);
tokenReply = () => {
  throw new TypeError("fetch failed");
};
eq("background: network error → error", await backgroundCheck(auth, notify, later), "error");
eq("background: offline retry is throttled", await backgroundCheck(auth, notify, new Date(later.getTime() + 60_000)), "skipped");

const muchLater = new Date(later.getTime() + CHECK_EVERY_MS + 1000);
tokenReply = () => json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
eq("background: expired grant → notified", await backgroundCheck(auth, notify, muchLater), "notified");
eq("one notification", toasts, ["Google connection expired"]);
eq("background: no repeat notification", await backgroundCheck(auth, notify, new Date(muchLater.getTime() + 60_000)), "invalid");
eq("still one notification", toasts.length, 1);
ok("invalidAt recorded", Boolean(readState()?.invalidAt));
await rejects("accessToken after expiry", auth.accessToken(), "invalid_grant");

// Reconnect: asks for previous + new scopes, clears the expiry
browser = (redirect, state) => `${redirect}/?state=${state}&code=CODE2`;
tokenReply = () => json({ access_token: "AT4", expires_in: 3600, refresh_token: "RT2", scope: `openid ${EMAIL_SCOPE} https://www.googleapis.com/auth/calendar.readonly`, id_token: jwt({ email: "me@gmail.com" }) });
const s2 = await auth.connect(["https://www.googleapis.com/auth/calendar.readonly"], open, { timeoutMs: 10_000 });
eq("reconnect requests old + new scopes", opened!.searchParams.get("scope"), `openid email ${EMAIL_SCOPE} https://www.googleapis.com/auth/calendar.readonly`);
eq("reconnect clears invalidAt", s2.invalidAt, undefined);
eq("works again", await auth.accessToken(), "AT4");

// Browser outcomes: declined, cancelled
browser = (redirect, state) => `${redirect}/?state=${state}&error=access_denied`;
await rejects("declined in the browser", auth.connect([], open, { timeoutMs: 10_000 }), "denied");
browser = () => "http://127.0.0.1:1/"; // the browser never comes back
const ac = new AbortController();
setTimeout(() => ac.abort(), 200);
await rejects("Ctrl+C cancels the wait", auth.connect([], open, { timeoutMs: 10_000, signal: ac.signal }), "cancelled");
await rejects("timeout", auth.connect([], open, { timeoutMs: 300 }), "timeout");
ok("failed attempts keep the existing connection", readState()?.email === "me@gmail.com" && existsSync(tokenPath()));

// Disconnect
calls.length = 0;
eq("disconnect revokes", await auth.disconnect(), { revoked: true });
eq("revoked the refresh token", calls[0]?.params.get("token"), "RT2");
ok("local token and state deleted", !existsSync(tokenPath()) && !existsSync(join(dir, "google.json")));
eq("state null after disconnect", auth.state(), null);
eq("updateState without a connection is a no-op", updateState({ checkedAt: "x" }), null);

rmSync(dir, { recursive: true, force: true });

console.log(results.map(([n, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${n}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
