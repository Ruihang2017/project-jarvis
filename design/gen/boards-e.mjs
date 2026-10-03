// Additions after the direction was approved (D29): Today in the evening.
import { C, F, SHADOW, asset, card, composer, h2, ic, muted, shell } from "./lib.mjs";

const cardHead = (icon, title) =>
  `<div style="display: flex; align-items: center; gap: 10px"><span style="display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 10px; background: ${C.blueSoft}; color: ${C.blueInk}">${ic(icon, 17)}</span>${h2(title, "font-size: 16px")}</div>`;
const line = (time, title, sub = "") =>
  `<div style="display: flex; gap: 12px; align-items: baseline"><div style="width: 46px; flex-shrink: 0; font-size: 13px; font-weight: 600; color: ${C.blueInk}">${time}</div><div><div style="font-weight: 500">${title}</div>${sub ? `<div style="font-size: 12.5px; color: ${C.ink2}">${sub}</div>` : ""}</div></div>`;

// The brief's picture follows the time of day: morning light until the afternoon, the lamp-lit study after dark.
const evening = shell({
  active: "Today",
  title: "Today",
  sub: "Friday 2 October, evening",
  bodyStyle: "display: flex; flex-direction: column; gap: 16px",
  body: `
<section aria-label="Evening brief" style="position: relative; height: 330px; flex-shrink: 0; border-radius: 24px; overflow: hidden; box-shadow: ${SHADOW}; background: #131B33">
<img src="${asset("hero-evening")}" alt="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 45%">
<div style="position: absolute; inset: 0; background: linear-gradient(270deg, rgba(14,20,40,0.82) 0%, rgba(14,20,40,0.55) 38%, rgba(14,20,40,0) 64%)"></div>
<div style="position: relative; height: 100%; box-sizing: border-box; margin-left: auto; padding: 30px 40px; display: flex; flex-direction: column; justify-content: center; gap: 10px; max-width: 500px; color: #FFFFFF">
<div style="font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #C9D4F2">Today at a glance · 19:30</div>
<div style="font-family: ${F.disp}; font-size: 40px; font-weight: 600; line-height: 1.08; letter-spacing: -0.025em">Good evening, Alex.</div>
<div style="font-size: 16px; color: #E3E9F8; text-wrap: pretty">Nothing else needs you tonight. Tomorrow starts with the farmers market at 10:00.</div>
</div>
</section>

<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; flex-grow: 1; min-height: 0">
${card(
  `${cardHead("calendar", "Tomorrow")}
<div style="display: flex; flex-direction: column; gap: 12px">${line("10:00", "Farmers market with Priya", "Harbour Square")}${line("18:30", "Dinner at Mum&#39;s")}</div>`,
  "padding: 18px; display: flex; flex-direction: column; gap: 14px",
)}
${card(
  `${cardHead("bill", "Coming up")}
<div style="display: flex; justify-content: space-between; gap: 10px"><div><div style="font-weight: 500">Northwind Energy</div><div style="font-size: 12.5px; color: ${C.apricotInk}; font-weight: 600">Due Monday</div></div><div style="font-weight: 600">$245.30</div></div>
<div style="margin-top: auto">${muted("Jarvis reminds you on Monday at 09:00.")}</div>`,
  "padding: 18px; display: flex; flex-direction: column; gap: 14px",
)}
${card(
  `${cardHead("moon", "While you sleep")}
${muted("Reminders and the morning brief still arrive when Jarvis is closed. The next one is the brief at 08:30, Monday.", "text-wrap: pretty")}`,
  "padding: 18px; display: flex; flex-direction: column; gap: 14px",
)}
</div>
<div style="flex-shrink: 0">${composer({ placeholder: "Ask Jarvis anything, or tell it what to do" })}</div>`,
});

// ---------------------------------------------------------------- Name and icon candidates
const ICONS = [
  ["icon-house", "House with a lit window", "Clearest at small sizes"],
  ["icon-bell", "Service bell", "The butler&#39;s bell"],
  ["icon-lantern", "Lantern", "Keeps watch at night"],
  ["icon-key", "Key", "Thin at 32 px"],
  ["icon-sunrise", "Round window at sunrise", "Turns into a ring when tiny"],
  ["icon-wren", "Wren", "Low contrast when tiny"],
];
const iconCard = ([name, what, note]) =>
  card(
    `<img src="${asset(name)}" alt="${what}" style="width: 132px; height: 132px; border-radius: 30px; box-shadow: 0 2px 8px rgba(26,34,54,0.18)">
<div style="display: flex; align-items: flex-end; gap: 12px"><img src="${asset(name)}" alt="" style="width: 48px; height: 48px; border-radius: 11px"><img src="${asset(name)}" alt="" style="width: 32px; height: 32px; border-radius: 7px"><img src="${asset(name)}" alt="" style="width: 16px; height: 16px; border-radius: 4px"></div>
<div><div style="font-weight: 600">${what}</div>${muted(note)}</div>`,
    "padding: 18px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center",
  );
const nameRow = (name, icon, meaning, risk, tone) =>
  `<div style="display: grid; grid-template-columns: 56px 150px minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: center; padding: 12px 0; border-top: 1px solid ${C.line}">
<img src="${asset(icon)}" alt="" style="width: 48px; height: 48px; border-radius: 11px">
<div style="font-family: ${F.disp}; font-size: 24px; font-weight: 600; letter-spacing: -0.02em">${name}</div>
<div style="font-size: 13.5px; text-wrap: pretty">${meaning}</div>
<div style="font-size: 13px; color: ${tone}; text-wrap: pretty">${risk}</div>
</div>`;

const nameIcon = `<div class="wash" style="width: 1360px; height: 770px; box-sizing: border-box; padding: 36px 44px; overflow: hidden; background-color: ${C.bg}; color: ${C.ink}; font-family: ${F.body}; font-size: 14px; line-height: 1.5; display: flex; flex-direction: column; gap: 20px">
<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 20px"><div style="font-family: ${F.disp}; font-size: 36px; font-weight: 600; letter-spacing: -0.025em">A new name and icon</div>${muted("Painted with Codex in the same watercolour as the rest. Shown at 132, 48, 32 and 16 px.")}</div>
<div style="display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 14px">${ICONS.map(iconCard).join("")}</div>
${card(
  `${h2("Names that fit")}
${nameRow("Lamplight", "icon-lantern", "A lamp left on for you. Fits the evening picture and the way it keeps watch while closed.", "No assistant app found by that name. A UK charity database is called Lamplight. npm name free.", C.sageInk)}
${nameRow("Bellamy", "icon-bell", "Sounds like a trusted butler, and carries the bell: you ring, it comes.", "Bellamy.ai is a recruitment AI agent in Paris. npm name taken.", C.apricotInk)}
${nameRow("Hob", "icon-house", "In English folklore, a hob is the small house spirit that quietly does the chores at night.", "In Australia a hob is also a cooktop. Short and memorable. npm name taken.", C.apricotInk)}
<div style="padding-top: 10px; border-top: 1px solid ${C.line}; font-size: 13px; color: ${C.ink2}"><strong style="color: ${C.ink}">Ruled out</strong>, each already names an assistant or family-calendar product: Morrow, Wren, Hearth, Tilly.</div>`,
  "padding: 20px 24px; display: flex; flex-direction: column",
)}
</div>`;

export default [
  { file: "MainEvening.dc.html", title: "Today · evening", row: 0, pos: 0.5, markup: evening },
  { file: "NameIcon.dc.html", title: "Name and icon candidates", row: 5, pos: 0.5, markup: nameIcon, fixed: true, h: 770 },
];
