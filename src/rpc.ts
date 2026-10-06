import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import type { ClientRequest, ServerNotification, ServerRequest, RequestId } from "./protocol/index.js";
import { envVar } from "./settings.js";

type Method = ClientRequest["method"];
type ParamsOf<M extends Method> = Extract<ClientRequest, { method: M }>["params"];

export type NotificationHandler = (n: ServerNotification) => void;

/** Rewrites what Edward sends to Codex (the privacy guard, S1). */
export interface OutgoingFilter {
  request(method: string, params: unknown): unknown;
  /** Client→server notifications go through the guard as well. */
  notify(method: string, params: unknown): unknown;
  /** Result of a server→client request (tool call, question, approval) before it is sent back. */
  reply(requestMethod: string, result: unknown): unknown;
  error(requestMethod: string, message: string): string;
}
export type ServerRequestHandler = (r: ServerRequest) => Promise<unknown>;

interface Pending {
  method: string;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class RpcError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    // Upstream failures can embed whole HTML pages (e.g. a Cloudflare challenge); keep messages readable.
    const short = message.length > 300 ? `${message.slice(0, 300)}… [truncated]` : message;
    super(`${method}: ${short} (${code})`);
  }
}

/** JSON-RPC client for `codex app-server` over stdio (one JSON message per line). */
export class CodexClient extends EventEmitter<{
  notification: [ServerNotification];
  exit: [number | null];
  serverRequestCancelled: [RequestId];
}> {
  private proc: ChildProcessWithoutNullStreams;
  private startError?: Error;
  private nextId = 1;
  private pending = new Map<RequestId, Pending>();
  /** Server→client requests we haven't answered yet. */
  private inflight = new Set<RequestId>();
  private serverRequestHandler: ServerRequestHandler = async () => {
    throw new Error("no handler");
  };

  constructor(
    bin: string,
    args: string[] = [],
    env: NodeJS.ProcessEnv = process.env,
    private readonly filter?: OutgoingFilter,
  ) {
    super();
    this.proc = spawn(bin, ["app-server", ...args], { stdio: ["pipe", "pipe", "pipe"], env });
    createInterface({ input: this.proc.stdout }).on("line", (line) => this.onLine(line));
    // app-server logs to stderr; surface it only when debugging.
    this.proc.stderr.on("data", (d) => {
      if (envVar("DEBUG")) process.stderr.write(d);
    });
    // Codex couldn't be started at all (not installed, or not where Edward looks): every request
    // fails with that reason ("spawn codex ENOENT") instead of the whole program stopping.
    this.proc.on("error", (e) => {
      this.startError = e;
      for (const p of this.pending.values()) p.reject(e);
      this.pending.clear();
      this.emit("exit", null);
    });
    this.proc.stdin.on("error", () => {}); // a write after it has gone
    this.proc.on("exit", (code) => {
      for (const p of this.pending.values()) p.reject(new Error(`codex app-server exited (${code}) during ${p.method}`));
      this.pending.clear();
      this.emit("exit", code);
    });
  }

  onServerRequest(handler: ServerRequestHandler) {
    this.serverRequestHandler = handler;
  }

  request<R = unknown, M extends Method = Method>(method: M, params: ParamsOf<M>): Promise<R> {
    if (this.startError) return Promise.reject(this.startError);
    const id = this.nextId++;
    return new Promise<R>((resolve, reject) => {
      this.pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject });
      this.send({ id, method, params: this.filter ? this.filter.request(method, params) : params });
    });
  }

  notify(method: string, params?: unknown) {
    this.send(params === undefined ? { method } : { method, params: this.filter ? this.filter.notify(method, params) : params });
  }

  close() {
    this.proc.stdin.end();
    this.proc.kill();
  }

  private send(msg: object) {
    if (envVar("DEBUG")) process.stderr.write(`>> ${JSON.stringify(msg)}\n`);
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  private onLine(line: string) {
    if (!line.trim()) return;
    if (envVar("DEBUG")) process.stderr.write(`<< ${line}\n`);
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    const hasId = msg.id !== undefined && msg.id !== null;
    if (hasId && msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new RpcError(p.method, msg.error.code, msg.error.message, msg.error.data));
      else p.resolve(msg.result);
    } else if (hasId) {
      this.inflight.add(msg.id);
      const settle = (reply: object) => {
        // Skip replies to requests the server already gave up on.
        if (this.inflight.delete(msg.id)) this.send({ id: msg.id, ...reply });
      };
      const method = String(msg.method);
      this.serverRequestHandler(msg as ServerRequest).then(
        (result) => settle({ result: this.filter ? this.filter.reply(method, result) : result }),
        (err: Error) => settle({ error: { code: -32603, message: this.filter ? this.filter.error(method, err.message) : err.message } }),
      );
    } else if (msg.method) {
      // The server resolves a request itself when it stops waiting (e.g. a cancelled tool call).
      if (msg.method === "serverRequest/resolved" && this.inflight.delete(msg.params?.requestId)) {
        this.emit("serverRequestCancelled", msg.params.requestId);
      }
      this.emit("notification", msg as ServerNotification);
    }
  }
}
