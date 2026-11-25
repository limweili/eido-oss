# Update delivery is a signed manifest fetched from an address Eido owns

Status: accepted; decision 5 amended by ADR 0039

Eido ships as an installed desktop app, so a person on an old version stays
there until something tells them otherwise. We decided the update path is a
version manifest that Eido signs with its own key, published at an address
Eido controls, and that both platforms will eventually install on one click.
The three parts of that sentence are each hard to reverse, because every one
of them is compiled into the app a user already has.

## Decisions

0. **A signed manifest must also be current.** Each installation remembers the
   publish time of the newest manifest it has accepted and refuses anything
   older. A signature alone proves origin, not freshness, so without this a
   party who can publish could replay an old signed manifest to freeze a person
   on their version or to erase a recall. Ships in the first signed schema
   because it cannot be retrofitted.
1. **The manifest is signed with an Ed25519 key that never touches the public
   release repository.** The public half is baked into the app; the private
   half lives as a secret in the private source repository and is applied by
   the release workflow. Checksums prove a file arrived undamaged; only a
   signature proves it came from us (#793).
2. **The update address is a hostname Eido owns**, not a GitHub URL. Today it
   resolves to GitHub release assets. When release hosting moves to Cloudflare
   R2, only the hostname's target changes.
3. **The manifest carries a blocked-versions list and a minimum-version
   floor.** These are Eido's recall mechanism for a bad release.
4. **Publication moves from a local script into a dispatchable workflow**, so
   the signing key is a repository secret rather than a file on the founder's
   laptop and no release carries a manual step.
5. **Amended by ADR 0039.** macOS retains Eido's signed-manifest and joined
   drain authority, then hands replacement and relaunch to Squirrel.Mac.
6. **Windows executables are not Authenticode signed.** Users accept one
   SmartScreen warning at first install.

## Why the address decision is the load-bearing one

`electron/updateEndpoints.ts` compiles both the feed URL and the allowed-host
list into the binary. Neither can be changed remotely. An app shipped against
a GitHub URL will ask GitHub forever, so a later move to R2 would strand every
existing install behind a manual reinstall. Owning the address converts a
migration into a DNS change.

## Considered options

- **Adopt `electron-updater` / Squirrel.Mac.** Originally rejected here; ADR
  0039 reverses only this installer-mechanism choice after field evidence and
  primary-source review. The historical rejection was that its
  `latest-mac.yml` format duplicated Eido's verified manifest and was then
  banned by publication policy. ADR 0039 resolves that conflict by keeping
  Eido's signed manifest authoritative while certifying and publishing the
  paired transport metadata from the same sealed artifact record. Windows
  continues to use Eido's signed manifest and existing NSIS handoff.
- **Ship a `.pkg` on macOS** so the existing installer-launching handoff works
  unchanged. Rejected: it requires a second Apple certificate (Developer ID
  Installer) that the signing setup deliberately does not create.
- **Keep the GitHub URL and add the future R2 host to the allowlist.**
  Rejected: the feed URL itself would still change, so users who had not taken
  the migrating update would still be stranded.

## Consequences

- Without Authenticode, the signed manifest is the only authenticity control
  on Windows. macOS keeps notarization as an independent second guard; Windows
  has none. #793 is therefore a hard precondition for publishing any feed, not
  a hardening task.
- Windows auto-update is quieter than first install: SmartScreen keys off the
  mark-of-the-web that browsers attach to downloads, and an update the app
  fetches itself does not carry one.
- Losing the private signing key permanently ends updates for every installed
  copy, because the matching public key is already compiled into them. The key
  must be backed up outside GitHub before first use.
- Releases 0.1.2 onward already run the update client; it is not switched off,
  it simply finds nothing. Those installs understand only the old unsigned
  schema and will treat the signed schema as no manifest at all, so they still
  need one hand-held reinstall to reach the first updatable Release. The cost
  scales with the size of the friend list, not with elapsed time, so the list
  stays small and recorded until the signed Release ships.
- Until that migration completes, a party with write access to the public
  release repository could publish an old-schema manifest and installer that
  fielded Windows installs would accept. The founder accepted this window on
  2026-08-18 rather than treating it as an incident, on the grounds that write
  access is the founder's alone. The mitigation is speed, not machinery.
