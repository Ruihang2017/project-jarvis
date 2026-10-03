// Row 5: settings, care, notifications and states. Row 6: the design language.
import { C, F, SHADOW, SHADOW_LG, asset, btn, card, h2, ic, label, mono, muted, segmented, shell, spot, tag, toggle } from "./lib.mjs";

const note = (icon, text, tone = "grey") => {
  const [bg, fg] = { grey: [C.soft, C.ink2], apricot: [C.apricotSoft, C.apricotInk], sage: [C.sageSoft, C.sageInk], rose: [C.roseSoft, C.roseInk], blue: [C.blueSoft, C.blueInk] }[tone];
  return `<div style="display: flex; gap: 10px; padding: 12px 14px; border-radius: 12px; background: ${bg}; color: ${fg}; font-size: 13px; text-wrap: pretty">${ic(icon, 16, "currentColor", 1.8)}<span>${text}</span></div>`;
};
const row = (name, help, control) =>
  `<div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 52px"><div style="min-width: 0"><div style="font-weight: 600">${name}</div>${help ? `<div style="font-size: 13px; color: ${C.ink2}; text-wrap: pretty">${help}</div>` : ""}</div><div style="flex-shrink: 0">${control}</div></div>`;
const hr = `<div style="height: 1px; background: ${C.line}"></div>`;
const select = (value, name) => `<button aria-label="${name}: ${value}. Change" style="display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 12px 0 14px; border: 1px solid ${C.line}; border-radius: 12px; background: ${C.surface}; color: ${C.ink}; font-weight: 600; font-size: 13.5px">${value}${ic("chevron", 16, C.ink3)}</button>`;
const settingsLink = (icon, text, href) => `<a href="${href}" style="display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 0 12px; border-radius: 12px; background: ${C.bg}; color: ${C.ink}; font-weight: 600; text-decoration: none">${ic(icon, 18, C.blueInk)}<span style="flex-grow: 1">${text}</span>${ic("right", 16, C.ink3)}</a>`;

// ---------------------------------------------------------------- Settings
const meter = (name, pct, reset) =>
  `<div style="display: flex; flex-direction: column; gap: 6px"><div style="display: flex; justify-content: space-between; font-size: 13.5px"><span style="font-weight: 600">${name}</span><span style="color: ${C.ink2}">${pct}% used · resets ${reset}</span></div><div style="height: 10px; border-radius: 999px; background: ${C.soft}"><div style="width: ${pct}%; height: 10px; border-radius: 999px; background: ${C.blue}"></div></div></div>`;

const settings = shell({
  active: "Settings",
  title: "Settings",
  bodyStyle: "display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px",
  body: `
${card(
  `${h2("The assistant")}
${row("Model", "", select("gpt-6-luna", "Model"))}
${row("How hard it thinks", "Higher is slower and uses more of your plan.", "")}
${segmented(["Low", "Medium", "High"], "Low", "Reasoning effort")}
${hr}
${row("Search the web", "Lets Edward look things up online.", toggle(true, "Search the web"))}
${row("Learn from conversations", "Remember things worth keeping.", toggle(true, "Learn from conversations"))}
${hr}
${h2("Your ChatGPT plan", "font-size: 16px")}
${meter("5-hour limit", 32, "at 14:10")}
${meter("Weekly limit", 18, "Monday")}`,
  "padding: 20px; display: flex; flex-direction: column; gap: 12px",
)}
${card(
  `${h2("Your day")}
${row("Morning brief", "Events, reminders, bills and mail at a glance.", select("08:30", "Brief time"))}
${segmented(["Weekdays", "Daily", "Off"], "Weekdays", "Brief days")}
${hr}
${row("Reminders when Edward is closed", "A small Windows task, every minute.", toggle(true, "Reminders when Edward is closed"))}
${hr}
${h2("Region", "font-size: 16px")}
${row("Dates", "10/12 means 10 December.", "")}
${segmented(["Day / month / year", "Month / day / year"], "Day / month / year", "Date order")}
${row("Currency", "For amounts with no currency sign.", select("AUD", "Currency"))}
${muted("Both were detected from your system.")}`,
  "padding: 20px; display: flex; flex-direction: column; gap: 12px",
)}
<div style="display: flex; flex-direction: column; gap: 16px">
${card(
  `<div style="display: flex; align-items: center; gap: 16px">${spot("spot-compass", 96, "A brass compass on a folded map")}<div>${h2("Looking after Edward")}${muted("Connections, your data and a health check.")}</div></div>
<div style="display: flex; flex-direction: column; gap: 8px">
${settingsLink("key", "Google connection", "Google.dc.html")}
${settingsLink("shield", "Permission modes", "Modes.dc.html")}
${settingsLink("bill", "How bills work", "BillsMonth.dc.html")}
${settingsLink("box", "Your data: back up, export, delete", "Data.dc.html")}
${settingsLink("heart", "Health check", "Doctor.dc.html")}
${settingsLink("spark", "Getting started tips", "Commands.dc.html")}
</div>`,
  "padding: 20px; display: flex; flex-direction: column; gap: 14px",
)}
${card(
  `${h2("Pictures", "font-size: 16px")}
${row("Open pictures when they&#39;re made", "", toggle(true, "Open pictures when they are made"))}
${row("Saved in", `<span style="font-family: ${F.mono}; font-size: 12.5px">Pictures\\Edward</span>`, btn("Change", "secondary"))}`,
  "padding: 20px; display: flex; flex-direction: column; gap: 6px; flex-grow: 1",
)}
</div>`,
});

