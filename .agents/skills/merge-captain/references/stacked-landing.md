# Landing a stack

A stack is an ordered chain of pull requests: the bottom targets the trunk and
each layer above targets the branch below it. The `gh-stack` skill owns
creating, splitting, and restructuring stacks. This file covers landing one.

## Read the stack before anything else

```bash
gh stack view --json
```

JSON goes to stdout, status text to stderr. Per branch it reports `isMerged`,
`isQueued`, `needsRebase`, and the pull request number and state. `needsRebase`
is true when the parent tip is no longer an ancestor of the branch, which means
that branch's proof describes a base that no longer exists.

Never run bare `gh stack view`, `submit`, `checkout`, or `modify` from an agent
session; they open a terminal UI and block. The `gh-stack` skill lists the
non-interactive form of every command.

## The merge set, not the pull request

`gh stack merge <pr> --yes` lands that pull request **and every unmerged layer
below it**. That set is the unit of readiness:

- Every layer in the set needs its own current required proof. A green top
  layer over a red third layer is an unready set.
- The operation is all-or-nothing. If any layer in the set cannot merge, none
  do, and the reason is reported.
- A layer cannot be landed while an unmerged dependency sits below it. When a
  middle layer is blocked, land up to the last ready layer below the blockage
  rather than retargeting anything to skip it.

Scope the merge deliberately: pass a pull request number to land that layer and
everything under it, or a stack number to land the whole stack.

```bash
gh stack merge 42 --yes --squash   # PR 42 and every unmerged PR below it
gh stack merge 7 --yes --squash    # every unmerged PR in stack 7
```

Without a method flag the last-used method is reused. `gh pr merge` cannot
merge a stack.

**Merge queue overrides everything.** When the trunk uses a merge queue, the
set is queued rather than merged, the queue picks the method, and any method
flag is ignored with a warning. Queued layers may land in separate groups, so
treat the stack as landed only when live state says so.

## After a partial merge

GitHub retargets and rebases every layer above the cut. Consequences:

- Exact-head proof above the cut is **stale** the moment the merge lands. New
  heads need current proof before the next merge set.
- Approvals above the cut can vanish if the repository dismisses reviews on new
  pushes. See the settings below.
- Local branches are behind until `gh stack sync` runs. `--prune` also deletes
  local branches for merged layers.

```bash
gh stack sync --prune
gh stack view --json
```

`sync` exits **0** with `Sync aborted` when the local and remote stacks have
diverged, having changed nothing. Success there does not mean synced; read the
message or re-check the JSON.

Squash merges are handled automatically: `sync` and `rebase` replay with
`--onto` against the correct target rather than replaying commits that no
longer exist.

## One writer per stack

Any rebase low in a stack rewrites every branch above it. A stack is therefore
a single serialized mutation, not a set of independent ones. While a merge,
rebase, or sync is in flight, exactly one role may move any branch in that
stack. Exit **8** means another process holds the lock; wait about five seconds
and retry.

## Review practices worth enforcing

These belong to the author and the reviewer, but the landing role sees the
consequences and should send work back when they are missing.

- **Each layer reads as an independent change.** If a layer only makes sense
  with context from the layers above, the split is wrong. Send it back rather
  than approving on faith.
- **Review starts at the bottom** and does not wait for lower layers to merge.
  Waiting serializes review and gives back the time the stack was meant to save.
- **Open means ready.** A layer still being worked on is a draft. Submit early
  as drafts to get architecture feedback before implementation is finished.
- **Reviewers are chosen per layer.** The schema change and the UI layer rarely
  want the same reviewer.
- **Each description states its place in the sequence**, for example
  `Part 2 of 3: adds the API on top of the user model`.
- **Two to five layers** read better than a long chain of micro changes. Order
  them by dependency: shared types, migrations, and core logic below their
  consumers.

## Repository settings that keep stacks landable

Cascading rebases rewrite branches constantly, so review-dismissal settings
fight the workflow. Where required approvals are configured, leave both of
these off:

- **dismiss stale approvals**
- **require approval of the most recent reviewable push**

With either on, a partial merge silently strips approvals from the layers above
and the train stalls on re-approval rather than on real risk. Read the live
setting before assuming either state:

```bash
gh api repos/<owner>/<repo>/branches/<trunk>/protection \
  --jq '.required_pull_request_reviews // "no required reviews"'
```

Required status checks are the other cost. Every layer is checked against the
trunk independently, so an N-layer stack runs the full required gate N times.
That is the price of independent reviewability, and it is the reason to keep a
stack shallow rather than to weaken the gate.
