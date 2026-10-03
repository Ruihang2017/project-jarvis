/**
 * Pictures in the window: generated images and attachments are local files, which a sandboxed page
 * can't load. They are served through edward-img://, and only files the main process has listed
 * (Edward's own pictures and what the user attached) — never an arbitrary path the page asks for.
 */
import { net, protocol, type CustomScheme } from "electron";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SCHEME = "edward-img";
const allowed = new Set<string>();
const key = (p: string) => resolve(p).toLowerCase();

export function allowImage(path: string) {
  allowed.add(key(path));
}

export const imageUrl = (path: string) => `${SCHEME}://file/${encodeURIComponent(resolve(path))}`;

/**
 * Before app ready: the scheme is privileged enough to be an <img> source, nothing more. Electron
 * takes one list for all custom schemes, so others (the mail view) are passed in.
 */
export function registerScheme(others: CustomScheme[] = []) {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false } }, ...others]);
}

/** After app ready. */
export function handleScheme() {
  protocol.handle(SCHEME, (req) => {
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (url.host !== "file" || !allowed.has(key(path)) || !/\.(png|jpe?g|gif|webp)$/i.test(path)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(path).href);
  });
}
