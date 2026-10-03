// Row 2: what Edward looks after.
import { C, F, SHADOW, asset, btn, card, h2, ic, iconBtn, label, mono, muted, segmented, shell, spot, tag, toggle } from "./lib.mjs";

const sr = "position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%)";
const note = (icon, text, tone = "grey") => {
  const [bg, fg] = { grey: [C.soft, C.ink2], apricot: [C.apricotSoft, C.apricotInk], sage: [C.sageSoft, C.sageInk], rose: [C.roseSoft, C.roseInk], blue: [C.blueSoft, C.blueInk] }[tone];
  return `<div style="display: flex; gap: 10px; padding: 12px 14px; border-radius: 12px; background: ${bg}; color: ${fg}; font-size: 13px; text-wrap: pretty">${ic(icon, 16, "currentColor", 1.8)}<span>${text}</span></div>`;
};
const kv = (k, v) => `<div style="color: ${C.ink3}">${k}</div><div>${v}</div>`;
const lockChip = (what) => `<span style="display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; border-radius: 6px; background: ${C.sageSoft}; color: ${C.sageInk}; font-size: 12.5px; font-weight: 600">${ic("lock", 12, "currentColor", 2)}${what} removed</span>`;

// ---------------------------------------------------------------- Calendar
const day = (d, n, on, dots) =>
  `<button aria-pressed="${on}" style="display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 68px; padding: 8px 0; border: 0; border-radius: 14px; background: ${on ? C.blue : "transparent"}; color: ${on ? "#FFFFFF" : C.ink}"><span style="font-size: 12px; font-weight: 600; color: ${on ? "#DCE5FB" : C.ink3}">${d}</span><span style="font-family: ${F.disp}; font-size: 20px; font-weight: 600">${n}</span><span style="display: flex; gap: 3px; height: 5px">${`<span style="width: 5px; height: 5px; border-radius: 50%; background: ${on ? "#FFFFFF" : C.apricot}"></span>`.repeat(dots)}</span></button>`;
const ev = (from, to, title, where, color, extra = "") =>
  `<div style="display: flex; gap: 14px; align-items: stretch; padding: 12px 14px; border-radius: 14px; background: ${C.bg}"><div style="width: 4px; border-radius: 4px; background: ${color}"></div><div style="width: 92px; flex-shrink: 0; font-size: 13px; font-weight: 600; color: ${C.ink2}">${from}<span style="font-weight: 400"> to ${to}</span></div><div style="flex-grow: 1; min-width: 0"><div style="font-weight: 600">${title}</div>${where ? `<div style="font-size: 13px; color: ${C.ink2}">${where}</div>` : ""}</div>${extra}</div>`;
const check = (name, color, on) =>
  `<label style="display: flex; align-items: center; gap: 10px; min-height: 44px"><input type="checkbox" ${on ? "checked" : ""} style="width: 18px; height: 18px; accent-color: ${C.blue}"><span style="width: 10px; height: 10px; border-radius: 3px; background: ${color}"></span><span>${name}</span></label>`;

const calendar = shell({
  active: "Calendar",
  title: "Calendar",
  sub: "From your Google Calendar. Times are Sydney time.",
  actions: segmented(["Today and tomorrow", "Week"], "Today and tomorrow", "Range") + btn("Add an event", "primary", "plus"),
  bodyStyle: "display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px",
  body: `
${card(
  `<div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px">
${day("Mon", 28, false, 1)}${day("Tue", 29, false, 0)}${day("Wed", 30, false, 2)}${day("Thu", 1, false, 1)}${day("Fri", 2, true, 2)}${day("Sat", 3, false, 2)}${day("Sun", 4, false, 0)}
</div>
<div style="display: flex; flex-direction: column; gap: 8px">
${label("Today · Friday 2 October")}
${ev("09:30", "10:00", "Team stand-up", "Video call", "#5B7FD9")}
${ev("15:00", "15:45", "Dentist", "Northside Dental", C.apricot)}
</div>
<div style="display: flex; flex-direction: column; gap: 8px">
${label("Tomorrow · Saturday 3 October")}
${ev("10:00", "11:30", "Farmers market with Priya", "Harbour Square", "#6FA57E", tag("1 guest", "grey", "users"))}
${ev("18:30", "21:00", "Dinner at Mum&#39;s", "", C.apricot)}
</div>
${note("clock", "Clocks go forward one hour on Sunday 4 October. Edward already counts that when it works out times.", "blue")}`,
  "padding: 20px; display: flex; flex-direction: column; gap: 18px",
)}
<div style="display: flex; flex-direction: column; gap: 16px">
${card(
  `<div style="display: flex; justify-content: center">${spot("spot-calendar", 150, "A small desk calendar with a sprig of flowers")}</div>
${h2("Free time")}
<div style="display: grid; grid-template-columns: 84px minmax(0, 1fr); row-gap: 8px; font-size: 13.5px">
${kv("Today", "10:00 to 15:00, then after 15:45")}
${kv("Tomorrow", "Until 10:00, then 11:30 to 18:30")}
${kv("Sunday", "All day")}
</div>`,
  "padding: 20px; display: flex; flex-direction: column; gap: 12px",
)}
${card(
  `${h2("Calendars shown")}
<div style="display: flex; flex-direction: column">
${check("Personal", C.apricot, true)}${check("Work", "#5B7FD9", true)}${check("Family", "#6FA57E", true)}${check("Public holidays", "#B8C1D1", false)}
</div>`,
  "padding: 20px; display: flex; flex-direction: column; gap: 8px; flex-grow: 1",
)}
</div>`,
});

