# Landing loop — mutate shared state deliberately

## 1. Inventory and order

- Derive the requested changes from live repository and tracker state.
- Read each change's intent, diff, review boundary, base, dependencies, and
  affected shared surfaces.
- Order by real dependencies and preservation needs. A dependency branch or
  artifact remains protected until every consumer is safe.
- Record only the resources this landing effort demonstrably owns.

## 2. Establish readiness

- Determine required evidence from current repository policy and change risk.
- Verify review debt, current-head proof, mergeability or equivalent
  integration readiness, and data-safety requirements.
- Confirm that hosted merge checks tested against the current main tip. On GitHub
  Actions, rerunning a failed job reuses that run's original synthetic merge ref,
  and closing and reopening a PR fires before GitHub recomputes the merge ref
  after main has moved. Read the checkout step's merge line or printed git log to
  confirm the base matches the current main tip before trusting a green gate; if
  stale, wait for the merge ref to recompute or push an empty-diff refresh to run
  a fresh pull_request event, rather than rerunning failed jobs.
- Classify required signals as verified now, stale, or absent.
- Reuse existing valid proof. Generate compensation only when policy permits,
  the normal source is diagnosed unavailable, and the compensation proves the
  same claim at the exact identity.
- Investigate relevant red optional signals and report their disposition
  without silently promoting or waiving them.

## 3. Refresh safely

- Integrate the current shared base in an isolated location.
- Preserve user-owned and unrelated work.
- Resolve mechanical conflicts only when the intended result is already
  authoritative. Escalate conflicts that change product, architecture,
  persistence, security, or public semantics.
- Use the narrowest re-review and revalidation that covers the actual delta.
  An identical patch needs lineage proof; a changed patch needs affected
  behavior proof.

## 4. Mutate one step

Immediately before a consequential action, write down the expected live state
and re-read it. Apply one authorized mutation. Verify the result before doing
anything that assumes success.

Serialize mutations that compete for the same shared state or invalidate one
another's proof. Parallel read-only preparation is encouraged; parallel
irreversible mutation is not.

## 5. Verify the shared result

Use the repository's declared post-landing proof for the exact landed identity.
Do not substitute an earlier branch result when integration can change
behavior. Do not run unrelated local mirrors when authoritative shared proof
already exists.

If a required result is cancelled or absent, restore that proof or use an
explicitly permitted equivalent. A genuine red result remains red until its
cause is understood and repaired.

## 6. Reconcile and report

- Re-read dependents before deleting bases, branches, artifacts, or workspaces.
- Update tracker state from the landed outcome.
- Delete only demonstrably owned resources, and verify deletion.
- Report landed identities, current proof, repairs made, optional-signal
  triage, preserved resources, and residual risk.

The loop is complete only when shared state, evidence, tracker state, and
resource ownership agree.
