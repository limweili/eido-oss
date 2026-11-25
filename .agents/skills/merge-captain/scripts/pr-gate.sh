#!/usr/bin/env bash
# pr-gate.sh — the three-valued go/no-go read for one PR.
#
# Usage: pr-gate.sh <pr-number> [--review-required] [--review-confirmed]
#        [--provider-ci-compensated <exact-head-sha>]
#        [--canary-reviewed <exact-head-sha>]
#
#   --review-required   Declare independent review required by repository policy
#                       or change risk. Without provider approval or a matching
#                       --review-confirmed assertion, the verdict is WAIT.
#   --review-confirmed  Assert that an external review PASS exists for the PR's
#                       CURRENT head. Use when required review is tracked outside
#                       the provider.
#   --provider-ci-compensated <sha>
#                       Assert that the canonical full CI mirror passed at the
#                       CURRENT head and GitHub CI is unavailable. This can
#                       replace only absent/pending/cancelled provider proof;
#                       it never overrides a genuine red conclusion.
#   --canary-reviewed <sha>
#                       Assert that a red non-blocking canary was investigated
#                       at the CURRENT head and is understood/accepted.
#
# Exit codes: 0 = GO, 1 = NO-GO, 2 = WAIT (absent/uncomputed signals).
# Run this seconds before the merge command — an earlier read is already
# stale. This script never collapses "no data" into "pass".
set -u

n=""; review_required=0; review_confirmed=0; compensated_sha=""; canary_reviewed_sha=""
while [ $# -gt 0 ]; do
  case "$1" in
    --review-required) review_required=1; shift ;;
    --review-confirmed) review_confirmed=1; shift ;;
    --provider-ci-compensated) [ $# -ge 2 ] || { echo "FAIL: --provider-ci-compensated needs an exact SHA"; exit 2; }; compensated_sha="$2"; shift 2 ;;
    --canary-reviewed) [ $# -ge 2 ] || { echo "FAIL: --canary-reviewed needs an exact SHA"; exit 2; }; canary_reviewed_sha="$2"; shift 2 ;;
    --*) echo "FAIL: unknown option '$1'"; exit 2 ;;
    *) [ -z "$n" ] || { echo "FAIL: multiple PR numbers"; exit 2; }; n="$1"; shift ;;
  esac
done
[ -n "$n" ] || { echo "usage: pr-gate.sh <pr-number> [--review-required] [--review-confirmed] [--provider-ci-compensated <exact-head-sha>] [--canary-reviewed <exact-head-sha>]"; exit 2; }
sdir=$(cd "$(dirname "$0")" && pwd)
command -v gh >/dev/null || { echo "FAIL: gh not found"; exit 2; }
command -v jq >/dev/null || { echo "FAIL: jq not found"; exit 2; }

j=$(gh pr view "$n" --json number,state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,baseRefName,baseRefOid,headRefName,headRefOid,url,changedFiles,files) || exit 2
oid=$(printf '%s' "$j" | jq -r .headRefOid)
base_oid=$(printf '%s' "$j" | jq -r '.baseRefOid // ""')
valid_full_oid() {
  case "$1" in *[!0-9a-f]*|"") return 1 ;; esac
  [ ${#1} -eq 40 ]
}
valid_full_oid "$oid" || { echo "FAIL: provider omitted a valid full lowercase PR head identity"; exit 2; }
valid_full_oid "$base_oid" || { echo "FAIL: provider omitted a valid full lowercase PR base identity"; exit 2; }

nogo=0; wait=0
sig() { # verdict name detail
  printf '%-6s %-22s %s\n' "$1" "$2" "$3"
  [ "$1" = "NO-GO" ] && nogo=1
  [ "$1" = "WAIT" ] && wait=1
  return 0
}

. "$sdir/conditional-gates.sh"

state=$(printf '%s' "$j" | jq -r .state)
[ "$state" = "OPEN" ] && sig OK "state" "OPEN" || sig NO-GO "state" "$state — not mergeable; if this is a surprise, freeze and report"

draft=$(printf '%s' "$j" | jq -r .isDraft)
[ "$draft" = "false" ] && sig OK "draft" "not a draft" || sig NO-GO "draft" "draft PR — resolve draft state (whose work is it?) before merging"

mergeable=$(printf '%s' "$j" | jq -r .mergeable)
case "$mergeable" in
  MERGEABLE) sig OK "mergeable" "MERGEABLE" ;;
  UNKNOWN)   sig WAIT "mergeable" "UNKNOWN — provider still computing; re-run in ~10s; never act on UNKNOWN" ;;
  *)         sig NO-GO "mergeable" "$mergeable — refresh in isolation and reprove the affected claims" ;;
