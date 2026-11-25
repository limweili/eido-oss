# Desktop Release Captain

This is the active runbook for publishing Eido desktop releases. The Captain
owns planning, exact-current-main packaged certification, immutable target
declaration, publication to the update feed, live verification, recall of a
defective release, and fail-closed abort. The founder is not in the loop: the
Captain selects the version by rule and performs every mechanic end to end.

The historical alpha.7/alpha.8 publication tickets are evidence for already
immutable releases, not current release instructions. New releases use this
runbook. [`Release incident response`](release-incident-response.md) owns
standing maintenance and forward hotfixes; rollback or mutation of published
bytes remains forbidden.

## The chain, in one paragraph

Two manual workflows do the whole job.
[`Packaged certification`](../../.github/workflows/packaged-certification.yml)
builds both platforms from exact current `main`, signs, notarizes and staples
the macOS app and DMG, certifies the paired macOS updater ZIP, and mints a
`certificationSetId`.
[`Desktop release publication`](../../.github/workflows/desktop-release.yml)
downloads those exact artifacts, refuses anything certification did not bless,
generates and signs the update manifest, uploads to Cloudflare R2, and then
reads the live feed back as a shipped client would. Nothing between them
rebuilds, repacks, or renames a byte.

The first installed macOS acceptance result is recorded in
[`17-macos-0.1.17-to-0.1.18-field-proof.md`](../../research/05-production-release/17-macos-0.1.17-to-0.1.18-field-proof.md): one consent click on certified 0.1.17 led to a certified 0.1.18 Squirrel replacement and automatic relaunch. That record is evidence, not a shortcut around the two workflows; every later release still starts from a fresh exact-main read and a new certification set.

## Authority and boundaries

- [`packaged-certification.md`](packaged-certification.md) owns the manual
  `Packaged certification` gate and its digest-addressed evidence contract.
- [`verify-certified-artifacts.mjs`](../../scripts/release/verify-certified-artifacts.mjs)
  owns the publication gate: schema version, signing posture, certification set,
  version, source SHA, artifact digest, and artifact size. It is the reason the
  publication workflow cannot ship an uncertified byte.
- [`generate-update-manifest.mjs`](../../scripts/release/generate-update-manifest.mjs)
  owns the signed Eido feed's shape, including the recall and version-floor
  fields, and derives the matching Squirrel `latest-mac.yml` from the certified
  ZIP identity.
  [`sign-update-manifest.mjs`](../../scripts/release-signing/sign-update-manifest.mjs)
  owns signing and its self-verification against the compiled public key.
  [`verify-published-feed.mjs`](../../scripts/release/verify-published-feed.mjs)
  owns the live-feed verdict, running the client's own `verifyUpdateFeed`.
- [`release-planning.mjs`](../../scripts/release/release-planning.mjs) and
  [`manifest.json`](../../release/planning/manifest.json) own the durable
  version ledger, immutable source/version/platform record, and certification
  dependency ledger. No workflow reads them. They are the record that makes a
  version un-reusable, not a gate on publication.
- [`release-incident-response.md`](release-incident-response.md) owns the D2
  maintenance verdicts and post-publication forward-hotfix response.
- [`release-profile.md`](release-profile.md) adapts delivery policy to Eido.
  [`devops-operating-system.md`](devops-operating-system.md) is the sole
  authority for gate classification and merge pacing. Do not copy its figures
  into a release plan.
- [`founder-setup-coach.md`](founder-setup-coach.md) separately owns
  publisher-identity actions. macOS is signed with Eido's Developer ID,
  hardened, notarized, and stapled by the certification lane
  ([`../release/macos-signing.md`](../release/macos-signing.md)); Windows ships
  unsigned by decision.

### The GitHub promotion path is retired

[`promote-release.mjs`](../../scripts/release/promote-release.mjs) published
releases to the public `limweili/eido-releases` repository. **No workflow calls
it, and a normal release never runs it.** Distribution is Cloudflare R2 behind
`updates.eido.so`, plus the static download page on `eido.so`. Do not run
`promote`, `verify`, or `abort` as part of a release.

The script stays because
[`release-incident-response.md`](release-incident-response.md) and
[`prove-incident-hotfix.mjs`](../../scripts/release/prove-incident-hotfix.mjs)
still depend on it for the immutability proof and the maintenance verdicts.
Do not delete it, and do not treat its verdicts as release evidence.

The `session-control` skill owns agent and model selection. Every step below is executable by an authorized autonomous agent. The
founder's only release action is advancing the tracker, and the founder may
name a version; absent that, **SOP 1** decides the version by rule.