// ---------------------------------------------------------------- Google connection
const perm = (name, what, level) =>
  `<div style="display: grid; grid-template-columns: 150px minmax(0, 1fr) 110px; gap: 12px; align-items: center; min-height: 52px; border-top: 1px solid ${C.line}"><div style="font-weight: 600">${name}</div><div style="font-size: 13.5px; color: ${C.ink2}">${what}</div><div style="text-align: right">${level}</div></div>`;

const google = shell({
  active: "Settings",
  title: "Google connection",
  sub: "Your personal Google account, through your own Google Cloud project",
  actions: `<a href="Settings.dc.html" style="display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 8px; font-weight: 600; text-decoration: none">${ic("left", 16)}Settings</a>`,
  bodyStyle: "display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 16px",
  body: `
<div style="display: flex; flex-direction: column; gap: 16px">
${card(
  `${spot("spot-key", 110, "A brass key with a blank paper tag")}
<div style="flex-grow: 1"><div style="display: flex; align-items: center; gap: 10px"><div style="font-family: ${F.disp}; font-size: 24px; font-weight: 600; letter-spacing: -0.015em">alex@example.com</div>${tag("Working", "sage", "check")}</div>${muted("Connected 1 October · checked 2 hours ago · Edward checks every 6 hours")}</div>
${btn("Check now", "secondary", "refresh")}`,
  "padding: 20px 24px; display: flex; align-items: center; gap: 20px",
)}
${card(
  `<div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 12px">${h2("What Edward may do")}${muted("Each of these still asks you first")}</div>
${perm("Calendar events", "See your events; add, move and remove them after you say yes", tag("Read and change", "blue"))}
${perm("Calendar list", "Know which calendars you have", tag("Read only", "grey"))}
${perm("Gmail", "Search and read your mail", tag("Read only", "grey"))}
${perm("Gmail drafts", "Write drafts, and send the ones you approve", tag("Write drafts", "blue"))}
<div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-top: 16px; border-top: 1px solid ${C.line}"><span style="font-weight: 600; width: 150px">Calendars it looks at</span>${tag("Personal", "grey")}${tag("Work", "grey")}${tag("Family", "grey")}<a href="Calendar.dc.html" style="display: inline-flex; align-items: center; min-height: 44px; padding: 0 6px; font-weight: 600">Change</a></div>
<div style="margin-top: auto; padding-top: 14px">${note("x", "Not asked for, so not possible: deleting or archiving mail, changing Gmail settings, your contacts, your Drive.")}</div>`,
  "padding: 22px 24px; display: flex; flex-direction: column; flex-grow: 1",
)}
</div>
<div style="display: flex; flex-direction: column; gap: 16px">
${card(
  `${h2("How it&#39;s kept")}
<div style="display: flex; flex-direction: column; gap: 10px; font-size: 13.5px">
<div style="display: flex; gap: 10px">${ic("lock", 17, C.sageInk, 2)}<span>The sign-in is encrypted by Windows for your user account, and never written to a log.</span></div>
<div style="display: flex; gap: 10px">${ic("check", 17, C.sageInk, 2)}<span>Mail and calendar data go from Google to this computer. There is no Edward server.</span></div>
</div>`,
  "padding: 20px; display: flex; flex-direction: column; gap: 12px",
)}
${card(
  `${h2("Reconnect or leave")}
${muted("Reconnect if a permission is missing or Google stopped answering.")}
${btn("Reconnect", "secondary", "refresh")}
${hr}
${muted("Disconnecting tells Google to withdraw Edward&#39;s access and deletes the sign-in from this computer. Calendar, mail and bills stop working until you connect again.", "text-wrap: pretty")}
${btn("Disconnect Google", "danger")}`,
  "padding: 20px; display: flex; flex-direction: column; gap: 12px; flex-grow: 1",
)}
</div>`,
});