esac

provider_compensated=0
if [ -n "$compensated_sha" ]; then
  if [ "$compensated_sha" = "$oid" ]; then
    provider_compensated=1
  else
    sig NO-GO "CI compensation" "proof was for $compensated_sha, but current head is $oid"
  fi
fi

canary_reviewed=0
if [ -n "$canary_reviewed_sha" ]; then
  if [ "$canary_reviewed_sha" = "$oid" ]; then
    canary_reviewed=1
  else
    sig NO-GO "canary review" "triage was for $canary_reviewed_sha, but current head is $oid"
  fi
fi

if ! checks=$(printf '%s' "$j" | jq -r -L "$sdir" '
  include "checks-classifier";
  .statusCheckRollup | classify_checks'); then
  checks="CLASSIFIER_ERROR"
fi
if ! genuine_failure=$(printf '%s' "$j" | jq -r -L "$sdir" '
  include "checks-classifier";
  .statusCheckRollup | has_genuine_required_failure'); then
  checks="CLASSIFIER_ERROR"
  genuine_failure="false"
fi
required_ok=0; compensation_used=0
case "$checks" in
  PASS)    required_ok=1; sig OK "checks" "all completed green" ;;
  NONE)
    if [ "$provider_compensated" -eq 1 ]; then
      required_ok=1; compensation_used=1; sig OK "checks" "provider proof absent; canonical full mirror asserted at exact head $oid"
    else
      sig WAIT "checks" "ZERO checks attached — trigger CI; if provider CI is unavailable, run the canonical full mirror and re-run with --provider-ci-compensated $oid"
    fi ;;
  PENDING)
    if [ "$provider_compensated" -eq 1 ] && [ "$genuine_failure" = "false" ]; then
      required_ok=1; compensation_used=1; sig OK "checks" "provider proof unavailable/pending; canonical full mirror asserted at exact head $oid"
    else
      sig WAIT "checks" "runs in progress — wait; compensate only after diagnosing provider unavailability"
    fi ;;
  CANCELLED)
    if [ "$provider_compensated" -eq 1 ]; then
      required_ok=1; compensation_used=1; sig OK "checks" "provider run cancelled; canonical full mirror asserted at exact head $oid"
    else
      sig WAIT "checks" "required run cancelled — re-run it, or compensate only after diagnosing provider unavailability"
    fi ;;
  FAIL)
    sig NO-GO "checks" "genuine red required check — inspect logs; local proof can never override it" ;;
  *)
    sig WAIT "checks" "check state could not be classified safely — repair the classifier/read path and re-run" ;;
esac

