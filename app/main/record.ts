/**
 * Tutorial videos (L, D44): plays a script in the hidden window (go to a page, move a drawn pointer,
 * click, type slowly, show a caption) and saves a frame every 1/fps seconds, with how long each one
 * stays, for ffmpeg (app/scripts/videos.mjs). Only runs with EDWARD_RECORD, on demo data.
 */
import type { BrowserWindow } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Step {
  /** Page to show (as the sidebar does). */
  go?: string;
  /** Text of a button or link (exact, else contained), or "css:<selector>". Moves the pointer there and clicks. */
  click?: string;
  /** Moves the pointer there without clicking. */
  point?: string;
  /** [target, text]: clicks into a field and types, a letter at a time. */
  type?: [string, string];
  /** Presses a key in the focused field ("Enter"). */
  key?: string;
  /** Shows a caption at the bottom (null hides it). */
  caption?: string | null;
  /** Where captions go from this step on: "top" when the bottom is where the typing happens. */
  at?: "top" | "bottom";
  /** Waits this many ms. */
  wait?: number;
  /** Waits for Edward to finish answering (at most this many ms), then a moment more. */
  reply?: number;
  /** Waits until this text is on screen (at most 120 s): for things that take a while, like the mail summary. */
  until?: string;
  /** [target, pixels]: scrolls the element (or the page's scrolling body) by that much. */
  scroll?: [string, number];
}

/** Helpers put into the page: a pointer, captions, finding things by their text, typing like a person. */
const HELPERS = `(() => {
  if (window.__rec) return;
  const style = document.createElement("style");
  style.textContent = \`
    #rec-cursor { position: fixed; z-index: 99999; width: 26px; height: 26px; pointer-events: none; left: 0; top: 0; transform: translate(-3px, -2px); filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
    #rec-ring { position: fixed; z-index: 99998; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 3px solid rgba(42,82,190,.75); pointer-events: none; opacity: 0; transform: scale(.4); transition: opacity .35s, transform .35s; }
    #rec-caption { position: fixed; z-index: 99997; left: 50%; bottom: 34px; transform: translateX(-50%) translateY(10px); max-width: 78%; padding: 12px 22px; border-radius: 14px; background: rgba(19,27,51,.9); color: #fff; font: 600 21px/1.35 "Inter", "Segoe UI", sans-serif; text-align: center; opacity: 0; transition: opacity .35s, transform .35s; pointer-events: none; }
    #rec-caption.top { bottom: auto; top: 10px; }
    #rec-caption.on { opacity: 1; transform: translateX(-50%) translateY(0); }\`;
  document.head.appendChild(style);
  const cursor = document.createElement("div");
  cursor.id = "rec-cursor";
  cursor.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="#fff" stroke="#1b2440" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const ring = document.createElement("div");
  ring.id = "rec-ring";
  const caption = document.createElement("div");
  caption.id = "rec-caption";
  document.body.append(ring, caption, cursor);
  let x = innerWidth * 0.62, y = innerHeight * 0.55;
  const place = () => { cursor.style.left = x + "px"; cursor.style.top = y + "px"; };
  place();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(el).visibility !== "hidden"; };
  const find = (q) => {
    if (q.startsWith("css:")) return [...document.querySelectorAll(q.slice(4))].find(visible) || null;
    const all = [...document.querySelectorAll("button, a, [role=button], [role=tab], label, input, textarea, select, .list-btn, h1, h2, h3, li")].filter(visible);
    // innerText follows text-transform (labels are upper case), so compare without case.
    const lq = q.toLowerCase();
    const text = (el) => (el.innerText || el.value || el.placeholder || el.getAttribute("aria-label") || "").trim().toLowerCase();
    const exact = all.filter((el) => text(el) === lq);
    const pool = exact.length ? exact : all.filter((el) => text(el).includes(lq) || (el.placeholder || "").toLowerCase().includes(lq) || (el.getAttribute("aria-label") || "").toLowerCase() === lq);
    pool.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height);
    if (pool.length) return pool[0];
    // Plain text (a label, a heading in a card): the smallest element whose own text has it.
    const any = [...document.querySelectorAll("div, span, p, b, strong, td")].filter((el) => visible(el) && (el.innerText || "").trim().toLowerCase().includes(lq) && el.children.length < 4);
    any.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length);
    return any[0] || null;
  };
  const moveTo = async (el) => {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    await sleep(80);
    const r = el.getBoundingClientRect();
    const tx = r.left + Math.min(r.width / 2, 60), ty = r.top + r.height / 2;
    const fx = x, fy = y, dist = Math.hypot(tx - fx, ty - fy), ms = Math.min(900, 250 + dist * 0.9);
    const t0 = performance.now();
    await new Promise((done) => {
      const step = (t) => {
        const k = Math.min(1, (t - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        x = fx + (tx - fx) * e; y = fy + (ty - fy) * e; place();
        k < 1 ? requestAnimationFrame(step) : done();
      };
      requestAnimationFrame(step);
    });
  };
  const pulse = () => { ring.style.left = x + "px"; ring.style.top = y + "px"; ring.style.opacity = "1"; ring.style.transform = "scale(1)"; setTimeout(() => { ring.style.opacity = "0"; ring.style.transform = "scale(.4)"; }, 260); };
  const setValue = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  window.__rec = {
    async click(q) {
      const el = find(q); if (!el) throw new Error("not found: " + q);
      await moveTo(el); await sleep(120); pulse();
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      if (typeof el.focus === "function") el.focus();
      el.click();
      return true;
    },
    has(q) { return Boolean(find(q)); },
    async point(q) { const el = find(q); if (!el) throw new Error("not found: " + q); await moveTo(el); return true; },
    async type(q, text) {
      const el = find(q); if (!el) throw new Error("not found: " + q);
      await moveTo(el); pulse(); el.focus();
      let v = el.value || "";
      for (const ch of text) { v += ch; setValue(el, v); await sleep(ch === " " ? 70 : 38 + Math.random() * 40); }
      return true;
    },
    async key(k) {
      const el = document.activeElement || document.body;
      for (const type of ["keydown", "keypress", "keyup"]) el.dispatchEvent(new KeyboardEvent(type, { key: k, code: k, bubbles: true, cancelable: true }));
      return true;
    },
    place(at) { caption.classList.toggle("top", at === "top"); return true; },
    caption(t) { if (t) { caption.textContent = t; caption.classList.add("on"); } else caption.classList.remove("on"); return true; },
    async scroll(q, dy) {
      const el = q ? find(q) : null;
      let box = el; while (box && box !== document.body && !(box.scrollHeight > box.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
      box = box && box !== document.body ? box : document.querySelector(".body") || document.scrollingElement;
      box.scrollBy({ top: dy, behavior: "smooth" }); await sleep(700); return true;
    },
  };
})()`;

