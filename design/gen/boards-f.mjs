// Icon candidates for the name the owner picked, Echo (D30).
import { C, F, asset, card, muted } from "./lib.mjs";

const ICONS = [
  ["echo-moon-lake", "Moon and its reflection", "Two bright shapes on navy: the clearest when tiny"],
  ["echo-house-lake", "House and its reflection", "The lit house from round one, echoed in a still lake"],
  ["echo-songbird", "Songbird", "A robin calling out; the orange reads at once"],
  ["echo-ripples", "Drop and ripples", "At 32 px the ripples fade and it becomes a drop"],
  ["echo-shell", "Seashell", "Hold it to your ear; low contrast when tiny"],
  ["echo-hills", "Sun between two hills", "Flatter than the rest; the idea gets lost when tiny"],
];

// Each candidate as the app would show it: large, at taskbar sizes, and next to the name in the sidebar.
const cell = ([name, what, note]) =>
  card(
    `<img src="${asset(name)}" alt="${what}" style="width: 136px; height: 136px; border-radius: 31px; box-shadow: 0 2px 8px rgba(26,34,54,0.18)">
<div style="display: flex; align-items: flex-end; gap: 12px"><img src="${asset(name)}" alt="" style="width: 48px; height: 48px; border-radius: 11px"><img src="${asset(name)}" alt="" style="width: 32px; height: 32px; border-radius: 7px"><img src="${asset(name)}" alt="" style="width: 16px; height: 16px; border-radius: 4px"></div>
<div style="display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-radius: 12px; background: ${C.bg}"><img src="${asset(name)}" alt="" style="width: 34px; height: 34px; border-radius: 10px"><span style="font-family: ${F.disp}; font-size: 20px; font-weight: 700; letter-spacing: -0.02em">Echo</span></div>
<div><div style="font-weight: 600">${what}</div>${muted(note, "text-wrap: pretty")}</div>`,
    "padding: 18px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center",
  );

const board = `<div class="wash" style="width: 1360px; height: 540px; box-sizing: border-box; padding: 36px 44px; overflow: hidden; background-color: ${C.bg}; color: ${C.ink}; font-family: ${F.body}; font-size: 14px; line-height: 1.5; display: flex; flex-direction: column; gap: 20px">
<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 20px"><div style="font-family: ${F.disp}; font-size: 36px; font-weight: 600; letter-spacing: -0.025em">Icons for Echo</div>${muted("Second round, painted with Codex. Ordered by how well each reads at 32 px.")}</div>
<div style="display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 14px">${ICONS.map(cell).join("")}</div>
</div>`;

export default [{ file: "EchoIcons.dc.html", title: "Icons for Echo", row: 5, pos: 0.6, markup: board, fixed: true, h: 540 }];