// ---------------------------------------------------------------- Calendar changes
const confirmCard = (icon, title, rows, footer, buttons, border = C.line, head = C.ink) =>
  card(
    `<div style="display: flex; align-items: center; gap: 10px; color: ${head}">${ic(icon, 20)}${h2(title, `color: ${head}`)}</div>
<div style="display: grid; grid-template-columns: 84px minmax(0, 1fr); row-gap: 8px; font-size: 14px">${rows}</div>
${footer}
<div style="margin-top: auto; display: flex; gap: 8px; flex-wrap: wrap">${buttons}</div>`,
    `padding: 22px; display: flex; flex-direction: column; gap: 14px; border-color: ${border}`,
  );
const change = (a, b) => `<span><span style="color: ${C.ink3}; text-decoration: line-through">${a}</span> <strong style="color: ${C.blueInk}">${b}</strong></span>`;

const calendarChanges = shell({
  active: "Calendar",
  title: "Calendar changes",
  sub: "Edward asks before it adds, moves or removes anything, and never sends invitations.",
  bodyStyle: "display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 16px",
  body: `
${confirmCard("plus", "Add this event?", kv("What", "Dentist follow-up") + kv("When", "Thursday 15 October, 15:00 to 15:30") + kv("Where", "Northside Dental") + kv("Calendar", "Personal"), note("check", "No guests. Nobody is invited or notified.", "sage"), btn("Add to calendar", "primary", "check") + btn("Change details", "secondary") + btn("Cancel", "ghost"), "#C9D6F5")}
${confirmCard("pencil", "Move this event?", kv("What", "Dentist") + kv("When", change("Fri 2 Oct, 15:00", "Fri 2 Oct, 16:30")) + kv("Length", "45 minutes, unchanged") + kv("Calendar", "Personal"), note("clock", "You&#39;re free from 15:45 that day, so the new time doesn&#39;t clash.", "blue"), btn("Move it", "primary", "check") + btn("Cancel", "ghost"), "#C9D6F5")}
${confirmCard("trash", "Remove this event?", kv("What", "Dinner at Mum&#39;s") + kv("When", "Saturday 3 October, 18:30 to 21:00") + kv("Calendar", "Personal"), note("warn", "Removing it can&#39;t be undone from Edward. You can restore it from the bin in Google Calendar for 30 days.", "apricot"), btn("Remove", "dangerFill") + btn("Keep it", "secondary"), "#EDBDB8", C.roseInk)}
${confirmCard("users", "This event has guests", kv("What", "Farmers market with Priya") + kv("When", "Saturday 3 October, 10:00 to 11:30") + kv("Guests", "1 other person"), note("shield", "Edward doesn&#39;t change or remove events that other people are invited to, so nobody gets a surprise notice. Change it yourself in Google Calendar.", "grey"), btn("Open in Google Calendar", "secondary", "link"))}`,
});

// ---------------------------------------------------------------- Mail
const mailRow = (from, subject, snip, when, on = false, flag = "") =>
  `<button aria-pressed="${on}" style="display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border: 1px solid ${on ? "#C9D6F5" : "transparent"}; border-radius: 14px; background: ${on ? C.blueSoft : "transparent"}; color: ${C.ink}; text-align: left"><span style="display: flex; justify-content: space-between; gap: 10px"><span style="display: flex; align-items: center; gap: 8px; font-weight: 700"><span style="width: 8px; height: 8px; border-radius: 50%; background: ${C.blue}"></span>${from}</span><span style="font-size: 12.5px; color: ${C.ink3}">${when}</span></span><span style="font-weight: 500">${subject}</span><span style="font-size: 13px; color: ${C.ink2}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${snip}</span>${flag}</button>`;