/**
 * Plays `steps` while saving frames into `dir` (f00001.png …) and `frames.txt` (an ffmpeg concat list
 * with each frame's duration). `navigate` shows a page; `busy` says whether Edward is still answering.
 */
export async function record(w: BrowserWindow, steps: Step[], dir: string, o: { navigate: (page: string) => void; busy: () => boolean; fps?: number }) {
  mkdirSync(dir, { recursive: true });
  const js = (code: string) => w.webContents.executeJavaScript(code, true);
  await js(HELPERS);
  const frames: { file: string; at: number }[] = [];
  let recording = true;
  // Waiting for the model is cut out of the video: no frames while paused, and the pause doesn't count.
  let paused = false;
  let cut = 0;
  const interval = 1000 / (o.fps ?? 15);
  const t0 = Date.now();
  const grab = (async () => {
    while (recording) {
      if (paused) {
        const p0 = Date.now();
        await new Promise((r) => setTimeout(r, 100));
        cut += Date.now() - p0;
        continue;
      }
      const started = Date.now();
      const img = await w.webContents.capturePage();
      const file = `f${String(frames.length + 1).padStart(5, "0")}.jpg`;
      writeFileSync(join(dir, file), img.toJPEG(92));
      frames.push({ file, at: started - t0 - cut });
      await new Promise((r) => setTimeout(r, Math.max(0, interval - (Date.now() - started))));
    }
  })();
  const q = (s: string) => JSON.stringify(s);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await sleep(800);
  try {
  for (const s of steps) {
    if (s.go) {
      o.navigate(s.go);
      await sleep(1200);
      await js(HELPERS); // a page change keeps the document, but be sure
    }
    if (s.at) await js(`window.__rec.place(${q(s.at)})`);
    if (s.caption !== undefined) await js(`window.__rec.caption(${q(s.caption ?? "")})`);
    if (s.point) await js(`window.__rec.point(${q(s.point)})`);
    if (s.click) await js(`window.__rec.click(${q(s.click)})`);
    if (s.type) await js(`window.__rec.type(${q(s.type[0])}, ${q(s.type[1])})`);
    if (s.key) await js(`window.__rec.key(${q(s.key)})`);
    if (s.scroll) await js(`window.__rec.scroll(${q(s.scroll[0])}, ${s.scroll[1]})`);
    if (s.until) {
      const until = Date.now() + 120_000;
      const started = Date.now();
      while (Date.now() < until && !(await js(`window.__rec.has(${q(s.until)})`))) {
        if (Date.now() - started > 2500) paused = true; // a long wait is cut, like a reply
        await sleep(300);
      }
      paused = false;
      await sleep(900);
    }
    if (s.reply) {
      await sleep(2000);
      const until = Date.now() + s.reply;
      if (o.busy()) paused = true;
      // Resume a moment before the end, so the answer is seen arriving.
      while (Date.now() < until && o.busy()) await sleep(200);
      paused = false;
      await sleep(1500);
    }
    if (s.wait) await sleep(s.wait);
  }
  await sleep(600);
  } finally {
    recording = false;
    await grab;
  }
  const end = Date.now() - t0 - cut;
  const lines = ["ffconcat version 1.0"];
  frames.forEach((f, i) => lines.push(`file ${f.file}`, `duration ${(((frames[i + 1]?.at ?? end) - f.at) / 1000).toFixed(3)}`));
  lines.push(`file ${frames.at(-1)!.file}`);
  writeFileSync(join(dir, "frames.txt"), lines.join("\n") + "\n");
  return { frames: frames.length, seconds: end / 1000 };
}
