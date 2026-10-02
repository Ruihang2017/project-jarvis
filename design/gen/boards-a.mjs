// Row 1: Today and conversation.
import { C, F, SHADOW, SHADOW_LG, asset, btn, card, composer, h2, ic, iconBtn, label, mono, muted, shell, spot, tag } from "./lib.mjs";

const chipBtn = (text) => `<button style="min-height: 44px; padding: 0 16px; border: 1px solid ${C.line}; border-radius: 999px; background: rgba(255,255,255,0.86); color: ${C.ink2}; font-size: 13px; font-weight: 500">${text}</button>`;

const timeRow = (time, title, sub = "", tone = C.blueInk) =>
  `<div style="display: flex; gap: 12px; align-items: baseline"><div style="width: 46px; flex-shrink: 0; font-size: 13px; font-weight: 600; color: ${tone}">${time}</div><div style="min-width: 0"><div style="font-weight: 500">${title}</div>${sub ? `<div style="font-size: 12.5px; color: ${C.ink2}">${sub}</div>` : ""}</div></div>`;

const cardHead = (icon, title, link) =>
  `<div style="display: flex; align-items: center; justify-content: space-between"><div style="display: flex; align-items: center; gap: 10px"><span style="display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 10px; background: ${C.blueSoft}; color: ${C.blueInk}">${ic(icon, 17)}</span>${h2(title, "font-size: 16px")}</div><a href="${link}" aria-label="Open ${title}" style="display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; margin: -8px -10px -8px 0; color: ${C.ink3}">${ic("right", 18)}</a></div>`;

// ---------------------------------------------------------------- Today
const today = shell({
  active: "Today",
  title: "Today",
  sub: "Friday 2 October",
  bodyStyle: "display: flex; flex-direction: column; gap: 16px",
  body: `
<section aria-label="Morning brief" style="position: relative; height: 290px; flex-shrink: 0; border-radius: 24px; overflow: hidden; box-shadow: ${SHADOW}">
<img src="${asset("hero-morning")}" alt="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 40%">
<div style="position: absolute; inset: 0; background: linear-gradient(90deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.82) 34%, rgba(255,255,255,0) 66%)"></div>
<div style="position: relative; height: 100%; box-sizing: border-box; padding: 30px 36px; display: flex; flex-direction: column; justify-content: center; gap: 10px; max-width: 560px">
${label("Your morning brief · 08:30")}
<div style="font-family: ${F.disp}; font-size: 40px; font-weight: 600; line-height: 1.08; letter-spacing: -0.025em">Good morning, Alex.</div>
<div style="font-size: 16px; color: ${C.ink2}; text-wrap: pretty">Two things on today, one bill due on Monday, and a reply to Sam waiting for your OK.</div>
</div>
</section>

<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; flex-grow: 1; min-height: 0">
${card(
  `${cardHead("calendar", "Calendar", "Calendar.dc.html")}
<div style="display: flex; flex-direction: column; gap: 12px">
${timeRow("09:30", "Team stand-up", "30 min")}
${timeRow("15:00", "Dentist", "Northside Dental")}
</div>
<div style="margin-top: auto; padding-top: 12px; border-top: 1px solid ${C.line}">${muted("Tomorrow")}<div style="font-weight: 500">Farmers market with Priya, 10:00</div></div>`,
  "padding: 18px; display: flex; flex-direction: column; gap: 14px",
)}
${card(
  `${cardHead("bill", "Bills", "Bills.dc.html")}
<div style="display: flex; flex-direction: column; gap: 12px">
<div style="display: flex; justify-content: space-between; gap: 10px"><div><div style="font-weight: 500">Northwind Energy</div><div style="font-size: 12.5px; color: ${C.apricotInk}; font-weight: 600">Due Monday, in 3 days</div></div><div style="font-weight: 600">$245.30</div></div>
<div style="display: flex; justify-content: space-between; gap: 10px"><div><div style="font-weight: 500">Fibreline Internet</div><div style="font-size: 12.5px; color: ${C.ink2}">Charged automatically on the 14th</div></div><div style="font-weight: 600">$79.00</div></div>
</div>
<a href="BillReview.dc.html" style="margin-top: auto; display: flex; align-items: center; justify-content: space-between; min-height: 44px; padding: 0 14px; border-radius: 12px; background: ${C.apricotSoft}; color: ${C.apricotInk}; font-weight: 600; text-decoration: none"><span>2 new bills to check</span>${ic("right", 16)}</a>`,
  "padding: 18px; display: flex; flex-direction: column; gap: 14px",
)}
${card(
  `${cardHead("mail", "Mail", "Mail.dc.html")}
<div style="display: flex; flex-direction: column; gap: 12px">
<div><div style="font-weight: 500">Sam Carter</div><div style="font-size: 12.5px; color: ${C.ink2}">Weekly update: kitchen install moved to the 12th</div></div>
<div><div style="font-weight: 500">Harbour Water</div><div style="font-size: 12.5px; color: ${C.ink2}">Your October bill is ready</div></div>
</div>
<div style="margin-top: auto; padding-top: 12px; border-top: 1px solid ${C.line}">${muted("4 unread in Primary since yesterday")}</div>`,
  "padding: 18px; display: flex; flex-direction: column; gap: 14px",
)}
${card(
  `${cardHead("bell", "Reminders", "Reminders.dc.html")}
<div style="display: flex; flex-direction: column; gap: 12px">
${timeRow("12:30", "Call the dentist to confirm")}
${timeRow("17:00", "Submit expenses", "Every month on the 2nd")}
</div>
<div style="margin-top: auto; display: flex; align-items: center; gap: 10px; padding-top: 12px; border-top: 1px solid ${C.line}">${ic("moon", 16, C.ink3)}${muted("Reminders also arrive when Jarvis is closed")}</div>`,
  "padding: 18px; display: flex; flex-direction: column; gap: 14px",
)}
</div>

<div style="display: flex; flex-direction: column; gap: 10px; flex-shrink: 0">
${composer({ placeholder: "Ask Jarvis anything, or tell it what to do" })}
<div style="display: flex; gap: 8px; flex-wrap: wrap">
${chipBtn("What&#39;s on tomorrow?")}${chipBtn("Any important mail today?")}${chipBtn("Remind me at 5pm to call the dentist")}${chipBtn("What bills are still unpaid this month?")}
</div>
</div>`,
});