conditional_gates=""
if [ "${MERGE_CAPTAIN_PR_FILES_FROM_VIEW_FOR_TESTS:-}" = "1" ]; then
  pr_file_pages=$(printf '%s' "$j" | jq -c '
    [[.files[]? | {
      filename: .path,
      status: (.status // "modified"),
      previous_filename: (.previousPath // null)
    }]]')
elif ! pr_file_pages=$(gh api --paginate --slurp "repos/{owner}/{repo}/pulls/$n/files?per_page=100" 2>/dev/null); then
  sig WAIT "conditional gates" "provider PR file inventory is unreadable; cannot derive path-scoped proof"
  pr_file_pages=""
fi
if ! declared_file_count=$(printf '%s' "$j" | jq -er '
  .changedFiles as $count
  | if (($count | type) == "number"
      and $count >= 0
      and $count <= 9007199254740991
      and $count == ($count | floor))
    then $count
    else error("invalid changedFiles")
    end'); then
  sig WAIT "conditional gates" "provider PR changed-file count is missing or invalid; inventory completeness cannot be proven"
  declared_file_count=-1
fi
if [ -n "$pr_file_pages" ] && ! printf '%s' "$pr_file_pages" | jq -e '
  type == "array" and length > 0 and all(.[]; type == "array")
  and all(.[][];
    type == "object"
    and (.filename | type) == "string" and (.filename | length) > 0
    and (.status == "added" or .status == "removed" or .status == "modified"
      or .status == "renamed" or .status == "copied" or .status == "changed"
      or .status == "unchanged")
    and (.status != "renamed"
      or ((.previous_filename | type) == "string" and (.previous_filename | length) > 0)))
' >/dev/null; then
  sig WAIT "conditional gates" "PR file inventory contains a missing or invalid current/previous path"
  pr_file_pages=""
fi
if [ -n "$pr_file_pages" ]; then
  observed_file_count=$(printf '%s' "$pr_file_pages" | jq '[.[][]] | length')
  unique_observed_file_count=$(printf '%s' "$pr_file_pages" | jq '[.[][].filename] | unique | length')
  changed_files=$(printf '%s' "$pr_file_pages" | jq -c '
    [.[][] | .filename, (select(.status == "renamed") | .previous_filename)] | unique')
else
  observed_file_count=0
  unique_observed_file_count=0
  changed_files='[]'
fi
if [ -z "$pr_file_pages" ]; then
  :
elif [ "$observed_file_count" -ne "$unique_observed_file_count" ]; then
  sig WAIT "conditional gates" "PR file inventory contains duplicate current paths; an omitted conditional path could be hidden"
elif [ "$declared_file_count" -lt 0 ] || [ "$observed_file_count" -ne "$declared_file_count" ]; then
  sig WAIT "conditional gates" "PR file inventory is incomplete ($observed_file_count of $declared_file_count); cannot derive path-scoped proof"
elif [ "$observed_file_count" -ge 3000 ]; then
  sig WAIT "conditional gates" "PR file inventory reached GitHub's 3000-file API cap; conditional paths cannot be proven complete"
elif ! conditional_gate_lines=$(matching_conditional_gates_at_refs "$changed_files" "$base_oid" "$oid"); then
  sig WAIT "conditional gates" "conditional gate policy is missing, invalid, or unreadable at the PR base/head identities"
else
  conditional_gates=$(printf '%s\n' "$conditional_gate_lines" | jq -s -c 'unique_by(tojson)[]')
fi
while IFS= read -r gate; do
  [ -n "$gate" ] || continue
  gate_id=$(printf '%s' "$gate" | jq -r .id)
  gate_checks=$(printf '%s' "$gate" | jq -c .checks)
  if ! gate_state=$(printf '%s' "$j" | jq -r -L "$sdir" --argjson names "$gate_checks" '
    include "checks-classifier";
    .statusCheckRollup | classify_named_checks($names)'); then
    gate_state="CLASSIFIER_ERROR"
  fi
  case "$gate_state" in
    PASS) sig OK "$gate_id" "every exact required check completed successfully" ;;
    NONE) sig WAIT "$gate_id" "required checks absent; conditional host proof cannot be compensated by the canonical mirror" ;;
    PENDING) sig WAIT "$gate_id" "required checks missing or pending; conditional host proof cannot be compensated" ;;
    CANCELLED) sig WAIT "$gate_id" "required check cancelled; rerun it because conditional host proof cannot be compensated" ;;
    FAIL) sig NO-GO "$gate_id" "genuine red conditional check; inspect logs and re-prove" ;;
    *) sig WAIT "$gate_id" "conditional check state could not be classified safely" ;;
  esac
done <<< "$conditional_gates"

