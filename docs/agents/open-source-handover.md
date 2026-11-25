# Open-source handover

Eido is free to use and has no Eido account, subscription, credits, or paywall.
Online AI and keyed web tools use credentials supplied and paid for by the user.
Boards, Profile exports, and local CLI and MCP access work offline.
See [ADR 0051](../adr/0051-free-open-source-byok-only.md).

## Retained owner costs

- Cloudflare Pages, R2 download storage, and domain registration support
  distribution. The signed feed continues to serve older versions. Current
  versions update when the user downloads and installs a release.
- Apple Developer membership supports signed macOS releases. Windows is
  currently unsigned and no Windows signing certificate was purchased. Build
  and release workflows can consume GitHub Actions minutes and artifact storage.
  The founder decides whether to retain or change those distribution costs.
- Product analytics and PostHog are removed. Existing PostHog vendor resources,
  if any, require separate shutdown; the application sends no analytics.
- OpenRouter and Linkup usage, and subscriptions used by local AI tools, belong
  to each user. Eido supplies no managed key or provider credit.
- Link previews fetch public pages and their preview assets directly. AI web
  reads and research use the person's chosen provider. Coding CLIs selected
  for an AI run can also contact their own providers.

## External shutdown boundary

The repository removes the control plane, operator console, account runtime,
Stripe/Clerk integrations, managed providers, and their release/flag workflows.
That change alone does not stop a deployed Cloud Run or Railway service, remove
Cloud SQL/PostgreSQL databases, Cloud Tasks/Scheduler jobs, Artifact Registry
images, KMS keys, secrets, backups, logs,
Clerk tenants, Stripe products/webhooks/subscriptions, PostHog projects, or
OpenRouter management/child credentials. Existing resources can keep costing
money until their owner disables or deletes them.

Inventory those resources using vendor dashboards before teardown. Preserve any
records legally required for actual payments or customers, resolve outstanding
obligations if any exist, then revoke retired credentials and stop the services.
Do not delete Cloudflare release storage, update-signing material, user Profiles,
or the retained download website as part of commercial shutdown. No external
shutdown, secret rotation, billing cancellation, or repository visibility change
is performed merely by applying this code change.

## Publication boundary

The repository uses [GNU GPL version 3](../../LICENSE). Start public history
from a reviewed source snapshot. From a local commit that includes the launch
changes, export it with:

```sh
git archive --format=tar.gz --prefix=eido/ --output=eido-source.tar.gz HEAD
```

The archive includes the application source, dependency lockfile, tests, build
and release scripts, and documentation. `.gitattributes` omits old commercial
research, internal proof transcripts, and reference captures. Review the
exported tree and use it for the first commit of the public source repository.
GitHub's visibility setting exposes the existing repository, including its
history. Before using that route, review all reachable Git history and CI
artifacts for credentials and private Profile data.

## Launch on eido.so

1. **Publish the source.** Export the exact release commit from the private
   build repository and publish the reviewed tree to `limweili/eido-oss`.
   Tag the public snapshot with the release version and record the private
   release SHA it came from. Verify that the repository, tag, and licence open
   while signed out of GitHub.
2. **Deploy the site.** Confirm the operator and contact details in the draft
   privacy and terms pages. `eido.so` is already attached to the `eido-site`
   Cloudflare Pages project. Deploy the static `site/` directory, with no build
   command. Preview first. If the public source uses a different repository,
   confirm Pages production branch settings so the old branch cannot overwrite
   the launch. An authorised manual production deploy can run:

   ```sh
   npx wrangler pages deploy site --project-name eido-site --branch main
   ```

   Check the source, build instructions, privacy, terms, and legal links on
   `eido.so` after deployment. See [Cloudflare's Pages deployment guide](https://developers.cloudflare.com/pages/get-started/direct-upload/).
3. **Certify and publish installers.** Run **Native desktop proof**,
   **Packaged certification**, and **Desktop release publication** on the exact
   private `main` commit used for the public source export. The existing
   GitHub environments hold the signing, notarization, and publication
   credentials. Use the same release version and certification set for
   certification and publication. Verify both stable download aliases against
   the certified installers. See the [desktop release runbook](desktop-release-captain.md).
