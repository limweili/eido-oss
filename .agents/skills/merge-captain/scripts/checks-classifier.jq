# checks-classifier.jq — shared by pr-map.sh and pr-gate.sh (jq module).
# Classifies checks as NONE / PENDING / CANCELLED / FAIL / PASS.
# A check named with the exact suffix " (non-blocking)" is an observable
# canary that needs triage. " (experimental)" is opt-in research evidence:
# it stays queryable but never enters the merge verdict.
#
# gh returns two shapes in the rollup: CheckRun {status, conclusion} and
# legacy StatusContext {state}. Both are handled, case-insensitively.
# Anything unrecognized is treated as PENDING, never as green — a signal we
# cannot read is an absent signal, and absence is not green.
def _norm: if . == null then "" else (tostring | ascii_upcase) end;
def is_nonblocking_check:
  ((.name // .context // "") | endswith(" (non-blocking)"));
def is_experimental_check:
  ((.name // .context // "") | endswith(" (experimental)"));
def is_optional_check:
  is_nonblocking_check or is_experimental_check;
def _check_key:
  (.name // .context // "");
def _attempt_time:
  (.startedAt // .createdAt // .completedAt // "");
# GitHub may retain a cancelled attempt beside a later rerun with the same
# check name. A current-head verdict uses the newest attempt for each named
# signal; otherwise a superseded cancellation can permanently hide green proof.
def latest_check_attempts:
  group_by(_check_key) | map(max_by(_attempt_time));
def _classify_check_list:
  if length == 0 then "NONE"
  else
    map(
      if (.state | _norm) != "" then
        # StatusContext shape
        ((.state | _norm) as $s |
         { done: (["SUCCESS","FAILURE","ERROR"] | index($s) != null),
           bad:  (["FAILURE","ERROR"] | index($s) != null),
           cancelled: false,
           good: ($s == "SUCCESS") })
      else
        # CheckRun shape
        ((.status | _norm) as $st | (.conclusion | _norm) as $c |
         { done: ($st == "COMPLETED"),
           bad:  (["FAILURE","TIMED_OUT","ACTION_REQUIRED","STARTUP_FAILURE"] | index($c) != null),
           cancelled: ($c == "CANCELLED"),
           good: (["SUCCESS","NEUTRAL","SKIPPED"] | index($c) != null) })
      end
    ) as $cs
    | if ([$cs[] | select(.bad)] | length) > 0 then "FAIL"
      elif ([$cs[] | select(.done | not)] | length) > 0 then "PENDING"
      elif ([$cs[] | select(.cancelled)] | length) > 0 then "CANCELLED"
      elif ([$cs[] | select(.good | not)] | length) > 0 then "PENDING"
      else "PASS" end
  end;
def classify_checks:
  latest_check_attempts | map(select(is_optional_check | not)) | _classify_check_list;
def classify_nonblocking_checks:
  latest_check_attempts | map(select(is_nonblocking_check)) | _classify_check_list;
def classify_experimental_checks:
  latest_check_attempts | map(select(is_experimental_check)) | _classify_check_list;

# Conditional release-profile gates name every signal they require. Unlike the
# broad rollup, each named signal must exist and conclude SUCCESS; neutral or
# skipped cannot stand in for an absent platform proof.
def _classify_exact_success_check_list:
  if length == 0 then "NONE"
  else
    map(
      if (.state | _norm) != "" then
        ((.state | _norm) as $s |
         { done: (["SUCCESS","FAILURE","ERROR"] | index($s) != null),
           bad: (["FAILURE","ERROR"] | index($s) != null),
           cancelled: false,
           good: ($s == "SUCCESS") })
      else
        ((.status | _norm) as $st | (.conclusion | _norm) as $c |
         { done: ($st == "COMPLETED"),
           bad: (["FAILURE","TIMED_OUT","ACTION_REQUIRED","STARTUP_FAILURE"] | index($c) != null),
           cancelled: ($c == "CANCELLED"),
           good: ($c == "SUCCESS") })
      end
    ) as $cs
    | if ([$cs[] | select(.bad)] | length) > 0 then "FAIL"
      elif ([$cs[] | select(.done | not)] | length) > 0 then "PENDING"
      elif ([$cs[] | select(.cancelled)] | length) > 0 then "CANCELLED"
      elif ([$cs[] | select(.good | not)] | length) > 0 then "PENDING"
      else "PASS" end
  end;
def _named_check_attempts($names):
  latest_check_attempts
  | map(select((.name // .context // "") as $key | ($names | index($key)) != null));
def classify_named_checks($names):
  _named_check_attempts($names) as $present
  | ($present | _classify_exact_success_check_list) as $state
  | if $state == "FAIL" then "FAIL"
    elif ($present | length) < ($names | unique | length) then
      if ($present | length) == 0 then "NONE" else "PENDING" end
    else $state end;
def has_genuine_named_check_failure($names):
  _named_check_attempts($names)
  | any(
      if (.state | _norm) != "" then
        ((.state | _norm) as $state | ["FAILURE","ERROR"] | index($state) != null)
      else
        ((.conclusion | _norm) as $conclusion
         | ["FAILURE","TIMED_OUT","ACTION_REQUIRED","STARTUP_FAILURE"]
         | index($conclusion) != null)
      end
    );

# A provider outage may leave required checks absent, pending, or cancelled.
# It may never turn an actual test failure into a pass. Keep this predicate
# separate from the five-state display classification so callers can make
# that distinction mechanically.
def has_genuine_required_failure:
  latest_check_attempts
  | map(select(is_optional_check | not))
  | any(
      if (.state | _norm) != "" then
        ((.state | _norm) as $state | ["FAILURE","ERROR"] | index($state) != null)
      else
        ((.conclusion | _norm) as $conclusion
         | ["FAILURE","TIMED_OUT","ACTION_REQUIRED","STARTUP_FAILURE"]
         | index($conclusion) != null)
      end
    );