const mail = shell({
  active: "Mail",
  title: "Mail",
  sub: "Unread in your Primary tab from the last 24 hours",
  actions: iconBtn("refresh", "Check again") + btn("Ask about my mail", "primary", "chat"),
  bodyStyle: "display: grid; grid-template-columns: 400px minmax(0, 1fr); gap: 16px",
  body: `
${card(
  `${mailRow("Sam Carter", "Weekly update", "Hi Alex, the kitchen install has moved to Monday the 12th because", "08:02", true)}
${mailRow("Harbour Water", "Your October bill is ready", "Your bill for the period 1 July to 30 September is now available", "07:15", false, `<span style="margin-top: 4px">${tag("Looks like a bill", "apricot", "bill")}</span>`)}
${mailRow("Priya Nair", "Saturday?", "Still on for the market? I can pick you up at quarter to ten", "Yesterday")}
${mailRow("Northside Dental", "Appointment reminder", "This is a reminder of your appointment on Friday 2 October at", "Yesterday")}
<div style="margin-top: auto">${note("eye", "Edward can read and search your mail and write drafts. It can&#39;t delete, archive or mark anything.")}</div>`,
  "padding: 12px; display: flex; flex-direction: column; gap: 4px",
)}
${card(
  `<div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px">
<div><div style="font-family: ${F.disp}; font-size: 24px; font-weight: 600; letter-spacing: -0.015em">Weekly update</div>${muted("Sam Carter · today 08:02 · 3 messages in this conversation")}</div>
${btn("Open in Gmail", "secondary", "link")}
</div>
<div style="display: flex; flex-direction: column; gap: 12px; font-size: 15px; max-width: 620px; text-wrap: pretty">
<div>Hi Alex,</div>
<div>The kitchen install has moved to Monday the 12th because the benchtop is arriving late. Everything else is on track: cabinets are finished and the tiler is booked for the week after.</div>
<div>I&#39;ve sent the progress invoice separately. Please use reference ${lockChip("reference number")} when you pay it.</div>
<div>Cheers, Sam</div>
</div>
${note("shield", "1 reference number in this email was removed before the model saw it. The original is untouched in Gmail.", "sage")}
<div style="margin-top: auto; display: flex; gap: 8px; flex-wrap: wrap; padding-top: 16px; border-top: 1px solid ${C.line}">${btn("Draft a reply", "primary", "pencil")}${btn("Summarise the conversation", "secondary")}${btn("Add the new date to my calendar", "secondary", "calendar")}</div>`,
  "padding: 24px; display: flex; flex-direction: column; gap: 16px",
)}`,
});

// ---------------------------------------------------------------- Mail: send confirmation
const draftRow = (to, subject, when, on) =>
  `<button aria-pressed="${on}" style="display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border: 1px solid ${on ? "#C9D6F5" : "transparent"}; border-radius: 14px; background: ${on ? C.blueSoft : "transparent"}; color: ${C.ink}; text-align: left"><span style="display: flex; justify-content: space-between; gap: 10px"><span style="font-weight: 600">${subject}</span><span style="font-size: 12.5px; color: ${C.ink3}">${when}</span></span><span style="font-size: 13px; color: ${C.ink2}">To ${to}</span></button>`;

const mailSend = shell({
  active: "Mail",
  title: "Drafts Edward wrote",
  sub: "Nothing is sent until you press Send, every time.",
  bodyStyle: "display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 16px",
  body: `
${card(
  `${label("Waiting for you", "padding: 6px 14px")}
${draftRow("jordan@harbourjoinery.example", "Quote for the pantry shelves", "09:20", true)}
${draftRow("Sam Carter", "Re: Weekly update", "09:12", false)}
<div style="margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 0; text-align: center">
<div style="margin: 0 0 10px">${spot("spot-mail", 150, "A small stack of envelopes tied with string")}</div>
${muted("Only drafts Edward wrote can be sent from here. Your own drafts stay in Gmail.", "padding: 0 12px 8px; text-wrap: pretty")}
</div>`,
  "padding: 12px; display: flex; flex-direction: column; gap: 4px",
)}
<section aria-label="Send this email?" style="box-sizing: border-box; padding: 24px; border: 1px solid #C9D6F5; border-radius: 18px; background: ${C.surface}; box-shadow: ${SHADOW}; display: flex; flex-direction: column; gap: 16px">
<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px">${h2("Send this email?", "font-size: 22px")}${tag("Read again from Gmail a moment ago", "sage", "refresh")}</div>
<div style="display: grid; grid-template-columns: 72px minmax(0, 1fr); row-gap: 8px; font-size: 14px">
${kv("To", "jordan@harbourjoinery.example")}${kv("Subject", "Quote for the pantry shelves")}
</div>
${note("warn", "<strong>You haven&#39;t written to this address before.</strong> Check it letter by letter. Edward found it in Sam&#39;s email from 28 September.", "apricot")}
<div style="position: relative; flex-grow: 1; min-height: 0; overflow: hidden; padding: 18px; border-radius: 14px; background: ${C.bg}; font-size: 14.5px; display: flex; flex-direction: column; gap: 10px; text-wrap: pretty">
<div>Hi Jordan,</div>
<div>Sam Carter passed on your details. We&#39;re fitting out a walk-in pantry and would like a quote for five fixed shelves in white oak, 2.4 metres wide and 400 millimetres deep, with a lip on the front edge.</div>
<div>The kitchen install is booked for Monday 12 October, so ideally the shelves would go in the same week. If it helps, I can send photos and exact measurements of the space, and Sam is happy to talk through how they attach to the wall studs.</div>
<div>Could you let me know roughly what it would cost, how long you&#39;d need, and whether you would install them yourself or leave them for Sam&#39;s team?</div>
<div style="position: absolute; left: 0; right: 0; bottom: 0; height: 70px; background: linear-gradient(180deg, rgba(243,246,250,0) 0%, ${C.bg} 80%)"></div>
</div>
${note("warn", "<strong>412 more characters aren&#39;t shown here.</strong> Open the draft in Gmail to read all of it before sending.", "apricot")}
<div style="display: flex; gap: 8px">${btn("Send", "primary", "send")}${btn("Read all in Gmail", "secondary", "link")}${btn("Don&#39;t send", "ghost")}</div>
</section>`,
});