// ---------------------------------------------------------------- Chat
const bubble = (inner) => `<div style="align-self: flex-end; max-width: 560px; padding: 12px 16px; border-radius: 18px 18px 4px 18px; background: ${C.blue}; color: #FFFFFF; font-size: 15px">${inner}</div>`;
const step = (icon, text) => `<div style="display: flex; align-items: center; gap: 10px; color: ${C.ink2}; font-size: 13px">${ic(icon, 15, C.ink3)}<span>${text}</span></div>`;
const reply = (inner) => `<div style="display: flex; gap: 12px; max-width: 680px"><img src="${asset("icon")}" alt="" style="width: 28px; height: 28px; border-radius: 9px; flex-shrink: 0; margin-top: 2px"><div style="font-size: 15px; text-wrap: pretty">${inner}</div></div>`;
const removed = (what) => `<span style="display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; border-radius: 6px; background: rgba(255,255,255,0.22); font-size: 13px; font-weight: 600">${ic("lock", 12, "currentColor", 2)}${what} removed</span>`;
const guardNote = (text) => `<div style="align-self: flex-end; display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; background: ${C.sageSoft}; color: ${C.sageInk}; font-size: 12.5px; font-weight: 600">${ic("shield", 14, "currentColor", 2)}${text}</div>`;

