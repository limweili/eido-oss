#!/usr/bin/env bash
# main-ci-wait.sh — wait for a COMPLETED green main-branch CI run for a
# specific merge commit. Read-only by default: a cancelled run is reported as
# absent proof. Pass --rerun-cancelled only when the landing role has diagnosed
# cancellation and authorizes one recovery mutation.
#
# Usage: main-ci-wait.sh <merge-commit-sha> [--branch main] [--workflow CI]
#        [--artifact eido-main-<sha>] [--timeout 1800] [--rerun-cancelled]
#
# Exit: 0 = completed green run exists for this sha
#       1 = run completed red (stop the train, inspect logs)
#       2 = no run appeared / timed out (absent signal — investigate, don't shrug)
set -u

sha=""; branch="main"; workflow="CI"; artifact=""; timeout=1800
rerun_cancelled=0; rerun_requested=0
poll_interval="${MERGE_CAPTAIN_POLL_INTERVAL_SECONDS:-20}"
while [ $# -gt 0 ]; do
  case "$1" in
    --branch) branch="$2"; shift 2 ;;
    --workflow) workflow="$2"; shift 2 ;;
    --artifact) artifact="$2"; shift 2 ;;
    --timeout) timeout="$2"; shift 2 ;;
    --rerun-cancelled) rerun_cancelled=1; shift ;;
    *) sha="$1"; shift ;;
  esac
done
[ -n "$sha" ] || { echo "usage: main-ci-wait.sh <merge-commit-sha> [--branch main] [--workflow CI] [--artifact name] [--timeout secs] [--rerun-cancelled]"; exit 2; }
case "$sha" in
  *[!0-9a-f]*|"") echo "FAIL: merge SHA must be the full 40-character lowercase hexadecimal commit id"; exit 2 ;;
