# Windows public code-signing provider shortlist

**Evidence cut:** 2026-07-20

**Target:** Australian organization, private source, public direct-download
Windows x64 Electron application, GitHub-hosted Windows runner

**Status:** decision-ready shortlist from current primary public sources;
provider onboarding, commercial terms, credentials, and a real signed candidate
remain unproven

## Decision

Use the **DigiCert family as the first onboarding path** and keep **SSL.com
eSigner as the bounded fallback**.

- Choose **DigiCert KeyLocker** when one authorized signing identity and its
  published 1,000-signature allowance are enough. Choose **DigiCert Software
  Trust Manager** only if provider-side role separation, signing policies, or
  audit-ready logs are release requirements. DigiCert documents a cloud HSM,
  Windows GitHub Actions automation, and SignTool/SMCTL paths without exporting
  the code-signing private key. Its exact Australian organization eligibility
  and current GitHub-action entitlement still need confirmation before purchase.
- If DigiCert cannot validate the organization, meet the required onboarding
  time, or provide acceptable commercial terms, use **SSL.com OV Code Signing +
  eSigner through CodeSignTool or the CSC API**. Do **not** use eSigner CKA on a
  GitHub-hosted runner: SSL.com's current compatibility matrix limits that path
  to self-hosted GitHub runners.
- Hold **GlobalSign** as a customer-managed-HSM alternative, not a turnkey
  provider-hosted option. Its documented path makes Eido own Azure Key Vault HSM
  and a second vendor boundary.
- Do not select **Sectigo** from current public evidence. Its current material
  proves token or customer-owned HSM custody, but not a turnkey unattended
  GitHub-hosted signing path.
- Exclude **Microsoft Artifact Signing Public Trust** now. Microsoft limits
  organization eligibility to the United States, Canada, the European Union,
  and the United Kingdom; Australia is absent. Microsoft Private Trust is not a
  substitute for signatures intended to validate on ordinary public Windows
  installations.

Prefer an **OV** certificate for this Electron application. Microsoft says OV
and EV now have the same initial SmartScreen reputation behavior; EV no longer
bypasses first-download warnings. Reopen EV only for an explicit enterprise-
procurement requirement, which is not in this release scope.

## Evidence language

This note uses three evidence classes:

| Label | Meaning |
| --- | --- |
| **Fact** | A current standard, platform owner, tool owner, or provider states the property directly. Provider product claims remain provider-declared, not independent operating proof. |
| **Inference** | The cited facts make the conclusion reasonable for Eido, but a disposable signing run or vendor confirmation is still required. |
| **Unknown** | Current primary public sources do not establish the property. It must not be treated as delivered. |

No provider account, repository configuration, workflow, environment, secret,
variable, credential, or live signing service was inspected during this review.

## Non-negotiable technical floor