// ---------------------------------------------------------------- Bills
const stat = (value, what, tone = C.ink) => `<div style="display: flex; flex-direction: column; gap: 2px"><div style="font-family: ${F.disp}; font-size: 30px; font-weight: 600; letter-spacing: -0.02em; color: ${tone}">${value}</div><div style="font-size: 13px; color: ${C.ink2}">${what}</div></div>`;
const payRow = (payee, cat, amount, due, tone, auto = false) =>
  `<div style="display: grid; grid-template-columns: minmax(0, 1fr) 90px 44px; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid ${C.line}"><div style="min-width: 0"><div style="font-weight: 600">${payee}</div><div style="font-size: 12.5px; color: ${tone}; font-weight: ${tone === C.ink2 ? 400 : 600}">${due}${auto ? " · automatic" : ""} · ${cat}</div></div><div style="text-align: right; font-weight: 600">${amount}</div><button aria-label="Mark ${payee} as paid" style="display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border: 1px solid ${C.line}; border-radius: 12px; background: ${C.surface}; color: ${C.ink2}">${ic("check", 17)}</button></div>`;
const paidRow = (payee, when, amount) => `<div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 44px; color: ${C.ink2}"><div style="display: flex; align-items: center; gap: 10px">${ic("check", 16, C.sageInk, 2)}<div><span style="font-weight: 600; color: ${C.ink}">${payee}</span> · ${when}</div></div><div style="font-weight: 600">${amount}</div></div>`;
const newBill = (payee, amount, due, flags, href) =>
  `<div style="display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid ${flags.length ? "#F3C9A6" : C.line}; border-radius: 14px; background: ${C.surface}">
<div style="display: flex; justify-content: space-between; gap: 12px"><div><div style="font-weight: 600">${payee}</div><div style="font-size: 13px; color: ${C.ink2}">${due}</div></div><div style="font-family: ${F.disp}; font-size: 20px; font-weight: 600">${amount}</div></div>
${flags.map((f) => `<div style="display: flex; gap: 8px; color: ${C.apricotInk}; font-size: 13px; font-weight: 500">${ic("warn", 15, "currentColor", 2)}<span>${f}</span></div>`).join("")}
<div style="display: flex; gap: 8px">${btn("Track it", "soft", "check")}<a href="${href}" style="display: inline-flex; align-items: center; min-height: 44px; padding: 0 14px; font-weight: 600; text-decoration: none">Look closer</a>${btn("Not a bill", "ghost")}</div>
</div>`;

const bills = shell({
  active: "Bills",
  title: "Bills",
  sub: "Found in your email. Edward reminds you; paying is yours to do.",
  actions: btn("Check my mail now", "secondary", "refresh") + `<a href="BillsMonth.dc.html" style="display: inline-flex; align-items: center; min-height: 44px; padding: 0 8px; font-weight: 600">October summary</a>`,
  bodyStyle: "display: flex; flex-direction: column; gap: 16px",
  body: `
${card(
  `<div style="display: flex; gap: 56px">
${stat("$410.80", "still to pay in October")}
${stat("Monday", "next one due: Northwind Energy", C.apricotInk)}
${stat("2", "new bills to check")}
</div>
<div style="margin: -14px 8px -14px 0">${spot("spot-bills", 124, "Paper bills on a desk spike beside a dish of coins")}</div>`,
  "padding: 22px 26px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; overflow: hidden",
)}
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; flex-grow: 1; min-height: 0">
<div style="display: flex; flex-direction: column; gap: 12px">
<div style="display: flex; align-items: center; justify-content: space-between">${h2("New, check these")}${tag("Edward tracks nothing until you say so", "blue")}</div>
${newBill("Harbour Water", "$86.50", "Due Friday 23 October · water", [], "BillReview.dc.html")}
${newBill("Northwind Energy Billing", "$1,245.30", "Due Monday 5 October · electricity", ["The payment details differ from this payee&#39;s last bill.", "The amount is five times your usual bill."], "BillReview.dc.html")}
</div>
${card(
  `<div style="display: flex; align-items: center; justify-content: space-between">${h2("To pay")}${muted("Tick one off when you&#39;ve paid it")}</div>
<div style="display: flex; flex-direction: column">
${payRow("Northwind Energy", "electricity", "$245.30", "Due Monday, in 3 days", C.apricotInk)}
${payRow("Fibreline Internet", "internet", "$79.00", "Charged on the 14th", C.ink2, true)}
${payRow("City Council rates", "rates", "$86.50", "Due 30 October", C.ink2)}
</div>
<div style="margin-top: auto; display: flex; flex-direction: column; padding-top: 12px; border-top: 1px solid ${C.line}"><div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 8px">${h2("Paid this month", "font-size: 16px")}<span style="color: ${C.ink2}">2 bills · $131.90</span></div>${paidRow("Harbour Water", "Paid 1 October", "$86.50")}${paidRow("Tasman Mobile", "Charged 1 October · automatic", "$45.40")}</div>`,
  "padding: 20px; display: flex; flex-direction: column; gap: 6px",
)}
</div>
${note("lock", "Edward never pays, never signs in to a bank, and keeps no account, card or reference numbers, not even part of one. To pay, open the bill in your own banking app.")}`,
});

// ---------------------------------------------------------------- Bill review
const field = (id, name, value, w = "") =>
  `<div style="display: flex; flex-direction: column; gap: 4px; ${w}"><label for="${id}" style="font-size: 12.5px; font-weight: 600; color: ${C.ink2}">${name}</label><input id="${id}" type="text" value="${value}" style="box-sizing: border-box; width: 100%; min-height: 44px; padding: 0 12px; border: 1px solid ${C.line}; border-radius: 12px; background: ${C.surface}; color: ${C.ink}; font: inherit; font-weight: 500"></div>`;
const checkRow = (ok, text) => `<div style="display: flex; gap: 10px; align-items: flex-start; font-size: 13.5px; color: ${ok ? C.ink : C.apricotInk}; font-weight: ${ok ? 400 : 600}">${ic(ok ? "check" : "warn", 17, ok ? C.sageInk : C.apricotInk, 2)}<span>${text}</span></div>`;

const billReview = shell({
  active: "Bills",
  title: "Check this bill",
  sub: "1 of 2 new bills",
  actions: `<a href="Bills.dc.html" style="display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 8px; font-weight: 600; text-decoration: none">${ic("left", 16)}All bills</a>`,
  bodyStyle: "display: grid; grid-template-columns: minmax(0, 1fr) 440px; gap: 16px",
  body: `
