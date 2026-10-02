// Rows 3 and 4: privacy, and first-run setup.
import { C, F, SHADOW, SHADOW_LG, asset, btn, card, h2, ic, label, muted, shell, spot, tag, toggle } from "./lib.mjs";

const frame = (inner, extra = "") =>
  `<div class="wash" style="position: relative; width: 100%; height: 860px; box-sizing: border-box; overflow: hidden; background-color: ${C.bg}; color: ${C.ink}; font-family: ${F.body}; font-size: 14px; line-height: 1.5; ${extra}">${inner}</div>`;
const li = (icon, text, color = C.sageInk) => `<div style="display: flex; gap: 10px; align-items: flex-start">${ic(icon, 17, color, 2)}<span>${text}</span></div>`;

// ---------------------------------------------------------------- Privacy
const pillar = (icon, title, sub, items, itemIcon) =>
  card(
    `<div style="display: flex; align-items: center; gap: 12px"><span style="display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 12px; background: ${C.sageSoft}; color: ${C.sageInk}">${ic(icon, 20)}</span>${h2(title)}</div>
${muted(sub, "text-wrap: pretty")}
<div style="display: flex; flex-direction: column; gap: 8px; font-size: 14px">${items.map((t) => li(itemIcon, t)).join("")}</div>`,
    "padding: 20px; display: flex; flex-direction: column; gap: 12px",
  );

const privacy = shell({
  active: "Privacy",
  title: "Privacy",
  sub: "What Jarvis will not do, enforced by code before anything reaches the AI",
  actions: `<a href="Modes.dc.html" style="display: inline-flex; align-items: center; min-height: 44px; padding: 0 8px; font-weight: 600">Permission modes</a>`,
  bodyStyle: "display: flex; flex-direction: column; gap: 16px",
  body: `
${card(
  `${spot("spot-privacy", 150, "A small wooden box with a brass padlock and a key")}
<div style="display: flex; flex-direction: column; gap: 8px; max-width: 640px">
<div style="font-family: ${F.disp}; font-size: 30px; font-weight: 600; line-height: 1.12; letter-spacing: -0.02em; text-wrap: balance">Your account, card and ID numbers never leave this computer.</div>
<div style="font-size: 15px; color: ${C.ink2}; text-wrap: pretty">They are taken out before a single word goes to the AI, and Jarvis keeps no copy, not even the last four digits. This is a filter in the program, not a request to the model to behave.</div>
</div>
<div style="margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 8px">${tag("Guard is on", "sage", "shield")}${muted("Checked at start-up with a test number")}</div>`,
  "padding: 20px 28px; display: flex; align-items: center; gap: 24px; flex-shrink: 0",
)}
<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; flex-grow: 1; min-height: 0">
${pillar("lock", "Never sent to the AI", "Removed from what you type, from emails and calendar entries, and from every answer a tool gives.", ["Card numbers", "Bank account and BSB numbers", "Bill and customer reference numbers", "Tax file, Medicare, passport and licence numbers", "Passwords, PINs and sign-in keys"], "x")}
${pillar("box", "Never stored", "Memory, reminders and bills refuse anything that looks like one of these, whole or in part.", ["No field anywhere for an account or card", "Nothing in the logs", "Google sign-in is kept encrypted by Windows", "Everything else stays in one folder you can open, export or delete"], "check")}
${pillar("shield", "Never done", "Jarvis is a butler that reminds. It has no tools for these, so no instruction can make it.", ["Paying a bill", "Signing in to a bank", "Following instructions written inside an email", "Sending an email without showing it to you first", "Inviting people to calendar events"], "x")}
</div>
${card(
  `<div style="display: flex; align-items: center; gap: 10px; color: ${C.apricotInk}">${ic("warn", 18, "currentColor", 2)}${h2("Where the guard stops", `font-size: 16px; color: ${C.apricotInk}`)}</div>
<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; font-size: 13.5px; color: ${C.ink2}">
<div><strong style="color: ${C.ink}">Bare numbers.</strong> A number with no word near it saying what it is can slip through.</div>
<div><strong style="color: ${C.ink}">Pictures aren&#39;t checked.</strong> A photo of a card is sent as it is. Don&#39;t attach one.</div>
<div><strong style="color: ${C.ink}">Other modes.</strong> In Manual, Semi-auto and Auto, Codex can read files itself, past the guard.</div>
<div style="display: flex; align-items: center; gap: 12px"><div><strong style="color: ${C.ink}">Web search.</strong> Off closes a way for email text to leak in a search.</div>${toggle(true, "Web search")}</div>
</div>`,
  `padding: 18px 22px; display: flex; flex-direction: column; gap: 10px; flex-shrink: 0; background: #FFFBF7; border-color: #F3D9C2`,
)}`,
});

// ---------------------------------------------------------------- Guard in action
const strike = (t) => `<span style="padding: 0 4px; border-radius: 4px; background: ${C.roseSoft}; color: ${C.roseInk}; text-decoration: line-through; font-family: ${F.mono}; font-size: 13px">${t}</span>`;
const gone = (t) => `<span style="display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; border-radius: 6px; background: ${C.sageSoft}; color: ${C.sageInk}; font-size: 12.5px; font-weight: 600">${ic("lock", 12, "currentColor", 2)}${t} removed</span>`;
const example = (icon, where, before, after, outcome, tone = "sage") =>
  card(
    `<div style="display: flex; align-items: center; gap: 10px"><span style="display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 11px; background: ${C.blueSoft}; color: ${C.blueInk}">${ic(icon, 18)}</span>${h2(where, "font-size: 17px")}</div>
