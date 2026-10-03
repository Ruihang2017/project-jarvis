// Shared tokens and building blocks for the Edward design boards.
// Every board is plain static markup; this file only saves retyping the shell.

export const C = {
  bg: "#F3F6FA",
  surface: "#FFFFFF",
  soft: "#EDF1F7",
  line: "#DFE5EE",
  ink: "#1A2236",
  ink2: "#4A566E",
  ink3: "#5F6B85",
  blue: "#2A52BE",
  blueInk: "#1F3E94",
  blueSoft: "#E6ECFB",
  apricot: "#F0A066",
  apricotSoft: "#FDECDD",
  apricotInk: "#8A4210",
  sageSoft: "#E1F0E5",
  sageInk: "#1F5E3A",
  roseSoft: "#FBE6E3",
  roseInk: "#9C261D",
};

export const F = {
  disp: "'Bricolage Grotesque', 'Segoe UI', system-ui, sans-serif",
  body: "'Hanken Grotesk', 'Segoe UI', system-ui, sans-serif",
  mono: "'JetBrains Mono', Consolas, monospace",
};

export const SHADOW = "0 1px 2px rgba(26,34,54,0.05), 0 10px 28px rgba(26,34,54,0.07)";
export const SHADOW_LG = "0 2px 4px rgba(26,34,54,0.06), 0 24px 60px rgba(26,34,54,0.16)";

const PATHS = {
  sun: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"></path>',
  chat: '<path d="M4 5.5h16v10.5H10l-4.5 3.5V16H4z"></path>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"></rect><path d="M3.5 10h17M8 3v4M16 3v4"></path>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"></rect><path d="m3.5 7 8.5 6.5L20.500 7"></path>',
  bill: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"></path><path d="M9 8h6M9 12h6"></path>',
  bell: '<path d="M6 16.500V11a6 6 0 0 1 12 0v5.500l1.500 2h-15z"></path><path d="M10 20.500a2 2 0 0 0 4 0"></path>',
  book: '<path d="M5 4.500h10.500A2.500 2.500 0 0 1 18 7v13H7.500A2.500 2.500 0 0 1 5 17.500z"></path><path d="M5 17.500A2.500 2.500 0 0 1 7.500 15H18"></path>',
  image: '<rect x="3" y="4.500" width="18" height="15" rx="2.500"></rect><circle cx="8.500" cy="10" r="1.500"></circle><path d="m4 17 5-4.500 3.500 3 3-2.500 4.500 4"></path>',
  shield: '<path d="M12 3 4.500 6v5.500c0 4.600 3.100 8 7.500 9.500 4.400-1.500 7.500-4.900 7.500-9.500V6z"></path><path d="m9 12 2.200 2.200L15.200 10"></path>',
  gear: '<circle cx="12" cy="12" r="3"></circle><path d="M12 3v2.500M12 18.500V21M3 12h2.500M18.500 12H21M5.600 5.600l1.800 1.800M16.600 16.600l1.800 1.800M5.600 18.400l1.800-1.800M16.600 7.400l1.800-1.800"></path>',
  clock: '<circle cx="12" cy="12" r="8.500"></circle><path d="M12 7.500V12l3 2"></path>',
  check: '<path d="m5 12.500 4.500 4.500L19 7.500"></path>',
  warn: '<path d="M12 4 2.800 19.500h18.400z"></path><path d="M12 10v4.500M12 17v.500"></path>',
  x: '<path d="m6 6 12 12M18 6 6 18"></path>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  search: '<circle cx="11" cy="11" r="6.500"></circle><path d="m16 16 4.500 4.500"></path>',
  send: '<path d="M4 12 20 4.500 14.500 20l-3-6.500z"></path>',
  clip: '<path d="M8 12.500 14 6.500a3 3 0 0 1 4.200 4.200l-7.700 7.700a5 5 0 0 1-7-7L10 5"></path>',
  chevron: '<path d="m7 10 5 5 5-5"></path>',
  right: '<path d="m10 7 5 5-5 5"></path>',
  left: '<path d="m14 7-5 5 5 5"></path>',
  link: '<path d="M14 5h5v5M19 5l-8 8M17 14v4.500a.500.500 0 0 1-.500.500h-11a.500.500 0 0 1-.500-.500v-11a.500.500 0 0 1 .500-.500H10"></path>',
  lock: '<rect x="5" y="10.500" width="14" height="10" rx="2.500"></rect><path d="M8 10.500V8a4 4 0 0 1 8 0v2.500"></path>',
  key: '<circle cx="8" cy="15" r="4"></circle><path d="m11 12 8.500-8.500M16 7l3 3M13.500 9.500l2 2"></path>',
  heart: '<path d="M3.500 12h4l2-5 3.500 10 2.500-5h5"></path>',
  box: '<path d="M3.500 8 12 3.500 20.500 8v8L12 20.500 3.500 16z"></path><path d="M3.500 8 12 12.500 20.500 8M12 12.500v8"></path>',
  moon: '<path d="M19.500 14.500A8 8 0 0 1 9.500 4.500a8 8 0 1 0 10 10z"></path>',
  globe: '<circle cx="12" cy="12" r="8.500"></circle><path d="M3.500 12h17M12 3.500c3 3 3 14 0 17M12 3.500c-3 3-3 14 0 17"></path>',
  folder: '<path d="M3.500 6.500h6l2 2.500h9v10.500h-17z"></path>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V5.500a1.500 1.500 0 0 0-1.500-1.500h-9A1.500 1.500 0 0 0 4 5.500v9A1.500 1.500 0 0 0 5.500 16H8"></path>',
  download: '<path d="M12 4v11M7.500 11l4.500 4.500 4.500-4.500M5 19.500h14"></path>',
  trash: '<path d="M5 7h14M9.500 7V4.500h5V7M7 7l.800 12.500h8.400L17 7"></path>',
  pencil: '<path d="M4.500 19.500 5.500 15 16 4.500l3.500 3.500L9 18.500z"></path>',
  history: '<path d="M4 12a8 8 0 1 0 2.500-5.800L4 8.500"></path><path d="M4 4.500v4h4M12 8v4.500l3 1.500"></path>',
  terminal: '<rect x="3" y="4.500" width="18" height="15" rx="2.500"></rect><path d="m7 9.500 3 2.500-3 2.500M12.500 15h4.500"></path>',
  eye: '<path d="M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12z"></path><circle cx="12" cy="12" r="3"></circle>',
  spark: '<path d="M12 3.500 13.800 10l6.700 2-6.700 2L12 20.500 10.200 14l-6.700-2 6.700-2z"></path>',
  file: '<path d="M6.500 3.500h8l4 4v13h-12z"></path><path d="M14.500 3.500v4h4"></path>',
  refresh: '<path d="M19.500 12a7.500 7.500 0 1 1-2.300-5.400L19.500 9"></path><path d="M19.500 4.500V9H15"></path>',
  users: '<circle cx="9" cy="9" r="3.500"></circle><path d="M2.500 19.500a6.500 6.500 0 0 1 13 0M16 5.800a3.500 3.500 0 0 1 0 6.400M18 14.500a6.500 6.500 0 0 1 3.500 5"></path>',
};

