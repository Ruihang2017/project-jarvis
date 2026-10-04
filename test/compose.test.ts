// Emails written in the app (src/google/compose.ts, F1b): reply, reply all, forward.
import type { Message } from "../src/google/gmail.js";
const { startFrom, forwardSubject, quoted } = await import("../src/google/compose.js");

const results: [string, boolean, string?][] = [];
const ok = (name: string, cond: boolean, info = "") => results.push([name, cond, info]);
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const now = new Date(2026, 9, 4, 12, 0);
const m = {
  id: "m1",
  threadId: "t1",
  from: "Sam Taylor <sam@example.com>",
  to: "me@gmail.com, Kim <kim@example.com>",
  cc: "Lee <lee@example.com>",
  subject: "Weekly update",
  date: new Date(2026, 9, 4, 9, 30),
  snippet: "",
  unread: true,
  body: "Hi,\n\nThe roof is done.\nSam",
  attachments: [],
  inline: [],
  messageId: "<abc@example.com>",
  references: "<old@example.com>",
} as Message;

const r = startFrom(m, "reply", "me@gmail.com");
eq("reply: to the sender only", [r.to, r.cc], [["Sam Taylor <sam@example.com>"], []]);
eq("reply: Re: subject, threaded", [r.subject, r.threadId, r.inReplyTo, r.references], ["Re: Weekly update", "t1", "<abc@example.com>", "<old@example.com> <abc@example.com>"]);
ok("reply: room to write, then the quoted original", r.body.startsWith("\n\nOn ") && r.body.includes("Sam Taylor wrote:\n> Hi,\n>\n> The roof is done.\n> Sam"), r.body);

const all = startFrom(m, "replyAll", "me@gmail.com");
ok("reply all: the others too, never yourself", all.to.includes("Sam Taylor <sam@example.com>") && [...all.to, ...all.cc].some((x) => x.includes("kim@example.com")) && [...all.to, ...all.cc].some((x) => x.includes("lee@example.com")) && ![...all.to, ...all.cc].some((x) => x.includes("me@gmail.com")), JSON.stringify(all));

const f = startFrom(m, "forward", "me@gmail.com");
eq("forward: nobody yet, not threaded", [f.to, f.cc, f.threadId, f.inReplyTo], [[], [], undefined, undefined]);
eq("forward: Fwd: subject", f.subject, "Fwd: Weekly update");
ok("forward: the original's headers and text", f.body.includes("---------- Forwarded message ---------\nFrom: Sam Taylor <sam@example.com>") && f.body.includes("Subject: Weekly update") && f.body.includes("Cc: Lee <lee@example.com>") && f.body.endsWith("The roof is done.\nSam"), f.body);
eq("Fwd: not doubled", [forwardSubject("Fwd: x"), forwardSubject("FW: x"), forwardSubject("x")], ["Fwd: x", "FW: x", "Fwd: x"]);
eq("Re: not doubled", startFrom({ ...m, subject: "Re: Weekly update" } as Message, "reply", "me@gmail.com").subject, "Re: Weekly update");
const mine = { ...m, from: "Me <me@gmail.com>", to: "Sam Taylor <sam@example.com>", cc: "" } as Message;
eq("replying to your own email goes to whom it went to", startFrom(mine, "reply", "me@gmail.com").to, ["Sam Taylor <sam@example.com>"]);
const self = { ...m, from: "Me <me@gmail.com>", to: "me@gmail.com", cc: "" } as Message;
eq("…an email to yourself goes back to you", startFrom(self, "reply", "me@gmail.com").to, ["me@gmail.com"]);
ok("the quote carries a full date", /On \w+,? 4 Oct 2026,? 09:30, Sam Taylor wrote:/.test(r.body), r.body.slice(0, 60));
ok("a very long original is cut", quoted({ ...m, body: "x".repeat(10_000) } as Message).includes("[…]"));

console.log(results.map(([n, pass, info]) => `${pass ? "PASS" : "FAIL"}  ${n}${pass ? "" : "  → " + info}`).join("\n"));
if (results.some(([, pass]) => !pass)) process.exitCode = 1;
