/**
 * Inline image previews via Sixel (Windows Terminal ≥ 1.22, WezTerm, iTerm2, foot, xterm -ti vt340…).
 * Dependency-free: PNG decode (zlib + unfilter), area-average downscale, 216-colour cube with
 * Floyd–Steinberg dithering, and Sixel encoding with transparent background.
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array; // RGBA, 4 bytes per pixel
}

/** Decodes 8-bit, non-interlaced PNGs (grey, RGB, palette, grey+alpha, RGBA). Returns null otherwise. */
export function decodePng(buf: Buffer): Rgba | null {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let off = 8; off + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8]!;
      colorType = body[9]!;
      interlace = body[12]!;
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") trns = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels || bitDepth !== 8 || interlace !== 0 || !width || !height) return null;

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[dst + x - channels]! : 0;
      const b = y > 0 ? px[dst + x - stride]! : 0;
      const c = x >= channels && y > 0 ? px[dst + x - stride - channels]! : 0;
      const v = raw[src + x]!;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[dst + x] = (v + pred) & 0xff;
    }
  }

  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels, d = i * 4;
    switch (colorType) {
      case 0: data[d] = data[d + 1] = data[d + 2] = px[s]!; data[d + 3] = 255; break;
      case 2: data[d] = px[s]!; data[d + 1] = px[s + 1]!; data[d + 2] = px[s + 2]!; data[d + 3] = 255; break;
      case 3: {
        const idx = px[s]!;
        data[d] = palette?.[idx * 3] ?? 0; data[d + 1] = palette?.[idx * 3 + 1] ?? 0; data[d + 2] = palette?.[idx * 3 + 2] ?? 0;
        data[d + 3] = trns && idx < trns.length ? trns[idx]! : 255;
        break;
      }
      case 4: data[d] = data[d + 1] = data[d + 2] = px[s]!; data[d + 3] = px[s + 1]!; break;
      case 6: data[d] = px[s]!; data[d + 1] = px[s + 1]!; data[d + 2] = px[s + 2]!; data[d + 3] = px[s + 3]!; break;
    }
  }
  return { width, height, data };
}

/** Area-average downscale to fit within maxW × maxH (never upscales). */
export function fit(img: Rgba, maxW: number, maxH: number): Rgba {
  const scale = Math.min(1, maxW / img.width, maxH / img.height);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  if (w === img.width && h === img.height) return img;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * img.height) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.width) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / w));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * img.width + sx) * 4;
          const al = img.data[i + 3]!;
          r += img.data[i]! * al; g += img.data[i + 1]! * al; b += img.data[i + 2]! * al; a += al; n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = a ? Math.round(r / a) : 0; out[o + 1] = a ? Math.round(g / a) : 0; out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width: w, height: h, data: out };
}

const LEVELS = [0, 51, 102, 153, 204, 255]; // 6×6×6 cube
const toLevel = (v: number) => Math.min(5, Math.max(0, Math.round(v / 51)));

/** Encodes to a Sixel string; pixels with alpha < 128 stay transparent. */
export function encodeSixel(img: Rgba): string {
  const { width: w, height: h } = img;
  // Dither into palette indices (-1 = transparent), working on a float copy for error diffusion.
  const buf = Float32Array.from(img.data);
  const idx = new Int16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (buf[i + 3]! < 128) { idx[y * w + x] = -1; continue; }
      const q = [toLevel(buf[i]!), toLevel(buf[i + 1]!), toLevel(buf[i + 2]!)];
      idx[y * w + x] = q[0]! * 36 + q[1]! * 6 + q[2]!;
      for (let c = 0; c < 3; c++) {
        const err = buf[i + c]! - LEVELS[q[c]!]!;
        const spread = (dx: number, dy: number, f: number) => {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny < h) buf[(ny * w + nx) * 4 + c]! += err * f;
        };
        spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
      }
    }
  }

  const used = new Set<number>();
  for (const v of idx) if (v >= 0) used.add(v);
  let out = `\x1bP0;1;0q"1;1;${w};${h}`;
  for (const c of used) {
    const r = Math.floor(c / 36), g = Math.floor(c / 6) % 6, b = c % 6;
    out += `#${c};2;${r * 20};${g * 20};${b * 20}`; // Sixel RGB is 0–100
  }
  for (let band = 0; band < h; band += 6) {
    // Per colour, one row of sixel chars for this 6-pixel band.
    const rows = new Map<number, Uint8Array>();
    for (let dy = 0; dy < 6 && band + dy < h; dy++) {
      for (let x = 0; x < w; x++) {
        const c = idx[(band + dy) * w + x]!;
        if (c < 0) continue;
        let row = rows.get(c);
        if (!row) rows.set(c, (row = new Uint8Array(w)));
        row[x]! |= 1 << dy;
      }
    }
    let first = true;
    for (const [c, row] of rows) {
      out += (first ? "" : "$") + `#${c}` + rle(row);
      first = false;
    }
    out += "-";
  }
  return out + "\x1b\\";
}

function rle(row: Uint8Array): string {
  let s = "";
  for (let x = 0; x < row.length; ) {
    let n = 1;
    while (x + n < row.length && row[x + n] === row[x]) n++;
    const ch = String.fromCharCode(63 + row[x]!);
    s += n > 3 ? `!${n}${ch}` : ch.repeat(n);
    x += n;
  }
  return s;
}

/** Whether this session prints previews; set once at REPL start from settings + detection. */
export const preview = { enabled: false };

/** PNG file → Sixel thumbnail, or null if the file can't be decoded. */
export function sixelPreview(png: Buffer, maxW = 400, maxH = 280): string | null {
  const img = decodePng(png);
  return img ? encodeSixel(fit(img, maxW, maxH)) : null;
}

/** Sixel thumbnail of a PNG file, indented and newline-terminated; "" if it can't be rendered. */
export function renderPreview(path: string): string {
  try {
    const six = sixelPreview(readFileSync(path));
    return six ? `  ${six}\n` : "";
  } catch {
    return "";
  }
}

/**
 * Asks the terminal (DA1) whether it supports Sixel (attribute 4). Must run before readline
 * takes over stdin. Resolves false on timeout or non-TTY.
 */
export function detectSixel(timeoutMs = 400): Promise<boolean> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY || !stdout.isTTY) return Promise.resolve(false);
  return new Promise((resolve) => {
    let buf = "";
    const done = (ok: boolean) => {
      clearTimeout(timer);
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      resolve(ok);
    };
    const onData = (d: Buffer) => {
      buf += d.toString("latin1");
      const m = /\x1b\[\?([\d;]*)c/.exec(buf);
      if (m) done(m[1]!.split(";").includes("4"));
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
    stdout.write("\x1b[c");
  });
}