<div style="display: flex; flex-direction: column; gap: 6px">${label("On your screen")}<div style="padding: 14px; border-radius: 12px; background: ${C.bg}; font-size: 14.5px; min-height: 92px; box-sizing: border-box; text-wrap: pretty">${before}</div></div>
<div style="display: flex; justify-content: center; color: ${C.ink3}">${ic("chevron", 22)}</div>
<div style="display: flex; flex-direction: column; gap: 6px">${label(tone === "sage" ? "What the AI receives" : "What is kept")}<div style="padding: 14px; border: 1px dashed #A9C9B4; border-radius: 12px; font-size: 14.5px; min-height: 92px; box-sizing: border-box; text-wrap: pretty">${after}</div></div>
<div style="margin-top: auto; display: flex; gap: 10px; padding: 12px 14px; border-radius: 12px; background: ${tone === "sage" ? C.sageSoft : C.apricotSoft}; color: ${tone === "sage" ? C.sageInk : C.apricotInk}; font-size: 13px; font-weight: 500">${ic(tone === "sage" ? "shield" : "warn", 16, "currentColor", 2)}<span>${outcome}</span></div>`,
    "padding: 20px; display: flex; flex-direction: column; gap: 12px",
  );

const guard = shell({
  active: "Privacy",
  title: "The guard at work",
  sub: "Three places it steps in, and what you see when it does",
  bodyStyle: "display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px",
  body: `
${example("chat", "Something you type", `Is this fee normal? My card is ${strike("4111 1111 1111 1111")} and the password I use there is ${strike("hunter2")}`, `Is this fee normal? My card is ${gone("card number")} and the password I use there is ${gone("password")}`, "Shown under your message: 2 things were removed before it left this computer.")}
${example("mail", "An email Jarvis reads", `Please pay to BSB ${strike("062-000")} account ${strike("1234 5678")} and quote reference ${strike("88 0042 7719")}.`, `Please pay to BSB and account ${gone("bank account")} and quote reference ${gone("reference number")}.`, "The email in Gmail is untouched. Only the copy sent to the AI is changed.")}
${example("book", "Something you ask it to keep", `Remember that my Medicare number is ${strike("2123 45670 1")}`, `<span style="color: ${C.ink2}">Nothing. Jarvis answers: &ldquo;I don&#39;t keep ID numbers, not even part of one. I can remind you where you keep the card instead.&rdquo;</span>`, "Memory, reminders and bills all refuse. There is nowhere for it to be saved.", "apricot")}`,
});

// ---------------------------------------------------------------- Setup: welcome
const stepLine = (n, text, sub) =>
  `<div style="display: flex; gap: 14px; align-items: flex-start"><span style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex-shrink: 0; border-radius: 50%; background: ${C.blueSoft}; color: ${C.blueInk}; font-weight: 700; font-size: 13px">${n}</span><div><div style="font-weight: 600">${text}</div><div style="font-size: 13px; color: ${C.ink2}">${sub}</div></div></div>`;