if ! canaries=$(printf '%s' "$j" | jq -r -L "$sdir" '
  include "checks-classifier";
  .statusCheckRollup | classify_nonblocking_checks'); then
  canaries="CLASSIFIER_ERROR"
fi
case "$canaries" in
  FAIL)
    if [ "$canary_reviewed" -eq 1 ]; then
      printf '%-6s %-22s %s\n' "WARN" "canaries" "red non-blocking check investigated and accepted at head $oid; record the evidence"
    else
      sig WAIT "canaries" "red non-blocking check needs explicit triage; re-run with --canary-reviewed $oid only after it is understood"
    fi ;;
  PENDING) printf '%-6s %-22s %s\n' "INFO" "canaries" "non-blocking check still running" ;;
  CANCELLED) printf '%-6s %-22s %s\n' "INFO" "canaries" "non-blocking check was cancelled or superseded; no test failure recorded" ;;
  NONE|PASS) ;;
  *) sig WAIT "canaries" "optional check state could not be classified safely — repair the classifier/read path and re-run" ;;
esac

if ! experiments=$(printf '%s' "$j" | jq -r -L "$sdir" '
  include "checks-classifier";
  .statusCheckRollup | classify_experimental_checks'); then
  experiments="CLASSIFIER_ERROR"
fi
case "$experiments" in
  FAIL)    printf '%-6s %-22s %s\n' "INFO" "experiments" "experimental evidence is red; it does not enter the merge verdict" ;;
  PENDING) printf '%-6s %-22s %s\n' "INFO" "experiments" "experimental evidence is still running; it does not enter the merge verdict" ;;
  CANCELLED) printf '%-6s %-22s %s\n' "INFO" "experiments" "experimental run was cancelled or superseded; no evidence verdict recorded" ;;
  NONE|PASS) ;;
  *) printf '%-6s %-22s %s\n' "INFO" "experiments" "experimental state could not be classified; it remains outside the merge verdict" ;;
esac

mss=$(printf '%s' "$j" | jq -r .mergeStateStatus)
case "$mss" in
  CLEAN)    sig OK "mergeState" "CLEAN" ;;
  UNSTABLE)
    if [ "$required_ok" -eq 1 ] && [ "$canaries" = "FAIL" ] && [ "$canary_reviewed" -eq 1 ]; then
      sig OK "mergeState" "UNSTABLE explained by the named, explicitly-triaged non-blocking canary"
    elif [ "$required_ok" -eq 1 ] && [ "$canaries" = "FAIL" ]; then
      sig WAIT "mergeState" "UNSTABLE explained by a red canary that still needs explicit triage"
    elif [ "$required_ok" -eq 1 ] && [ "$canaries" = "PENDING" ]; then
      sig OK "mergeState" "UNSTABLE explained by a pending optional canary"
    elif [ "$required_ok" -eq 1 ] && [ "$canaries" = "CANCELLED" ]; then
      sig OK "mergeState" "UNSTABLE explained by a cancelled optional canary; no test failure recorded"
    elif [ "$required_ok" -eq 1 ] && { [ "$experiments" = "FAIL" ] || [ "$experiments" = "CANCELLED" ] || [ "$experiments" = "PENDING" ]; } && { [ "$canaries" = "NONE" ] || [ "$canaries" = "PASS" ]; }; then
      sig OK "mergeState" "UNSTABLE explained only by opt-in experimental evidence"
    elif [ "$required_ok" -eq 1 ] && [ "$compensation_used" -eq 1 ]; then
      sig OK "mergeState" "UNSTABLE explained by unavailable provider CI plus exact-head canonical mirror"
    elif [ "$required_ok" -eq 1 ]; then
      sig NO-GO "mergeState" "UNSTABLE despite green required proof and no accepted canary — freeze and investigate"
    elif [ "$genuine_failure" = "true" ]; then
      sig NO-GO "mergeState" "UNSTABLE with a genuine red merge-blocking check"
    else
      sig WAIT "mergeState" "UNSTABLE without complete explained proof"
    fi ;;
  BLOCKED|BEHIND|DIRTY) sig NO-GO "mergeState" "$mss" ;;
  *)        sig WAIT "mergeState" "$mss — recompute pending" ;;
