// Screenshots out/preview/*.html with headless Edge (no window): node gen/shot.mjs [Name ...]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
if (!edge) throw new Error("no Edge or Chrome found");
mkdirSync(join(root, "shots"), { recursive: true });
const want = process.argv.slice(2);
const sizes = {};
for (const f of readdirSync(join(root, "preview"))) {
  const name = f.replace(".html", "");
  if (want.length && !want.includes(name)) continue;
  const [w, h] = sizes[name] ?? [1360, 860];
  try {
    execFileSync(edge, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--user-data-dir=${join(root, "shots", ".profile-" + name)}`, `--window-size=${w},${h}`, "--virtual-time-budget=6000", `--screenshot=${join(root, "shots", name + ".png")}`, pathToFileURL(join(root, "preview", f)).href], { stdio: "ignore", timeout: 40000 });
    console.log(name);
  } catch {
    // Edge sometimes writes the picture and then doesn't exit; the timeout kills it.
    console.log(name, "(timed out)");
  }
}