## Get a current read

Start every run in the private source repository and re-read live state:

```sh
git rev-parse HEAD
git status --short
node scripts/release/release-planning.mjs validate \
  --manifest release/planning/manifest.json
gh run list --repo limweili/eido --workflow "Packaged certification" --branch main --limit 20
gh run list --repo limweili/eido --workflow "Desktop release publication" --branch main --limit 20
```

Then read the live feed exactly as a shipped client does, so the run starts
from what users actually have rather than what the repository claims:

```sh
mkdir -p .local/live-feed
for asset in eido-update.json eido-update.json.sha256 eido-update.json.sig; do
  curl -fsS "https://updates.eido.so/$asset" -o ".local/live-feed/$asset"
done
node scripts/release/verify-published-feed.mjs --dir .local/live-feed
```

Three 404s mean no release has ever been published; that is the first-release
state, not a failure. Anything else that is not a clean `PASS` means the live
feed is already broken, and **SOP 6** applies before a new release is planned.

Stop if the checkout is dirty in a way that changes release bytes, planning
validation exits nonzero, the intended SHA is not current `main`, or live
evidence cannot be read. Never translate unavailable evidence into a pass and
never ask the founder to inspect logs, choose runners, edit a manifest,
dispatch a workflow, or operate GitHub.

The planning CLI always emits JSON and never edits its input file. `declare`,
`transition`, and `resolve-dependency` return a proposed `manifest` member. The
Captain persists only that member, only after reviewing the zero-exit result and
validating the proposed manifest. Keep the prior manifest available and pass it
with `--previous-manifest` so a version, source SHA, platform digest, or
toolchain record cannot be removed or replaced.

## SOP 1: Plan

Planning has a pre-certification selection and a post-certification immutable
declaration. The initial version/SHA selection is not a release-planning
manifest target because its platform digests do not exist yet.

1. Validate the active manifest and certification ledger as in **Get a current
   read**.
2. Select the version by rule. Releases use plain `MAJOR.MINOR.PATCH` with no
   prerelease suffix and no build metadata. `0.1.0` is a release name;
   `0.1.0-alpha.7` is not. The core is never `0.0.0`.

   **The rule: the next patch above the highest version already recorded.**
   "Recorded" means every target in `release/planning/manifest.json` plus the
   version the live feed currently advertises. A version is recorded the moment
   it is declared, whether or not it was ever published, because its digests are
   bound to a source SHA that will never be current again. This command applies
   the rule and needs no judgment:

   ```sh
   node --input-type=module -e '
   import { readFile } from "node:fs/promises"

   const recorded = new Set()
   const planning = JSON.parse(await readFile("release/planning/manifest.json", "utf8"))
   for (const target of planning.targets) recorded.add(target.version)

   const feed = await fetch("https://updates.eido.so/eido-update.json")
     .then((response) => (response.ok ? response.json() : undefined))
     .catch(() => undefined)
   if (feed?.version) recorded.add(feed.version)

   // Cores only: a retired prerelease name never lowers the next release floor.
   const cores = [...recorded]
     .map((version) => version.split(/[-+]/, 1)[0].split(".").map(Number))
     .filter((core) => core.length === 3 && core.every(Number.isInteger))
   cores.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
   const highest = cores.at(-1) ?? [0, 0, 0]
   console.log(`recorded: ${[...recorded].join(", ")}`)
   console.log(`next release version: ${highest[0]}.${highest[1]}.${highest[2] + 1}`)
   '
   ```

   The founder may name a version instead, in which case use exactly that one.
   Do not otherwise ask, wait, or infer a version from tracker state or a prior
   run's convention. A version is never reused for different bytes, so a
   rejected, aborted, or abandoned candidate advances the patch number rather
   than being re-cut. Minor and major bumps are the founder's to name; the rule
   never produces one on its own.

3. Record the selected version and the exact full lowercase SHA of current
   `main` in the tracker, then run the rest of the release without founder
   involvement.
4. Confirm the single external dependency entry remains
   `profile-agent-packaged-certification`, pointing to #520/#528. A new release
   returns it to `unresolved`; only exact certification evidence may make it
   `resolved`. `empty`, `stale`, `manually-assumed`, or `invalid` is not
   publishable.

Do not add a manifest target yet: its platform evidence is immutable.
**Certification** must first return one real JSON platform-evidence entry for
each locked target, exactly `darwin-arm64` and `win32-x64`. Both entries name
the selected source SHA and carry lowercase `sha256:<64-hex>` digests.

