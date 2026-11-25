#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: classify-docs-only.sh <base-commit> <head-commit>" >&2
  exit 2
fi

docs_merge_base_ref="$1"
docs_merge_head_ref="$2"

git rev-parse --verify "${docs_merge_base_ref}^{commit}" >/dev/null
git rev-parse --verify "${docs_merge_head_ref}^{commit}" >/dev/null

docs_merge_count=0
docs_merge_denied=0

while IFS= read -r -d '' docs_merge_path; do
  docs_merge_count=$((docs_merge_count + 1))

  case "$docs_merge_path" in
    research/*|docs/*|retros/*|reports/*|sops/*|.agents/*|.claude/*|.codex/*|AGENTS.md|CLAUDE.md|CONTEXT.md|README.md|CHANGELOG.md|CONTRIBUTING.md|SECURITY.md|CODE_OF_CONDUCT.md)
      ;;
    *)
      echo "DENY path outside the non-production allowlist: $docs_merge_path" >&2
      docs_merge_denied=1
      continue
      ;;
  esac

  docs_merge_mode="$(git ls-tree "$docs_merge_head_ref" -- "$docs_merge_path" | awk 'NR == 1 { print $1 }')"
  if [ -z "$docs_merge_mode" ]; then
    docs_merge_mode="$(git ls-tree "$docs_merge_base_ref" -- "$docs_merge_path" | awk 'NR == 1 { print $1 }')"
  fi

  case "$docs_merge_mode" in
    120000|160000)
      echo "DENY symlink or submodule: $docs_merge_path" >&2
      docs_merge_denied=1
      ;;
  esac
done < <(git diff --name-only --no-renames -z "${docs_merge_base_ref}...${docs_merge_head_ref}")

if [ "$docs_merge_count" -eq 0 ]; then
  echo "DENY empty diff" >&2
  exit 1
fi

if [ "$docs_merge_denied" -ne 0 ]; then
  exit 1
fi

echo "docs-only scope: PASS ($docs_merge_count paths)"
