# Design

Design boards for a Jarvis desktop app. There is no frontend code yet; this folder holds the source of the
boards and the illustrations they use.

- `gen/` builds the boards. `lib.mjs` has the colours, type and shared parts; `boards-*.mjs` have one screen
  each. `node design/gen/build.mjs` writes them to `design/out/`; `node design/gen/shot.mjs` takes pictures
  of them with headless Edge. `assets.json` maps each illustration to its address on the published canvas.
- `art/` holds the illustrations. They were painted with Codex's image generation: `prompts.tsv` has the
  prompts, `gen.sh <name>…` runs them, `trim.py` crops the small ones and makes their paper pure white.

Every name, address and amount on the boards is made up.
