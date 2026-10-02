#!/usr/bin/env node
/**
 * Takes personal details out of files: real names, addresses and numbers that crept into examples
 * and tests while the project was developed against one person's data.
 *
 * The replacement list is NOT in the repository. It lives in scripts/scrub-map.local.mjs (ignored
 * by git), which exports `REPLACEMENTS = [[from, to], …]`, longer strings first. Without that file
 * every mode below does nothing.
 *
 *   node scripts/scrub.mjs             rewrite the published files in place
 *   node scripts/scrub.mjs --all       rewrite every text file under the current folder
 *   node scripts/scrub.mjs --check     list files that still contain something to replace; exit 1 if any
 *   node scripts/scrub.mjs --stdin     filter standard input (commit messages)
 *   node scripts/scrub.mjs --patterns  print the strings being looked for, one per line
 *   node scripts/scrub.mjs --scan      read standard input; print lines containing any of them (any case); exit 1 if found
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const mapFile = join(dirname(fileURLToPath(import.meta.url)), "scrub-map.local.mjs");
const REPLACEMENTS = existsSync(mapFile) ? (await import(pathToFileURL(mapFile).href)).REPLACEMENTS : [];

const TEXT = /\.(ts|mts|mjs|js|json|md|html|css|yml|yaml|txt|sh|toml)$/i;
const SKIP = /^(node_modules|dist|\.git|src[\\/]protocol)([\\/]|$)|package-lock\.json$|scrub-map\.local\.mjs$/;
const PUBLISHED = ["src", "test", "site", "scripts", ".github", "README.md", "SECURITY.md", "CONTRIBUTING.md", "CHANGELOG.md", "LICENSE", "package.json", "docs/google-cloud-setup.md"];

const scrub = (text) => REPLACEMENTS.reduce((out, [from, to]) => out.split(from).join(to), text);

const args = process.argv.slice(2);
if (args.includes("--patterns")) {
  for (const [from] of REPLACEMENTS) console.log(from);
} else if (args.includes("--scan")) {
  // Done here rather than with grep: Git for Windows' grep crashes on -i -F with non-ASCII input.
  let s = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) s += chunk;
  const needles = REPLACEMENTS.map(([from]) => from.toLowerCase());
  const hits = s.split("\n").filter((line) => needles.some((n) => line.toLowerCase().includes(n)));
  for (const h of hits.slice(0, 20)) console.log(h);
  if (hits.length) process.exitCode = 1;
} else if (args.includes("--stdin")) {
  let s = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) s += chunk;
  process.stdout.write(scrub(s));
} else {
  const check = args.includes("--check");
  function* walk(path) {
    let s;
    try {
      s = statSync(path);
    } catch {
      return;
    }
    const rel = relative(".", path);
    if (rel && SKIP.test(rel)) return;
    if (s.isDirectory()) for (const e of readdirSync(path)) yield* walk(join(path, e));
    else if (TEXT.test(path) || path === "LICENSE") yield path;
  }
  const dirty = [];
  for (const root of args.includes("--all") ? ["."] : PUBLISHED) {
    for (const file of walk(root)) {
      const before = readFileSync(file, "utf8");
      const after = scrub(before);
      if (after === before) continue;
      dirty.push(relative(".", file));
      if (!check) writeFileSync(file, after);
    }
  }
  if (!REPLACEMENTS.length) console.log("no scripts/scrub-map.local.mjs: nothing to look for");
  else if (dirty.length) console.log(`${check ? "needs scrubbing" : "scrubbed"}:\n  ${dirty.join("\n  ")}`);
  else console.log("clean");
  if (check && dirty.length) process.exitCode = 1;
}
