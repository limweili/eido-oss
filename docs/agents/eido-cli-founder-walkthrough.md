# Founder walkthrough — judge the Agent CLI from felt use

Status: source-aligned manual procedure for
[#722](https://github.com/limweili/eido/issues/722). It is not a completed
evidence transcript. Run it only against a supported packaged build and derive
the installed bounds from that build's own `eido describe` output.

## What this walkthrough should prove

In one sitting, the founder can hand Eido a place on the canvas, let an Agent
inspect it without flooding context, preview a spatially related thought,
commit it into the open app, see who made it, experience a stale-revision
refusal, adopt the work, delegate a real Run, and read the result.

This is a product-feel check, not a second semantic test suite. Capture only
the evidence that would change whether the epic ships.

## Safety boundary and setup

Run this only on a supported packaged build in a declared disposable OS user.
The user's fixed app-data `Eido` root must be absent before the walkthrough.
Do not run it from the founder's ordinary account and do not redirect packaged
Eido with `EIDO_DATA_FILE`.

1. Record the build commit, platform, architecture, and package filename.
2. Launch packaged Eido. Let it create a fresh synthetic Profile.
3. Create a synthetic Idea named **Agent CLI Walkthrough**.
4. Create one note Card with the text **Synthetic story outline anchor**.
5. Copy that Card's Deep Link from the canvas. Call it `<ANCHOR_LINK>` below.
6. Keep Eido open on that Idea and open a terminal in an unrelated directory.
7. Start a transcript that excludes physical Profile paths, tokens, keys, and
   non-synthetic Card content.

The automated `npm run desktop:smoke` remains the authority for its existing
disposable-root package boundary. This interactive walkthrough adds felt-use
evidence; it does not replace or duplicate the smoke proof.

## 1. Orient from zero context

Run exactly what a new local Agent sees:

```bash
eido
eido describe --pretty
eido status --pretty
eido capabilities --pretty
```

Pass when the first command says what Eido is and points to discovery; the
registry explains operations, bounds, mutations, and failures without repo
knowledge; status exposes a current revision. Record that revision as
`<START_REVISION>`.

Before continuing, compare the commands below with `eido describe`. If
discovery cannot teach the same exact surface and limits, stop: the
zero-context contract has failed.

## 2. Inspect the copied place, boundedly

```bash
eido record get '<ANCHOR_LINK>' --projection payload --pretty
eido graph query --card '<ANCHOR_LINK>' --kind card --limit 1 \
  --projection id --projection kind --projection position --pretty
```

Pass when both commands resolve the same Card identity while ignoring viewport
hints, return one bounded page at `<START_REVISION>`, and reveal enough context
to decide what should be created beside it.

## 3. Preview one connected thought

The product idiom is one atomic connected-thought creation, placed near the
anchor inside the pinned commit:

```bash
eido card create --idea '<ANCHOR_LINK>' --kind note \
  --near '<ANCHOR_LINK>' --body 'Synthetic storyboard draft' \
  --connect-from '<ANCHOR_LINK>' --strength strong --polarity helps \
  --expected-revision <START_REVISION> --dry-run \
  --idempotency-key founder-walkthrough-thought-1 --pretty
```

Pass when the response predicts one new Card, one Connection, an exact
position, and a proposed revision without changing the open canvas.

## 4. Apply it and watch it land live

Repeat the same discovered intent with `--apply`, the same expected revision,
and a new apply key such as `founder-walkthrough-thought-1-apply`. Reuse that
apply key only if the exact apply request itself must be retried.

Pass when:

- the response advances the Profile exactly once and includes
  `cli: { version: 1, servedBy: "live", live: { state: "served" } }`;
- the new connected Card appears beside the anchor without reload or overlap;
- the Card has the Agent accent;
- the founder's selection, editor, camera, and user undo history remain intact;
- repeating the exact apply returns the original receipt as a replay rather
  than creating a duplicate.

Record the committed Card Deep Link as `<AGENT_CARD_LINK>` and the new revision
as `<APPLIED_REVISION>`.

## 5. Feel the stale-revision guard

Use the intentionally old `<START_REVISION>` with a new idempotency key:

```bash
eido card create --idea '<ANCHOR_LINK>' --kind note --x 10 --y 10 \
  --body 'This stale thought must not land' \
  --expected-revision <START_REVISION> --apply \
  --idempotency-key founder-walkthrough-intentional-stale --pretty
```

Pass when stdout contains `error.code: "conflict"`, the process exits `4`,
the response reports `<APPLIED_REVISION>` as current, and no Card appears.
The felt recovery should be obvious: inspect again, reconsider the intent,
then dry-run against the new head.

## 6. Find what the Agent did

In the GUI, open Board search, choose the Agent creator filter, and jump to the
new Card. Then compare the two CLI views:

```bash
eido graph query --creator agent --kind card --idea '<ANCHOR_LINK>' \
  --limit 20 --projection id --projection position \
  --projection createdBy --projection lastModifiedBy --pretty

eido changes --since <START_REVISION> --limit 50 --pretty
```

Pass when the current-state query finds the Card, the history lists only
Agent-attributed changes newest first, and its Deep Link returns the founder to
the right canvas place. Confirm the actor contains kind, client, and session.

## 7. Adopt the Card

Edit the Agent Card once in the GUI, for example by changing its synthetic text
to **Synthetic storyboard draft — adopted**.

Pass when the Agent accent clears without undoing or relocating the Card. Read
it again:

```bash
eido record get '<AGENT_CARD_LINK>' --projection payload --pretty
```

`createdBy.kind` must remain `agent`; `lastModifiedBy.kind` must now be `user`.
The Agent creator filter must still find the Card. Pressing Undo at this point
may undo the founder's own edit; it must not expose the Agent commit as a user
undo entry.

## 8. Trigger a real delegated Run

Create or use a synthetic Ask AI Card in the live walkthrough Idea and copy its
Deep Link as `<ASK_LINK>`. Use a test provider account/key installed only in
the disposable Eido settings; never put it in the transcript.

```bash
eido --agent-client founder-walkthrough \
  --agent-session founder-walkthrough-session \
  run '<ASK_LINK>' --pretty

eido run status '<RUN_ID>' --pretty
eido run read '<RUN_ID>' --limit 50 --byte-limit 65536 --pretty
eido record get '<RETURNED_RECORD_ID>' --pretty
```

`run status` is a poll; repeat it with bounded cadence until `done`, `failed`,
or `canceled`. Run the first status poll from a new process to prove app-scoped
cross-process lookup. Keep the same `--agent-session` only when testing shared
session accounting; status/read do not require it while the same app lifetime
retains the Run.

Pass when the ordinary Eido run indicator is visible, fresh upstream steps are
reused, stale upstream steps heal, the target Ask reruns, terminal status is
observable from a later CLI process, and the bounded artifact page leads to a
real Run record and output version. The Run must carry the same Agent
attribution and appear as `run.submit` in `eido changes`.

Also prove the two cheap failure boundaries:

- close Eido and submit again: it must fail with `live-app-required` and tell
  the caller to open Eido, never attempt headless AI execution;
- in the focused unit seam with injected caps, reserve through exhaustion: the
  next job must not start and must map `budget-exhausted` to
  `capability-denied`/exit `3`. Do not spend through production defaults to
  prove the guard; there is no public CLI cap override.

All three Run commands are live-only. App-closed `live-app-required` maps to
`busy`/exit `4`. A pre-read terminal gap returns
`run-not-finished` as `busy`/exit `4`. If submit returns
`internal`/exit `1` with reason `submit-outcome-unknown` and
`retryable: false`, do not submit again: inspect the live app and `eido changes`
and reconcile manually.

## 9. Close and record the verdict

The walkthrough passes only when every observable outcome above is present on
the packaged build. Record:

- build commit and package identity;
- supported OS/architecture;
- the synthetic task prompt and command transcript;
- start and final revisions;
- live/headless transport evidence using only public response fields;
- whether the Card landed near the anchor, was findable, and adopted cleanly;
- delegated Run terminal status and artifact kinds, without result content;
- each friction point, its severity, and whether it blocks zero-context use.

Then close Eido and remove only the disposable OS user's owned data using the
environment's ordinary teardown. Do not manually delete broad paths, copy the
Profile out, or retain it as evidence.

Use the companion
[zero-context validation template](eido-cli-onboarding-and-zero-context-check.md)
for the independent Agent transcript.

## Evidence boundary at source close-out

Do not mark this walkthrough complete from source tests or a no-key package
probe. Epic close-out had no disposable provider credential, so it did not
execute a paid model end to end. The package harness can prove discovery,
live/headless routing, bounded spatial reads, mutations, change history, and
live-only Run refusal without exposing credentials. Fresh paired hosted macOS
arm64 and Windows x64 certification remains the authority after a runtime
fingerprint change; local macOS cannot prove the Windows named-pipe/compiler
path or replace paired hosted validation of the current Alpha signing posture.
Friends Alpha uses ad-hoc signing for the app and its nested executables and an
unsigned DMG; it makes no Developer ID, notarization, or Gatekeeper-acceptance
claim.