After **Certification**, ask the planning CLI to finalize the immutable
declaration. `--platform-evidence` takes a two-entry array built from the
certified packets, where each `digest` is the certified artifact's own
`artifact.sha256` prefixed with `sha256:`:

```sh
node --input-type=module -e '
import { readFile, writeFile } from "node:fs/promises"
const entries = []
for (const key of ["darwin-arm64", "win32-x64"]) {
  const evidence = JSON.parse(
    await readFile(`.local/certified/${key}/evidence/platform-evidence.json`, "utf8"),
  )
  entries.push({
    platform: key,
    sourceSha: evidence.sourceSha,
    evidenceKind: "sealed-candidate",
    digest: `sha256:${evidence.artifact.sha256}`,
  })
}
await writeFile(".local/platform-evidence.json", JSON.stringify(entries, null, 2))
'

node scripts/release/release-planning.mjs declare \
  --version <semver> \
  --source-sha <full-main-sha> \
  --platform-evidence .local/platform-evidence.json \
  --manifest release/planning/manifest.json
```

Persist only the returned `manifest` from a zero-exit response. An idempotent
declaration is acceptable; any `issues` entry blocks the run. Validate the
proposed bytes against the pre-change manifest before making them active:

```sh
node scripts/release/release-planning.mjs validate \
  --manifest <proposed-manifest.json> \
  --previous-manifest <pre-change-manifest.json>
```

The declared target remains `status: "declared"` and `promotable: false` while
the Captain validates the completed sealing handoff, then moves forward only.

## SOP 2: Seal

The manual `Packaged certification` workflow is the package producer and
certifier. It builds the macOS DMG plus Squirrel ZIP and the Windows NSIS
installer internally from exact current `main`; those retained package bytes
are the only candidates eligible for publication. The outcome passes only when
all of the following are true:

- one build from the selected SHA produces the candidate bytes, and those exact
  bytes are published without rebuild, repack, rename-by-rebuild, or metadata
  mutation;
- the paired certification manifest binds the unique version, exact source
  SHA, locked platforms, DMG/ZIP/EXE sizes and digests, and producing evidence;
- packaging starts from an explicit include allowlist, never an exclusion
  pattern. Candidate evidence asserts that the artifact contains no research
  notes, prototypes, design-system documents, retros, ADRs, agent
  instructions, skills, tests, fixtures, or CI tooling;
- both `darwin-arm64` and `win32-x64` candidates exist for the same SHA and
  version, with their expected posture: the DMG and updater ZIP contain the
  same Developer-ID-signed, hardened, notarized and stapled macOS app accepted
  by Gatekeeper, while Windows remains unsigned by decision. A missing, failed,
  changed, or unproven member rejects the pair: both platforms publish together
  or neither does; and
- proof is taken at the packaged seams: the desktop-proof CI matrix and
  packaged smoke establish their owned boundaries. Internal-only tests cannot
  substitute for missing packaged evidence.

After the paired workflow passes, complete **Plan**'s immutable declaration with
the real digests, then advance the target to `candidate`:

```sh
node scripts/release/release-planning.mjs transition \
  --version <semver> \
  --status candidate \
  --manifest release/planning/manifest.json
```

Persist and validate the returned manifest as in **Plan**. Do not advance one
platform alone.

## SOP 3: Certify

Certification is a separate manual release-train gate, not a PR check. Follow
the complete [Running the gate](packaged-certification.md#running-the-gate)
contract. The workflow accepts only a SemVer, packages internally from exact
current `main`, and retains the certified candidates.

Before dispatch, the Captain confirms:

- the target version is unique, is plain `MAJOR.MINOR.PATCH` with a non-`0.0.0`
  core, and is the version **SOP 1**'s rule produced (or the one the founder
  named);
