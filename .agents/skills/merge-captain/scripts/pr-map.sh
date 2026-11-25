#!/usr/bin/env bash
# pr-map.sh — map a PR train: live state, stacking edges, do-not-delete
# branches, and a suggested bottom-up merge order.
#
# Usage:
#   pr-map.sh [pr-number ...]     # no args: all open PRs
#   pr-map.sh --json [pr ...]     # raw JSON instead of the table
#
# Run at step 0 of every train and again after every merge — the output is a
# snapshot; it goes stale the moment anything moves.
set -u

json_out=0
prs=""
for a in "$@"; do
  case "$a" in
    --json) json_out=1 ;;
    *) prs="$prs $a" ;;
  esac
done

command -v gh >/dev/null || { echo "FAIL: gh not found"; exit 2; }
command -v jq >/dev/null || { echo "FAIL: jq not found"; exit 2; }

default_branch=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name) || exit 2

if [ -z "${prs// /}" ]; then
  prs=$(gh pr list --state open --limit 100 --json number -q '.[].number' | tr '\n' ' ')
fi
[ -z "${prs// /}" ] && { echo "No open PRs."; exit 0; }

fields=number,title,state,isDraft,headRefName,baseRefName,mergeable,mergeStateStatus,reviewDecision,url,statusCheckRollup,headRefOid

tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT
for n in $prs; do
  gh pr view "$n" --json "$fields" >>"$tmp" || { echo "FAIL: could not read PR #$n"; exit 2; }
done

# Summarize checks into NONE / PENDING / CANCELLED / FAIL / PASS via the shared
# classifier (handles CheckRun + StatusContext shapes; unknown ≠ green).
sdir=$(cd "$(dirname "$0")" && pwd)
all=$(jq -s -L "$sdir" --arg def "$default_branch" '
  include "checks-classifier";
  map(. + { checks: (.statusCheckRollup | classify_checks) })
  | . as $set
  | map(. + {
      stackedOn: (.baseRefName as $b | ($set | map(select(.headRefName == $b) | .number) | first)),
      offDefault: (.baseRefName != $def)
    })
  | . as $set2
  | map(. + {
      isBaseOfOpen: (.headRefName as $h | ($set2 | map(select(.baseRefName == $h and .state == "OPEN") | .number)))
    })' "$tmp")

if [ "$json_out" -eq 1 ]; then
  printf '%s\n' "$all" | jq .
  exit 0
fi

echo "PR MAP — default branch: $default_branch — $(date '+%Y-%m-%d %H:%M %Z')"
echo "(snapshot: stale the moment anything moves; re-run after every merge)"
echo
printf '%s\n' "$all" | jq -r '.[] |
  "#\(.number) \(.state)\(if .isDraft then "/DRAFT" else "" end)  \(.headRefName) → \(.baseRefName)  mergeable=\(.mergeable) mergeState=\(.mergeStateStatus) checks=\(.checks)"
  + (if .stackedOn then "  [STACKED on #\(.stackedOn)]" else "" end)
  + (if (.isBaseOfOpen | length) > 0 then "  [DO-NOT-DELETE branch: base of #\(.isBaseOfOpen | join(", #"))]" else "" end)'

echo
echo "Warnings:"
warnings=$(printf '%s\n' "$all" | jq -r '
  (.[] | select(.checks == "NONE") | "  - #\(.number): ZERO CI checks attached — unproven, not green. Trigger CI; use the exact-head canonical mirror only after diagnosing provider unavailability."),
  (.[] | select(.checks == "CANCELLED") | "  - #\(.number): required CI was CANCELLED — proof is absent, not failed. Re-run it or use exact-head compensation only after diagnosing provider unavailability."),
  (.[] | select(.mergeable == "UNKNOWN") | "  - #\(.number): mergeable UNKNOWN — provider still computing; wait and re-query, never act on it."),
  (.[] | select(.offDefault and (.stackedOn == null)) | "  - #\(.number): based on \(.baseRefName), which is not the default branch and not another listed PR — find the missing parent before merging."),
  (.[] | select((.isBaseOfOpen | length) > 0) | "  - #\(.number): its branch \(.headRefName) is the BASE of open PR(s) #\(.isBaseOfOpen | join(", #")) — merge WITHOUT --delete-branch; deleting a base can CLOSE the dependent PR.")')
if [ -n "$warnings" ]; then printf '%s\n' "$warnings"; else echo "  (none)"; fi

echo
echo "Suggested merge order (bottom-up, parents before children — verify against actual file scopes yourself):"
# Depth is capped at 1 by policy, but handle a few levels defensively.
emitted=" "
remaining=$(printf '%s\n' "$all" | jq -r '.[] | "\(.number):\(.stackedOn // "root")"')
for _pass in 1 2 3 4; do
  for pair in $remaining; do
    n=${pair%%:*}; parent=${pair##*:}
    case "$emitted" in *" $n "*) continue ;; esac
    if [ "$parent" = "root" ]; then
      echo "  #$n"; emitted="$emitted$n "
    else
      case "$emitted" in *" $parent "*) echo "  #$n  (after #$parent; retarget to $default_branch after it lands, verify OPEN/CLEAN)"; emitted="$emitted$n " ;; esac
    fi
  done
done
for pair in $remaining; do
  n=${pair%%:*}
  case "$emitted" in *" $n "*) ;; *) echo "  #$n  (UNORDERED — stack deeper than expected or parent outside this set; map it manually)" ;; esac
done