${card(
  `<div style="display: flex; align-items: center; justify-content: space-between">${label("The email it came from")}${btn("Open in Gmail", "secondary", "link")}</div>
<div><div style="font-family: ${F.disp}; font-size: 20px; font-weight: 600">Your electricity bill is ready</div>${muted("Northwind Energy Billing · billing@northwind-energy-pay.example · today 06:40")}</div>
<div style="display: flex; flex-direction: column; gap: 10px; padding: 18px; border-radius: 14px; background: ${C.bg}; font-size: 14.5px; text-wrap: pretty">
<div>Dear customer,</div>
<div>Your bill for 1 July to 30 September is <mark style="padding: 0 4px; border-radius: 4px; background: #FBE3A8; color: ${C.ink}">$1,245.30</mark>, due <mark style="padding: 0 4px; border-radius: 4px; background: #FBE3A8; color: ${C.ink}">5 October 2026</mark>.</div>
<div>Our bank details have changed. Please pay to BSB and account ${lockChip("bank account")} and quote ${lockChip("reference number")}.</div>
<div>Pay within 24 hours to avoid disconnection.</div>
</div>
${note("shield", "2 numbers in this email were removed before the model saw it, and are not kept anywhere by Edward.", "sage")}
<div style="display: flex; flex-direction: column; gap: 10px; padding: 16px 18px; border: 1px solid ${C.line}; border-radius: 14px">${label("Northwind Energy&#39;s earlier bills")}<div style="display: grid; grid-template-columns: 120px minmax(0, 1fr); row-gap: 6px; font-size: 13.5px">${kv("Usual amount", "$230 to $260, every three months")}${kv("Sent from", "bills@northwindenergy.example")}${kv("Last one", "$245.30, tracked 2 October")}</div></div>
<div style="margin-top: auto">${note("lock", "How you pay is up to you. Edward will not show, store or act on the payment details in an email.")}</div>`,
  "padding: 22px; display: flex; flex-direction: column; gap: 14px",
)}
<div style="display: flex; flex-direction: column; gap: 16px">
${card(
  `<div style="display: flex; align-items: center; gap: 10px; color: ${C.apricotInk}">${ic("warn", 20, "currentColor", 2)}${h2("Take care with this one", `color: ${C.apricotInk}`)}</div>
<div style="display: flex; flex-direction: column; gap: 10px">
${checkRow(true, "The amount and due date really are in the email.")}
${checkRow(false, "The payment details differ from this payee&#39;s last bill. Edward compared them in memory and kept neither.")}
${checkRow(false, "Sent from a different address than Northwind Energy&#39;s earlier bills.")}
${checkRow(false, "The amount is five times your usual bill.")}
${checkRow(false, "The email pushes you to pay within 24 hours.")}
</div>
${muted("If in doubt, call the company on a number you already have, not one from this email.", "text-wrap: pretty")}`,
  "padding: 20px; display: flex; flex-direction: column; gap: 14px; border-color: #F3C9A6",
)}
${card(
  `${h2("What Edward read")}
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px">
${field("payee", "Payee", "Northwind Energy Billing", "grid-column: span 2")}
${field("amount", "Amount", "$1,245.30")}
${field("due", "Due", "5 October 2026")}
</div>
<div style="margin-top: auto; display: flex; gap: 8px; flex-wrap: wrap">${btn("Not a bill, ignore it", "secondary")}${btn("Track it anyway", "ghost")}</div>`,
  "padding: 20px; display: flex; flex-direction: column; gap: 14px; flex-grow: 1",
)}
</div>`,
});

// ---------------------------------------------------------------- Bills: month and settings
const bar = (name, amount, pct, color) =>
  `<div style="display: grid; grid-template-columns: 110px minmax(0, 1fr) 80px; align-items: center; gap: 12px"><div>${name}</div><div style="height: 12px; border-radius: 999px; background: ${C.soft}"><div style="width: ${pct}%; height: 12px; border-radius: 999px; background: ${color}"></div></div><div style="text-align: right; font-weight: 600">${amount}</div></div>`;
const tr = (payee, cat, due, amount, state) =>
  `<div style="display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 90px 90px 80px; gap: 10px; align-items: center; min-height: 44px; border-top: 1px solid ${C.line}; font-size: 13.5px"><div style="font-weight: 600">${payee}</div><div style="color: ${C.ink2}">${cat}</div><div style="color: ${C.ink2}">${due}</div><div style="text-align: right; font-weight: 600">${amount}</div><div style="text-align: right">${state}</div></div>`;
const setting = (name, help, control) => `<div style="display: flex; flex-direction: column; gap: 8px"><div><div style="font-weight: 600">${name}</div><div style="font-size: 13px; color: ${C.ink2}; text-wrap: pretty">${help}</div></div>${control}</div>`;
const pick = (text, on) => `<button aria-pressed="${on}" style="min-height: 44px; padding: 0 14px; border: 1px solid ${on ? C.blue : C.line}; border-radius: 999px; background: ${on ? C.blueSoft : C.surface}; color: ${on ? C.blueInk : C.ink2}; font-weight: 600; font-size: 13px">${text}</button>`;

const billsMonth = shell({
  active: "Bills",
  title: "October 2026",
  sub: "Bills this month",
  actions: iconBtn("left", "Previous month") + iconBtn("right", "Next month") + btn("Export as CSV", "secondary", "download"),
  bodyStyle: "display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px",
  body: `
