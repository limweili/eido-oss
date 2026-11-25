# Founder Setup Coach

This is a pull-only guide for the two identity and purchasing actions only the
founder can perform: Apple Developer enrollment for S1 ([#677](https://github.com/limweili/eido/issues/677))
and Windows Authenticode provider onboarding for S2
([#678](https://github.com/limweili/eido/issues/678)). Agents still own GitHub
configuration, workflow operation, failure diagnosis, and every other delivery
mechanic.

## Phase boundary: never an Alpha gate

This coach guides the terminal **Phase 2 signing upgrade only**. The Friends
Alpha shipped unsigned: macOS was ad-hoc signed and used the documented one-time
Gatekeeper override; Windows uses the documented one-time SmartScreen override.
Since #696 the production lane signs, hardens, notarizes, and staples macOS
Releases, so a macOS Release built after that no longer needs the Gatekeeper
override ([macOS release signing](../release/macos-signing.md)). Windows remains
unsigned by decision.
Nothing here is a precondition, CI gate, dependency, or readiness signal for
E1 through R or anything earlier in the unsigned Alpha. S1 and S2 can happen
before, during, or after that release; only the later signed re-release S3
consumes them.

No Windows signing workflow should exist until a provider is selected and its
public identity is bound. That absence is policy, not unfinished scaffolding.

## Get a current read

From the private source repository, run:

```sh
node scripts/release-signing/founder-setup-coach.mjs
```

Every run re-reads these authorities:

- issue #677 state and checkboxes;
- issue #678 state and checkboxes;
- the live GitHub environment list and, when present, only the **names** of
  secrets and variables in `macos-signing-smoke`; and
- [`windows-manifest.json`](../../release/signing-smoke/windows-manifest.json),
  including `bindingStatus` and its three public identity fields.

GitHub cannot reveal whether the founder enrolled with Apple or what happened
in private provider conversations. The coach therefore asks instead of
silently calling either flow “not started.” After receiving a current answer,
rerun with the matching ephemeral stage:

```sh
node scripts/release-signing/founder-setup-coach.mjs \
  --apple-stage enrolled \
  --windows-stage awaiting-responses
```

`--help` lists every accepted stage. These answers affect that process only;
the coach writes no ledger, issue, manifest, account, environment, or other
state. Do not pass a stage unless it came from the founder in the current
conversation. `--json` emits the same report for an agent to relay.

The report always states, for each flow, its prerequisites, honest cost, known
or unknown lead time, and one exact next action.

## Apple flow

The canonical technical owner remains
[`macos-signing-smoke.md`](../release/macos-signing-smoke.md). This coach
names the founder handoffs; it does not copy the smoke runbook.

### Account state unknown

- **Prerequisites:** a current founder answer. An absent environment or a
  missing secret name does not prove enrollment has not happened.
- **Cost:** Apple Developer Program membership is **USD 99/year** in the
  repository's production-release research. Taxes, local-currency pricing, and
  any other amount are not established here; confirm what Apple presents.
- **Lead time:** unknown. Ask Apple for enrollment and identity-review timing.
- **Exact next action:** founder answers one of: `not enrolled`, `enrolled but
  credentials are not ready`, or `credentials are ready`. The agent reruns
  with `--apple-stage not-enrolled`, `enrolled`, or `credentials-ready`.

### Not enrolled

- **Prerequisites:** choose the stable personal or legal-entity publisher
  identity Eido will use; be ready to complete Apple's legal/identity checks
  and authorize payment.
- **Cost:** USD 99/year, subject to the confirmation above.
- **Lead time:** unknown; ask Apple before relying on a date.
- **Exact next action:** founder opens
  [Apple Developer Program enrollment](https://developer.apple.com/programs/enroll/),
  enrolls the chosen identity, accepts the agreements, and pays only the amount
  Apple presents.

### Enrolled; credentials not ready

- **Prerequisites:** active membership for the stable Eido publisher identity.
- **Cost:** USD 99/year membership. The repository establishes no separate
  certificate or API-key price; confirm rather than infer one.
- **Lead time:** unknown; ask Apple how long certificate/API-key availability
  and any remaining identity review will take.
- **Exact next action:** founder obtains one **Developer ID Application**
  certificate (not Developer ID Installer) and one App Store Connect
  notarization API key, then tells the release agent they are ready for
  protected environment provisioning.

### Credentials ready; environment incomplete

- **Prerequisites:** active membership; Developer ID Application `.p12` and
  password; App Store Connect `.p8`, key ID, and issuer UUID; exact Apple Team
  ID and certificate authority common name.
- **Cost:** no additional provisioning amount is established beyond the
  membership amount above.
- **Lead time:** GitHub setup is agent-owned delivery mechanics; any Apple
  credential delay remains unknown and must be asked of Apple.
- **Exact next action:** founder transfers or authorizes the real identity
  material through a protected channel. The agent stores only the missing
  names in the `macos-signing-smoke` environment and never prints their values.

The final environment contract is:

| Name | Kind |
| --- | --- |
| `EIDO_MACOS_CSC_LINK` | Secret |
| `EIDO_MACOS_CSC_KEY_PASSWORD` | Secret |
| `EIDO_MACOS_NOTARIZATION_API_KEY_BASE64` | Secret |
| `EIDO_MACOS_NOTARIZATION_API_KEY_ID` | Variable |
| `EIDO_MACOS_NOTARIZATION_API_ISSUER` | Variable |
| `EIDO_MACOS_EXPECTED_TEAM_ID` | Variable |
| `EIDO_MACOS_EXPECTED_AUTHORITY` | Variable |

Name presence is not proof that a value is valid. Only the owning real-identity
smoke closes that boundary.

### Environment complete; smoke still open

- **Prerequisites:** the seven values are the real Eido identity described in
  the owning smoke doc; the founder is ready to approve the environment-gated
  run.
- **Cost:** no separate smoke amount is established here. CI cost belongs to
  the existing delivery budget authority.
- **Lead time:** unknown; the owning run produces the evidence and this coach
  does not predict Apple's notarization time.
- **Exact next action:** founder approves the environment review when the
  release agent requests it. The agent performs the existing
  sign→notarize→staple→Gatekeeper→offline-launch smoke exactly as owned by
  `macos-signing-smoke.md`.

When the environment contract and #677 both show complete, there is no founder
action until S3 is intentionally started.

## Windows flow

The provider-neutral build and binding owner remains
[`windows-signing-smoke.md`](../release/windows-signing-smoke.md). The shortlist at
[`13-windows-code-signing-provider-shortlist.md`](../../research/05-production-release/13-windows-code-signing-provider-shortlist.md)
is the decision authority; provider onboarding, commercial terms, credentials,
and a real signed candidate remain unproven until completed.

### Provider conversation state unknown

- **Prerequisites:** a current founder answer. A `provider-unselected` manifest
  proves no binding, not that no email or sales conversation happened.
- **Cost:** written quote required. Point-in-time public displays are DigiCert
  **USD 65/month/certificate** and **USD 996 for 12 months/1,000 signings**;
  SSL.com shows **USD 129/year for OV plus USD 15/month for 240 annual
  signings**, while another page says **USD 20/month or USD 180/year**. The
  inconsistencies mean none is a budget or purchase approval.
- **Lead time:** unknown; require written validation and onboarding timing.
- **Exact next action:** founder answers one of: requests not sent, awaiting
  responses, responses received, DigiCert selected, or SSL.com selected. The
  agent reruns with the matching `--windows-stage` value from `--help`.

### Request not sent

- **Prerequisites:** exact Australian legal entity and desired Authenticode
  publisher name; OV; provider-operated non-exportable HSM custody; unattended
  signing from GitHub-hosted `windows-2025`.
- **Cost:** quote required; the public displays above are indicative only.
- **Lead time:** unknown; the request asks the providers to state it.
- **Exact next action:** founder sends this identical, non-binding request to
  DigiCert and SSL.com. Do not create an account or buy a certificate yet:

> Can you issue one OV publicly trusted code-signing certificate to our exact
> Australian legal entity and publisher name, with a provider-operated,
> non-exportable HSM key and unattended signing from GitHub-hosted
> `windows-2025`? Please confirm the supported client/API, authentication and
> revocation model, RFC 3161 timestamping, sandbox/trial, exact annual total,
> included signature count, and overage price. Name the exact HSM model and
> provide its validation certificate showing at least FIPS 140-2 Level 3 or
> Common Criteria EAL 4+, plus the current Signing Service conformity-audit
> scope/report required by CA/B Forum Code Signing Baseline Requirements
> section 8.4.2.

### Awaiting responses

- **Prerequisites:** the identical request was sent to both providers.
- **Cost:** still quote required; no sales acknowledgement is a total.
- **Lead time:** unknown until DigiCert gives a response date and onboarding
  estimate. Ask SSL.com too without making the fallback a gate.
- **Exact next action:** founder requires DigiCert to answer every request
  item. A compliant DigiCert response can advance immediately; use the SSL.com
  response only if DigiCert fails eligibility, timing, contract, or commercial
  terms.

### Responses received; decision required

- **Prerequisites:** DigiCert covers Australian eligibility and exact
  publisher, total and overages, onboarding time, hosted-HSM assurance,
  unattended `windows-2025` integration, authentication/revocation,
  timestamping, and sandbox/trial terms; or DigiCert failed and SSL.com covers
  the same list.
- **Cost:** compare exact written all-in totals and signing allowances. This is
  a founder money and identity decision.
- **Lead time:** compare the providers' written validation and onboarding
  estimates; there is no repository default.
- **Exact next action:** choose **DigiCert KeyLocker** if it confirms the
  contract and its total is acceptable. Choose **SSL.com** only if DigiCert
  fails and SSL.com confirms a GitHub-hosted **CodeSignTool or CSC API** path,
  immutable integration, and acceptable credential rotation. Never use SSL.com
  CKA on a GitHub-hosted runner. Prefer **OV over EV** because both now share
  the same initial SmartScreen reputation behavior.

DigiCert Software Trust Manager is considered only if role separation,
provider-side policy, or audit-ready logs are actually required. GlobalSign is
held only for a founder decision to own the Azure HSM boundary. Sectigo is not
shortlisted on present hosted-runner evidence. Microsoft Artifact Signing
Public Trust is excluded because Australia is not eligible.

Before selection becomes release authority, the agent must confirm the chosen
response can be proven against all seven outcomes in the shortlist's
**Adapter and acceptance contract**: non-exportable declared custody;
authorized hosted signing; fail-closed unauthorized/outage/allowance behavior;
one verified SHA-256-only builder adapter; exact publisher/chain/timestamp
verification; source/artifact/provider evidence binding; and rehearsable
credential or provider replacement. A provider sales response alone completes
none of them.

### Provider selected; manifest unbound

- **Prerequisites:** founder-approved written quote and publisher identity;
  issued/activated OV identity; exact provider class, Authenticode publisher
  subject, and SHA-256 certificate fingerprint available.
- **Cost:** the accepted written all-in quote and overages; never substitute a
  public display figure.
- **Lead time:** the selected provider's written validation, issuance, and
  onboarding estimate.
- **Exact next action:** founder authorizes the selected identity and protected
  account access. The agent changes `bindingStatus` to `bound` and populates
  `providerClass`, `expectedPublisher`, and
  `expectedCertificateThumbprintSha256` in `windows-manifest.json`. Only after
  that provider-authorized binding may the agent follow the owning smoke doc
  and add the signing workflow.

### Manifest bound

Binding is not completion. If #678 remains open, founder delivery mechanics are
done and the agent proves the real fail-closed smoke under the owning doc. Cost
and lead time come from the accepted provider terms. When the manifest and #678
both show complete, there is no founder action until S3 is intentionally
started.

## Safety and authority

- This coach never reads secret values, writes account state, modifies GitHub,
  changes the manifest, or dispatches a workflow.
- A live-source error is reported as unavailable, never translated into an
  account reset or another founder task.
- Tracker closure and acceptance checkboxes must agree. A closed issue with
  unchecked criteria, or an open issue with every criterion checked, is handed
  to an agent for reconciliation instead of being called complete.
- The environment and manifest are tolerated in any state; their absence or
  incompleteness cannot fail CI or block an Alpha ticket.
- The coach is not wired into a package gate or GitHub Actions workflow. It
  runs only when a founder or agent asks for a current read.
- The Apple cost is sourced from
  [`03-autonomous-release-operations.md`](../../research/05-production-release/03-autonomous-release-operations.md);
  the epic's later unsigned-first decision supersedes that note's old release
  ordering, not the cited membership amount. Windows facts and labels come
  from the dated shortlist above and must not be silently re-researched or
  upgraded from Fact/Inference/Unknown.
