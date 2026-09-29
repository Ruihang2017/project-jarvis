import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { ImageGenerationItem } from "./protocol/index.js";
import { appDataDir, imagesDir } from "./settings.js";

export interface ImageRecord {
  path: string;
  /** What the user asked for (the turn's message). */
  prompt: string;
  /** The prompt the model actually sent to the image tool. */
  revisedPrompt: string | null;
  threadId: string;
  createdAt: string;
  width?: number;
  height?: number;
  /** Codex's own copy, kept for follow-up edits. */
  codexPath?: string;
}

const indexPath = () => join(appDataDir(), "images.jsonl");

/**
 * Copies a finished generation into the images directory with a readable name and indexes it.
 * Prefers Codex's saved file; falls back to decoding the base64 `result`.
 */
export function saveGeneratedImage(item: ImageGenerationItem, ctx: { threadId: string; prompt: string }): ImageRecord {
  const source = item.savedPath && existsSync(item.savedPath) ? item.savedPath : undefined;
  const data = source ? undefined : decodeResult(item.result);
  if (!source && !data) throw new Error("image generation returned no file or data");

  const ext = source ? extname(source) || ".png" : sniffExt(data!);
  const title = stripRequest(ctx.prompt) || item.revisedPrompt || "image";
  const path = uniquePath(imagesDir(), `${timestamp()}_${slugify(title)}`, ext);
  if (source) copyFileSync(source, path);
  else writeFileSync(path, data!);

  const record: ImageRecord = {
    path,
    prompt: ctx.prompt,
    revisedPrompt: item.revisedPrompt,
    threadId: ctx.threadId,
    createdAt: new Date().toISOString(),
    ...pngSize(readFileSync(path)),
    ...(source ? { codexPath: source } : {}),
  };
  appendFileSync(indexPath(), JSON.stringify(record) + "\n");
  return record;
}

/** Most recent first. Entries whose file was deleted are skipped. */
export function listImages(limit = 20): ImageRecord[] {
  let lines: string[];
  try {
    lines = readFileSync(indexPath(), "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
  const out: ImageRecord[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      const r = JSON.parse(lines[i]!) as ImageRecord;
      if (existsSync(r.path)) out.push(r);
    } catch {
      // skip corrupt line
    }
  }
  return out;
}

function decodeResult(result: string): Buffer | undefined {
  if (!result) return undefined;
  const b64 = result.replace(/^data:[^;]+;base64,/, "");
  const buf = Buffer.from(b64, "base64");
  return buf.length ? buf : undefined;
}

function sniffExt(buf: Buffer): string {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return ".jpg";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return ".webp";
  return ".png";
}

function pngSize(buf: Buffer): { width?: number; height?: number } {
  if (buf.length < 24 || buf.subarray(12, 16).toString() !== "IHDR") return {};
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Drops request boilerplate so names describe the picture: "帮我画一个红苹果" → "红苹果", "Draw a cat" → "cat". */
export function stripRequest(prompt: string): string {
  return prompt
    .trim()
    .replace(/^(请|麻烦)?(你)?(帮我|给我|为我)?(画|生成|做|设计|创作)(一个|一张|一幅|个|张|幅)?/, "")
    .replace(/^(please\s+)?(can you\s+)?(draw|generate|create|make|design|paint)\s+(me\s+)?((an?\s+)?(image|picture|illustration|icon)\s+of\s+)?(an?\s+|the\s+)?/i, "")
    .trim();
}

/** Filename-safe slug; keeps CJK and other letters (fine on NTFS/APFS/ext4). */
export function slugify(text: string, max = 40): string {
  const slug = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
  return slug || "image";
}

function uniquePath(dir: string, base: string, ext: string): string {
  let path = join(dir, base + ext);
  for (let i = 2; existsSync(path); i++) path = join(dir, `${base}-${i}${ext}`);
  return path;
}
