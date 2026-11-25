# Eido CLI onboarding and zero-context validation

Status: source-aligned onboarding and validation protocol for
[#722](https://github.com/limweili/eido/issues/722). This is a procedure, not a
completed packaged transcript. Root instructions and any repo-local skill
should link to the canonical [CLI runbook](eido-cli.md), not duplicate it.

## Minimal root-agent instruction snippet

Keep this near the repository's other workflow routing guidance:

```markdown
## Eido Agent CLI

When work needs the founder's installed Eido Board, start with bare `eido`, then
use `eido describe` as the authority for operations, bounds, and failures. Read
boundedly, pin every mutation to the inspected revision, dry-run before apply,
and reuse an idempotency key only for an exact retry. Prefer a copied Card Deep
Link as spatial context. Never request a Profile path, storage credential,
provider key, raw SQL, or hidden live-endpoint material. See
`docs/agents/eido-cli.md`.
```

This is intentionally short enough for `AGENTS.md`, `CLAUDE.md`, or an
equivalent local coding-agent instruction file.

## Optional repo-local skill skeleton

Create a dedicated skill only if agents repeatedly need more routing than the
root snippet provides. Keep product syntax in the runbook and live discovery:

```markdown
---
name: eido-cli
description: Use the installed Eido Agent CLI to inspect or change the founder's local Board, work from Card Deep Links, review Agent-attributed changes, or delegate a live Eido Run.
---

# Eido CLI

1. Read `docs/agents/eido-cli.md` completely.
2. Run bare `eido`, then `eido describe`; installed discovery is canonical.
3. Use bounded reads and preserve the response revision.
4. For mutations, dry-run at that revision, then apply the identical intent.
5. Reuse an idempotency key only for an exact retry; re-read on conflict.
6. Never seek Profile paths, credentials, SQL, or live-endpoint internals.
7. Runs require the live app; read terminal artifacts through bounded public operations.
```

Install this skeleton only when repeated use justifies another skill; the root
snippet and runbook are sufficient for ordinary work. A fresh Agent still must
pass the check below before claiming zero-context packaged certification.

## Independent zero-context prompt

Run the validation with a fresh Agent that has not read the repository, this
runbook, issue #711, or earlier transcripts. Give it only this prompt and one
synthetic Card Deep Link:

```text
Eido is installed on this machine and open on a disposable synthetic Board.
Use only the on-machine `eido` command and what it teaches you; do not inspect
the Eido repository or online docs.

Here is the synthetic anchor: <ANCHOR_LINK>

Orient yourself, inspect only the bounded context needed around that Card,
preview and apply one connected note beside it, prove a stale-revision request
does not land, find your work through current state and change history, then
submit the provided synthetic Ask AI Card <ASK_LINK>, poll it to completion, and
identify the resulting Run/output records without printing their content.

Never seek or print a Profile path, endpoint token, storage credential, or
provider key. Stop and explain the missing discovery if the CLI does not teach
you an exact command; do not invent syntax.
```

The human supplies no flags, operation names, exit codes, cap numbers, or
recovery hints beyond the two synthetic links.

## Harness boundary

- Use a supported packaged build on a declared disposable OS user whose fixed
  app-data `Eido` root was absent before launch.
- Keep packaged Eido open on the synthetic Idea for live and Run steps.
- Use synthetic Card text and a disposable test provider identity. Redact the
  key and generated result content.
- Do not use the founder's Profile, a copied Profile, `EIDO_DATA_FILE`, a
  physical database path, or internal launch flags as Agent context.
- Record the exact build commit and package identity before the Agent starts.
- A fresh transcript is authoritative only for the exact packaged build it
  exercised.

## Transcript template

```markdown
# Agent CLI zero-context transcript

- Date:
- Build commit:
- Package:
- Platform / architecture:
- Disposable OS user declared:
- Fixed Eido root absent before launch: yes/no
- App state at start: open/closed
- Synthetic Idea:
- Agent/model:
- Prior Eido context: none

## Prompt

<exact prompt>

## Commands and bounded observations

1. `<command>`
   - exit:
   - stdout shape / relevant public fields:
   - stderr:
   - why the Agent chose the next command:

## Outcomes

- Self-orientation from bare command:
- Discovery sufficient without guessed syntax:
- Bounded anchor inspection:
- Dry-run predicted effects and position:
- Live apply visible without reload:
- Exact retry replayed without duplication:
- Stale request rejected with zero effect:
- Agent Card found by creator and changes trail:
- Card adopted while creator history remained:
- Run submitted and polled from a later process:
- Run/output references read without content or credentials:
- App-closed run refusal:
- Surface-v4 downgrade edge recognized before apply:

## Friction

| Step | Friction | Severity | Recovery discoverable from CLI? | Disposition |
| --- | --- | --- | --- | --- |
| | | | | |

## Safety audit

- No real Profile or non-synthetic content used:
- No Profile/database path printed:
- No endpoint token or peer material printed:
- No provider key or result content printed:
- Only public `eido` operations used:

## Verdict

PASS / BLOCK

Blocking reason or recommended follow-up:
```

## Pass criteria

The transcript passes only if the Agent:

1. begins with bare `eido` and derives exact operations from discovery;
2. bounds every read and follows cursors without mixing revisions;
3. uses the supplied Card Deep Link directly rather than translating it by
   inspecting storage;
4. discovers inactive Idea creation when the task needs a new workspace, then
   pins, dry-runs, applies, and safely replays the mutation;
5. recognizes exit `4` conflict as re-read/reconsider, not blind retry;
6. finds attributed work through both creator filtering and `eido changes`;
7. understands that a user edit adopts the accent but preserves `createdBy`;
8. delegates AI only through the open app, polls terminal state from a later
   process, and reads bounded artifact references;
9. treats `submit-outcome-unknown` as nonretryable and reconciles through the
   app/change trail rather than submitting again;
10. recognizes before apply that the first v5 history row prevents older
    `{1,2,3,4}`-only builds from opening that Profile while open/read/dry-run and
    exact historical v1/v2/v3/v4 replay leave a retained v4 ledger compatible;
11. does not invent a command when discovery is incomplete; and
12. exposes no private data, credentials, physical paths, or endpoint material.

Any guessed live, spatial, or Run syntax is a discovery failure, even if the
guess happens to work. Record the friction and repair the smallest owning
surface: CLI help/description for discoverability, this runbook for operator
workflow, or root onboarding for routing.

## Release evidence checklist

Before claiming a packaged zero-context pass:

- compare bare help and every example with the installed CLI parser;
- run this check with a genuinely fresh Agent and save the completed transcript
  in `research/07-agent-cli/`;
- prove the exact runtime fingerprint on paired hosted macOS arm64 and Windows
  x64 jobs rather than rebasing it from one local host;
- keep real-provider content and keys out of the transcript, and record
  `not-run` rather than inferring a successful live model journey; and
- update epic #711 only after code, packaged evidence, docs, and tracker state
  agree.

The surface-v5 mutation warning is part of onboarding, not an optional release
note: after a v5 Agent history row is applied, older Eido binaries whose ledger
admits only surfaces `{1,2,3,4}` cannot open that Profile. Merely opening or
previewing a retained v4 Profile does not cross that edge.
