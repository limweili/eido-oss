#!/usr/bin/env bash
# ci-mirror.sh — exact-head canonical proof when provider CI is diagnosed
# unavailable. Creates a disposable worktree with its own dependencies and runs
# the repository's single required command. It is not a routine rebase gate and
# has no partial-proof mode.
#
# Usage: ci-mirror.sh <full-40-character-head-sha>
#
# Exit 0: canonical proof passed and the worktree was removed.
# Exit 1: required proof failed and the worktree is kept for diagnosis.
# Exit 2: setup or usage failure; no product verdict was produced.
set -u

[ "$#" -eq 1 ] || { echo "usage: ci-mirror.sh <full-40-character-head-sha>"; exit 2; }
ref="$1"
case "$ref" in
  *[!0-9a-f]*|"") echo "FAIL: ref must be a full 40-character lowercase hexadecimal commit id"; exit 2 ;;
esac
[ ${#ref} -eq 40 ] || { echo "FAIL: ref must be full-length (40 characters), not a prefix"; exit 2; }

git fetch origin >/dev/null 2>&1 || echo "WARN: fetch failed; continuing only if exact commit $ref already exists locally"
git cat-file -e "$ref^{commit}" 2>/dev/null || { echo "FAIL: exact commit $ref is unavailable"; exit 2; }

dir=$(mktemp -d "${TMPDIR:-/tmp}/ci-mirror.XXXXXX")
if ! git worktree add --detach "$dir" "$ref" >/dev/null 2>&1; then
  rmdir "$dir" 2>/dev/null
  echo "FAIL: could not create a disposable worktree at $ref"
  exit 2
fi
sha=$(git -C "$dir" rev-parse HEAD)
echo "Disposable worktree: $dir @ $sha"

cleanup_worktree() {
  git worktree remove "$dir" >/dev/null 2>&1 || git worktree remove --force "$dir" >/dev/null 2>&1
}

gate_log=$(mktemp "${TMPDIR:-/tmp}/ci-mirror-gate.XXXXXX.log")
t0=$(date +%s)
echo "── gate: npm run ci:required"
if (cd "$dir" && npm run ci:required) >"$gate_log" 2>&1; then
  echo "   PASS in $(( $(date +%s) - t0 ))s"
  rm -f "$gate_log"
  cleanup_worktree
  echo
  echo "RESULT: PASS — canonical required proof is green at exact head $sha. Worktree removed."
  echo "If this substitutes for provider CI, record the diagnosed outage and exact-head assertion explicitly."
  exit 0
fi

echo "   FAIL in $(( $(date +%s) - t0 ))s — last 40 lines:"
tail -40 "$gate_log" | sed 's/^/   | /'
rm -f "$gate_log"
echo
echo "RESULT: FAIL — canonical required proof is red at exact head $sha. Worktree kept: $dir"
echo "Classify setup/capability failures separately from product failures before recovery."
echo "Remove the owned worktree when diagnosis is complete: git worktree remove '$dir'"
exit 1