esac
[ ${#sha} -eq 40 ] || { echo "FAIL: merge SHA must be full-length (40 characters), not a prefix"; exit 2; }
case "$poll_interval" in *[!0-9]*|"") echo "FAIL: poll interval must be a non-negative integer"; exit 2 ;; esac
command -v gh >/dev/null || { echo "FAIL: gh not found"; exit 2; }
command -v jq >/dev/null || { echo "FAIL: jq not found"; exit 2; }

sdir=$(cd "$(dirname "$0")" && pwd)
. "$sdir/conditional-gates.sh"
conditional_gates=""
if [ -n "${MERGE_CAPTAIN_RELEASE_GATES_FILE:-}" ] && [ ! -f "$MERGE_CAPTAIN_RELEASE_GATES_FILE" ]; then
  echo "FAIL: declared conditional gate policy is missing: $MERGE_CAPTAIN_RELEASE_GATES_FILE"
  exit 2
fi
if ! commit_pages=$(gh api --paginate --slurp "repos/{owner}/{repo}/commits/$sha?per_page=100" 2>/dev/null); then
  echo "ABSENT: could not read changed paths for exact main SHA $sha; conditional proof cannot be inferred"
  exit 2
fi
if ! printf '%s' "$commit_pages" | jq -e '
  type == "array" and length > 0
  and all(.[];
    type == "object"
    and (.files | type == "array")
    and all(.files[];
      (.filename | type) == "string" and (.filename | length) > 0
      and (.status == "added" or .status == "removed" or .status == "modified"
        or .status == "renamed" or .status == "copied" or .status == "changed"
        or .status == "unchanged")
      and (.status != "renamed"
        or ((.previous_filename | type) == "string" and (.previous_filename | length) > 0))))
' >/dev/null; then
  echo "ABSENT: changed-path inventory for exact main SHA $sha is malformed or incomplete"
  exit 2
fi
current_filenames=$(printf '%s' "$commit_pages" | jq -c '[.[].files[].filename]') || exit 2
changed_file_count=$(printf '%s' "$current_filenames" | jq 'length') || exit 2
unique_changed_file_count=$(printf '%s' "$current_filenames" | jq 'unique | length') || exit 2
if [ "$changed_file_count" -ne "$unique_changed_file_count" ]; then
  echo "ABSENT: exact main SHA $sha returned duplicate changed filenames across commit pages; inventory completeness is ambiguous"
  exit 2
fi
if [ "$changed_file_count" -ge 3000 ]; then
  echo "ABSENT: exact main SHA $sha reached GitHub's 3000-file commit API cap; conditional paths cannot be proven complete"
  exit 2
fi
changed_files=$(printf '%s' "$commit_pages" | jq -c '
  [.[].files[] | .filename, (select(.status == "renamed") | .previous_filename)] | unique') || exit 2
parent_sha=$(printf '%s' "$commit_pages" | jq -r '.[0].parents[0].sha // ""') || exit 2
case "$parent_sha" in
  *[!0-9a-f]*|"") echo "ABSENT: exact main SHA $sha has no valid full first-parent identity"; exit 2 ;;
esac
[ ${#parent_sha} -eq 40 ] || { echo "ABSENT: exact main SHA $sha has no valid full first-parent identity"; exit 2; }
if ! conditional_gate_lines=$(matching_conditional_gates_at_refs "$changed_files" "$parent_sha" "$sha"); then
  echo "ABSENT: conditional gate policy is missing, invalid, or unreadable at exact main SHA $sha or its parent"
  exit 2
fi
conditional_gates=$(printf '%s\n' "$conditional_gate_lines" | jq -s -c 'unique_by(tojson)[]')

verify_conditional_main_gates() {
  local pending=0 gate gate_id gate_checks gate_state workflow run_json runs count latest status conclusion run_id run_url jobs_json
  while IFS= read -r gate; do
    [ -n "$gate" ] || continue
    gate_id=$(printf '%s' "$gate" | jq -r .id)
    gate_checks=$(printf '%s' "$gate" | jq -c .checks)
    workflow=$(printf '%s' "$gate" | jq -r .mainWorkflow)
    if run_json=$(gh run list --workflow "$workflow" --branch "$branch" --limit 30 --json databaseId,headSha,status,conclusion,url,workflowName,event 2>/dev/null); then
      runs=$(printf '%s' "$run_json" | jq --arg sha "$sha" '[.[] | select(.headSha == $sha and .event == "push")]')
    else
      runs='[]'
    fi
    count=$(printf '%s' "$runs" | jq 'length')
    if [ "$count" -eq 0 ]; then
      echo "WAIT: $gate_id main workflow '$workflow' is absent for exact SHA $sha"
      pending=1
      continue
    fi

    latest=$(printf '%s' "$runs" | jq '.[0]')
    status=$(printf '%s' "$latest" | jq -r .status)
    [ "$status" = "completed" ] || {
      echo "WAIT: $gate_id main workflow '$workflow' is still pending for exact SHA $sha"
      pending=1
      continue
    }
    conclusion=$(printf '%s' "$latest" | jq -r '.conclusion // ""')
    run_id=$(printf '%s' "$latest" | jq -r .databaseId)
    run_url=$(printf '%s' "$latest" | jq -r .url)
    if [ "$conclusion" = "cancelled" ]; then
      if [ "$rerun_cancelled" -eq 0 ]; then
        echo "ABSENT: $gate_id run $run_id was cancelled; conditional proof cannot be compensated: $run_url"
      elif [ "$rerun_requested" -eq 0 ]; then
        echo "$gate_id run $run_id was cancelled. Requesting the one authorized rerun."
        rerun_requested=1
        gh run rerun "$run_id" >/dev/null 2>&1 \
          || echo "ABSENT: the authorized $gate_id rerun request failed; investigate before another mutation"
      else
        echo "WAIT: the one authorized rerun was already requested; $gate_id proof is still absent"
      fi
      pending=1
      continue
    elif [ "$conclusion" = "failure" ] || [ "$conclusion" = "timed_out" ] \
      || [ "$conclusion" = "action_required" ] || [ "$conclusion" = "startup_failure" ]; then
      echo "RED: $gate_id main workflow completed with '$conclusion': $run_url"
      return 1
    elif [ "$conclusion" != "success" ]; then
      echo "WAIT: $gate_id main workflow concluded '$conclusion'; exact host proof is absent: $run_url"
      pending=1
      continue
    fi

    if ! jobs_json=$(gh run view "$run_id" --json jobs 2>/dev/null); then
      echo "WAIT: $gate_id workflow is green but its exact job matrix cannot be read: $run_url"
      pending=1
      continue
    fi
    if ! gate_state=$(printf '%s' "$jobs_json" | jq -r -L "$sdir" --argjson names "$gate_checks" '
      include "checks-classifier";
      .jobs | classify_named_checks($names)'); then
      gate_state="CLASSIFIER_ERROR"
    fi
    case "$gate_state" in
      PASS) echo "GREEN: $gate_id exact workflow and every required job succeeded for $sha: $run_url" ;;
      FAIL) echo "RED: $gate_id contains a genuine failed required job: $run_url"; return 1 ;;
      NONE|PENDING) echo "WAIT: $gate_id required job matrix is missing or pending at exact SHA $sha: $run_url"; pending=1 ;;
      CANCELLED) echo "WAIT: $gate_id contains a cancelled required job at exact SHA $sha: $run_url"; pending=1 ;;
      *) echo "WAIT: $gate_id required job matrix could not be classified safely: $run_url"; pending=1 ;;
    esac
  done <<< "$conditional_gates"
  [ "$pending" -eq 0 ] && return 0
  return 2
}

