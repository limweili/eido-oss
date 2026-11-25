#!/usr/bin/env bash
# cleanup-verify.sh — registry-scoped cleanup with verification.
#
# Deletes ONLY what the registry file lists, one item at a time, never
# forced, and verifies every deletion. Never derives a cleanup list by
# enumerating the repo — `git worktree list` and branch globs span other
# sessions' live work, and sweeping them has destroyed live work before.
#
# Usage: cleanup-verify.sh <registry-file> [--dry-run]
#
# Registry format (one per line, written at train start):
#   branch <remote-branch-name>     # deleted on origin after PR merged
#   local-branch <branch-name>      # deleted locally (-d, then -D only if
#                                   # the PR is confirmed MERGED)
#   worktree <absolute-path>        # removed without --force
#   # comments and blank lines ignored
#
# A refusal (dirty worktree, unmerged branch) means LIVE WORK: it is
# reported, never forced. Exit 0 = everything deleted+verified; 1 = leftovers.
set -u

[ $# -ge 1 ] || { sed -n '2,17p' "$0"; exit 2; }
reg=$1; dry=${2:-}
[ -f "$reg" ] || { echo "FAIL: registry file not found: $reg"; exit 2; }

leftover=0
# "Verified gone" requires ls-remote to SUCCEED and return nothing. A failed
# ls-remote (network/auth) also prints nothing — that is an absent signal,
# not a confirmation.
remote_state() { # branch -> echoes GONE / EXISTS / UNKNOWN
  out=$(git ls-remote --heads origin "$1" 2>/dev/null)
  rc=$?
  if [ $rc -ne 0 ]; then echo UNKNOWN
  elif [ -z "$out" ]; then echo GONE
  else echo EXISTS; fi
}

while IFS= read -r line; do
  line=${line%%#*}
  # trim
  line=$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  [ -z "$line" ] && continue
  kind=${line%% *}; target=${line#* }
  case "$kind" in
    branch)
      if [ "$dry" = "--dry-run" ]; then echo "would delete remote branch: $target"; continue; fi
      if git push origin --delete "$target" >/dev/null 2>&1; then
        case "$(remote_state "$target")" in
          GONE)    echo "OK  remote branch $target deleted (verified by ls-remote: gone)" ;;
          EXISTS)  echo "WARN remote branch $target: delete reported ok but ls-remote still shows it — re-check"; leftover=1 ;;
          UNKNOWN) echo "WARN remote branch $target: deleted but ls-remote FAILED — deletion is unverified, not confirmed"; leftover=1 ;;
        esac
      else
        case "$(remote_state "$target")" in
          GONE)    echo "OK  remote branch $target already gone (verified)" ;;
          EXISTS)  echo "KEPT remote branch $target: delete refused — possibly protected or base of an open PR. Not forcing."; leftover=1 ;;
          UNKNOWN) echo "WARN remote branch $target: delete failed AND ls-remote failed — cannot verify anything (network/auth?). Unresolved."; leftover=1 ;;
        esac
      fi
      ;;
    local-branch)
      if [ "$dry" = "--dry-run" ]; then echo "would delete local branch: $target"; continue; fi
      if git branch -d "$target" >/dev/null 2>&1; then
        echo "OK  local branch $target deleted"
      elif git show-ref --verify --quiet "refs/heads/$target"; then
        echo "KEPT local branch $target: -d refused (unmerged by ancestry — normal for squash merges)."
        echo "     If the PR is confirmed MERGED on the provider, 'git branch -D $target' is safe; confirm first."
        leftover=1
      else
        echo "OK  local branch $target already gone"
      fi
      ;;
    worktree)
      if [ "$dry" = "--dry-run" ]; then echo "would remove worktree: $target"; continue; fi
      if [ ! -d "$target" ]; then echo "OK  worktree $target already gone"; continue; fi
      if git worktree remove "$target" >/dev/null 2>&1; then
        echo "OK  worktree $target removed (no --force)"
      else
        echo "KEPT worktree $target: removal refused — it has uncommitted state. Refusal = live work; not forcing. Inspect it yourself."
        leftover=1
      fi
      ;;
    *)
      echo "SKIP unrecognized registry line: $line"; leftover=1
      ;;
  esac
done <"$reg"

if [ "$dry" = "--dry-run" ]; then
  echo
  echo "Dry run — nothing was deleted."
  exit 0
fi
if [ "$leftover" -eq 1 ]; then
  echo
  echo "Some items were kept or need re-checking (listed above). Report them — do not force."
  exit 1
fi
echo
echo "All registry items deleted and verified."