esac

rd=$(printf '%s' "$j" | jq -r '.reviewDecision // ""')
case "$rd" in
  CHANGES_REQUESTED) sig NO-GO "review" "changes requested — every blocking finding needs a fix commit + re-verification" ;;
  APPROVED)          sig OK "review" "approved" ;;
  *)
    if [ "$review_confirmed" -eq 1 ]; then
      sig OK "review" "external adversarial review PASS asserted by caller for head $oid (--review-confirmed)"
    elif [ "$review_required" -eq 1 ]; then
      sig WAIT "review" "review is required for this change — verify a PASS on head $oid, then re-run with --review-confirmed"
    else
      printf '%-6s %-22s %s\n' "INFO" "review" "no provider review signal; this invocation did not declare independent review required"
    fi ;;
esac

# Bind every decision above to one provider snapshot. The REST file inventory
# and GraphQL PR/check read are not atomic, so a moving head, base, file count,
# or check rerun invalidates the mixed proof and must be recomputed.
snapshot_stable=1
if ! fresh_j=$(gh pr view "$n" --json number,state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,baseRefName,baseRefOid,headRefName,headRefOid,changedFiles 2>/dev/null); then
  sig WAIT "snapshot" "could not re-read PR verdict state, identity, and checks after classification; recompute from a fresh provider snapshot"
  snapshot_stable=0
else
  initial_snapshot=$(printf '%s' "$j" | jq -cS '
    {number, state, isDraft, mergeable, mergeStateStatus, reviewDecision,
      baseRefName, baseRefOid, headRefName, headRefOid, changedFiles,
      statusCheckRollup: ((.statusCheckRollup // []) | sort_by(tojson))}')
  fresh_snapshot=$(printf '%s' "$fresh_j" | jq -cS '
    {number, state, isDraft, mergeable, mergeStateStatus, reviewDecision,
      baseRefName, baseRefOid, headRefName, headRefOid, changedFiles,
      statusCheckRollup: ((.statusCheckRollup // []) | sort_by(tojson))}')
  if [ "$initial_snapshot" = "$fresh_snapshot" ]; then
    sig OK "snapshot" "verdict state, identity, file count, and checks remained stable through classification"
  else
    sig WAIT "snapshot" "PR verdict state, identity, file count, or checks changed during gate read; discard mixed proof and re-run"
    snapshot_stable=0
  fi
fi

# Freshness: does the exact head contain the exact base identity captured above?
base=$(printf '%s' "$j" | jq -r .baseRefName)
if [ "$snapshot_stable" -eq 0 ]; then
  sig WAIT "freshness" "not computed because the provider snapshot changed during the gate read"
else
  behind=$(gh api "repos/{owner}/{repo}/compare/$base_oid...$oid" --jq .behind_by 2>/dev/null || echo "?")
  case "$behind" in
    0)  sig OK "freshness" "exact head $oid contains exact $base identity $base_oid" ;;
    \?) sig WAIT "freshness" "could not compute for exact identities (compare API failed) — verify by fetch + merge-base locally" ;;
    *)  sig NO-GO "freshness" "$behind commit(s) behind $base — refresh in isolation, reprove invalidated claims, and wait for required proof on the new head" ;;
  esac
fi

echo
url=$(printf '%s' "$j" | jq -r .url)
if [ "$nogo" -eq 1 ]; then
  echo "VERDICT: NO-GO — fix the named signals, then re-run. ($url @ $oid)"
  exit 1
elif [ "$wait" -eq 1 ]; then
  echo "VERDICT: WAIT — absent/uncomputed signals above. Make them exist; never substitute a vibe. ($url @ $oid)"
  exit 2
else
  echo "VERDICT: GO — all required signals verified now against head $oid. Merge, then main-ci-wait.sh before the next PR. ($url)"
  exit 0
fi