start=$(date +%s)
appeared=0
while :; do
  if run_json=$(gh run list --workflow "$workflow" --branch "$branch" --limit 30 --json databaseId,headSha,status,conclusion,url,workflowName,event 2>/dev/null); then
    runs=$(printf '%s' "$run_json" | jq --arg sha "$sha" '[.[] | select(.headSha == $sha and .event == "push")]')
  else
    runs='[]'
  fi
  count=$(printf '%s' "$runs" | jq 'length')

  if [ "$count" -gt 0 ]; then
    appeared=1
    latest=$(printf '%s' "$runs" | jq '.[0]')
    status=$(printf '%s' "$latest" | jq -r .status)
    if [ "$status" = "completed" ]; then
      conclusion=$(printf '%s' "$latest" | jq -r '.conclusion // ""')
      run_id=$(printf '%s' "$latest" | jq -r .databaseId)
      run_url=$(printf '%s' "$latest" | jq -r .url)
      if [ "$conclusion" = "success" ]; then
        if [ -n "$artifact" ]; then
          if ! artifact_json=$(gh api "repos/{owner}/{repo}/actions/runs/$run_id/artifacts" 2>/dev/null); then
            echo "ABSENT: '$workflow' is green for $sha, but its artifact inventory could not be read: $run_url"
            exit 2
          fi
          artifact_id=$(printf '%s' "$artifact_json" | jq -r --arg artifact "$artifact" \
            '.artifacts[] | select(.name == $artifact and (.expired | not)) | .id' | head -1)
          if [ -z "$artifact_id" ]; then
            echo "INCOMPLETE: workflow '$workflow' is green for $sha, but release artifact '$artifact' is absent or expired: $run_url"
            echo "Stop the train. Green code without the promised release object is not complete CD evidence."
            exit 1
          fi
          echo "ARTIFACT: $artifact (id $artifact_id) on run $run_url"
        fi
        if verify_conditional_main_gates; then
          echo "GREEN: completed successful '$workflow' push run for $sha: $run_url"
          exit 0
        else
          conditional_status=$?
          [ "$conditional_status" -eq 1 ] && exit 1
        fi
      elif [ "$conclusion" = "cancelled" ]; then
        if [ "$rerun_cancelled" -eq 0 ]; then
          echo "ABSENT: main run $run_id for $sha was cancelled: $run_url"
          echo "Diagnose the cancellation, then rerun once explicitly or invoke this command with --rerun-cancelled."
          exit 2
        elif [ "$rerun_requested" -eq 0 ]; then
          echo "Run $run_id was cancelled. Requesting the one authorized rerun; cancellation is absent proof, not green."
          if gh run rerun "$run_id" >/dev/null 2>&1; then
            rerun_requested=1
          else
            echo "ABSENT: the authorized rerun request failed. Investigate before another mutation."
            exit 2
          fi
        else
          echo "WAIT: the authorized rerun has been requested; waiting for its replacement attempt."
        fi
      else
        echo "RED: main run for $sha completed with '$conclusion': $run_url"
        echo "Stop the train. Inspect logs; mechanical cause → fix + re-prove; otherwise escalate."
        exit 1
      fi
    fi
  fi

  now=$(date +%s)
  if [ $((now - start)) -ge "$timeout" ]; then
    if [ "$appeared" -eq 0 ]; then
      echo "ABSENT: no $branch run ever appeared for $sha within ${timeout}s."
      echo "Possible causes: workflow doesn't trigger on push to $branch, or the run attached to a different sha. Investigate — absence is not green."
    else
      echo "TIMEOUT: run(s) for $sha still not conclusively green after ${timeout}s."
    fi
    exit 2
  fi
  sleep "$poll_interval"
done