${card(
  `<div style="display: flex; align-items: baseline; gap: 14px"><div style="font-family: ${F.disp}; font-size: 40px; font-weight: 600; letter-spacing: -0.025em">$542.70</div><div style="color: ${C.ink2}">across 5 bills · $131.90 paid, $410.80 to go</div></div>
<div style="display: flex; flex-direction: column; gap: 10px">
${bar("Electricity", "$245.30", 100, C.blue)}
${bar("Rates", "$86.50", 35, "#6C8BE0")}
${bar("Water", "$86.50", 35, "#6C8BE0")}
${bar("Internet", "$79.00", 32, "#9DB3EC")}
${bar("Phone", "$45.40", 19, "#9DB3EC")}
</div>
<div style="display: flex; flex-direction: column">
<div style="display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 90px 90px 80px; gap: 10px; padding-bottom: 6px; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: ${C.ink3}"><div>Payee</div><div>Kind</div><div>Due</div><div style="text-align: right">Amount</div><div style="text-align: right">Status</div></div>
${tr("Northwind Energy", "Electricity", "5 Oct", "$245.30", tag("To pay", "apricot"))}
${tr("Fibreline Internet", "Internet · automatic", "14 Oct", "$79.00", tag("To pay", "grey"))}
${tr("City Council rates", "Rates", "30 Oct", "$86.50", tag("To pay", "grey"))}
${tr("Harbour Water", "Water", "1 Oct", "$86.50", tag("Paid", "sage"))}
${tr("Tasman Mobile", "Phone · automatic", "1 Oct", "$45.40", tag("Paid", "sage"))}
</div>`,
  "padding: 24px; display: flex; flex-direction: column; gap: 22px",
)}
${card(
  `${h2("How bills work")}
${setting("Look for bills", "Edward checks your mail on the first start each day.", segmented(["Every day", "Only when I ask"], "Every day", "Look for bills"))}
${setting("New bills", "Ask about every new bill, or track bills from payees you&#39;ve confirmed before.", segmented(["Always ask me", "Trust known payees"], "Always ask me", "New bills"))}
${setting("Remind me", "At 09:00, also when Edward is closed.", `<div style="display: flex; gap: 8px; flex-wrap: wrap">${pick("7 days before", false)}${pick("3 days before", true)}${pick("1 day before", false)}${pick("On the day", true)}${pick("Never", false)}</div>`)}
<div style="margin-top: auto; display: flex; flex-direction: column; gap: 8px; padding-top: 14px; border-top: 1px solid ${C.line}">${btn("Forget all bills", "danger", "trash")}${muted("Removes the list from this computer. Your email isn&#39;t touched.")}</div>`,
  "padding: 22px; display: flex; flex-direction: column; gap: 18px",
)}`,
});

// ---------------------------------------------------------------- Reminders
const rem = (when, text, sub, actions, tone = C.blueInk, bg = C.bg) =>
  `<div style="display: flex; align-items: center; gap: 14px; padding: 10px 10px 10px 16px; border-radius: 14px; background: ${bg}"><div style="width: 86px; flex-shrink: 0; font-weight: 600; color: ${tone}">${when}</div><div style="flex-grow: 1; min-width: 0"><div style="font-weight: 600">${text}</div>${sub ? `<div style="font-size: 13px; color: ${C.ink2}">${sub}</div>` : ""}</div><div style="display: flex; gap: 6px">${actions}</div></div>`;
const small = (text, kind = "secondary") => `<button style="min-height: 44px; padding: 0 12px; border: 1px solid ${kind === "primary" ? C.blue : C.line}; border-radius: 12px; background: ${kind === "primary" ? C.blue : C.surface}; color: ${kind === "primary" ? "#FFFFFF" : C.ink}; font-weight: 600; font-size: 13px">${text}</button>`;

