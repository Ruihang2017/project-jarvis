// Writes out/project/*.dc.html, out/project/canvas.json and out/preview/*.html from the board modules.
//   node gen/build.mjs            build; asset urls come from gen/assets.json ({ name: "/_blob/…" })
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { page } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const art = join(root, "art");
const out = join(root, "out");
const W = 1360;
const H = 860;
const GAP = 80;
const PITCH = H + 420;

const ROWS = ["Today and conversation", "What Jarvis looks after", "Privacy and trust", "First-run setup", "Care, settings and states", "Design language"];

const boards = [];
for (const f of readdirSync(here).filter((f) => /^boards-.*\.mjs$/.test(f)).sort()) {
  boards.push(...(await import(pathToFileURL(join(here, f)).href)).default);
}

boards.forEach((b, i) => (b.pos ??= i));
boards.sort((a, b) => a.row - b.row || a.pos - b.pos);
// Main.dc.html must stay the entry and it already sorts first (row 0, pos 0).

const assets = existsSync(join(here, "assets.json")) ? JSON.parse(readFileSync(join(here, "assets.json"), "utf8")) : {};
const missing = new Set();
const fill = (text, map) =>
  text.replace(/@@([a-z0-9-]+)@@/g, (_, name) => {
    if (map(name)) return map(name);
    missing.add(name);
    return "";
  });
const local = (name) => {
  for (const ext of ["jpg", "png"]) {
    const p = join(art, `${name}.${ext}`);
    if (existsSync(p)) return pathToFileURL(p).href;
  }
  if (name === "icon") return pathToFileURL(join(root, "..", "assets", "icon.png")).href;
  return null;
};

mkdirSync(join(out, "project"), { recursive: true });
mkdirSync(join(out, "preview"), { recursive: true });

const index = {
  v: 3,
  attachments: {},
  createdOnFiles: { v: 1, at: "2026-10-02T08:30:00Z" },
  title: "Jarvis Frontend",
  launch: { view: "canvas" },
  pages: [],
  boards: {},
  order: [],
  notes: {},
  designSystems: [],
};

const col = {};
for (const b of boards) {
  const w = b.w ?? W;
  const h = b.h ?? H;
  const x = col[b.row] ?? 0;
  col[b.row] = x + w + GAP;
  const n = String(index.order.length + 1).padStart(2, "0");
  index.boards[b.file] = { x, y: b.row * PITCH, w, h, title: `${n} · ${b.title}`, ...(b.fixed ? {} : { expand: "fill" }) };
  index.order.push(b.file);
  const html = page(`Jarvis · ${b.title}`, b.markup, w, h);
  writeFileSync(join(out, "project", b.file), fill(html, (n) => assets[n]));
  const pv = fill(html, local).replace('<script src="./support.js"></script>', "").replace(/<\/?x-dc>|<\/?helmet>/g, "");
  writeFileSync(join(out, "preview", b.file.replace(".dc.html", ".html")), pv);
}
ROWS.forEach((text, r) => {
  if (boards.filter((b) => b.row === r).length > 1) index.notes[`row${r}`] = { x: 0, y: r * PITCH - 300, text, kind: "title1", maxW: col[r] - GAP };
});
writeFileSync(join(out, "project", "canvas.json"), JSON.stringify(index, null, 2) + "\n");

const unmapped = [...missing].filter((n) => !assets[n]);
console.log(`${boards.length} boards; assets not uploaded yet: ${unmapped.join(", ") || "none"}; no local file: ${[...missing].filter((n) => !local(n)).join(", ") || "none"}`);