const chat = shell({
  active: "Chat",
  title: "Reply to Sam about the kitchen",
  actions: iconBtn("history", "Conversations") + btn("New", "secondary", "plus"),
  bodyStyle: "display: flex; flex-direction: column; gap: 14px",
  body: `
<div style="flex-grow: 1; min-height: 0; overflow: hidden; display: flex; justify-content: center">
<div style="width: 100%; max-width: 780px; display: flex; flex-direction: column; gap: 16px; padding-top: 8px">
${bubble(`Reply to Sam&#39;s weekly update and ask whether the new date still works for the plumber. My account with them is ${removed("account number")}`)}
${guardNote("1 account number was removed before your message left this computer")}
<div style="display: flex; flex-direction: column; gap: 6px; padding-left: 40px">
${step("search", "Searched your mail for &ldquo;weekly update&rdquo; from Sam")}
${step("mail", "Read the conversation, 3 messages")}
${step("pencil", "Wrote a draft and saved it in Gmail drafts")}
</div>
${reply("Sam&#39;s update from this morning says the kitchen install moved to Monday 12 October. Nothing in the thread mentions the plumber, so the draft asks about that. I left your account number out.")}
<section aria-label="Send this email?" style="margin-left: 40px; max-width: 640px; display: flex; flex-direction: column; gap: 14px; padding: 18px; border: 1px solid #C9D6F5; border-radius: 18px; background: ${C.surface}; box-shadow: ${SHADOW}">
<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px">${h2("Send this email?", "font-size: 17px")}${tag("Jarvis asks every time", "blue")}</div>
<div style="display: grid; grid-template-columns: 64px minmax(0, 1fr); row-gap: 4px; font-size: 13.5px">
<div style="color: ${C.ink3}">To</div><div>Sam Carter</div>
<div style="color: ${C.ink3}">Subject</div><div>Re: Weekly update</div>
</div>
<div style="padding: 14px; border-radius: 12px; background: ${C.bg}; font-size: 14px; color: ${C.ink}">Hi Sam, thanks for the update. Monday the 12th works for me. Does the new date still suit the plumber, or do we need to rebook? Thanks, Alex</div>
<div style="display: flex; gap: 8px">${btn("Send", "primary", "send")}${btn("Edit in Gmail", "secondary", "link")}${btn("Don&#39;t send", "ghost")}</div>
</section>
</div>
</div>
<div style="width: 100%; max-width: 780px; align-self: center">${composer()}</div>`,
});

// ---------------------------------------------------------------- Chat with pictures
const pictures = shell({
  active: "Chat",
  title: "A birthday card for Mia",
  actions: iconBtn("history", "Conversations") + btn("New", "secondary", "plus"),
  bodyStyle: "display: flex; flex-direction: column; gap: 14px",
  body: `
<div style="flex-grow: 1; min-height: 0; overflow: hidden; display: flex; justify-content: center">
<div style="width: 100%; max-width: 780px; display: flex; flex-direction: column; gap: 16px; padding-top: 8px">
${bubble("Draw a cheerful birthday cake for Mia&#39;s card, coloured pencil style")}
<div style="display: flex; flex-direction: column; gap: 6px; padding-left: 40px">${step("spark", "Made a picture")}</div>
<div style="display: flex; gap: 12px">
<img src="${asset("icon")}" alt="" style="width: 28px; height: 28px; border-radius: 9px; flex-shrink: 0; margin-top: 2px">
<div style="display: flex; flex-direction: column; gap: 12px">
<div style="padding: 8px; border: 1px solid ${C.line}; border-radius: 20px; background: ${C.surface}; box-shadow: ${SHADOW}">
<img src="${asset("sample-cake")}" alt="A coloured-pencil drawing of a birthday cake with candles" style="width: 340px; height: 340px; object-fit: cover; border-radius: 14px">
</div>
<div style="display: flex; gap: 8px">${btn("Open", "secondary", "eye")}${btn("Copy", "secondary", "copy")}${btn("Show in folder", "secondary", "folder")}</div>
<div style="font-size: 15px">Here it is. It&#39;s saved in your Pictures as number 12. Want candles in a different colour?</div>
</div>
</div>
</div>
</div>
<div style="width: 100%; max-width: 780px; align-self: center">${composer({
    value: "Use this photo as the background instead",
    attach: `<div style="display: flex; align-items: center; gap: 12px; padding-top: 6px">
<div style="display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 6px; border: 1px solid ${C.line}; border-radius: 14px; background: ${C.bg}">
<img src="${asset("sample-house")}" alt="Attached picture" style="width: 44px; height: 44px; object-fit: cover; border-radius: 9px">
<div style="font-size: 13px"><div style="font-weight: 600">garden.png</div><div style="color: ${C.ink2}">Pasted from clipboard</div></div>
<button aria-label="Remove attached picture" style="display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border: 0; border-radius: 10px; background: transparent; color: ${C.ink3}">${ic("x", 16)}</button>
</div>
${tag("Pictures aren&#39;t checked by the privacy guard", "apricot", "warn")}
</div>`,
  })}</div>`,
});

// ---------------------------------------------------------------- Commands
const GROUPS = [
  ["Conversation", [["/new", "Start a new conversation"], ["/resume", "Continue an earlier one"], ["/image", "Attach a picture"], ["/model", "Choose the model"], ["/effort", "How hard the model thinks"], ["/usage", "Your ChatGPT plan limits"], ["/mode", "What Codex may do here"]]],
  ["What Jarvis looks after", [["/brief", "Today at a glance"], ["/calendar", "Today, tomorrow or the week"], ["/mail", "Unread mail from the last day"], ["/bills", "Bills found in your email"], ["/remind", "Reminders"], ["/memory", "What Jarvis remembers"], ["/images", "Pictures Jarvis made"]]],
  ["Setup and care", [["/connect", "Connect Google"], ["/google", "Connection status"], ["/background", "Reminders when closed"], ["/region", "Dates and currency"], ["/web", "Web search on or off"], ["/data", "Back up and export"], ["/doctor", "Check everything works"]]],
];

const commands = shell({
  active: "Chat",
  title: "New conversation",
  actions: iconBtn("history", "Conversations"),
  bodyStyle: "display: flex; flex-direction: column; gap: 14px; align-items: center",
  body: `
<div style="flex-grow: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; text-align: center">
${spot("spot-bell", 200, "A small brass bell beside a cup of tea", "margin: -30px 0 -24px")}
<div style="font-family: ${F.disp}; font-size: 30px; font-weight: 600; letter-spacing: -0.02em">What can I do for you?</div>
<div style="max-width: 460px; color: ${C.ink2}; font-size: 15px">Just type. Jarvis answers, looks things up, keeps track of your day, and makes pictures.</div>
</div>
<div role="listbox" aria-label="Commands" style="width: 100%; max-width: 900px; box-sizing: border-box; padding: 18px 20px; border: 1px solid ${C.line}; border-radius: 20px; background: ${C.surface}; box-shadow: ${SHADOW_LG}; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px">
${GROUPS.map(
  ([name, items], g) => `<div style="display: flex; flex-direction: column; gap: 2px">
${label(name, "padding: 0 10px 6px")}
${items
  .map(
    ([cmd, what], i) =>
      `<button role="option" aria-selected="${g === 1 && i === 3}" style="display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 10px; border: 0; border-radius: 10px; background: ${g === 1 && i === 3 ? C.blueSoft : "transparent"}; color: ${C.ink}; text-align: left"><span style="width: 96px; flex-shrink: 0; font-family: ${F.mono}; font-size: 13px; font-weight: 500; color: ${C.blueInk}">${cmd}</span><span style="font-size: 13px; color: ${C.ink2}">${what}</span></button>`,
  )
  .join("\n")}
</div>`,
).join("\n")}
</div>
<div style="width: 100%; max-width: 900px; display: flex; flex-direction: column; gap: 8px">
${composer({ value: "/" })}
<div style="display: flex; justify-content: center; gap: 18px; font-size: 12.5px; color: ${C.ink3}"><span>Up and Down to choose</span><span>Enter to run</span><span>Shift + Tab changes mode</span><span>Esc stops a reply</span></div>
</div>`,
});

// ---------------------------------------------------------------- History
const convo = (title, snippet, when, on = false) =>
  `<button aria-pressed="${on}" style="display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border: 1px solid ${on ? "#C9D6F5" : "transparent"}; border-radius: 14px; background: ${on ? C.blueSoft : "transparent"}; color: ${C.ink}; text-align: left"><span style="display: flex; justify-content: space-between; gap: 12px"><span style="font-weight: 600">${title}</span><span style="font-size: 12.5px; color: ${C.ink3}; flex-shrink: 0">${when}</span></span><span style="font-size: 13px; color: ${C.ink2}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${snippet}</span></button>`;

const history = shell({
  active: "Chat",
  title: "Conversations",
  sub: "Pick one to carry on where you left off",
  actions: btn("New conversation", "primary", "plus"),
  bodyStyle: "display: grid; grid-template-columns: 420px minmax(0, 1fr); gap: 16px",
  body: `
${card(
  `<div style="display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 14px; border-radius: 12px; background: ${C.bg}; color: ${C.ink3}">${ic("search", 16)}<label for="q" style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%)">Search conversations</label><input id="q" type="text" placeholder="Search conversations" style="flex-grow: 1; min-width: 0; min-height: 40px; border: 0; outline: 0; background: transparent; font: inherit; color: ${C.ink}"></div>
${label("Today", "padding: 8px 14px 0")}
${convo("Reply to Sam about the kitchen", "The draft asks whether the plumber can still make it.", "09:12", true)}
${convo("A birthday card for Mia", "Here it is. It&#39;s saved in your Pictures as number 12.", "08:40")}
${label("Yesterday", "padding: 8px 14px 0")}
${convo("Weekend plan", "Saturday is free after 2pm; Sunday has lunch with Priya.", "Thu")}
${convo("October bills", "Three to pay this month, one is automatic.", "Thu")}
${label("Earlier", "padding: 8px 14px 0")}
${convo("Flight times to Melbourne", "The 7:05 gets in before your first meeting.", "28 Sep")}
${convo("Gift ideas for Dad", "A pruning set, a book on roses, or a class.", "24 Sep")}`,
  "padding: 14px; display: flex; flex-direction: column; gap: 4px; overflow: hidden",
)}
${card(
  `<div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px">
<div>${h2("Reply to Sam about the kitchen", "font-size: 20px")}${muted("Today 09:12 · 6 messages · 1 email drafted")}</div>
${btn("Continue", "primary", "right")}
</div>
<div style="display: flex; flex-direction: column; gap: 14px; padding: 18px; border-radius: 14px; background: ${C.bg}">
<div style="align-self: flex-end; max-width: 440px; padding: 10px 14px; border-radius: 16px 16px 4px 16px; background: ${C.blue}; color: #FFFFFF">Reply to Sam&#39;s weekly update and ask whether the new date still works for the plumber.</div>
<div style="max-width: 500px">Sam&#39;s update says the kitchen install moved to Monday 12 October. The draft asks about the plumber.</div>
<div style="align-self: flex-end; max-width: 440px; padding: 10px 14px; border-radius: 16px 16px 4px 16px; background: ${C.blue}; color: #FFFFFF">Send it.</div>
<div style="max-width: 500px">Sent to Sam Carter.</div>
</div>
<div style="margin-top: auto; display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 12px; background: ${C.soft}; color: ${C.ink2}; font-size: 13px">${ic("lock", 15)}<span>Conversations are kept on this computer by Codex. Anything the privacy guard removed is not in them.</span></div>`,
  "padding: 22px; display: flex; flex-direction: column; gap: 18px",
)}`,
});

// ---------------------------------------------------------------- Modes
const modeCard = (name, dot, line, can, cannot, current, warn = "") =>
  card(
    `<div style="display: flex; align-items: center; justify-content: space-between"><div style="display: flex; align-items: center; gap: 10px"><span style="width: 11px; height: 11px; border-radius: 50%; background: ${dot}"></span>${h2(name)}</div>${current ? tag("On now", "sage", "check") : ""}</div>
<div style="color: ${C.ink2}; min-height: 63px; text-wrap: pretty">${line}</div>
<div style="display: flex; flex-direction: column; gap: 8px; font-size: 13.5px">
${can.map((t) => `<div style="display: flex; gap: 8px">${ic("check", 16, C.sageInk, 2)}<span>${t}</span></div>`).join("")}
${cannot.map((t) => `<div style="display: flex; gap: 8px; color: ${C.ink2}">${ic("x", 16, C.ink3, 2)}<span>${t}</span></div>`).join("")}
</div>
${warn ? `<div style="display: flex; gap: 8px; padding: 10px 12px; border-radius: 12px; background: ${C.apricotSoft}; color: ${C.apricotInk}; font-size: 12.5px; font-weight: 500">${ic("warn", 15, "currentColor", 2)}<span>${warn}</span></div>` : ""}
<div style="margin-top: auto">${current ? btn("Current mode", "soft", "", "width: 100%") : btn(`Switch to ${name}`, name === "Auto" ? "danger" : "secondary", "", "width: 100%")}</div>`,
    `padding: 20px; display: flex; flex-direction: column; gap: 14px; ${current ? `border-color: #B9C9F3; box-shadow: 0 0 0 3px ${C.blueSoft}, ${SHADOW}` : ""}`,
  );

const modes = shell({
  active: "Privacy",
  title: "Permission modes",
  sub: "What Codex may do on this computer. The mode is always shown at the top right.",
  bodyStyle: "display: flex; flex-direction: column; gap: 16px",
  body: `
<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; flex-grow: 1; min-height: 0">
${modeCard("Chat", "#2E8B57", "Jarvis talks, and uses only its own tools: calendar, mail, bills, reminders, memory.", ["Everything goes through the privacy guard", "Jarvis&#39;s own tools, each asking first"], ["Codex can&#39;t run commands", "Codex can&#39;t read your files or pictures"], true)}
${modeCard("Manual", "#C97A2B", "Codex may work with files and commands, and asks before every single step.", ["Run commands, after you say yes", "Change files, after you say yes"], ["Nothing happens without asking"], false, "What Codex reads by itself doesn&#39;t pass the privacy guard.")}
${modeCard("Semi-auto", "#C97A2B", "Like Manual, but edits inside the working folder go ahead without asking.", ["Edit files in the working folder freely", "Everything else still asks"], ["No changes outside that folder"], false, "What Codex reads by itself doesn&#39;t pass the privacy guard.")}
${modeCard("Auto", "#B3261E", "Codex never asks. Use it only for a task you would hand over completely.", ["Commands and file changes without asking"], ["Not in the Shift + Tab cycle", "Asks you to confirm when you turn it on"], false, "Nothing is checked with you first.")}
</div>
<div style="display: grid; grid-template-columns: minmax(0, 1fr) 470px; gap: 16px; flex-shrink: 0">
${card(
  `${h2("Switching")}
<div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">${tag("Chat", "sage")}${ic("right", 16, C.ink3)}${tag("Manual", "apricot")}${ic("right", 16, C.ink3)}${tag("Semi-auto", "apricot")}<span style="color: ${C.ink2}">with</span><span style="padding: 3px 10px; border: 1px solid ${C.line}; border-radius: 8px; background: ${C.bg}; font-family: ${F.mono}; font-size: 12.5px">Shift + Tab</span></div>
${muted("Auto is only reachable from this page or by typing /mode auto, and always asks you to confirm. Jarvis&#39;s own tools that change something outside Jarvis ask first in every mode.", "text-wrap: pretty")}`,
  "padding: 20px; display: flex; flex-direction: column; gap: 12px",
)}
<div role="dialog" aria-label="Turn on Auto mode?" style="box-sizing: border-box; padding: 20px; border: 1px solid #EDBDB8; border-radius: 18px; background: ${C.surface}; box-shadow: ${SHADOW_LG}; display: flex; flex-direction: column; gap: 12px">
<div style="display: flex; align-items: center; gap: 10px; color: ${C.roseInk}">${ic("warn", 20, "currentColor", 2)}${h2("Turn on Auto mode?", `color: ${C.roseInk}`)}</div>
<div style="color: ${C.ink2}; text-wrap: pretty">Codex will run commands and change files without asking, and what it reads won&#39;t pass the privacy guard. Jarvis stays in Auto until you switch back.</div>
<div style="display: flex; gap: 8px; justify-content: flex-end">${btn("Stay in Chat", "secondary")}${btn("Turn on Auto", "dangerFill")}</div>
</div>
</div>`,
});

// ---------------------------------------------------------------- Approval in Manual mode
const approval = shell({
  active: "Chat",
  title: "Tidy the Downloads folder",
  mode: "Manual",
  actions: iconBtn("history", "Conversations") + btn("New", "secondary", "plus"),
  bodyStyle: "display: flex; flex-direction: column; gap: 14px",
  body: `
<div style="flex-grow: 1; min-height: 0; overflow: hidden; display: flex; justify-content: center">
<div style="width: 100%; max-width: 780px; display: flex; flex-direction: column; gap: 16px; padding-top: 4px">
<div style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 14px; background: ${C.apricotSoft}; color: ${C.apricotInk}; font-size: 13.5px">${ic("warn", 18, "currentColor", 2)}<span style="flex-grow: 1"><strong>Manual mode.</strong> Codex can read files itself here, and what it reads that way doesn&#39;t pass the privacy guard.</span><a href="Modes.dc.html" style="display: inline-flex; align-items: center; min-height: 44px; padding: 0 6px; color: ${C.apricotInk}; font-weight: 600; white-space: nowrap">Back to Chat mode</a></div>
${bubble("Find the PDF invoices in Downloads and move them into Documents, Invoices")}
${reply("I&#39;ll look for PDFs first, then move the ones that look like invoices. Each step needs your OK.")}
<section aria-label="Run this command?" style="margin-left: 40px; max-width: 640px; display: flex; flex-direction: column; gap: 12px; padding: 18px; border: 1px solid ${C.line}; border-radius: 18px; background: ${C.surface}; box-shadow: ${SHADOW}">
<div style="display: flex; align-items: center; gap: 10px">${ic("terminal", 18, C.ink2)}${h2("Run this command?", "font-size: 17px")}${tag("Done", "sage", "check")}</div>
<div style="padding: 12px 14px; border-radius: 12px; background: ${C.ink}; color: #E8EDF7; font-family: ${F.mono}; font-size: 13px">Get-ChildItem ~\\Downloads -Filter *.pdf</div>
${muted("You allowed this once. It found 7 files.")}
</section>
<section aria-label="Move 3 files?" style="margin-left: 40px; max-width: 640px; display: flex; flex-direction: column; gap: 12px; padding: 18px; border: 1px solid #C9D6F5; border-radius: 18px; background: ${C.surface}; box-shadow: ${SHADOW}">
<div style="display: flex; align-items: center; gap: 10px">${ic("file", 18, C.blueInk)}${h2("Move 3 files?", "font-size: 17px")}</div>
<div style="display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border-radius: 12px; background: ${C.bg}; font-family: ${F.mono}; font-size: 12.5px; color: ${C.ink}">
<div>Downloads\\invoice-0914.pdf</div><div>Downloads\\invoice-0921.pdf</div><div>Downloads\\tax-invoice-oct.pdf</div>
<div style="color: ${C.ink2}; font-family: ${F.body}; font-size: 13px">to Documents\\Invoices</div>
</div>
<div style="display: flex; gap: 8px; flex-wrap: wrap">${btn("Allow once", "primary", "check")}${btn("Always allow moves into this folder", "secondary")}${btn("Deny", "ghost")}</div>
</section>
</div>
</div>
<div style="width: 100%; max-width: 780px; align-self: center">${composer()}</div>`,
});

export default [
  { file: "Main.dc.html", title: "Today", row: 0, markup: today },
  { file: "Chat.dc.html", title: "Chat · tools, guard notice, send approval", row: 0, markup: chat },
  { file: "ChatPictures.dc.html", title: "Chat · making and attaching pictures", row: 0, markup: pictures },
  { file: "Commands.dc.html", title: "New conversation · command list", row: 0, markup: commands },
  { file: "History.dc.html", title: "Conversations", row: 0, markup: history },
  { file: "Modes.dc.html", title: "Permission modes", row: 2, markup: modes },
  { file: "Approval.dc.html", title: "Manual mode · approvals", row: 2, markup: approval },
];
