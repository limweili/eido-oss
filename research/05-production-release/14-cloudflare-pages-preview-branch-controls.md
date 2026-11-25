# Cloudflare Pages marketing-only build controls

Date: 2026-08-20

## Decision and applied state

Cloudflare Pages project `eido-site` keeps automatic production and preview
deployments, but its build watch include is now `site/*` instead of `*`.
Cloudflare's wildcard crosses path separators, so this includes every nested
asset below `site/` while ignoring app, documentation, CI, and release-only
changes elsewhere in the repository.

The setting was applied and read back in Cloudflare account
`a052418cc9d979229b122900fb678019` on 2026-08-20:

- project: `eido-site`
- production branch: `main`
- automatic deployments: enabled
- build output: `site`
- build watch include: `site/*`
- build watch exclude: empty

Cloudflare documents this monorepo control in
[Build watch paths](https://developers.cloudflare.com/pages/configuration/build-watch-paths/).
It evaluates excludes first and then triggers only when at least one remaining
changed path matches an include. A wildcard at the end matches nested paths.

## Why this is the right boundary

- `eido.so` is owned entirely by `site/`. It is static HTML/CSS with local
  assets and no app runtime.
- `updates.eido.so` is not part of Pages. It is the Cloudflare R2 release feed
  populated by the signed desktop release workflow, so none of its release
  paths qualify for the marketing-only lane.
- Marketing PRs retain Cloudflare preview deployments for visual review.
- App-only and documentation-only branches stop creating irrelevant Pages
  builds and status checks.
- GitHub branch protection does not require `Cloudflare Pages`, so the absence
  of a check for a skipped build cannot hold a pull request open.

Cloudflare says a deployment skipped by build watch paths emits no GitHub check
run or commit status. The repository's own required workflows therefore remain
unconditionally triggered and make their scope decision after startup; they do
not use trigger-level path filters. Required CI classifies in a database-free
job, runs exactly one database-free site or PostgreSQL-backed full-app proof
job, then reports one aggregate conclusion.

## Repository companion

`scripts/ci/marketing-site-scope.mjs` uses the stricter repository rule: the
fast lane is available only when every changed path is inside `site/`. Mixed,
empty, malformed, release/update, CI, or app changes run full app CI. The
stable required check names still report on every pull request.

The static marketing contract is
`node --test scripts/ci/site-static.test.mjs`. It checks standalone routes,
internal links and fragments, stable release aliases, fonts and token parity,
the no-script/no-form boundary, and Cloudflare Pages headers.

## Caveats

- Cloudflare bypasses path matching for pushes containing zero file changes,
  at least 3,000 changed files, or at least 20 commits. Those unusual pushes
  may still deploy; this is a provider safety fallback, not part of ordinary
  pull-request behavior.
- Existing public preview deployments were not deleted or access-restricted.
- Do not add `Cloudflare Pages` to branch protection while skipped builds emit
  no check. The repository-owned required checks are the merge gate.