// ---------------------------------------------------------------- Health check
const chk = (status, name, detail) => {
  const s = { ok: [C.sageSoft, C.sageInk, "check", "OK"], warn: [C.apricotSoft, C.apricotInk, "warn", "Look"], fail: [C.roseSoft, C.roseInk, "x", "Fix"] }[status];
  return `<div style="display: grid; grid-template-columns: 34px 130px minmax(0, 1fr); gap: 12px; align-items: center; min-height: 54px; border-top: 1px solid ${C.line}"><span style="display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 50%; background: ${s[0]}; color: ${s[1]}">${ic(s[2], 15, "currentColor", 2.4)}</span><div style="font-weight: 600">${name}</div><div style="font-size: 13.5px; color: ${status === "ok" ? C.ink2 : s[1]}; font-weight: ${status === "ok" ? 400 : 600}">${detail}</div></div>`;
};

const doctor = shell({
  active: "Settings",
  title: "Health check",
  sub: "Everything Edward needs, tested just now",
  actions: btn("Check again", "secondary", "refresh") + btn("Copy the report", "secondary", "copy"),
  bodyStyle: "display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px",
  body: `
${card(
  `${chk("ok", "Node.js", "24.8.0")}
${chk("warn", "Codex", "0.160.1. Edward was verified with 0.159.3; if something misbehaves, suspect this first.")}
${chk("ok", "ChatGPT", "Signed in as alex@example.com")}
${chk("ok", "Privacy guard", "A test card number was removed before sending")}
${chk("ok", "Data folder", "AppData\\Local\\Edward, writable")}
${chk("ok", "Data version", "v1")}
${chk("ok", "Background", "On, last ran 20 seconds ago")}
${chk("ok", "Google", "alex@example.com · calendar, Gmail")}
${chk("ok", "Mode", "Chat. Codex&#39;s own commands and file reading are off")}`,
  "padding: 6px 24px 10px; display: flex; flex-direction: column",
)}
${card(
  `<div style="display: flex; justify-content: center">${spot("spot-care", 170, "A watering can beside a potted plant")}</div>
<div style="text-align: center"><div style="font-family: ${F.disp}; font-size: 24px; font-weight: 600; letter-spacing: -0.015em">Nearly everything is fine</div>${muted("8 checks passed, 1 to look at. Nothing is stopping Edward from working.", "text-wrap: pretty")}</div>
<div style="margin-top: auto">${note("lock", "The report has no account numbers in it, but names and email subjects are yours to trim before you share it.")}</div>`,
  "padding: 22px; display: flex; flex-direction: column; gap: 14px",
)}`,
});

// ---------------------------------------------------------------- Data
const size = (name, what, amount) => `<div style="display: grid; grid-template-columns: 130px minmax(0, 1fr) 80px; gap: 12px; align-items: center; min-height: 40px; border-top: 1px solid ${C.line}; font-size: 13.5px"><div style="font-weight: 600">${name}</div><div style="color: ${C.ink2}">${what}</div><div style="text-align: right; font-weight: 600">${amount}</div></div>`;
const backup = (when, why) => `<div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 40px; border-top: 1px solid ${C.line}; font-size: 13.5px"><span style="font-weight: 600">${when}</span><span style="color: ${C.ink2}">${why}</span></div>`;

