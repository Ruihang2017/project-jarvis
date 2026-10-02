#!/usr/bin/env bash
# usage: gen.sh <name> [<name> ...]   (runs them in parallel)
# Generates images with Codex and copies each to raw/<name>.png
ART="$(cd "$(dirname "$0")" && pwd)"
export CODEX_HOME="$LOCALAPPDATA/Jarvis/codex-home"
STYLE="Soft watercolour and gouache illustration on textured paper, loose painterly brushwork, gentle early-morning light, calm and airy. Limited palette: pale mist blue, soft periwinkle, warm apricot, a little sage green, natural wood, off-white. No text, no letters, no numbers, no logos, no people, no hands, no screens with UI."
SPOT="The objects are isolated on a pure flat white background (#FFFFFF), no table edge, no room, no frame, no border, only a faint soft shadow under the objects; nothing is cut off at the edges; the background stays clean unpainted pure white right to every edge and corner."
mkdir -p "$ART/raw" "$ART/logs"
cd "$ART" || exit 1

one() {
  local name="$1"
  local prompt
  prompt="$(grep -m1 "^$name|" "$ART/prompts.tsv" | cut -d'|' -f2-)"
  if [ -z "$prompt" ]; then echo "$name: no prompt"; return 1; fi
  prompt="${prompt//@STYLE@/$STYLE}"
  prompt="${prompt//@SPOT@/$SPOT}"
  codex exec --skip-git-repo-check "Use your image generation tool to create exactly one image: $prompt Reply with only the full path of the generated PNG file." > "$ART/logs/$name.log" 2>&1 < /dev/null
  local rc=$?
  local p
  local sid
  sid="$(grep -m1 '^session id:' "$ART/logs/$name.log" | awk '{print $3}' | tr -d '\r')"
  p=""
  if [ -n "$sid" ]; then
    p="$(ls -t "$CODEX_HOME/generated_images/$sid"/*.png 2>/dev/null | head -1)"
  fi
  if [ -n "$p" ] && [ -f "$p" ]; then
    cp "$p" "$ART/raw/$name.png"
    echo "$name: OK $p"
  else
    echo "$name: FAIL rc=$rc path='$p'"
    tail -4 "$ART/logs/$name.log"
    return 1
  fi
}

for n in "$@"; do one "$n" & done
wait