const welcome = frame(`
<img src="${asset("hero-welcome")}" alt="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: right center">
<div style="position: absolute; inset: 0; background: linear-gradient(90deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.78) 36%, rgba(255,255,255,0) 60%)"></div>
<div style="position: relative; height: 100%; box-sizing: border-box; width: 46%; min-width: 520px; padding: 56px 0 56px 72px; display: flex; flex-direction: column; gap: 22px; justify-content: center">
<div style="display: flex; align-items: center; gap: 12px"><img src="${asset("icon")}" alt="" style="width: 44px; height: 44px; border-radius: 13px"><div style="font-family: ${F.disp}; font-size: 24px; font-weight: 700; letter-spacing: -0.02em">Jarvis</div></div>
<div style="font-family: ${F.disp}; font-size: 54px; font-weight: 600; line-height: 1.02; letter-spacing: -0.03em; text-wrap: balance">Someone to keep an eye on things.</div>
<div style="font-size: 17px; color: ${C.ink2}; max-width: 440px; text-wrap: pretty">Jarvis watches your calendar, mail and bills, reminds you in time, and asks before it does anything on your behalf.</div>
<div style="display: flex; flex-direction: column; gap: 14px; padding: 6px 0">
${stepLine(1, "Sign in with ChatGPT", "Jarvis runs on your own ChatGPT plan through Codex")}
${stepLine(2, "Turn on reminders", "So they arrive even when Jarvis is closed")}
${stepLine(3, "Connect Google, if you like", "Calendar and Gmail, through your own Google Cloud project")}
</div>
<div style="display: flex; align-items: center; gap: 16px">${btn("Get started", "primary", "right", "min-height: 52px; padding: 0 26px; font-size: 16px")}${muted("About ten minutes")}</div>
</div>`);

// ---------------------------------------------------------------- Setup: steps (Google)
const sStep = (state, n, text, sub) => {
  const done = state === "done";
  const now = state === "now";
  return `<div style="display: flex; gap: 12px; align-items: flex-start; padding: 10px 12px; border-radius: 14px; background: ${now ? C.blueSoft : "transparent"}"><span style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex-shrink: 0; border-radius: 50%; background: ${done ? C.sageSoft : now ? C.blue : C.soft}; color: ${done ? C.sageInk : now ? "#FFFFFF" : C.ink3}; font-weight: 700; font-size: 13px">${done ? ic("check", 15, "currentColor", 2.4) : n}</span><div><div style="font-weight: 600; color: ${state === "todo" ? C.ink2 : C.ink}">${text}</div><div style="font-size: 12.5px; color: ${C.ink2}">${sub}</div></div></div>`;
};
const sub = (n, title, body) =>
  `<div style="display: flex; gap: 16px"><div style="font-family: ${F.disp}; font-size: 22px; font-weight: 600; color: ${C.blue}; width: 22px">${n}</div><div style="flex-grow: 1; display: flex; flex-direction: column; gap: 8px"><div style="font-weight: 600; font-size: 15px">${title}</div>${body}</div></div>`;

const setupGoogle = frame(`
<div style="display: flex; height: 100%">
<aside aria-label="Setup steps" style="width: 340px; flex-shrink: 0; box-sizing: border-box; padding: 32px 22px; display: flex; flex-direction: column; gap: 6px; border-right: 1px solid ${C.line}; background: rgba(255,255,255,0.8)">
<div style="display: flex; align-items: center; gap: 10px; padding: 0 12px 18px"><img src="${asset("icon")}" alt="" style="width: 34px; height: 34px; border-radius: 10px"><div style="font-family: ${F.disp}; font-size: 20px; font-weight: 700">Setting up Jarvis</div></div>
${sStep("done", 1, "This computer", "Node 24 and Codex 0.159 found")}
${sStep("done", 2, "ChatGPT", "Signed in as alex@example.com")}
${sStep("done", 3, "Reminders in the background", "On, checks every minute")}
${sStep("now", 4, "Google", "Calendar and Gmail, optional")}
${sStep("todo", 5, "Dates and currency", "Detected: day/month/year, AUD")}
${sStep("todo", 6, "Final check", "Everything tested once")}
<div style="margin-top: auto; display: flex; justify-content: center">${spot("spot-key", 150, "A brass key with a blank paper tag")}</div>
</aside>
<main style="flex-grow: 1; min-width: 0; box-sizing: border-box; padding: 44px 64px; display: flex; flex-direction: column; gap: 22px">
<div>${label("Step 4 of 6 · optional")}<h1 style="margin: 4px 0 6px; font-family: ${F.disp}; font-size: 38px; font-weight: 600; letter-spacing: -0.025em">Connect your Google account</h1><div style="font-size: 16px; color: ${C.ink2}; max-width: 640px; text-wrap: pretty">Jarvis talks to Google through a small project that belongs to you, so your mail and calendar travel from Google straight to this computer and nowhere else.</div></div>
${card(
  `${sub(1, "Create your Google Cloud project", `<div style="color: ${C.ink2}">A step-by-step guide with pictures. It takes about ten minutes and costs nothing.</div><div>${btn("Open the guide", "secondary", "link")}</div>`)}
<div style="height: 1px; background: ${C.line}"></div>
${sub(2, "Choose the file you downloaded", `<div style="display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 14px; border: 1px solid ${C.line}; border-radius: 12px; background: ${C.bg}">${ic("file", 18, C.ink3)}<span style="flex-grow: 1; font-family: ${F.mono}; font-size: 13px">google-client.json</span>${tag("Looks right", "sage", "check")}${btn("Choose another", "secondary")}</div><div style="font-size: 13px; color: ${C.ink2}">This file stays on this computer. Don&#39;t share it or put it online.</div>`)}
<div style="height: 1px; background: ${C.line}"></div>
${sub(3, "Sign in with Google", `<div style="color: ${C.ink2}">Your browser opens. Google lists what Jarvis asks for: your calendar, reading mail, and writing drafts.</div><div>${btn("Sign in with Google", "primary", "link")}</div>`)}`,
  "padding: 24px; display: flex; flex-direction: column; gap: 18px; max-width: 760px",
)}
<div style="margin-top: auto; display: flex; align-items: center; justify-content: space-between; max-width: 760px">${btn("Back", "ghost", "left")}<div style="display: flex; gap: 8px">${btn("Skip for now", "secondary")}${btn("Continue", "primary", "right")}</div></div>
</main>
</div>`);

