// Builds the app into build/: main (with the core bundled in), the tick script, preload, and the page.
//   node scripts/build.mjs [main|preload|renderer]   (default: all)
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(app, "..");
const only = process.argv[2];
const external = ["electron", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

if (!only) rmSync(join(app, "build"), { recursive: true, force: true });
mkdirSync(join(app, "build"), { recursive: true });
copyFileSync(join(repo, "assets", "icon.png"), join(app, "build", "icon.png"));
copyFileSync(join(repo, "assets", "icon.ico"), join(app, "build", "icon.ico"));
// The Mac's icon is made from a bigger picture (512 pixels) when the app is packaged.
copyFileSync(join(repo, "assets", "icon-source.png"), join(app, "build", "icon-mac.png"));

// The Google client built into the app (D37), from a git-ignored file; none when it isn't there.
const secretFile = process.env.EDWARD_GOOGLE_CLIENT_FILE ?? join(app, "build-secrets", "google-client.json");
let googleClient = null;
if (existsSync(secretFile)) {
  const c = JSON.parse(readFileSync(secretFile, "utf8")).installed;
  if (!c?.client_id || !c?.client_secret) throw new Error(`${secretFile} is not a Google "Desktop app" client file`);
  googleClient = { clientId: c.client_id, clientSecret: c.client_secret };
}

if (!only || only === "main") {
  await build({
    define: { __EDWARD_GOOGLE_CLIENT__: JSON.stringify(googleClient) },
    configFile: false,
    logLevel: "warn",
    root: app,
    build: {
      ssr: true,
      target: "node24",
      outDir: "build/main",
      emptyOutDir: true,
      minify: false,
      sourcemap: true,
      rollupOptions: {
        input: { main: join(app, "main", "main.ts"), tick: join(app, "main", "tick.ts") },
        output: { format: "esm", entryFileNames: "[name].js", chunkFileNames: "core-[hash].js" },
        external,
      },
    },
    ssr: { noExternal: true, target: "node" },
  });
}

if (!only || only === "preload") {
  await build({
    configFile: false,
    logLevel: "warn",
    root: app,
    build: {
      ssr: true,
      target: "node24",
      outDir: "build/preload",
      emptyOutDir: true,
      minify: false,
      rollupOptions: { input: join(app, "preload", "preload.ts"), output: { format: "cjs", entryFileNames: "preload.cjs" }, external },
    },
    ssr: { noExternal: true, target: "node" },
  });
}

if (!only || only === "renderer") {
  mkdirSync(join(app, "renderer", "public"), { recursive: true });
  // The illustrations live with the design; the page gets its own copy.
  copyFileSync(join(repo, "assets", "icon.png"), join(app, "renderer", "public", "icon.png"));
  cpSync(join(repo, "design", "art"), join(app, "renderer", "public", "art"), { recursive: true, filter: (p) => !/[\\/](raw|logs)([\\/]|$)/.test(p) && !/\.(py|sh|tsv)$/.test(p) });
  await build({
    configFile: false,
    logLevel: "warn",
    root: join(app, "renderer"),
    base: "./",
    plugins: [react()],
    build: { outDir: join(app, "build", "renderer"), emptyOutDir: true, target: "chrome140", assetsInlineLimit: 0, minify: false, sourcemap: true },
  });
}
console.log(`built ${only ?? "everything"}${googleClient ? " (with the built-in Google client)" : ""}`);
