/**
 * An email as it was designed: its own HTML in a sandboxed frame on edward-mail://. The frame has no
 * scripts, forms or plugins, can't navigate, and its links open in the browser. Pictures from the web
 * are blocked (they tell the sender the email was opened) until the user asks for them; pictures inside
 * the email (cid:) are shown. Only pages the main process registered are served.
 */
import { protocol, type CustomScheme } from "electron";
import { randomUUID } from "node:crypto";
import { mailCsp } from "./mailhtml.js";

export { hasRemoteContent, prepareMail } from "./mailhtml.js";

export const MAIL_SCHEME = "edward-mail";
export const MAIL_PRIVILEGES: CustomScheme = { scheme: MAIL_SCHEME, privileges: { standard: true, secure: true } };

const pages = new Map<string, { html: string; remote: boolean }>();
const KEEP = 20;

/** Registers a page and returns its address; `remote` lets it load pictures and styles from the web. */
export function showMail(html: string, remote: boolean): string {
  const id = randomUUID();
  pages.set(id, { html, remote });
  while (pages.size > KEEP) pages.delete(pages.keys().next().value!);
  return `${MAIL_SCHEME}://page/${id}`;
}

/** After app ready. */
export function handleMailScheme() {
  protocol.handle(MAIL_SCHEME, (req) => {
    const url = new URL(req.url);
    const page = url.host === "page" ? pages.get(url.pathname.replace(/^\//, "")) : undefined;
    if (!page) return new Response("not found", { status: 404 });
    return new Response(page.html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": mailCsp(page.remote),
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