**Fact:** The CA/Browser Forum's current Code Signing Baseline Requirements
cover publicly trusted code-signing certificates and require protected
subscriber keys. A provider-hosted Signing Service must generate and protect
keys in at least a FIPS 140-2 Level 3 or Common Criteria EAL 4+ module. A
subscriber-managed HSM or cloud-HSM solution has a FIPS 140-2 Level 2 or Common
Criteria EAL 4+ floor, with key creation, storage, and use remaining inside the
HSM boundary and access/configuration logged. Certificate validity is capped at
460 days for certificates issued on or after 2026-03-01.
[CA/Browser Forum Code Signing Baseline Requirements v3.11](https://cabforum.org/working-groups/code-signing/requirements/)

**Fact:** A valid OV or EV signature identifies the verified publisher and
allows reputation to accumulate, but a new signed binary can still show a
SmartScreen warning. Microsoft states that EV no longer bypasses SmartScreen and
that traditional OV/EV certificates remain the worldwide route for developers
outside Artifact Signing's eligible regions.
[Microsoft SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation),
[Microsoft code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)

**Fact:** `electron-builder` permits a custom Windows signer through
`win.signtoolOptions.sign`; that hook replaces its built-in signing operation.
In pinned 26.15.3, a custom hook that resolves is treated as successful without
independent byte verification, so `forceCodeSigning` alone cannot prove the
output was signed. The same version defaults non-MSI targets to SHA-1 plus
SHA-256 signing passes unless `signingHashAlgorithms` is narrowed.
[electron-builder Windows signing configuration](https://www.electron.build/docs/features/code-signing/code-signing-win/),
[electron-builder Windows configuration](https://www.electron.build/docs/win/),
[electron-builder 26.15.3 custom-sign source](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.15.3/packages/app-builder-lib/src/codeSign/windowsSignToolManager.ts#L178-L240)

**Inference:** Any shortlisted remote signer can be kept behind one narrow
Eido-owned `electron-builder` custom-sign adapter. That adapter should receive
each builder-selected path, invoke the provider client, throw on any signing or
timestamp failure, then independently verify publisher, chain, timestamp, and
file integrity before it resolves. Configure
`win.signtoolOptions.signingHashAlgorithms: ['sha256']` so one path does not
silently consume both SHA-1 and SHA-256 remote-signing units. This avoids
coupling package construction to one provider's workflow shape while making
success depend on the resulting bytes rather than the hook's return value.

## Exact runner and artifact evidence

**Fact:** GitHub currently exposes `windows-2025` as an x64 hosted-runner label,
and each standard hosted job receives a fresh VM. Its published image includes
the Windows 11 SDK/SignTool toolchain, current .NET runtimes, PowerShell, and
Java.
[GitHub-hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[`windows-2025` image inventory](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md)

**Inference:** Those prerequisites appear to cover the documented DigiCert
Windows clients, SSL.com CodeSignTool, and AzureSignTool shapes. The clients are
therefore plausible on `windows-2025`, but provider guides usually name GitHub
Actions or `windows-latest`, not a tested Eido `windows-2025` build. Only an
account-backed disposable signing run can close that residual. Runner
prerequisites are evidence for trying the path, not proof that a vendor
entitlement, installer, or current endpoint works.

The acceptance record must derive identity from the exact signed artifact, not
from a provider dashboard. On Windows, `Get-AuthenticodeSignature` exposes the
signer certificate, while .NET can calculate its SHA-256 certificate hash:

```powershell
$signature = Get-AuthenticodeSignature -LiteralPath $artifactPath
$subject = $signature.SignerCertificate.Subject
$fingerprint = $signature.SignerCertificate.GetCertHashString(
  [System.Security.Cryptography.HashAlgorithmName]::SHA256
).ToUpperInvariant()
```

Require `Valid`, an exact expected subject, and an uppercase 64-hex-character
fingerprint. Do not substitute the certificate object's ordinary `Thumbprint`
property, which is commonly SHA-1. Independently run SignTool verification with
the Authenticode policy and timestamp warning enabled (`verify /pa /tw /v`),
and require SHA-256 file and RFC 3161 timestamp digests when signing (`/fd
SHA256`, `/tr`, `/td SHA256`).
[Get-AuthenticodeSignature](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature),
[X509Certificate.GetCertHashString(HashAlgorithmName)](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.x509certificates.x509certificate.getcerthashstring),
[SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)

## Provider comparison

| Candidate | Public trust and custody | GitHub-hosted Windows evidence | Australia evidence | Verdict |
| --- | --- | --- | --- | --- |
| **DigiCert KeyLocker / Software Trust Manager** | DigiCert's KeyLocker product docs say it generates and stores code-signing keys in a FIPS 140-2 Level 3 cloud HSM. DigiCert public code-signing certificates are intended to be trusted by operating systems. | DigiCert documents Windows GitHub Actions, SMCTL/KSP/SignTool integration, and API-key plus client-authentication-certificate authentication. Its current Binary Signing material supports hosted and self-hosted runners. | DigiCert documents validation against government registries, but no current page found here explicitly promises Australian code-signing onboarding. | **First choice, conditional on validation and SKU confirmation.** KeyLocker is the lean default; use STM only when its added governance changes release risk. |
| **SSL.com OV + eSigner** | SSL.com says eSigner retains the private key in a FIPS 140-2 Level 3 cloud HSM and supports OV, IV, and EV public code-signing certificates. | Its current matrix explicitly supports CodeSignTool and CSC API on GitHub Actions; CKA is marked self-hosted-only for GitHub. The published action example uses username, password, credential ID, and a TOTP seed. | SSL.com explicitly accepts Australian identity documents for individual validation, but that is not proof that this Australian organization will pass OV. | **Second choice.** Trial only CodeSignTool or CSC on GitHub-hosted Windows; confirm OV eligibility and credential controls first. |
| **GlobalSign OV + customer HSM** | GlobalSign offers public OV/EV code-signing certificates and says the HSM implementation uses a customer-supplied conforming HSM; GlobalSign does not provide that HSM. Its documented Azure path integrates an HSM-backed Key Vault. | GlobalSign makes a general GitHub Actions integration claim, but its detailed AWS CloudHSM SignTool recipe requires a Windows EC2 instance in the HSM VPC. No exact first-party GitHub-hosted Windows recipe was found. | GlobalSign lists an Australian regional contact and an Asia-Pacific ordering region. Exact product validation remains unproven. | **Hold.** Viable only if Eido accepts owning Azure Key Vault HSM, its identity/access boundary, cost, and adapter. Atlas is not proven hosted signing custody. |
| **Sectigo OV/EV** | Sectigo's current enterprise page says certificates are shipped on a token or downloaded into the customer's own attested, FIPS-compliant HSM. | No current first-party turnkey GitHub-hosted Windows signing action or recipe was found. | Sectigo publishes an Australian sales contact, not a code-signing eligibility guarantee. | **Not shortlisted.** Reconsider only if Sectigo supplies a current, auditable hosted-signing contract and hosted-runner recipe. |
| **Microsoft Artifact Signing Public Trust** | Microsoft operates a managed public-trust service and keeps the Authenticode certificate inside the service. Private Trust is not rooted for ordinary public Windows users. | Microsoft and `electron-builder` both document direct CI/CD integration. | Microsoft explicitly limits Public Trust organizations to the US, Canada, EU, and UK. | **Excluded for Australia.** Recheck only after Microsoft publishes a geographic expansion. |

## Commercial evidence is quote-only

Public prices are useful for ordering the shortlist, not for approving spend:

| Candidate | Point-in-time public display | Why it is not a budget |
| --- | --- | --- |
| DigiCert OV + KeyLocker | DigiCert's buy page displays `$65/month/certificate` and a `$996` 12-month subscription with 1,000 signings. A second DigiCert code-signing page displays different starting amounts. | The monthly figure does not multiply to the displayed subscription total, currency/tax and Australian terms are unresolved, and extra 1,000-signature packs are unpriced publicly. [DigiCert buy page](https://www.digicert.com/buy), [DigiCert code-signing page](https://www.digicert.com/signing/code-signing-certificates) |
| SSL.com OV + eSigner | Its product page displays `$129/year` for OV plus Tier 1 at `$15/month` for 240 annual signings; its April 2026 comparison instead displays `$20/month` or `$180/year`. | The product page's own order summary shows `$129` total while also listing the signing subscription, so the all-in total is internally inconsistent. [SSL.com eSigner product/pricing](https://www.ssl.com/products/software-integrity/signing-service/), [SSL.com comparison/pricing](https://www.ssl.com/guide/esigner-vs-hardware-token/) |
| GlobalSign + Azure Key Vault HSM | GlobalSign hides the current certificate amount behind regional ordering, and Azure separately meters Premium HSM keys and operations. | This is a two-vendor total with identity validation, attestation, key storage, operations, and support terms. A GlobalSign-only quote is incomplete. [GlobalSign shop](https://shop.globalsign.com/en/code-signing), [Azure Key Vault pricing](https://azure.microsoft.com/en-us/pricing/details/key-vault/) |

No public number above is approval to purchase or a reliable annual total.

## Timestamp and `electron-builder` path

| Candidate | Eido integration seam | Provider timestamp evidence |
| --- | --- | --- |
| DigiCert | Let the current Binary Signing action install verified client tooling, then have `signtoolOptions.sign` invoke SMCTL or the KeyLocker KSP/SignTool path for every path supplied by the builder. Do not merely sign the completed NSIS outer file after packaging. | DigiCert's Binary Signing input defaults timestamping to enabled and SHA-256, while its KeyLocker examples use `http://timestamp.digicert.com`. |
| SSL.com | Have the custom hook invoke CodeSignTool or a small CSC client. Do not use CKA on the hosted runner and do not copy the vendor guide's floating `sslcom/actions-codesigner@develop` reference into a release boundary. | SSL.com's `sign` and `batch_sign` operations are documented to sign and timestamp the object. The real proof must record the returned RFC 3161 timestamp from the signed file. |
| GlobalSign + Azure | Have the custom hook invoke an immutable-pinned AzureSignTool against the customer-owned Key Vault HSM for each builder path. `win.azureSignOptions` is reserved for Microsoft Artifact Signing and is not this integration. | GlobalSign's recipe uses `http://timestamp.globalsign.com/tsa/advanced` with SHA-256 timestamp digest. |

These are adapter shapes, not workflow changes. The chosen path must prove that
Electron's unpacked/native executables are signed before they are embedded and
that the final NSIS installer is also signed and timestamped. Pin
`signingHashAlgorithms` to SHA-256-only; electron-builder 26.15.3 otherwise
invokes the custom hook once for SHA-1 and again for SHA-256 on non-MSI paths,
which can nest signatures and consume two remote signing units per path.
Pin every third-party action to a full commit SHA and every downloaded client to
an exact version plus vendor checksum; a floating action tag, branch, or
`latest` client URL cannot be part of the release authority.
[DigiCert Binary Signing inputs](https://docs.digicert.com/en/software-trust-manager/ci-cd-integrations-and-deployment-pipelines/plugins/github/binary-signing-using-github-actions.html),
[SSL.com GitHub integration](https://www.ssl.com/how-to/cloud-code-signing-integration-with-github-actions/),
[GlobalSign AzureSignTool integration](https://support.globalsign.com/code-signing/code-signing/code-signing-azure-key-vault-and-azure-signtool)

## 1. DigiCert: recommended family

### Facts

- [DigiCert KeyLocker](https://docs.digicert.com/en/digicert-keylocker.html)
  is described as cloud-based FIPS 140-2 Level 3 key generation/storage and an
  alternative to a local token or customer-operated HSM.
- [DigiCert public code-signing certificates](https://docs.digicert.com/en/software-trust-manager/certificates/certificates-types/public-code-signing-certificates.html)
  are issued under a public CA chain for operating-system trust and contain
  verified organization information.
- [KeyLocker licensing](https://docs.digicert.com/en/digicert-keylocker/overview/licensing.html)
  permits one assigned signer and 1,000 signature units per certificate; every
  artifact signed consumes a unit, including nested binaries.
- [DigiCert's KeyLocker/STM comparison](https://www.digicert.com/content/dam/digicert/pdfs/kl-and-stm-comparison-sheet.pdf)
  positions both as managed cloud key storage with CI/CD/CLI/API support, while
  STM adds role/team access control, policy enforcement, and audit-ready signing
  and activity logs.
- [DigiCert's current GitHub integration](https://docs.digicert.com/en/digicert-keylocker/ci-cd-integrations-and-deployment-pipelines/plugins/github.html)
  tells KeyLocker users to migrate to DigiCert Binary Signing. The
  [current Binary Signing instructions](https://docs.digicert.com/en/software-trust-manager/ci-cd-integrations-and-deployment-pipelines/plugins/github/binary-signing-using-github-actions.html)
  cover Windows and recommend the newer simple-signing mode.
- DigiCert also publishes a
  [direct KeyLocker KSP/SignTool script for GitHub Actions](https://docs.digicert.com/en/digicert-keylocker/ci-cd-integrations-and-deployment-pipelines/scripts/github/scripts-for-signing-using-ksp-library-on-github.html).
  It authenticates with an API key and client-authentication certificate and
  keeps the code-signing key remote.

### Inference

KeyLocker is the lowest-machinery DigiCert fit for a small Friends Alpha if its
one-signer and signature-unit limits cover the builder's real number of signing
operations. STM is justified only if provider-side approvals, separation of
duties, policies, or exported audit records are part of the release threat
model. Either path can sit behind `signtoolOptions.sign` and remain replaceable.

### Unknown before onboarding

- whether DigiCert will validate the exact Australian legal entity and desired
  publisher name;
- whether the selected KeyLocker SKU includes the current recommended Binary
  Signing/simple-signing path, or requires the documented KSP/SMCTL script;
- whether KeyLocker is currently operated and audited as the Level 3 hosted
  Signing Service its product docs describe: DigiCert's current public sales
  page separately says Level 2, so written confirmation is required;
- exact certificate-chain continuity, revocation response, credential rotation,
  outage behavior, support response, retention, and commercial terms;
- the true signature-unit count for one Eido NSIS build; and
- whether provider-side audit export is required beyond immutable CI evidence
  plus Windows signature/timestamp verification.

## 2. SSL.com eSigner: bounded fallback

### Facts

- [SSL.com eSigner for Code](https://www.ssl.com/products/software-integrity/signing-service/)
  is described as a FIPS 140-2 Level 3 cloud-HSM service in which the private key
  does not leave the HSM. It supports IV, OV, and EV code-signing certificates.
- [SSL.com's current compatibility matrix](https://www.ssl.com/guide/esigner-vs-hardware-token/)
  distinguishes its clients: GitHub Actions supports CodeSignTool and the CSC
  API, while CKA support is limited to a self-hosted GitHub runner.
- The [official GitHub Actions guide](https://www.ssl.com/how-to/cloud-code-signing-integration-with-github-actions/)
  uses CodeSignTool and requires username, password, credential ID, and TOTP
  secret inputs. The example proves automation shape, not Eido's production
  security posture or action pinning.
- [SSL.com OV Code Signing](https://www.ssl.com/products/software-integrity/code-signing/ov/)
  explicitly supports eSigner cloud custody and states that OV and EV share the
  same post-2024 SmartScreen reputation behavior.

### Spec correction

**CodeSignTool is an SSL.com eSigner client, not a Sectigo product.** Any ticket
or specification phrase that groups "Sectigo CodeSignTool" should be corrected
to "SSL.com eSigner CodeSignTool" and should separately describe Sectigo's
customer-HSM route.

### Inference

SSL.com is a credible fallback because it has the clearest first-party statement
that CodeSignTool runs on GitHub-hosted Actions. Use CodeSignTool or CSC, never
CKA, for the hosted Windows lane. Its four stored authentication inputs create a
material credential-rotation and least-privilege question that must be answered
before production signing.

### Unknown before onboarding

- Australian OV organization validation and exact publisher-name outcome;
- supported unattended authentication lifetimes, rotation/revocation, approval
  controls, audit export, rate limits, file/hash disclosure, and outage behavior;
- whether the production-supported GitHub path is the published action, direct
  CodeSignTool, or CSC API, and how its implementation will be immutable-pinned;
- exact all-in commercial terms: SSL.com's current compatibility/pricing page
  and product/order pages publish conflicting Tier 1 amounts, so public prices
  are indicative only and a written quote is required; and
- actual Electron/NSIS throughput and signing-unit consumption.

## 3. GlobalSign: viable only with customer-owned cloud HSM

### Facts

- [GlobalSign's code-signing product](https://www.globalsign.com/en/code-signing-certificate)
  offers public OV and EV certificates with token or HSM implementation, states
  that HSMs are not provided, and lists Azure Key Vault HSM compatibility.
- Its [Azure Key Vault setup](https://support.globalsign.com/code-signing/code-signing/code-signing-certificate-setup-azure-key-vault)
  makes the customer create and operate the Azure subscription, vault, HSM key,
  and GlobalSign certificate enrollment.
- Its [AWS CloudHSM SignTool recipe](https://support.globalsign.com/code-signing/code-signing/code-signing-windows-builds-using-signtool-and-aws-cloud-hsm)
  requires a Windows EC2 client and an HSM cluster in the same VPC. That is not a
  GitHub-hosted runner design.
- GlobalSign broadly claims
  [GitHub Actions compatibility](https://www.globalsign.com/en/pki-devops), but
  the public material reviewed here does not bind that claim to a specific
  GitHub-hosted Windows adapter or to GlobalSign-hosted key custody.

### Inference

GlobalSign + Azure Key Vault HSM + AzureSignTool could be automated from a
GitHub-hosted Windows runner, but it gives Eido two external operational
boundaries rather than one. It should not displace DigiCert or SSL.com unless
customer-controlled Azure custody is itself a requirement.

### Unknown before onboarding

- whether the exact Azure Key Vault tier/key type can be remotely signed from
  GitHub-hosted Windows with a supported, least-privilege identity;
- Australian OV validation, attestation acceptance, and certificate pickup;
- who owns incident response across GlobalSign and Azure; and
- any GlobalSign-hosted signing service behind Atlas. Current Atlas evidence
  establishes certificate management, not hosted code-signing key custody.

## 4. Sectigo: insufficient hosted-runner evidence

### Facts

- [Sectigo's current enterprise code-signing page](https://www.sectigo.com/enterprise-solutions/certificate-manager/code-signing-solutions)
  offers OV/EV certificates and says current certificates are delivered on a
  token or downloaded into the customer's own attested FIPS-compliant HSM.
- Sectigo's
  [current Code Signing CP/CPS v1.0.3](https://www.sectigo.com/uploads/files/Code-Signing-CP-CPS-1.0.3.pdf)
  permits subscriber hardware, a compliant cloud HSM, or a conforming signing
  service. That is a policy allowance, not proof that Sectigo sells Eido a
  turnkey hosted signer.
- The current public support material reviewed here contains SignTool/token and
  customer-HSM instructions, but no exact GitHub-hosted Windows automation path.

### Inference

Sectigo can issue a usable public certificate if Eido supplies a supported cloud
HSM. It does not currently meet the low-operations hosted-signing requirement on
public evidence alone.

### Unknown before reconsideration

- whether Sectigo currently offers a provider-hosted, audited signing service to
  an Australian organization;
- its unattended API/client, GitHub-hosted runner recipe, authentication model,
  limits, logs, and file/hash disclosure; and
- whether any older "Code Signing on Demand" material represents a current
  product with current CA/B Forum and runner support.

## 5. Microsoft Artifact Signing: geographically excluded

### Facts

- Microsoft's [Artifact Signing FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)
  and [quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
  state that Public Trust is currently available to organizations in the US,
  Canada, EU, and UK, and to individuals in the US and Canada. Australia is not
  listed.
- [Microsoft's trust-model documentation](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-trust-models)
  says Public Trust is intended for publicly shared Windows artifacts; Private
  Trust is not default-trusted in Windows.
- Microsoft keeps the Authenticode certificate inside the service and documents
  GitHub/CI integration, but those advantages cannot overcome the Public Trust
  identity gate for this organization.

### Inference

Artifact Signing would otherwise be an attractive low-custody option. It should
remain excluded rather than allowing Azure account creation or Private Trust
experiments to distract from an eligible public-trust provider.

### Unknown

Microsoft has not published an Australian expansion date. Re-evaluate geography
from the FAQ immediately before any later procurement decision.

## Smallest founder action

Authorize one identical, non-binding written eligibility-and-quote request to
DigiCert and SSL.com; do not create an account or buy a certificate yet:

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

The assurance request is mandatory because a generic "non-exportable HSM" claim
can still describe a lower-assurance boundary, and DigiCert's current KeyLocker
documentation and sales page conflict on Level 3 versus Level 2 wording.
[CA/B Forum Code Signing Baseline Requirements](https://cabforum.org/working-groups/code-signing/requirements/),
[DigiCert KeyLocker documentation](https://docs.digicert.com/en/digicert-keylocker.html),
[DigiCert code-signing sales page](https://www.digicert.com/signing/code-signing-certificates)

Decision rule: choose DigiCert KeyLocker if it confirms the contract and its
written total is acceptable; choose SSL.com only if it confirms the hosted-runner
CodeSignTool/CSC path, safer immutable integration than its floating-branch
example, and acceptable credential rotation. Escalate to STM or GlobalSign +
Azure only when their extra governance or customer custody would change the
release risk. This is the only founder decision needed from this research.

## Adapter and acceptance contract

Provider selection is not completion. A disposable production-equivalent proof
must establish these outcomes before the provider becomes release authority:

1. the code-signing private key is generated, stored, and used only inside the
   declared HSM/signing-service boundary and is not exportable as PFX;
2. an authorized GitHub-hosted Windows job can sign every builder-selected PE
   and the final NSIS installer without interaction;
3. an unauthorized job/ref, expired credential, provider outage, missing
   timestamp, or exhausted signing allowance fails closed and publishes no
   candidate;
4. `electron-builder` uses one custom signing adapter, `forceCodeSigning`, and
   SHA-256-only `signingHashAlgorithms`; the adapter throws on refusal or
   timestamp failure and independently verifies each builder-selected output
   before resolving;
5. Windows verification proves the expected legal publisher, trusted chain,
   RFC 3161 timestamp, and signature integrity for the final downloadable
   installer and installed executable set;
6. the release record binds source SHA, unsigned-input digest where available,
   signed-output digest, provider/certificate identity, timestamp, job/run, and
   verification result without exposing credentials; and
7. credential rotation/revocation and provider replacement are rehearsable
   without changing Eido's package-construction interface.

Additional provider comparison work should stop once one eligible provider
passes this contract. More vendor paperwork would not change what Eido ships.

## Primary source index

- [CA/Browser Forum Code Signing Baseline Requirements v3.11](https://cabforum.org/working-groups/code-signing/requirements/)
- [Microsoft code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- [Microsoft SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- [Microsoft Artifact Signing FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)
- [Microsoft Artifact Signing trust models](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-trust-models)
- [electron-builder Windows signing configuration](https://www.electron.build/docs/features/code-signing/code-signing-win/)
- [GitHub-hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [`windows-2025` runner image inventory](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md)
- [Microsoft Get-AuthenticodeSignature](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature)
- [Microsoft X509 certificate SHA-256 hash API](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.x509certificates.x509certificate.getcerthashstring)
- [Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)
- [DigiCert KeyLocker](https://docs.digicert.com/en/digicert-keylocker.html)
- [DigiCert KeyLocker licensing](https://docs.digicert.com/en/digicert-keylocker/overview/licensing.html)
- [DigiCert KeyLocker/Software Trust Manager comparison](https://www.digicert.com/content/dam/digicert/pdfs/kl-and-stm-comparison-sheet.pdf)
- [DigiCert GitHub integration](https://docs.digicert.com/en/digicert-keylocker/ci-cd-integrations-and-deployment-pipelines/plugins/github.html)
- [DigiCert public prices](https://www.digicert.com/buy)
- [SSL.com eSigner for Code](https://www.ssl.com/products/software-integrity/signing-service/)
- [SSL.com CI/CD compatibility matrix](https://www.ssl.com/guide/esigner-vs-hardware-token/)
- [SSL.com GitHub Actions integration](https://www.ssl.com/how-to/cloud-code-signing-integration-with-github-actions/)
- [GlobalSign code-signing certificates](https://www.globalsign.com/en/code-signing-certificate)
- [GlobalSign Azure Key Vault setup](https://support.globalsign.com/code-signing/code-signing/code-signing-certificate-setup-azure-key-vault)
- [GlobalSign AzureSignTool integration](https://support.globalsign.com/code-signing/code-signing/code-signing-azure-key-vault-and-azure-signtool)
- [Sectigo enterprise code signing](https://www.sectigo.com/enterprise-solutions/certificate-manager/code-signing-solutions)
