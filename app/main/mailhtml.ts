/** The email view's HTML handling, without Electron (so it can be unit-tested). See mailview.ts. */

const REMOTE = /<img\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\/|\bbackground\s*=\s*["']?\s*https?:|<link\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\//i;

/** Whether the email loads anything from the web (pictures, fonts, styles). */
export const hasRemoteContent = (html: string) => REMOTE.test(html);

/**
 * Defence in depth; the sandbox and the page's CSP are what keep it safe. Drops scripts, frames,
 * plugins, refresh/base tags; makes links open outside; swaps cid: pictures for the bytes given.
 */
export function prepareMail(html: string, inline: Map<string, string>): string {
  const body = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<(script|iframe|frame|frameset|object|embed|applet|base|portal)\b[^>]*>/gi, "")
    .replace(/<\/(iframe|frame|frameset|object|embed|applet|portal)\s*>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, "")
    .replace(/<a\b/gi, '<a target="_blank" rel="noopener noreferrer"')
    .replace(/cid:([^"'\s)>]+)/gi, (m, id: string) => inline.get(id.toLowerCase()) ?? m);
  // Emails are designed for a white page.
  return `<!doctype html><meta charset="utf-8"><style>html{background:#fff;color:#1a1a1a}body{margin:16px;font-family:Arial,Helvetica,sans-serif}</style>${body}`;
}

/** The frame's own rules (sent as a header): no scripts, forms or frames; web content only when `remote`. */
export function mailCsp(remote: boolean): string {
  const web = remote ? " https: http:" : "";
  return [
    "default-src 'none'",
    "script-src 'none'",
    `style-src 'unsafe-inline'${web}`,
    `img-src data:${web}`,
    `font-src data:${web}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join("; ");
}
