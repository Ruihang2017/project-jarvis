// The desktop app's "as sent" email view (app/main/mailhtml.ts): what the frame gets and may load.
import { hasRemoteContent, mailCsp, prepareMail } from "../app/main/mailhtml.js";

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);

const email = [
  `<html><head><meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/">`,
  `<script>alert(1)</script><script src="https://evil.example/x.js"></script></head><body>`,
  `<a href="https://shop.example/sale" target="_self">Sale</a> <abbr title="x">AU</abbr>`,
  `<img src="cid:Logo@01"><img src="https://track.example/open.gif">`,
  `<iframe src="https://evil.example"></iframe><object data="x"></object><embed src="y">`,
  `<form action="https://evil.example"><input name="q"></form></body></html>`,
].join("");
const out = prepareMail(email, new Map([["logo@01", "data:image/png;base64,AAAA"]]));

ok("scripts removed", !/<script/i.test(out) && !out.includes("alert(1)"));
ok("refresh and base removed", !/http-equiv\s*=\s*["']?refresh/i.test(out) && !/<base/i.test(out));
ok("frames and plugins removed", !/<(iframe|object|embed)\b/i.test(out));
ok("links open outside (our target comes first)", out.includes('<a target="_blank" rel="noopener noreferrer" href="https://shop.example/sale" target="_self">'));
ok("other tags starting with a untouched", out.includes('<abbr title="x">'));
ok("cid picture replaced by its bytes (case-insensitive)", out.includes('<img src="data:image/png;base64,AAAA">'));
ok("unknown cid left alone", prepareMail('<img src="cid:other">', new Map()).includes("cid:other"));
ok("white page", out.startsWith("<!doctype html>") && out.includes("background:#fff"));

ok("remote picture noticed", hasRemoteContent(out));
ok("remote background noticed", hasRemoteContent(`<td style="background:url('https://x.example/bg.png')">`));
ok("remote stylesheet noticed", hasRemoteContent(`<link rel="stylesheet" href="https://fonts.example/a.css">`));
ok("protocol-relative picture noticed", hasRemoteContent(`<img src="//cdn.example/a.png">`));
ok("data: pictures aren't remote", !hasRemoteContent(`<img src="data:image/png;base64,AAAA"> <a href="https://x.example">x</a>`));

const closed = mailCsp(false);
const open = mailCsp(true);
ok("no scripts, ever", closed.includes("script-src 'none'") && open.includes("script-src 'none'") && !open.includes("unsafe-eval"));
ok("no forms or frames", closed.includes("form-action 'none'") && closed.includes("frame-src 'none'") && open.includes("form-action 'none'"));
ok("blocked: nothing from the web", !/https?:/.test(closed));
ok("shown: pictures, styles and fonts from the web", /img-src data: https: http:/.test(open) && /style-src 'unsafe-inline' https: http:/.test(open) && /font-src data: https: http:/.test(open));
ok("never connect, media or objects", !/connect-src|media-src|object-src [^']/.test(open) && open.startsWith("default-src 'none'"));

let failed = 0;
for (const [name, pass, info] of results) {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !info ? "" : `  (${info})`}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
