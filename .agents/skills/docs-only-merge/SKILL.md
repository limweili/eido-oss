---
name: docs-only-merge
description: Land non-production documentation PRs with focused local proof and suppressed hosted CI. Use for research, reports, retros, skills, SOPs, or agent-instruction changes that cannot affect shipped code, builds, workflows, dependencies, release artifacts, public sites, or runtime data.
---

# Docs-only merge

This is the narrow, low-cost specialization of `merge-captain`. Read
[`../merge-captain/SKILL.md`](../merge-captain/SKILL.md) and the repository
release profile before mutating shared state. This skill changes the evidence
choice for a proven non-production diff; it does not relax merge authorization,
preservation, or exact-state verification.

## Qualify the change

Use the lane only when the owner has authorized the PR merge and the complete
base-to-head diff is non-production. Run:

```sh
bash .agents/skills/docs-only-merge/scripts/classify-docs-only.sh <base> <head>
```

The classifier admits documentation and agent-workflow roots such as
`research/`, `docs/`, `retros/`, `reports/`, `sops/`, `.agents/`, `.claude/`,
and `.codex/`, plus the named root instruction documents. It rejects mixed
diffs, symlinks, and submodules.

Classification is necessary, not sufficient. Exit to the ordinary
`merge-captain` path when any changed content can alter:

- a shipped application, public site, package, build, test, deployment, or CI
  workflow;
- dependencies, lockfiles, release artifacts, update manifests, or runtime
  configuration;
- persisted data, schemas, migrations, credentials, permissions, or security
  boundaries;
- executable agent tooling whose focused behavior cannot be proven safely in
  an isolated fixture.

A path that merely looks like documentation does not outrank its effect.

## Produce minimal exact-head proof

Inspect the complete semantic diff and run `git diff --check`. Add only the
cheapest validator that can falsify the changed artifact:

- Markdown, research, retros, and SOPs: verify local links, named sources, and
  any required index entry.
- HTML reports: reuse current rendered evidence; otherwise perform a bounded
  parse or opening check and run the owning chassis/template validator when one
  exists.
- Skills and agent instructions: run `quick_validate.py` for each changed
  skill, inspect invocation and authorization boundaries, and exercise each
  changed helper script against an isolated fixture.
- Machine-readable documentation metadata: run its focused parser or schema
  check.

Do not install dependencies or run application, browser, native, packaging, or
full repository suites for a qualified diff. Reuse exact-head proof already
produced during authoring.

## Suppress hosted CI at both identities

Before opening the PR, inspect the live workflows. GitHub skip tokens suppress
`push` and `pull_request` workflows, not `pull_request_target`, `workflow_run`,
external provider checks, or repository automation. Stop if a paid automatic
path cannot be suppressed without changing shared settings.

Ensure the PR head commit message contains `[skip ci]`. Put it on the content
commit when the branch is owned; otherwise add one owned empty head commit
rather than rewriting user-owned history.

After pushing and opening the PR, verify the exact head has no workflow or
check runs. If one starts, cancel only that exact-head run immediately, record
the exposure, and diagnose before merging.

Required checks will remain absent. Use the admin override only because the
owner authorized this qualified lane. Preserve the skip token on the squash
commit itself:

```sh
gh pr merge <pr> --squash --admin \
  --subject '[skip ci] <plain-language title> (#<pr>)'
```

The merge subject must contain `[skip ci]`; a token present only on the PR head
is lost when GitHub creates a squash commit. Re-read the proposed subject
immediately before merging.

## Verify and reconcile

After the merge:

1. Verify the PR is merged and capture the exact merge SHA.
2. Verify the landed tree matches the reviewed PR head.
3. Confirm the merge commit message still contains `[skip ci]`.
4. Observe the exact merge SHA long enough for provider scheduling and confirm
   that no workflow or check run appeared.
5. If a run appears, cancel that exact run immediately and report the runner
   exposure; never describe the merge as zero-CI.
6. Delete only the merged, dependency-free topic branch owned by this work.

Completion means the intended non-production files are on the shared branch,
focused proof is current, no hosted runner started or any accidental run is
cancelled and disclosed, and owned branch resources are reconciled.