const data = shell({
  active: "Settings",
  title: "Your data",
  sub: "All of it is in one folder on this computer",
  actions: btn("Open the folder", "secondary", "folder"),
  bodyStyle: "display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 16px",
  body: `
<div style="display: flex; flex-direction: column; gap: 16px">
${card(
  `<div style="display: flex; align-items: center; gap: 18px; padding-bottom: 12px">${spot("spot-archive", 96, "Three archive boxes with blank labels")}<div style="min-width: 0"><div style="font-family: ${F.mono}; font-size: 14px; font-weight: 500">C:\\Users\\alex\\AppData\\Local\\Edward</div>${muted("17.3 MB in all · data version v1")}</div></div>
${size("Memory", "What Edward remembers about you", "48 KB")}
${size("Reminders", "Coming up, repeating and done", "12 KB")}
${size("Bills", "Payee, amount, due date. No account numbers", "20 KB")}
${size("Conversations", "Kept by Codex", "3.2 MB")}
${size("Pictures", "12 pictures", "14.0 MB")}
${size("Google sign-in", "Encrypted by Windows", "1 KB")}`,
  "padding: 22px 24px; display: flex; flex-direction: column",
)}
${card(
  `<div style="display: flex; align-items: center; gap: 10px; color: ${C.roseInk}">${ic("trash", 18)}${h2("Leaving", `color: ${C.roseInk}`)}</div>
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px">
<div style="display: flex; flex-direction: column; gap: 10px">${muted("<strong style=\"color: " + C.ink + "\">Delete all data.</strong> Memory, reminders, bills, pictures and the Google sign-in. Can&#39;t be undone.", "text-wrap: pretty")}<div style="margin-top: auto">${btn("Delete everything", "danger", "trash")}</div></div>
<div style="display: flex; flex-direction: column; gap: 10px">${muted("<strong style=\"color: " + C.ink + "\">Uninstall.</strong> Also withdraws Google access and removes the background task and notifications.", "text-wrap: pretty")}<div style="margin-top: auto">${btn("Uninstall Edward", "danger")}</div></div>
</div>`,
  "padding: 22px 24px; display: flex; flex-direction: column; gap: 14px; flex-grow: 1; border-color: #EDBDB8",
)}
</div>
<div style="display: flex; flex-direction: column; gap: 16px">
${card(
  `${h2("Back up")}
${muted("A copy of the whole folder. Edward also makes one by itself before every upgrade.", "text-wrap: pretty")}
<div style="display: flex; flex-direction: column">
${backup("2 October, 09:40", "You asked")}
${backup("28 September, 18:02", "Before an upgrade")}
</div>
${btn("Back up now", "primary", "copy")}`,
  "padding: 20px; display: flex; flex-direction: column; gap: 12px",
)}
${card(
  `${h2("Export")}
${muted("Everything as files you can read without Edward.", "text-wrap: pretty")}
<div style="display: flex; flex-wrap: wrap; gap: 6px">${["memories.md", "reminders.json", "bills.json", "bills.csv", "settings.json"].map((f) => `<span style="padding: 3px 10px; border-radius: 8px; background: ${C.bg}; font-family: ${F.mono}; font-size: 12.5px">${f}</span>`).join("")}</div>
<div style="margin-top: auto">${btn("Export everything", "secondary", "download")}</div>`,
  "padding: 20px; display: flex; flex-direction: column; gap: 12px; flex-grow: 1",
)}
</div>`,
});

// ---------------------------------------------------------------- Notifications (Windows)
const toast = (icon, title, body, actions, when) =>
  `<div role="status" style="box-sizing: border-box; width: 400px; padding: 16px 18px; border-radius: 14px; background: rgba(250,251,253,0.97); color: ${C.ink}; box-shadow: ${SHADOW_LG}; display: flex; flex-direction: column; gap: 10px">
<div style="display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: ${C.ink2}"><img src="${asset("icon")}" alt="" style="width: 18px; height: 18px; border-radius: 5px"><span style="font-weight: 600">Edward</span><span style="margin-left: auto">${when}</span></div>
<div style="display: flex; gap: 12px"><span style="display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; flex-shrink: 0; border-radius: 11px; background: ${C.blueSoft}; color: ${C.blueInk}">${ic(icon, 19)}</span><div><div style="font-weight: 700; font-size: 15px">${title}</div><div style="font-size: 13.5px; color: ${C.ink2}; text-wrap: pretty">${body}</div></div></div>
${actions ? `<div style="display: grid; grid-template-columns: repeat(${actions.length}, minmax(0, 1fr)); gap: 8px">${actions.map((a) => `<button style="min-height: 44px; border: 1px solid ${C.line}; border-radius: 10px; background: ${C.surface}; color: ${C.ink}; font-weight: 600; font-size: 13.5px">${a}</button>`).join("")}</div>` : ""}
</div>`;

