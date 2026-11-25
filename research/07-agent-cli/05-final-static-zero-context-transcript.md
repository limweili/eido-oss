# Final Agent CLI static zero-context transcript

Captured: 2026-07-22 from the identity-null macOS arm64 package built at
`b5970f1`. Scope: installed static discovery only. This is not the disposable
live-Board/provider walkthrough.

## Boundary

A fresh GPT-5.6 Sol evaluator received only the packaged `eido` executable and
these restrictions:

- invoke only bare help and `describe`/`describe <operation>`;
- do not inspect the repository, Git, environment, app-data, or online docs;
- do not invoke anything that opens, reads, mutates, or runs a Profile; and
- derive exact workflows from discovery, or report what is missing rather than
  guess.

The evaluator invoked only those static modes. No Profile, Board, provider,
credential, endpoint, or model output participated.

## First pass and repair

The first packaged discovery pass derived the spatial, mutation, attribution,
and delegated-Run workflows, but found two public-contract gaps:

1. help called all three mutation flags mandatory even though the ergonomic
   parser generates an idempotency key when it is omitted; and
2. the surface-v3 downgrade edge existed in repository docs but not in the
   installed command's static discovery.

The owning help contract was corrected and regression-tested, then the package
was regenerated. On the final pass, bare `eido` taught all of the following:

- every mutation requires an expected revision and exactly one of dry-run or
  apply;
- an idempotency key is generated when omitted; a scripted apply supplies and
  reuses one explicit key only for its exact retry;
- moving from preview to apply is a new request and should use a different key;
- fresh mutations use surface v3 and historical v1/v2 receipts retain exact
  replay; and
- after the first applied v3 mutation, an older build whose Agent ledger admits
  only `{1,2}` cannot open that Profile.

## Commands derived without repository context

The evaluator derived these templates from bare help plus the named Gateway
descriptors:

```bash
eido graph neighbors CARD_OR_LINK [--idea IDEA] --limit N --byte-limit BYTES
eido graph bounds CARD_OR_LINK... [--idea IDEA]

eido card create --idea IDEA --kind note \
  --near ANCHOR --body 'TEXT' --connect-from ANCHOR \
  --expected-revision REV --dry-run \
  --idempotency-key PREVIEW_KEY

eido card create --idea IDEA --kind note \
  --near ANCHOR --body 'TEXT' --connect-from ANCHOR \
  --expected-revision REV --apply \
  --idempotency-key APPLY_KEY

eido graph query --creator agent --kind card --limit N --byte-limit BYTES
eido changes --since REV --limit N --byte-limit BYTES

eido run ASK_CARD_OR_LINK [--idea IDEA]
eido run status RUN_ID
eido run read RUN_ID --limit N --byte-limit BYTES [--cursor CURSOR]
eido record get RETURNED_RECORD_ID
```

It also derived the correct failure actions: re-read and reconsider after a
revision conflict; open Eido for `live-app-required`; do not retry after denied
grant or exhausted budget without an owner/policy change; and never resubmit an
`internal`/`submit-outcome-unknown` Run because admission may already have
happened.

The boundary was discoverable too: no Mod Card mutation, no Title Connection,
no Result-content creation/editing, no Conversation transcript or follow-up
answer writes, no raw SQL/generic patch/credential read, and no Agent commit in
the user's undo stack.

## Package check

The regenerated package independently passed:

- strict signature verification for `eido` and its native helper;
- deep strict verification for the application bundle;
- bare `eido`: exit `0`, 5,199 stdout bytes, zero stderr; and
- `eido describe --pretty`: exit `0`, 33,108 stdout bytes, zero stderr.

Both nested proof executables are explicitly ad-hoc signed. **Signing-scope
update (superseding the close-out expectation that Developer ID signing would
be hosted release evidence):** Friends Alpha validates the ad-hoc app and
nested-executable seals plus an unsigned DMG through paired hosted macOS
arm64/Windows x64 proof. It makes no Developer ID, notarization, or
Gatekeeper-acceptance claim.

## Remaining limits and verdict

`eido describe card.create` is intentionally not a descriptor—the raw installed
mutation seam is `command.batch`—so the ergonomic primitive syntax lives in
bare help. `submit-outcome-unknown` deliberately has no automatic
reconciliation command; static discovery teaches the safe stop/reconcile rule.

**Static zero-context verdict: PASS.** The packaged command orients a new caller
and teaches the exact bounded workflows and one-way compatibility edge without
repository help. The full live-Board, visual-adoption, and real-provider
walkthrough remains **NOT RUN** because close-out had no disposable provider
credential or disposable OS-user journey; source/package seams are not used to
infer that evidence.
