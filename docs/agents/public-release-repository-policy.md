# Public release repository policy

> **Status: the release path this document describes is retired.** Distribution
> moved to Cloudflare R2 behind `updates.eido.so` with a signed update manifest
> (#978, ADR 0032), and no workflow publishes to `limweili/eido-releases` any
> more. Read [`desktop-release-captain.md`](desktop-release-captain.md) for how a
> release is actually made. What is still live here is the disclosure boundary
> (nothing private in a public artifact), the prohibition on adding
> electron-updater auto-discovery metadata, and the founder-owned-content rules
> that stop an agent overwriting the public tree. Everything framed below as the
> "current" agent-owned publication boundary describes the retired path and is
> kept as history and as the contract the incident-response immutability proof
> still exercises.

This runbook separates the retired release boundary from preserved bootstrap
machinery. `limweili/eido-releases` is public: obscurity is not access control,
and private source, Profile data, Portable Exports, credentials, source maps,
tests, fixtures, and internal documentation never belong in its releases.

The retired agent-owned boundary was the GitHub Releases API, exact immutable
tag, and verified direct release-asset URLs. The public repository's
default-branch, site, and domain content are founder-owned and may evolve
independently through reviewed public changes. They are neither a release gate
nor a mirror of this private repository.

`release/public-repository/policy.json`,
`release/public-repository/template/`, and
`scripts/release/public-release-repository.mjs` are legacy bootstrap and
retired-Captain inputs. Their template paths and SHA-256 pins describe the
original bootstrap snapshot only. Do not apply them to, verify them against, or
use them to overwrite live founder-owned branch content. A live mismatch is
expected after founder changes and must not block publication or canaries.

## Retired bootstrap credential boundary

The original repository bootstrap used the following separation. It remains a
security design reference, not authority to run the retired template applier
against the live public repository.

| Boundary | Authority |
| --- | --- |
| Private source reads | A source workflow uses `limweili/eido`'s repository-scoped `GITHUB_TOKEN` (for example, `actions: read`) to read its own candidate artifact. |
| Public release writes | GitHub App `eido-release-publisher-limweili`, installed only on `limweili/eido-releases`, has `contents: write` and implicit `metadata: read`. |
| App credentials | `EIDO_RELEASE_APP_ID` and `EIDO_RELEASE_APP_PRIVATE_KEY` exist only in the private source repository's `release-publish` environment. The verifier inventories source repository and environment secret names and blocks the App key at repository scope or in any other environment. The public repository has no repository or environment Actions secrets. This exclusivity claim is scoped to the GitHub Actions secret namespace; Dependabot and Codespaces use separate product-specific secret stores. |
| Installation token | Minted for only `limweili/eido-releases`. The verifier narrows a probe token to `contents: read`, proves the private source repository returns 404, and emits only permissions, repository name, denial result, and expiry. |

A single App installation must not span the private and public repositories.
GitHub App maximum permissions apply across every selected repository; installing
the publisher App on the source repository would unnecessarily give its public
write authority to private source. The source job already has a source-scoped
token for its own reads.

## Retired bootstrap verifier contract

The committed legacy fixture makes its verifier return `PASS` only when all
machine provider signals match that bootstrap model and the one UI-only control
has an explicit owner acceptance envelope:

- the modeled target is the exact public, unarchived repository with `main` as
  default;
- the modeled default-branch snapshot contains exactly the bootstrap template
  files at their committed SHA-256 digests;
- the fixture permits GitHub Releases and tags alongside that modeled snapshot;
- immutable releases and private vulnerability reporting are enabled;
- Actions are limited to SHA-pinned GitHub-owned actions, read-only default
  workflow permissions, no PR approval, and 90-day artifact/log retention;
- `main` has the active `protect-main` ruleset with no bypass actors, deletion and
  non-fast-forward protection, and pull-request/thread-resolution requirements;
- public `release-promotion` requires reviewer `limweili`, is limited to
  protected branches, and has no Actions secrets;
- the public repository has no repository Actions secrets;
- private `release-publish` accepts deployments only from the `main` branch (not
  a same-named tag), has only the declared App ID/repository variables and App
  private-key secret name, and is the exclusive source-repository Actions
  location for that key; secret values are never read;
- the App is selected-repository-only, installed only on the public repository,
  has exactly `contents: write` plus `metadata: read`, subscribes to no events,
  and its scoped token cannot read `limweili/eido`.

Within that retired contract, absent or incomplete API responses are not
inferred as safe. Missing machine evidence, a truncated recursive tree, an
incomplete deployment-policy count, a deployment policy without its branch/tag
type, a snapshot mismatch, a misplaced or public secret, an App installed on
private source, excess permissions, or a token that can read source all return
`BLOCK`.
GitHub omits a ruleset's `bypass_actors` when the caller lacks write access to
that ruleset, so the adapter requires an explicit array and fails closed rather
than interpreting an omitted field as no bypass actors. See
[Get a repository ruleset](https://docs.github.com/en/rest/repos/rules?apiVersion=2026-03-10#get-a-repository-ruleset).

The verifier uses GitHub's documented Actions repository/environment secret
endpoints. Dependabot and Codespaces secrets are separate namespaces consumed by
different products, so this repository policy does not query or make an
exclusivity claim about those stores. See GitHub's
[Actions secrets reference](https://docs.github.com/en/actions/reference/security/secrets)
and [Codespaces repository/organization secret guidance](https://docs.github.com/en/codespaces/managing-codespaces-for-your-organization/managing-development-environment-secrets-for-your-repository-or-organization?tool=webui).
GitHub's documented
[Get an app response](https://docs.github.com/en/rest/apps/apps?apiVersion=2026-03-10#get-an-app)
similarly exposes the subscribed `events` list but no webhook-toggle field.
`events: []` is therefore the machine proof; the owner should leave webhook
delivery unconfigured, but verification does not claim an API signal GitHub does
not return.

The current documented GitHub environment REST update schema exposes reviewers,
self-review, and branch-policy controls, but not the administrator-bypass
setting. The repository owner must disable administrator bypass in the
`release-promotion` settings UI and capture the visible provider state. The
envelope must name that exact control and settings URL, use a canonical GitHub
attachment URL, and be no more than 24 hours old (with at most five minutes of
future clock skew). Until that evidence is supplied, otherwise-green
verification returns `OWNER_EVIDENCE_REQUIRED`, never `PASS`. See GitHub's
[environment REST API](https://docs.github.com/en/rest/deployments/environments?apiVersion=2026-03-10)
and [deployment environment reference](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

`content.requireNoReleases` and `content.requireNoTags` were deliberately false
in the bootstrap model. Its fixture forbids installer extensions in the modeled
default-branch snapshot while permitting release and tag objects; it does not
approve their contents. The bootstrap verifier does not validate release asset names, counts, or digests.
It also does not prove that a publication followed the current Captain
procedure.
Its closed-tree verdict is no longer a live repository or release-completion
verdict.

## Historical alpha publications

The alpha.7 and alpha.8 publication tickets and their exact hashes are retained
in the tracker and release API as immutable historical evidence. They are not
current instructions and must never be used to select, rebuild, or publish a
new release. Current releases follow
[`desktop-release-captain.md`](desktop-release-captain.md).

Published assets remain immutable. A correction uses a higher version chosen by
the Captain's deterministic version rule, a new
exact-current-main packaged certification set, and new hashes.

Eido does publish an update feed, but not here and not in this shape. The
signed feed (`eido-update.json` with its `.sha256` and Ed25519 `.sig`) is
published to Cloudflare R2 behind `updates.eido.so` by
`.github/workflows/desktop-release.yml`, under ADRs 0032 and 0039. R2 also
serves one certified `latest-mac.yml` and its exact versioned ZIP; the client
accepts them only after cross-checking every identity field and the downloaded
bytes against Eido's signed manifest. What stays prohibited on this GitHub
release path is electron-updater's own auto-discovery metadata:
do not add `latest.yml`, `latest-mac.yml`, or any `*.blockmap` file to a
release. Provider metadata is transport metadata, never release authority.
`SHA256SUMS.txt` is a human/operator integrity record, not an updater input.

## Download page and serving boundary

The public repository's default-branch and site content are founder-owned and
may change independently of this private repository. The founder may use that
content on their own domain. Agents must not compare it with the legacy private
template pins, classify an intentional difference as drift, overwrite it, or
require any particular tree shape for release completion.

GitHub Pages on `limweili/eido-releases` is intentionally disabled or absent.
Agents must not enable it, require a Pages deployment, wait for a Pages URL, add
a `CNAME`, or treat missing Pages state as a release failure. Only a later
explicit founder instruction may reauthorize Pages; the historical template is
not standing authority to infer that decision.

The agent-owned publication boundary is the GitHub Releases API record for the
exact final, non-draft, non-prerelease release with `immutable: true`, its exact
tag, and its exact release assets. After final digest verification, require one
matching DMG and one matching EXE for a paired release, and record each asset's
GitHub `browser_download_url` with the source SHA and checksums. Those direct
asset URLs are sufficient inputs for the human canaries. They are ordinary
manual browser downloads, not an application update feed: Eido still does not
discover, download, or execute an unsigned installer. The release notes carry the
Windows SmartScreen first-open instruction; the macOS Open Anyway instruction
applies only to Releases built before #696, since macOS Releases are now signed
and notarized ([macOS release signing](../release/macos-signing.md)).

The founder owns public-tree/site content, any branded download page, final URL,
custom domain, and presentation of those direct links. Agents hand off the
verified URLs and do not create, edit, deploy, or validate that serving surface.
Its availability is outside agent-owned release completion and must not block
publication or the canaries. #695 remains the founder-owned share and Friends
Alpha closeout action after both canaries pass.

## Retired bootstrap commands — not live instructions

The following syntax documents the legacy bootstrap tool. Do not run its
`plan`, `verify`, or `apply` commands against the live public repository: its
private template snapshot intentionally does not govern founder-owned content.
If backlog epic #740 reactivates this machinery, derive a new policy from
then-live state before executing anything.

```sh
node scripts/release/public-release-repository.mjs plan --json
node scripts/release/public-release-repository.mjs verify --json
```

After the owner disables administrator bypass, store the acceptance envelope in
a temporary JSON file that is not committed:

```json
{
  "schemaVersion": 1,
  "target": "limweili/eido-releases",
  "observedAt": "2026-07-17T11:00:00Z",
  "observer": "limweili",
  "evidence": {
    "kind": "github-environment-settings-capture",
    "control": "promotionEnvironmentAdminBypassDisabled",
    "settingsUrl": "https://github.com/limweili/eido-releases/settings/environments/release-promotion",
    "captureUrl": "https://github.com/user-attachments/assets/11111111-1111-1111-1111-111111111111"
  },
  "controls": {
    "promotionEnvironmentAdminBypassDisabled": true
  }
}
```

Replace the dummy capture UUID with the exact GitHub attachment URL for the
fresh screenshot. Do not add fields: the verifier rejects generic GitHub links,
other settings pages, other controls, stale/future timestamps, and ambiguous
envelopes.

Pass that file explicitly to planning, verification, or application:

```sh
node scripts/release/public-release-repository.mjs verify --json \
  --owner-evidence owner-evidence.json
```

After the App exists, pass its private key only on stdin so the verifier can mint
and discard a narrowly scoped probe token:

```sh
node scripts/release/public-release-repository.mjs verify --json \
  --owner-evidence owner-evidence.json \
  --private-key-stdin < app-private-key.pem
```

This read-only proof validates the supplied candidate key. A confirmed `apply`
with the same successfully probed stdin key always rewrites the protected
`release-publish` secret, even when that secret name already exists, so stale
stored key material cannot pass the acceptance sequence.

`apply` requires the exact target as a second guardrail:

```sh
node scripts/release/public-release-repository.mjs apply --json \
  --confirm limweili/eido-releases
```

Credential wiring also requires stdin:

```sh
node scripts/release/public-release-repository.mjs apply --json \
  --confirm limweili/eido-releases \
  --private-key-stdin < app-private-key.pem
```

Never put a private key or installation token in a command argument, policy,
evidence file, issue, PR, log, or shell history. The script passes the key to
`gh secret set` through stdin, uses tokens only in child-process environment,
redacts credential-shaped provider failures, and reports secret names only.

Exit codes are stable:

- `0`: plan is non-blocked (including when owner actions remain), verification
  passed, or apply completed without an owner-only action remaining;
- `1`: verification returned `BLOCK`;
- `2`: unsafe drift, bad confirmation, provider failure, or invalid invocation;
- `3`: apply completed its safe automatic work but an owner-only App action
  remains, or verification requires the UI evidence envelope.

## Historical staged application

The following completed bootstrap sequence is preserved for audit only. It is
not a repeatable instruction for the live public repository.

1. Land this private-source policy through normal exact-head CI and independent
   review. A committed policy or passing fixture is not evidence that external
   GitHub state exists.
2. Run `plan --json`. Review the exact repository target and automatic mutations.
   Before repository creation, the script reads `/user` and requires the exact,
   case-sensitive authenticated login `limweili`; a mismatch stops before
   `POST /user/repos` and performs no mutation.
3. Run `apply --confirm limweili/eido-releases`. It creates/configures only the
   public repository and non-secret source-environment scaffolding, renames an
   initialized provider default branch to `main` before writing template files,
   restricts `release-publish` to `main`, then stops.
4. The repository owner registers the GitHub App with the declared permissions
   and no subscribed events, leaves webhook delivery unconfigured, installs it
   only on `limweili/eido-releases`, and creates one private key. The owner also
   disables administrator bypass in the public `release-promotion` environment
   and captures the visible setting with observer identity and observation time.
   These manual GitHub-settings steps are never fabricated by the script.
5. Re-run `plan` with the key on stdin. Then run confirmed `apply` with the key on
   stdin to set the App ID variable and write (or rewrite) the private-key secret
   in private `release-publish`.
6. Create the temporary owner-evidence envelope shown above and run
   `verify --json --owner-evidence owner-evidence.json --private-key-stdin`.
   Preserve the redacted JSON plus exact source SHA and CI/review links as
   acceptance evidence. Delete temporary evidence and key files according to the
   credential-handling procedure after GitHub confirms storage.

The retired applier was convergent only inside its declared bootstrap model.
Before the original no-bypass pull-request ruleset existed, it wrote the
template files with LF line endings and then created the ruleset. Its code still
classifies later template differences as blocked drift, but that behavior is
not authority over current founder-owned content and must not be used to restore
or overwrite it. The tool also modeled settings, environments, variables,
source deployment-branch policies, credentials, releases, and tags. Re-triage
all of those assumptions against live provider state before any future use.

## Retired bootstrap evidence format

The original machine evidence could include repository names, template digests,
commit SHA, modeled policy settings, complete count/list envelopes, secret names
and locations, App permissions/installations, token expiry, a boolean that the
supplied key was validated, and the source-denial result. Evidence must never
include secret values, JWTs, installation tokens, private-key bytes, product
binaries, or private save data.

## Current release-credential incident boundary

If a release credential can access `limweili/eido`, has excess permissions, or
is exposed, stop publication, revoke the key or token, correct the installation,
and rotate the private-source secret. Before resuming, use then-current read-only
provider evidence to prove the exact App installation repositories and
permissions, denial of private-source access, and the final immutable release
tuple: tag, source-SHA evidence, asset names, sizes, digests, and direct URLs.
Match the release assets to the sealed allowlist so an unintended or private
artifact cannot pass by name alone. Do not invoke the retired template verifier
or compare founder-owned branch content with private template pins. If no
current narrow proof exists, stop and re-triage the boundary rather than
weakening it.