const toasts = `<div style="position: relative; width: 1360px; height: 860px; overflow: hidden; background: #131B33; font-family: ${F.body}; font-size: 14px; line-height: 1.5">
<img src="${asset("hero-evening")}" alt="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover">
<div style="position: absolute; left: 56px; bottom: 56px; max-width: 420px; color: #FFFFFF"><div style="font-family: ${F.disp}; font-size: 34px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; text-shadow: 0 2px 18px rgba(10,14,30,0.7)">Edward keeps watch while it&#39;s closed.</div></div>
<div style="position: absolute; right: 28px; bottom: 28px; display: flex; flex-direction: column; gap: 12px">
${toast("sun", "Good morning, Alex", "2 events today, first at 09:30. 1 bill due Monday. 4 unread, 1 from Sam Carter.", ["Open Edward"], "08:30")}
${toast("bill", "Northwind Energy, $245.30, due today", "Pay it in your banking app, then tick it off in Edward.", ["I&#39;ve paid it", "Open the bill"], "09:00")}
${toast("bell", "Call the dentist to confirm", "Reminder for 12:30", ["Done", "In 10 minutes", "In 1 hour"], "12:30")}
</div>
</div>`;

// ---------------------------------------------------------------- States
const state = (name, title, text, action, alt) =>
  card(
    `${spot(name, 150, alt)}
<div style="display: flex; flex-direction: column; gap: 6px; align-items: flex-start"><div style="font-family: ${F.disp}; font-size: 22px; font-weight: 600; letter-spacing: -0.015em">${title}</div><div style="color: ${C.ink2}; text-wrap: pretty">${text}</div><div style="padding-top: 8px">${action}</div></div>`,
    "padding: 24px 28px; display: flex; align-items: center; gap: 24px",
  );

const states = shell({
  active: "Today",
  title: "Quiet moments and trouble",
  sub: "What each screen shows when there is nothing, or when something stopped working",
  bodyStyle: "display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 16px",
  body: `
${state("spot-rest", "Nothing needs you", "No events left today, no bills due this week, and no unread mail in Primary. Enjoy the quiet.", btn("Ask Edward something", "secondary", "chat"), "An armchair with a blanket and a closed book")}
${state("spot-umbrella", "Google stopped answering", "The connection expired or was withdrawn. Calendar, mail and bills are paused; reminders and memory still work.", btn("Reconnect Google", "primary", "refresh"), "A closed umbrella leaning on a pair of rain boots")}
${state("spot-key", "Sign in to carry on", "Edward runs on your ChatGPT plan, and you&#39;re signed out. Your reminders keep ringing in the meantime.", btn("Sign in with ChatGPT", "primary", "link"), "A brass key with a blank paper tag")}
${state("spot-lamp", "You&#39;ve reached your plan&#39;s limit", "ChatGPT will take new requests again at 14:10. Calendar, mail and bills still open, since they don&#39;t use the AI.", btn("See plan limits", "secondary"), "A desk lamp switched on beside a newspaper")}`,
});

// ---------------------------------------------------------------- Design language
const sw = (color, name, hex, dark = false) => `<div style="display: flex; flex-direction: column; gap: 6px"><div style="height: 72px; border-radius: 14px; background: ${color}; border: 1px solid ${C.line}"></div><div style="font-weight: 600; font-size: 13px">${name}</div><div style="font-family: ${F.mono}; font-size: 12px; color: ${C.ink2}">${hex}</div></div>`;

const style = `<div class="wash" style="width: 1360px; height: 860px; box-sizing: border-box; padding: 40px 48px; overflow: hidden; background-color: ${C.bg}; color: ${C.ink}; font-family: ${F.body}; font-size: 14px; line-height: 1.5; display: grid; grid-template-columns: 430px minmax(0, 1fr); gap: 28px">
<div style="display: flex; flex-direction: column; gap: 22px">
<div>${label("Edward · design language")}<div style="font-family: ${F.disp}; font-size: 46px; font-weight: 600; line-height: 1.02; letter-spacing: -0.03em">Morning light</div><div style="font-size: 16px; color: ${C.ink2}; text-wrap: pretty">A calm home study at sunrise: pale paper, ink blue, one warm accent, and watercolour still lifes instead of stock icons.</div></div>
${card(
  `${label("Type")}