const reminders = shell({
  active: "Reminders",
  title: "Reminders",
  sub: "Set one by just asking, in any conversation",
  bodyStyle: "display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px",
  body: `
${card(
  `<div style="display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 16px; border: 1px solid ${C.line}; border-radius: 16px; background: ${C.surface}">${ic("bell", 18, C.ink3)}<label for="rem" style="${sr}">New reminder</label><input id="rem" type="text" placeholder="Remind me tomorrow at 9 to water the plants" style="flex-grow: 1; min-width: 0; min-height: 44px; border: 0; outline: 0; background: transparent; font: inherit; font-size: 15px; color: ${C.ink}">${btn("Add", "primary")}</div>
<div style="display: flex; flex-direction: column; gap: 8px">
${label("Ringing now")}
${rem("12:30", "Call the dentist to confirm", "5 minutes ago", small("Done", "primary") + small("10 min") + small("1 hour"), C.apricotInk, C.apricotSoft)}
</div>
<div style="display: flex; flex-direction: column; gap: 8px">
${label("Later today")}
${rem("17:00", "Submit expenses", "Repeats every month on the 2nd", iconBtn("check", "Done") + iconBtn("x", "Cancel"))}
</div>
<div style="display: flex; flex-direction: column; gap: 8px">
${label("Coming up")}
${rem("Sat 09:00", "Water the plants", "", iconBtn("check", "Done") + iconBtn("x", "Cancel"))}
${rem("Mon 09:00", "Northwind Energy bill is due", "From Bills", iconBtn("right", "Open the bill"))}
${rem("15 Oct", "Renew the car registration", "Repeats every year", iconBtn("check", "Done") + iconBtn("x", "Cancel"))}
</div>`,
  "padding: 20px; display: flex; flex-direction: column; gap: 18px",
)}
<div style="display: flex; flex-direction: column; gap: 16px">
${card(
  `<div style="display: flex; justify-content: center">${spot("spot-reminder", 150, "A bedside alarm clock and a pad of sticky notes")}</div>
<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px">${h2("When Edward is closed")}${toggle(true, "Reminders when Edward is closed")}</div>
${muted("A small Windows task checks every minute and shows a notification. Last ran 20 seconds ago.", "text-wrap: pretty")}`,
  "padding: 20px; display: flex; flex-direction: column; gap: 10px",
)}
${card(
  `${h2("Morning brief")}
${muted("Events, reminders, bills and mail in one notification.")}
<div style="display: grid; grid-template-columns: 70px minmax(0, 1fr); row-gap: 8px; align-items: center; font-size: 14px">${kv("Time", `<strong>08:30</strong>`)}${kv("Days", segmented(["Weekdays", "Daily", "Off"], "Weekdays", "Brief days"))}</div>`,
  "padding: 20px; display: flex; flex-direction: column; gap: 10px; flex-grow: 1",
)}
</div>`,
});

// ---------------------------------------------------------------- Memory
const mem = (text, kind, when) =>
  `<div style="display: flex; align-items: center; gap: 12px; padding: 6px 6px 6px 16px; border-radius: 14px; background: ${C.bg}"><div style="flex-grow: 1; min-width: 0"><div style="font-weight: 500">${text}</div><div style="font-size: 12.5px; color: ${C.ink2}">${kind} · ${when}</div></div>${iconBtn("pencil", "Edit")}${iconBtn("trash", "Forget")}</div>`;

const memory = shell({
  active: "Memory",
  title: "Memory",
  sub: "What Edward remembers about you, kept on this computer",
  actions: btn("Undo last change", "secondary", "history") + btn("Export", "secondary", "download"),
  bodyStyle: "display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 16px",
  body: `
${card(
  `<div style="display: flex; gap: 8px">
<div style="flex-grow: 1; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 14px; border-radius: 12px; background: ${C.bg}; color: ${C.ink3}">${ic("search", 16)}<label for="mq" style="${sr}">Search memory</label><input id="mq" type="text" placeholder="Search what Edward remembers" style="flex-grow: 1; min-width: 0; min-height: 40px; border: 0; outline: 0; background: transparent; font: inherit; color: ${C.ink}"></div>
${btn("Add something", "primary", "plus")}
</div>
<div style="padding: 16px 18px; border-radius: 14px; background: ${C.blueSoft}; color: ${C.ink}">
${label("In short", `color: ${C.blueInk}`)}
<div style="font-size: 15px; text-wrap: pretty">You live in Sydney and work weekdays, with a stand-up at 09:30. You&#39;re renovating the kitchen with Sam Carter. You prefer short answers and morning appointments.</div>
</div>
<div style="display: flex; flex-direction: column; gap: 8px">
${mem("Prefers appointments before noon", "Preference", "learned 24 Sep")}
${mem("Sam Carter is the builder for the kitchen renovation", "Person", "you said so, 18 Sep")}
${mem("Dentist is Northside Dental", "Place", "learned 12 Sep")}
${mem("Mum&#39;s birthday is 14 November", "Date", "you said so, 2 Sep")}
${mem("Vegetarian on weekdays", "Preference", "learned 30 Aug")}
</div>`,
  "padding: 20px; display: flex; flex-direction: column; gap: 14px",
)}
<div style="display: flex; flex-direction: column; gap: 16px">
${card(
  `<div style="display: flex; align-items: center; justify-content: space-between; gap: 10px">${h2("Learn from conversations")}${toggle(true, "Learn from conversations")}</div>
${muted("After a conversation Edward notes things worth keeping and asks you here before they count.", "text-wrap: pretty")}
<div style="display: flex; flex-direction: column; gap: 8px">
${label("To review · 2")}
<div style="display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border: 1px solid ${C.line}; border-radius: 14px"><div style="font-weight: 500">Kitchen install is on Monday 12 October</div><div style="display: flex; gap: 6px">${small("Keep", "primary")}${small("Don&#39;t keep")}</div></div>
<div style="display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border: 1px solid ${C.line}; border-radius: 14px"><div style="font-weight: 500">Priya drives to the market on Saturdays</div><div style="display: flex; gap: 6px">${small("Keep", "primary")}${small("Don&#39;t keep")}</div></div>
</div>`,
  "padding: 20px; display: flex; flex-direction: column; gap: 12px",
)}
${card(
  `<div style="display: flex; align-items: center; gap: 4px"><div style="margin: 0 16px 0 0">${spot("spot-memory", 100, "An open notebook with a pressed leaf")}</div><div>${h2("Never in here", "font-size: 16px")}${muted("Account, card and ID numbers and passwords. If you ask Edward to remember one, it refuses.", "text-wrap: pretty")}</div></div>`,
  "padding: 18px 20px; flex-grow: 1; display: flex; align-items: center; overflow: hidden",
)}
</div>`,
});