// ---------------------------------------------------------------- Setup: done
const okLine = (name, detail) => `<div style="display: flex; align-items: center; gap: 10px; min-height: 36px">${ic("check", 17, C.sageInk, 2.2)}<span style="font-weight: 600; width: 130px">${name}</span><span style="color: ${C.ink2}; font-size: 13.5px">${detail}</span></div>`;
const tryChip = (t) => `<div style="padding: 10px 16px; border: 1px solid ${C.line}; border-radius: 999px; background: ${C.surface}; font-size: 14px">${t}</div>`;

const setupDone = frame(`
<div style="display: flex; flex-direction: column; height: 100%">
<div style="position: relative; height: 330px; flex-shrink: 0; overflow: hidden">
<img src="${asset("hero-garden")}" alt="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 22%">
<div style="position: absolute; inset: 0; background: linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 55%, ${C.bg} 100%)"></div>
<div style="position: relative; padding: 52px 72px"><div style="font-family: ${F.disp}; font-size: 54px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.02">You&#39;re all set.</div><div style="font-size: 17px; color: ${C.ink}; margin-top: 8px">Jarvis is ready, and everything was tested once.</div></div>
</div>
<div style="flex-grow: 1; box-sizing: border-box; padding: 0 72px 44px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; margin-top: -40px; position: relative">
${card(
  `${h2("The final check")}
<div style="display: flex; flex-direction: column">
${okLine("ChatGPT", "signed in as alex@example.com")}
${okLine("Privacy guard", "a test card number was removed before sending")}
${okLine("Background", "on, last ran 12 seconds ago")}
${okLine("Google", "calendar and Gmail both answer")}
${okLine("Your data", "kept in one folder on this computer")}
</div>
<div style="margin-top: auto">${muted("Run it again any time from Settings, Health check.")}</div>`,
  "padding: 24px; display: flex; flex-direction: column; gap: 12px",
)}
${card(
  `${h2("Just type. For example")}
<div style="display: flex; flex-direction: column; align-items: flex-start; gap: 8px">
${tryChip("Remind me at 5pm to call the dentist")}
${tryChip("What&#39;s on tomorrow?")}
${tryChip("Any important mail today?")}
${tryChip("What bills are due this month?")}
</div>
<div style="margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: 12px">${muted("Shift + Tab changes what Codex may do. It starts in Chat, the safe one.", "max-width: 300px; text-wrap: pretty")}<a href="Main.dc.html" style="display: inline-flex; align-items: center; gap: 8px; min-height: 52px; padding: 0 26px; border-radius: 12px; background: ${C.blue}; color: #FFFFFF; font-weight: 600; font-size: 16px; text-decoration: none; box-shadow: 0 6px 16px rgba(42,82,190,0.22)">Open Jarvis${ic("right", 16)}</a></div>`,
  "padding: 24px; display: flex; flex-direction: column; gap: 14px",
)}
</div>
</div>`);

export default [
  { file: "Privacy.dc.html", title: "Privacy", row: 2, pos: -2, markup: privacy },
  { file: "Guard.dc.html", title: "The privacy guard at work", row: 2, pos: -1, markup: guard },
  { file: "Welcome.dc.html", title: "Setup · welcome", row: 3, markup: welcome },
  { file: "SetupGoogle.dc.html", title: "Setup · connect Google", row: 3, markup: setupGoogle },
  { file: "SetupDone.dc.html", title: "Setup · all set", row: 3, markup: setupDone },
];