/** Inline stroke icon. The path data above is written with 3-decimal numbers only to keep the file greppable. */
export function ic(name, size = 18, color = "currentColor", width = 1.6) {
  const d = (PATHS[name] ?? "").replace(/(\d)\.(\d)00/g, "$1.$2").replace(/\.500/g, ".5");
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink: 0">${d}</svg>`;
}

/** Asset placeholder; build.mjs swaps @@name@@ for the uploaded url (or a local file for previews). */
export const asset = (name) => `@@${name}@@`;

/** A spot illustration painted on white; multiply drops the white out on any light ground. */
export function spot(name, size, alt = "", extra = "") {
  return `<img src="${asset(name)}" alt="${alt}" style="width: ${size}px; height: ${size}px; object-fit: contain; mix-blend-mode: multiply; flex-shrink: 0; ${extra}">`;
}

const TONES = {
  blue: [C.blueSoft, C.blueInk],
  apricot: [C.apricotSoft, C.apricotInk],
  sage: [C.sageSoft, C.sageInk],
  rose: [C.roseSoft, C.roseInk],
  grey: [C.soft, C.ink2],
};

export function tag(text, tone = "grey", icon = "") {
  const [bg, fg] = TONES[tone];
  return `<span style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: ${bg}; color: ${fg}; font-size: 12px; font-weight: 600; white-space: nowrap">${icon ? ic(icon, 13, "currentColor", 2) : ""}${text}</span>`;
}

export function btn(label, kind = "secondary", icon = "", extra = "") {
  const base = `display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 18px; border-radius: 12px; font-weight: 600; font-size: 14px; white-space: nowrap; ${extra}`;
  const kinds = {
    primary: `border: 0; background: ${C.blue}; color: #FFFFFF; box-shadow: 0 1px 2px rgba(42,82,190,0.3), 0 6px 16px rgba(42,82,190,0.22)`,
    secondary: `border: 1px solid ${C.line}; background: ${C.surface}; color: ${C.ink}`,
    ghost: `border: 0; background: transparent; color: ${C.blueInk}`,
    danger: `border: 1px solid #EDBDB8; background: ${C.surface}; color: ${C.roseInk}`,
    dangerFill: `border: 0; background: #B3261E; color: #FFFFFF`,
    soft: `border: 0; background: ${C.blueSoft}; color: ${C.blueInk}`,
  };
  return `<button style="${base}; ${kinds[kind]}">${icon ? ic(icon, 16) : ""}${label}</button>`;
}

