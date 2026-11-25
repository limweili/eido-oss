#!/usr/bin/env bash
# Generic adapter for repository-owned conditional release gates.

conditional_gates_file() {
  if [ -n "${MERGE_CAPTAIN_RELEASE_GATES_FILE:-}" ]; then
    printf '%s\n' "$MERGE_CAPTAIN_RELEASE_GATES_FILE"
    return
  fi
  local declaration
  declaration=$(conditional_gates_declaration | head -1)
  printf '%s\n' "${declaration:-docs/agents/release-gates.json}"
}

conditional_gates_declaration() {
  local release_profile="${MERGE_CAPTAIN_RELEASE_PROFILE:-docs/agents/release-profile.md}"
  [ -f "$release_profile" ] || return 0
  sed -n 's/^<!-- merge-captain:conditional-gates=\([^ ]*\) -->$/\1/p' "$release_profile"
}

conditional_gates_required() {
  [ -n "${MERGE_CAPTAIN_RELEASE_GATES_FILE:-}" ] || [ -n "$(conditional_gates_declaration)" ]
}

validate_conditional_gates() {
  local policy_file="$1"
  validate_conditional_gates_json < "$policy_file"
}

validate_conditional_gates_json() {
  jq -e '
    .schemaVersion == 1
    and (.conditionalGates | type == "array")
    and ([.conditionalGates[].id] | length == (unique | length))
    and all(.conditionalGates[];
      (.id | type == "string" and length > 0)
      and (.pathPatterns | type == "array" and length > 0 and length == (unique | length)
        and all(.[]; type == "string" and length > 0))
      and (.checks | type == "array" and length > 0 and length == (unique | length)
        and all(.[]; type == "string" and length > 0))
      and (.mainWorkflow | type == "string" and length > 0)
      and .providerCompensation == "forbidden")
  ' >/dev/null
}

matching_conditional_gates() {
  local policy_file="$1" files_json="$2" gate
  while IFS= read -r gate; do
    if conditional_gate_matches_paths "$gate" "$files_json"; then
      printf '%s\n' "$gate"
    fi
  done < <(jq -c '.conditionalGates[]' "$policy_file")
}

conditional_gate_matches_paths() {
  local gate_json="$1" files_json="$2" pattern changed_path
  while IFS= read -r pattern; do
    while IFS= read -r changed_path; do
      case "$changed_path" in
        $pattern) return 0 ;;
      esac
    done < <(printf '%s' "$files_json" | jq -r '.[]')
  done < <(printf '%s' "$gate_json" | jq -r '.pathPatterns[]')
  return 1
}

provider_file_at_ref() {
  local ref="$1" path="$2"
  gh api \
    -H 'Accept: application/vnd.github.raw+json' \
    "repos/{owner}/{repo}/contents/$path?ref=$ref"
}

conditional_policy_at_ref() {
  local ref="$1" release_profile="docs/agents/release-profile.md" profile policy_path policy
  if [ -n "${MERGE_CAPTAIN_RELEASE_PROFILE:-}" ]; then
    [ "${MERGE_CAPTAIN_ALLOW_LOCAL_POLICY_FOR_TESTS:-}" = "1" ] || return 2
    release_profile="$MERGE_CAPTAIN_RELEASE_PROFILE"
  fi
  if ! profile=$(provider_file_at_ref "$ref" "$release_profile" 2>/dev/null); then
    return 2
  fi
  policy_path=$(printf '%s' "$profile" | sed -n 's/^<!-- merge-captain:conditional-gates=\([^ ]*\) -->$/\1/p' | head -1)
  [ -n "$policy_path" ] || return 0
  case "$policy_path" in
    /*|*..*|*[!A-Za-z0-9._/-]*) return 2 ;;
  esac
  if ! policy=$(provider_file_at_ref "$ref" "$policy_path" 2>/dev/null); then
    return 2
  fi
  printf '%s' "$policy" | validate_conditional_gates_json || return 2
  printf '%s' "$policy" | jq -c .
}

matching_conditional_gates_at_refs() {
  local files_json="$1" ref policy gate
  shift

  # Local policy injection exists only for hermetic contract tests. Delivery
  # must bind policy to the provider base/head or parent/head identities.
  if [ -n "${MERGE_CAPTAIN_RELEASE_GATES_FILE:-}" ]; then
    [ "${MERGE_CAPTAIN_ALLOW_LOCAL_POLICY_FOR_TESTS:-}" = "1" ] || return 2
    validate_conditional_gates "$MERGE_CAPTAIN_RELEASE_GATES_FILE" || return 2
    matching_conditional_gates "$MERGE_CAPTAIN_RELEASE_GATES_FILE" "$files_json"
    return
  fi

  for ref in "$@"; do
    [ -n "$ref" ] || continue
    if ! policy=$(conditional_policy_at_ref "$ref"); then
      return 2
    fi
    [ -n "$policy" ] || continue
    while IFS= read -r gate; do
      [ -n "$gate" ] || continue
      if conditional_gate_matches_paths "$gate" "$files_json"; then
        printf '%s\n' "$gate"
      fi
    done < <(printf '%s' "$policy" | jq -c '.conditionalGates[]')
  done
}
