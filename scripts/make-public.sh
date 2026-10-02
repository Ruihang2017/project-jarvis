#!/usr/bin/env bash
# Builds the public version of this repository in a SEPARATE folder. The repository it is run from
# is never modified, and nothing is pushed.
#
#   bash scripts/make-public.sh <name> <no-reply-email> [output-folder]
#
#   name, email     the identity every commit gets (use your GitHub no-reply address)
#   output-folder   default: ../<this folder's name>-public
#
# In the copy, every commit is rewritten so that:
#   - author and committer are the identity given (a working history may carry a private address);
#   - personal details in file contents and commit messages are replaced, using the private list in
#     scripts/scrub-map.local.mjs (not in the repository; see scripts/scrub.mjs);
#   - internal working documents are left out: everything under docs/ except the public guide,
#     and CLAUDE.md.
# Then the whole history is searched for the strings in that list and for any other identity; the
# script fails if it finds one.
set -euo pipefail

if [ $# -lt 2 ]; then
  sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi
NAME="$1"
EMAIL="$2"
SRC="$(git rev-parse --show-toplevel)"
OUT="${3:-$SRC-public}"
SCRUB="$SRC/scripts/scrub.mjs"
PUBLIC_DOC="docs/google-cloud-setup.md"

if [ -e "$OUT" ]; then
  echo "error: $OUT already exists; remove it or give another folder" >&2
  exit 1
fi
if [ -n "$(git -C "$SRC" status --porcelain)" ]; then
  echo "error: commit or stash your changes first (the public version is built from commits)" >&2
  exit 1
fi
if [ ! -f "$SRC/scripts/scrub-map.local.mjs" ]; then
  echo "warning: no scripts/scrub-map.local.mjs — file contents will not be changed, only identities" >&2
fi

git clone --quiet --no-local --branch main --single-branch "$SRC" "$OUT"
cd "$OUT"
git remote remove origin

export FILTER_BRANCH_SQUELCH_WARNING=1
export PUBLIC_NAME="$NAME" PUBLIC_EMAIL="$EMAIL" SCRUB PUBLIC_DOC

git filter-branch --force \
  --env-filter '
    export GIT_AUTHOR_NAME="$PUBLIC_NAME" GIT_AUTHOR_EMAIL="$PUBLIC_EMAIL"
    export GIT_COMMITTER_NAME="$PUBLIC_NAME" GIT_COMMITTER_EMAIL="$PUBLIC_EMAIL"
  ' \
  --tree-filter '
    # Internal documents out; the public guide stays.
    if [ -d docs ]; then
      find docs -type f ! -path "$PUBLIC_DOC" -delete
      find docs -type d -empty -delete
    fi
    rm -f CLAUDE.md
    node "$SCRUB" --all >/dev/null
  ' \
  --msg-filter 'node "$SCRUB" --stdin' \
  --prune-empty -- --all >/dev/null

# Drop every trace of the unfiltered history from the copy.
git for-each-ref --format='%(refname)' refs/original | while read -r ref; do git update-ref -d "$ref"; done
git reflog expire --expire=now --all
git gc --quiet --prune=now --aggressive

echo "== identities in the public history"
git log --all --format='%an <%ae> | %cn <%ce>' | sort -u

fail=0
if git log --all --format='%ae%n%ce' | sort -u | grep -v -x -F "$EMAIL" | grep -q .; then
  echo "error: an identity other than $EMAIL remains" >&2
  fail=1
fi
patterns="$(mktemp)"
node "$SCRUB" --patterns > "$patterns"
if [ -s "$patterns" ]; then
  # File contents in every commit, then commit messages.
  if git grep -I -n -i -F -f "$patterns" $(git rev-list --all) -- . | head -20 | grep .; then
    echo "error: text from the private list remains in file contents (above)" >&2
    fail=1
  fi
  if git log --all --format='%h %B' | grep -n -i -F -f "$patterns" | head -20 | grep .; then
    echo "error: text from the private list remains in commit messages (above)" >&2
    fail=1
  fi
fi
rm -f "$patterns"
if git log --all --name-only --format= | sort -u | grep -E '^(CLAUDE\.md|docs/)' | grep -v -x -F "$PUBLIC_DOC" | grep .; then
  echo "error: internal documents are still in the history (above)" >&2
  fail=1
fi
[ "$fail" = 0 ] || exit 1

echo "== ok: $(git rev-list --count --all) commits in $OUT"
echo "Review it, then publish by hand, for example:"
echo "  cd \"$OUT\" && git remote add origin <url> && git push -u origin main"