export function iconBtn(icon, label, extra = "") {
  return `<button aria-label="${label}" style="display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border: 0; border-radius: 12px; background: transparent; color: ${C.ink2}; ${extra}">${ic(icon, 18)}</button>`;
}

export function card(inner, extra = "") {
  return `<div style="box-sizing: border-box; border: 1px solid ${C.line}; border-radius: 18px; background: ${C.surface}; box-shadow: ${SHADOW}; ${extra}">${inner}</div>`;
}

export const h2 = (text, extra = "") => `<h2 style="margin: 0; font-family: ${F.disp}; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; ${extra}">${text}</h2>`;
export const label = (text, extra = "") => `<div style="font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: ${C.ink3}; ${extra}">${text}</div>`;
export const muted = (text, extra = "") => `<div style="font-size: 13px; color: ${C.ink2}; ${extra}">${text}</div>`;
export const mono = (text, extra = "") => `<span style="font-family: ${F.mono}; font-size: 12.5px; ${extra}">${text}</span>`;

/** A switch drawn as a real button. */
export function toggle(on, name) {
  return `<button role="switch" aria-checked="${on}" aria-label="${name}" style="display: inline-flex; align-items: center; width: 52px; height: 44px; padding: 0; border: 0; background: transparent; flex-shrink: 0"><span style="display: flex; align-items: center; justify-content: ${on ? "flex-end" : "flex-start"}; width: 48px; height: 28px; box-sizing: border-box; padding: 3px; border-radius: 999px; background: ${on ? C.blue : "#B8C1D1"}"><span style="width: 22px; height: 22px; border-radius: 50%; background: #FFFFFF; box-shadow: 0 1px 3px rgba(26,34,54,0.3)"></span></span></button>`;
}

/** Segmented choice; `active` is the selected label. */
export function segmented(options, active, name) {
  return `<div role="group" aria-label="${name}" style="display: inline-flex; gap: 2px; padding: 3px; border-radius: 12px; background: ${C.soft}">${options
    .map((o) => `<button aria-pressed="${o === active}" style="min-height: 38px; padding: 0 14px; border: 0; border-radius: 9px; background: ${o === active ? C.surface : "transparent"}; color: ${o === active ? C.ink : C.ink2}; font-weight: ${o === active ? 600 : 500}; font-size: 13px; box-shadow: ${o === active ? "0 1px 3px rgba(26,34,54,0.14)" : "none"}">${o}</button>`)
    .join("")}</div>`;
}

const MODES = {
  Chat: { dot: "#2E8B57", note: "Privacy guard on", tone: "sage", icon: "shield" },
  Manual: { dot: "#C97A2B", note: "Guard covers chat only", tone: "apricot", icon: "warn" },
  "Semi-auto": { dot: "#C97A2B", note: "Guard covers chat only", tone: "apricot", icon: "warn" },
  Auto: { dot: "#B3261E", note: "Codex acts without asking", tone: "rose", icon: "warn" },
};

/** The mode is on every screen, in the same place (D24: the user must never wonder which mode is on). */
export function modeBar(mode = "Chat") {
  const m = MODES[mode];
  return `<div style="display: flex; align-items: center; gap: 10px">${tag(m.note, m.tone, m.icon)}<button aria-label="Permission mode: ${mode}. Change" style="display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 12px 0 14px; border: 1px solid ${C.line}; border-radius: 12px; background: ${C.surface}; color: ${C.ink}; font-weight: 600; font-size: 13px"><span style="width: 9px; height: 9px; border-radius: 50%; background: ${m.dot}"></span>${mode} mode${ic("chevron", 16, C.ink3)}</button></div>`;
}

const NAV = [
  ["Today", "sun", "Main.dc.html"],
  ["Chat", "chat", "Chat.dc.html"],
  null,
  ["Calendar", "calendar", "Calendar.dc.html"],
  ["Mail", "mail", "Mail.dc.html", "4"],
  ["Bills", "bill", "Bills.dc.html", "2 new", "apricot"],
  ["Reminders", "bell", "Reminders.dc.html"],
  ["Memory", "book", "Memory.dc.html"],
  ["Pictures", "image", "Pictures.dc.html"],
  null,
  ["Privacy", "shield", "Privacy.dc.html"],
  ["Settings", "gear", "Settings.dc.html"],
];

