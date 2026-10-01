import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** assets/icon.png in this checkout (used for notifications); may not exist yet. */
export function iconPath(): string {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  return join(root, "assets", "icon.png");
}
