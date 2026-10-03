import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runtime } from "../runtime.js";

/** assets/icon.png in this checkout (used for notifications); may not exist yet. */
export function iconPath(): string {
  if (runtime.iconPath) return runtime.iconPath;
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  return join(root, "assets", "icon.png");
}