function sidebar(active) {
  const items = NAV.map((n) => {
    if (!n) return `<div style="height: 1px; margin: 8px 12px; background: ${C.line}"></div>`;
    const [name, icon, href, badge, tone] = n;
    const on = name === active;
    const b = badge ? `<span style="margin-left: auto; padding: 1px 8px; border-radius: 999px; background: ${tone === "apricot" ? C.apricotSoft : C.soft}; color: ${tone === "apricot" ? C.apricotInk : C.ink2}; font-size: 12px; font-weight: 600">${badge}</span>` : "";
    return `<a href="${href}" ${on ? 'aria-current="page"' : ""} style="display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 12px; border-radius: 12px; text-decoration: none; background: ${on ? C.blueSoft : "transparent"}; color: ${on ? C.blueInk : C.ink2}; font-weight: ${on ? 600 : 500}">${ic(icon, 18)}<span>${name}</span>${b}</a>`;
  }).join("");
  return `<nav aria-label="Sections" style="width: 232px; flex-shrink: 0; box-sizing: border-box; padding: 20px 14px 16px; display: flex; flex-direction: column; gap: 18px; border-right: 1px solid ${C.line}; background: rgba(255,255,255,0.78)">
<div style="display: flex; align-items: center; gap: 10px; padding: 0 8px">
<img src="${asset("icon")}" alt="" style="width: 34px; height: 34px; border-radius: 10px">
<div style="font-family: ${F.disp}; font-size: 20px; font-weight: 700; letter-spacing: -0.02em">Edward</div>
</div>
<div style="display: flex; flex-direction: column; gap: 2px">${items}</div>
<div style="margin-top: auto; display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 14px; background: ${C.soft}; font-size: 12.5px; color: ${C.ink2}">
<div style="display: flex; align-items: center; justify-content: space-between"><span>Google</span><span style="color: ${C.sageInk}; font-weight: 600">Connected</span></div>
<div style="display: flex; align-items: center; justify-content: space-between"><span>Background</span><span style="color: ${C.sageInk}; font-weight: 600">On</span></div>
</div>
</nav>`;
}

/** App window: sidebar, a header with the title and the mode, and the board's own content. */
export function shell({ active, title, sub = "", mode = "Chat", actions = "", body, bodyStyle = "", height = 860 }) {
  return `<div class="wash" style="width: 100%; height: ${height}px; box-sizing: border-box; display: flex; overflow: hidden; background-color: ${C.bg}; color: ${C.ink}; font-family: ${F.body}; font-size: 14px; line-height: 1.5">
${sidebar(active)}
<main style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column">
<header style="display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 68px; box-sizing: border-box; padding: 12px 28px">
<div style="min-width: 0">
<h1 style="margin: 0; font-family: ${F.disp}; font-size: 22px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${title}</h1>
${sub ? `<div style="font-size: 13px; color: ${C.ink2}">${sub}</div>` : ""}
</div>
<div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0">${actions}${modeBar(mode)}</div>
</header>
<div style="flex-grow: 1; min-height: 0; box-sizing: border-box; padding: 4px 28px 24px; ${bodyStyle}">
${body}
</div>
</main>
</div>`;
}

/** The message box, the same on every conversation screen. */
export function composer({ placeholder = "Ask Edward, or type / for commands", value = "", attach = "" } = {}) {
  return `<div style="display: flex; flex-direction: column; gap: 8px; padding: 8px 8px 8px 18px; border: 1px solid ${C.line}; border-radius: 18px; background: ${C.surface}; box-shadow: ${SHADOW}">
${attach}
<div style="display: flex; align-items: center; gap: 6px">
<label for="msg" style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%)">Message</label>
<input id="msg" type="text" placeholder="${placeholder}" value="${value}" style="flex-grow: 1; min-width: 0; min-height: 44px; border: 0; outline: 0; background: transparent; color: ${C.ink}; font: inherit; font-size: 15px">
${iconBtn("clip", "Attach a picture")}
<button aria-label="Send" style="display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border: 0; border-radius: 12px; background: ${C.blue}; color: #FFFFFF">${ic("send", 18)}</button>
</div>
</div>`;
}

/** Wraps a board's markup into a whole .dc.html file. */
export function page(title, markup, w, h) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
body{margin:0}
a{color:${C.blueInk}}a:hover{color:${C.blue}}
button{font:inherit;cursor:pointer}
img{display:block}
.wash{background-image:url(${asset("wash-blue")});background-size:cover;background-position:center}
</style>
</helmet>
${markup}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${w},"height":${h}}}'>
class Component extends DCLogic {
renderVals() {
return {};
}
}
</script>
</body>
</html>
`;
}
