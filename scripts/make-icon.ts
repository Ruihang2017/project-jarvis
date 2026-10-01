// Builds assets/icon.png (256 px, notifications) and assets/icon.ico (16–256 px) from a source PNG.
// Usage: npx tsx scripts/make-icon.ts <source.png>   (writes assets/icon-source.png at 512 px too)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeIco, encodePng } from "../src/png.js";
import { decodePng, fit } from "../src/sixel.js";

const src = process.argv[2];
if (!src) throw new Error("usage: npx tsx scripts/make-icon.ts <source.png>");
const img = decodePng(readFileSync(src));
if (!img) throw new Error(`${src}: not an 8-bit non-interlaced PNG`);

const out = join(import.meta.dirname, "..", "assets");
mkdirSync(out, { recursive: true });
const at = (size: number) => encodePng(fit(img, size, size));

writeFileSync(join(out, "icon-source.png"), at(512));
writeFileSync(join(out, "icon.png"), at(256));
const sizes = [16, 24, 32, 48, 64, 128, 256];
writeFileSync(join(out, "icon.ico"), encodeIco(sizes.map((size) => ({ size, png: at(size) }))));
console.log(`wrote assets/icon-source.png (512), icon.png (256), icon.ico (${sizes.join("/")})`);