<div style="font-family: ${F.disp}; font-size: 34px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1">Bricolage Grotesque</div>
<div style="font-size: 16px">Hanken Grotesk for everything you read and press.</div>
<div style="font-family: ${F.mono}; font-size: 13.5px; color: ${C.ink2}">JetBrains Mono for /commands and paths</div>`,
  "padding: 20px; display: flex; flex-direction: column; gap: 8px",
)}
${card(
  `${label("Controls")}
<div style="display: flex; gap: 8px; flex-wrap: wrap">${btn("Send", "primary", "send")}${btn("Edit in Gmail", "secondary")}${btn("Don&#39;t send", "ghost")}${btn("Remove", "danger")}</div>
<div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">${tag("Privacy guard on", "sage", "shield")}${tag("Due Monday", "apricot")}${tag("Read only", "grey")}${tag("Asks every time", "blue")}${tag("Auto", "rose", "warn")}</div>
<div style="display: flex; gap: 14px; align-items: center">${segmented(["Weekdays", "Daily", "Off"], "Weekdays", "Example")}${toggle(true, "Example switch")}</div>`,
  "padding: 20px; display: flex; flex-direction: column; gap: 14px",
)}
</div>
<div style="display: flex; flex-direction: column; gap: 22px; min-width: 0">
${card(
  `${label("Colour")}
<div style="display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 12px">
${sw(C.bg, "Paper", "#F3F6FA")}${sw(C.surface, "Card", "#FFFFFF")}${sw(C.ink, "Ink", "#1A2236")}${sw(C.blue, "Cobalt", "#2A52BE")}${sw(C.blueSoft, "Mist", "#E6ECFB")}${sw(C.apricot, "Apricot", "#F0A066")}${sw(C.sageSoft, "Sage", "#E1F0E5")}${sw(C.roseSoft, "Rose", "#FBE6E3")}
</div>
${muted("Cobalt is for the one thing to press. Apricot means look at this. Sage means safe or done. Rose is only for things that can&#39;t be undone.")}`,
  "padding: 20px; display: flex; flex-direction: column; gap: 12px",
)}
${card(
  `${label("Illustration · painted for Edward with Codex image generation")}
<div style="display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1.5fr) minmax(0, 1fr); gap: 12px">
<img src="${asset("hero-morning")}" alt="A misty harbour at sunrise seen from a study window" style="width: 100%; height: 250px; object-fit: cover; border-radius: 14px">
<img src="${asset("hero-welcome")}" alt="An open front door with morning light" style="width: 100%; height: 250px; object-fit: cover; border-radius: 14px">
<img src="${asset("hero-evening")}" alt="A study at dusk with a lamp on" style="width: 100%; height: 250px; object-fit: cover; border-radius: 14px">
</div>
<div style="display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 6px; align-items: center">
${["spot-bell", "spot-calendar", "spot-mail", "spot-bills", "spot-reminder", "spot-memory", "spot-privacy", "spot-care"].map((n) => `<img src="${asset(n)}" alt="" style="width: 100%; aspect-ratio: 1 / 1; object-fit: contain; mix-blend-mode: multiply">`).join("")}
</div>
${muted("Scenes carry the big moments: the morning brief, first run, the night watch. Small still lifes mark each room of the app and soften empty and error states. One palette, no people, no lettering.", "text-wrap: pretty")}`,
  "padding: 20px; display: flex; flex-direction: column; gap: 12px; flex-grow: 1",
)}
</div>
</div>`;

export default [
  { file: "Settings.dc.html", title: "Settings", row: 4, markup: settings },
  { file: "Google.dc.html", title: "Google connection", row: 4, markup: google },
  { file: "Doctor.dc.html", title: "Health check", row: 4, markup: doctor },
  { file: "Data.dc.html", title: "Your data · back up, export, delete", row: 4, markup: data },
  { file: "Notifications.dc.html", title: "Windows notifications", row: 4, markup: toasts, fixed: true },
  { file: "States.dc.html", title: "Empty and trouble states", row: 4, markup: states },
  { file: "Style.dc.html", title: "Design language", row: 5, markup: style, fixed: true },
];