// ---------------------------------------------------------------- Pictures
const tile = (name, alt, on = false) =>
  `<button aria-pressed="${on}" aria-label="${alt}" style="padding: 0; border: 0; border-radius: 16px; background: transparent; overflow: hidden; box-shadow: ${on ? `0 0 0 3px ${C.blue}` : SHADOW}"><img src="${asset(name)}" alt="" style="width: 100%; aspect-ratio: 1 / 1; object-fit: cover"></button>`;

const picturesBoard = shell({
  active: "Pictures",
  title: "Pictures",
  sub: "Everything Edward has made for you",
  actions: btn("Open the folder", "secondary", "folder"),
  bodyStyle: "display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 16px",
  body: `
<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; align-content: start">
${tile("sample-cake", "Birthday cake, coloured pencil", true)}${tile("sample-fox", "A fox asleep in snow")}${tile("sample-house", "A tiny house on a floating island")}
${tile("sample-poster", "A retro harbour poster")}${tile("hero-garden", "A garden gate in morning light")}${tile("hero-evening", "A study at dusk")}
<div style="grid-column: span 3; display: flex; align-items: center; gap: 4px; padding: 0 16px 0 0; border: 1px dashed #B8C1D1; border-radius: 16px; overflow: hidden"><div style="margin: 10px 16px">${spot("spot-paints", 84, "A watercolour tin and a jar of brushes")}</div><div><div style="font-weight: 600">Ask for a picture in any conversation</div>${muted("&ldquo;Draw a fox asleep in the snow&rdquo; · &ldquo;Make this photo look like a watercolour&rdquo;")}</div></div>
</div>
${card(
  `<img src="${asset("sample-cake")}" alt="A coloured-pencil drawing of a birthday cake with candles" style="width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 14px">
<div><div style="font-weight: 600">Number 12 · today 08:41</div>${muted("&ldquo;Draw a cheerful birthday cake for Mia&#39;s card, coloured pencil style&rdquo;", "text-wrap: pretty")}</div>
<div style="display: flex; gap: 8px">${btn("Open", "primary", "eye")}${btn("Copy", "secondary", "copy")}${btn("Show in folder", "secondary", "folder")}</div>
<div style="margin-top: auto; display: flex; flex-direction: column; gap: 4px; padding-top: 12px; border-top: 1px solid ${C.line}">
<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px"><div><div style="font-weight: 600">Open pictures when they&#39;re made</div></div>${toggle(true, "Open pictures when they are made")}</div>
<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px"><div style="min-width: 0"><div style="font-weight: 600">Saved in</div><div style="font-family: ${F.mono}; font-size: 12.5px; color: ${C.ink2}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">Pictures\\Edward</div></div>${btn("Change", "secondary")}</div>
</div>`,
  "padding: 16px; display: flex; flex-direction: column; gap: 12px",
)}`,
});

export default [
  { file: "Calendar.dc.html", title: "Calendar", row: 1, markup: calendar },
  { file: "CalendarChanges.dc.html", title: "Calendar · add, move, remove, guests", row: 1, markup: calendarChanges },
  { file: "Mail.dc.html", title: "Mail · unread and reading", row: 1, markup: mail },
  { file: "MailSend.dc.html", title: "Mail · send confirmation", row: 1, markup: mailSend },
  { file: "Bills.dc.html", title: "Bills", row: 1, markup: bills },
  { file: "BillReview.dc.html", title: "Bills · checking a new bill", row: 1, markup: billReview },
  { file: "BillsMonth.dc.html", title: "Bills · month summary and settings", row: 1, markup: billsMonth },
  { file: "Reminders.dc.html", title: "Reminders and morning brief", row: 1, markup: reminders },
  { file: "Memory.dc.html", title: "Memory", row: 1, markup: memory },
  { file: "Pictures.dc.html", title: "Pictures", row: 1, markup: picturesBoard },
];