- the target SHA is exactly current `main` and matches both sealed candidates;
- a successful two-platform `Native desktop proof` run on `main` covers the
  Profile-runtime tree of that SHA. The Captain does not check this by hand and
  never edits a ledger: dispatch admission resolves the run itself and refuses
  the dispatch if there is none
  ([proof-reuse revalidation](packaged-certification.md#proof-reuse-revalidation)).

Dispatch the workflow against `main`; do not run its internal package commands
locally or substitute a branch SHA:

```sh
gh workflow run packaged-certification.yml \
  --repo limweili/eido \
  --ref main \
  -f semver=<semver>
```

The macOS leg signs and submits both the app and outer DMG for notarization, so
it is bound to the `macos-signing-smoke` GitHub Environment and can take far
longer than the Windows leg: Apple's notarization queue has been measured at 74
to 99 minutes, and the job allows 360 minutes for two independently bounded
submissions plus packaging and certification
([macOS release signing](../release/macos-signing.md)). If that environment has
required reviewers, the macOS leg waits for an approval before it starts.

**Nothing may merge to `main` between this dispatch and publication.**
`Desktop release publication` verifies the certified evidence against the SHA it
is itself running at, so a `main` that has moved makes publication fail with
`platform-evidence-source-mismatch`. Hold the merge queue for the whole window,
which can be three and a half hours. **SOP 4** states the only fallback.

Identify the resulting workflow-dispatch run, verify its `headSha` is the
declared SHA, and wait fail-closed for its conclusion:

```sh
gh run view <run-id> --repo limweili/eido \
  --json headSha,headBranch,event,status,conclusion,url
gh run watch <run-id> --repo limweili/eido --exit-status
```

A green native job alone is not certification. The paired job must succeed and
mint one `certificationSetId` of the form `eido-cert-v2-<run id>-<attempt>`,
bound to SHA, version, both targets, and evidence. Download its paired-set
artifact and both platform artifacts before they expire; **retention is 3
days**, and publication needs the binaries still to exist:

```sh
gh run download <run-id> --repo limweili/eido \
  --name "eido-packaged-certification-<set-id>-paired-set" \
  --dir .local/certified/set
gh run download <run-id> --repo limweili/eido \
  --name "eido-packaged-certification-<set-id>-darwin-arm64" \
  --dir .local/certified/darwin-arm64
gh run download <run-id> --repo limweili/eido \
  --name "eido-packaged-certification-<set-id>-win32-x64" \
  --dir .local/certified/win32-x64
```

Verify `certification-reference.json` names the declared SHA and version,
independently hash the exact `certification-manifest.json` bytes against
`manifest.sha256`, and apply `validateCertificationSet` from
[`certification-manifest.mjs`](../../scripts/certification/certification-manifest.mjs).
Verify the certified platform digests are the planned sealed-candidate digests;
a mismatch leaves the dependency unresolved. An Actions URL is transport,
never durable identity.

Copy the validated reference into the planning ledger, then request the
publishable transition:

```sh
node scripts/release/release-planning.mjs resolve-dependency \
  --reference .local/certified/set/certification-reference.json \
  --manifest release/planning/manifest.json

node scripts/release/release-planning.mjs transition \
  --version <semver> \
  --status promotable \
  --manifest release/planning/manifest.json
```

Only `accepted: true` with `ledgerState: "resolved"` may be persisted. The
transition fails closed for unresolved, stale, manually assumed, empty, or
invalid certification. Certification reuses landed evidence bound to the exact
candidate SHA; do not rerun already-authoritative proofs. Any changed candidate
byte, source SHA, package metadata, installed tree, or evidence requires the
owning invalidation path and a new certification set.

## SOP 4: Publish

Publication is one dispatch of `Desktop release publication`. That workflow
builds nothing. It downloads the certification run's own artifacts, runs
`verify-certified-artifacts.mjs` over them, generates the update manifest from
the verified names and digests, signs it, derives `latest-mac.yml`, uploads the
versioned DMG/ZIP/EXE first and feed metadata last, and then reads the live feed
back through the client's own verifier.

Immediately before dispatch, the Captain revalidates that:

- the active planning manifest is valid and the exact version is `promotable`
  with `promotable: true`;
- certification is still `resolved` for the exact source SHA;
- **`main` is still exactly the certified SHA** (`gh api
  repos/limweili/eido/git/ref/heads/main --jq '.object.sha'`);
- the certification run's three artifacts still exist and have not expired; and
- the live feed does not already advertise this version.

Dispatch:

```sh
gh workflow run desktop-release.yml \
  --repo limweili/eido \
  --ref main \
  -f semver=<semver> \
  -f certification_set_id=<eido-cert-v2-run-attempt>
```

`min_supported_version` and `blocked_versions` are the recall inputs and stay
empty for an ordinary release. **SOP 5** owns them.

If `main` has already moved past the certified SHA, publication against `main`
cannot succeed, and as the repository is configured today there is no fallback.
`release-publish` permits exactly one deployment branch, `main`, so a
tag-ref dispatch is refused by the environment and the certification set is
wasted. Verified live:

```sh
gh api repos/limweili/eido/environments/release-publish/deployment-branch-policies \
  --jq '.branch_policies[] | {name, type}'
```

The certification window can run to three and a half hours because of Apple's
notarization queue. Treat that window as a freeze: land nothing on `main`
between dispatching **SOP 3** and a green publication run. This is a
discipline, not a mechanism, and it is the single most likely way for a
release to be lost.

If the freeze is broken, the release is dead and **SOP 6** applies: re-certify
at the new head under the same version, since nothing was published. Never edit
the certified evidence to match a newer SHA. Adding a `v*` tag policy to the
environment would make a tag fallback real, and is the obvious fix the first
time this costs a run.

Then wait fail-closed and confirm the run's `headSha` is the certified SHA:

```sh
gh run view <run-id> --repo limweili/eido \
  --json headSha,headBranch,event,status,conclusion,url
gh run watch <run-id> --repo limweili/eido --exit-status
```

A green run means every one of these held, and each is a real failure mode
rather than a formality:

- **The publication gate passed.** `verify-certified-artifacts.mjs` refused
  nothing: both packets are schemaVersion 2, the macOS packet records Developer
  ID authority, Team ID, hardened runtime, secure timestamp, stapled
  notarization, and Gatekeeper acceptance, both packets name this certification
  set, this version, and this source SHA, and the DMG, updater ZIP, and EXE on
  disk hash and size exactly as certified.
- **The manifest was signed by the key the app trusts.**
  `sign-update-manifest.mjs` derives the public key from the private key,
  refuses to continue unless it equals the compiled
  `EIDO_UPDATE_MANIFEST_PUBLIC_KEY_HEX`, and re-reads both files from disk to
  verify its own signature. A manifest signed by any other key fails the release
  instead of stranding every install in the field.
- **The live feed verifies.** The last steps fetch `eido-update.json`, its
  `.sha256`, and its `.sig` from `updates.eido.so` and run the client's own
  `verifyUpdateFeed` against the compiled public key. They then require live
  `latest-mac.yml` to name exactly the certified ZIP with its SHA-512 and size,
  fetch that ZIP and verify its SHA-256, SHA-512, and byte count, and fetch the
  two stable download addresses the site links to and hash them against the
  certified installer digests. Reachability alone would pass on a wrong-key
  manifest, a stale bucket, a substituted updater ZIP, or a download button
  serving last week's build; this does not.

Anything else is not a release. A red run, an unreadable conclusion, or a
missing verification step means no success claim, and **SOP 6** applies.

Published bytes are immutable. A defect after publication is a forward hotfix
with a fresh version and candidate, never rollback or asset replacement. What
*is* re-dispatchable is the feed itself: re-running this workflow with the same
`semver` and `certification_set_id` re-uploads the identical binaries and
regenerates the manifest with a newer `publishedAt`. That is the repair path for
wrong feed metadata, and it is the mechanism **SOP 5** uses.

## SOP 5: Recall a published release

A release that is already installed can be pulled back. Setting
`blocked_versions` makes every install running a named version stop and present
a recall surface instead of continuing, and `min_supported_version` does the
same for everything below a floor. This is the strongest action in the runbook:
it halts an app on someone's machine.

### Preconditions

- **A newer good version must already be advertised.** The generator refuses a
  manifest that blocks its own advertised version, so a release can never recall
  itself. Worse, the recall surface reads `hasNewerVersion` to decide whether it
  can offer a way forward; recalling with nothing newer available leaves a user
  stopped with nowhere to go. If the defective version is the newest one, first
  certify and publish a fixed higher version through **SOP 1** to **SOP 4**,
  then recall in the same dispatch or a following one.
- The defect must warrant halting a running app. Recall is for data loss,
  corruption, a security defect, or an app that cannot function. A cosmetic or
  partial defect is a forward hotfix without a block.
- Every version to be blocked must be a valid `MAJOR.MINOR.PATCH`. One typo
  makes the whole manifest unparseable to every client, which turns a recall
  into a silent total feed outage at exactly the moment it matters.

### Procedure

Dispatch the publication workflow **for the newest good version**, with the
recall inputs set:

```sh
gh workflow run desktop-release.yml \
  --repo limweili/eido \
  --ref main \
  -f semver=<newest-good-semver> \
  -f certification_set_id=<its-certification-set-id> \
  -f blocked_versions=<bad-semver>[,<bad-semver>...] \
  -f min_supported_version=<floor-semver>
```

If that good version is already published, this is a re-dispatch: the same
certified binaries are re-uploaded and only the manifest changes. The same
`main`-is-the-certified-SHA constraint from **SOP 4** applies, because the
publication gate re-runs unchanged.

Then verify as a client would, and confirm the recall fields actually arrived:

```sh
mkdir -p .local/live-feed
for asset in eido-update.json eido-update.json.sha256 eido-update.json.sig; do
  curl -fsS "https://updates.eido.so/$asset" -o ".local/live-feed/$asset"
done
node scripts/release/verify-published-feed.mjs --dir .local/live-feed \
  --version <newest-good-semver>
node -e '
const feed = require("./.local/live-feed/eido-update.json")
console.log("blockedVersions:", feed.blockedVersions ?? "none")
console.log("minSupportedVersion:", feed.minSupportedVersion ?? "none")
'
```

### The recall does not persist itself

`blocked_versions` and `min_supported_version` are workflow inputs, not stored
state. Every dispatch regenerates the manifest from its own inputs alone. **A
later release that omits them silently un-recalls every blocked version.**

Therefore: record the active recall set in the tracker alongside the release
record, and re-pass the complete list on every subsequent dispatch until the
blocked versions are old enough that nobody is running them. Treat a release
dispatch with an empty `blocked_versions` while a recall is active as a defect,
not a default.

### Lifting a recall

Publish or re-dispatch with the version removed from `blocked_versions`.
Installs stop presenting the recall surface on their next successful feed read.
Do this only when the block was mistaken; a genuinely defective version stays
blocked.

## SOP 6: Abort fail-closed

Abort before publication on any certification failure, artifact-content
assertion failure, update-path proof failure, or canary failure. Also abort when
identity, provenance, paired-platform completeness, artifact retention, or live
provider state cannot be established.

Aborting before **SOP 4** is a bookkeeping action: nothing has been uploaded, so
there is nothing to undo. Do not run `promote-release.mjs abort`; it operates on
the retired GitHub path and has no authority over R2.

Invalidate the active certification claim in the private planning manifest
before ending the run. Set the single #528 dependency back to its valid
`unresolved` shape (`targetSha` and `certificationSetId` null, empty
`evidence`) until a replacement candidate receives a new certification set.
Preserve the aborted version and its target evidence unchanged; release target
status has no backward transition. Validate the proposed manifest against the
pre-abort manifest, persist it, and prove a stale publication cannot be
admitted:

```sh
node scripts/release/release-planning.mjs validate \
  --manifest <post-abort-manifest.json> \
  --previous-manifest <pre-abort-manifest.json>
node scripts/release/release-planning.mjs transition \
  --version <aborted-semver> \
  --status promotable \
  --manifest <post-abort-manifest.json>
```

The validation must pass; the read-only transition probe must exit `1` with
`accepted: false`, `ledgerState: "unresolved"`, and issue code
`promotion-dependency-unresolved`. Once a replacement SHA is certified, the
old SHA classifies as `stale` instead. Either state blocks stale re-publication.
The aborted version is spent: **SOP 1**'s rule advances past it.

### When the feed is wrong after publication

The bytes are out. The response depends on what is wrong.

| Symptom | Response |
| --- | --- |
| Upload failed part-way, so the feed names artifacts that are not there | Re-dispatch **SOP 4** with the same `semver` and `certification_set_id`. Binaries upload before the manifest, so a repeat run repairs the order. |
| The live-feed verification step went red | The feed is unusable to every client. Re-dispatch the same version. If it fails again, the signing key or the bucket is wrong; do not publish another version on top of a feed nothing can read. |
| The feed advertises the right version but wrong recall metadata | Re-dispatch the same version with corrected `blocked_versions` and `min_supported_version`, per **SOP 5**. |
| The published build is defective | Forward hotfix: **SOP 1** to **SOP 4** with a higher version, then **SOP 5** to block the defective one. |
| A download button serves the wrong bytes | The stable aliases are republished by **SOP 4**; re-dispatch the newest good version. Never upload to the bucket by hand. |

Never delete a versioned artifact from the bucket. A client that is mid-download
of a version the feed still names must be able to finish.

## Completion record

For every run, record the version, exact source SHA, the certified DMG, updater
ZIP, and EXE digests,
planning-manifest revision, certification set id and manifest digest,
publication run URL, live-feed verification result, the active recall set
(`blocked_versions` and `min_supported_version`, explicitly `none` when empty),
and links to durable tracker evidence. Secrets, private Profile data, and
expiring artifact URLs as identity do not belong in that record.
