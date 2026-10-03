// Icon options for the name Edward (D31), after the owner's reference: teal, concentric ripples, a bold wordmark.
import { C, F, asset, card, muted } from "./lib.mjs";

const LETTER = [
  ["ed-paint-e", "Teal, painted E", "Letter painted by Codex. Closest to your reference"],
  ["ed-apricot-e", "Apricot, set E", "Navy letter on morning colours"],
  ["ed-teal-e", "Teal, set E", "Type set over a painted background"],
  ["ed-navy-e", "Navy, set E", "Evening colours; the gold rings compete a little"],
];
const WORD = [
  ["ed-paint-word", "Teal, painted EDWARD"],
  ["ed-teal-word", "Teal, set EDWARD"],
  ["ed-apricot-word", "Apricot, set EDWARD"],
  ["ed-navy-word", "Navy, set EDWARD"],
];

const sizes = (name) =>
  `<div style="display: flex; align-items: flex-end; gap: 12px"><img src="${asset(name)}" alt="" style="width: 48px; height: 48px; border-radius: 11px"><img src="${asset(name)}" alt="" style="width: 32px; height: 32px; border-radius: 7px"><img src="${asset(name)}" alt="" style="width: 16px; height: 16px; border-radius: 4px"></div>`;
const lockup = (name) =>
  `<div style="display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-radius: 12px; background: ${C.bg}"><img src="${asset(name)}" alt="" style="width: 34px; height: 34px; border-radius: 10px"><span style="font-family: ${F.disp}; font-size: 20px; font-weight: 700; letter-spacing: -0.02em">Edward</span></div>`;

const letterCell = ([name, what, note]) =>
  card(
    `<img src="${asset(name)}" alt="${what}" style="width: 150px; height: 150px; border-radius: 34px; box-shadow: 0 2px 8px rgba(26,34,54,0.18)">${sizes(name)}${lockup(name)}<div><div style="font-weight: 600">${what}</div>${muted(note, "text-wrap: pretty")}</div>`,
    "padding: 18px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center",
  );
const wordCell = ([name, what]) =>
  card(
    `<img src="${asset(name)}" alt="${what}" style="width: 150px; height: 150px; border-radius: 34px; box-shadow: 0 2px 8px rgba(26,34,54,0.18)">${sizes(name)}<div style="font-weight: 600">${what}</div>`,
    "padding: 18px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center",
  );

const board = `<div class="wash" style="width: 1360px; height: 1060px; box-sizing: border-box; padding: 36px 44px; overflow: hidden; background-color: ${C.bg}; color: ${C.ink}; font-family: ${F.body}; font-size: 14px; line-height: 1.5; display: flex; flex-direction: column; gap: 18px">
<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 20px"><div style="font-family: ${F.disp}; font-size: 36px; font-weight: 600; letter-spacing: -0.025em">Icons for Edward</div>${muted("After your reference, painted in watercolour. Shown at 150, 48, 32 and 16 px.")}</div>
<div style="font-weight: 600">A single E: reads at every size</div>
<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px">${LETTER.map(letterCell).join("")}</div>
<div style="display: flex; align-items: baseline; gap: 12px"><span style="font-weight: 600">The whole name: for large places only</span>${muted("At 32 px six letters become texture. Pair one with an E icon: the name on the splash screen and installer, the E in the taskbar.")}</div>
<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px">${WORD.map(wordCell).join("")}</div>
</div>`;

// ---------------------------------------------------------------- The chosen identity (D32)
const use = (where, what) => `<div style="display: flex; gap: 10px; font-size: 13.5px"><span style="width: 150px; flex-shrink: 0; font-weight: 600">${where}</span><span style="color: ${C.ink2}">${what}</span></div>`;

const identity = `<div class="wash" style="width: 1360px; height: 860px; box-sizing: border-box; padding: 36px 44px; overflow: hidden; background-color: ${C.bg}; color: ${C.ink}; font-family: ${F.body}; font-size: 14px; line-height: 1.5; display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 24px">
<div style="display: flex; flex-direction: column; gap: 16px">
<div><div style="font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: ${C.ink3}">The chosen identity</div><div style="font-family: ${F.disp}; font-size: 44px; font-weight: 600; line-height: 1.02; letter-spacing: -0.03em">Edward</div>${muted("Night-blue watercolour ripples with gold light, set in Bahnschrift Bold.")}</div>
${card(
  `<img src="${asset("ed-navy-e")}" alt="Edward icon: a white E on night-blue ripples" style="width: 180px; height: 180px; border-radius: 40px; box-shadow: 0 2px 10px rgba(26,34,54,0.22)">${sizes("ed-navy-e")}${lockup("ed-navy-e")}`,
  "padding: 22px; display: flex; flex-direction: column; align-items: center; gap: 14px",
)}
${card(
  `${use("Taskbar, tray, window", "The E icon")}${use("Sidebar", "The E icon with the name set beside it")}${use("Installer, splash", "The banner")}${use("About, website", "The square with the full name")}`,
  "padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; flex-grow: 1",
)}
</div>
<div style="display: flex; flex-direction: column; gap: 16px; min-width: 0">
<img src="${asset("ed-navy-banner")}" alt="The name EDWARD across night-blue ripples" style="width: 100%; height: 420px; object-fit: cover; border-radius: 24px; box-shadow: 0 2px 10px rgba(26,34,54,0.22)">
<div style="display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; flex-grow: 1; min-height: 0">
<img src="${asset("ed-navy-word-calm")}" alt="Square icon with the full name EDWARD" style="width: 300px; height: 300px; border-radius: 66px; box-shadow: 0 2px 10px rgba(26,34,54,0.22)">
${card(
  `<div style="font-weight: 600">The full name, square</div>${muted("A calmer background than the first try, with the rings pushed to the edges so the six letters stay clear. Still for large sizes only: at 32 px use the E.", "text-wrap: pretty")}<div style="display: flex; align-items: flex-end; gap: 12px; margin-top: auto"><img src="${asset("ed-navy-word-calm")}" alt="" style="width: 96px; height: 96px; border-radius: 22px"><img src="${asset("ed-navy-word-calm")}" alt="" style="width: 64px; height: 64px; border-radius: 14px"><img src="${asset("ed-navy-word-calm")}" alt="" style="width: 32px; height: 32px; border-radius: 7px"></div>`,
  "padding: 20px; display: flex; flex-direction: column; gap: 10px",
)}
</div>
</div>
</div>`;

export default [
  { file: "EdwardIcons.dc.html", title: "Icons for Edward", row: 5, pos: 0.7, markup: board, fixed: true, h: 1060 },
  { file: "EdwardIdentity.dc.html", title: "Edward · chosen icon and name", row: 5, pos: 0.4, markup: identity, fixed: true },
];
