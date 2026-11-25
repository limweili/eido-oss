# ADR 0046: Account Deletion Freezes First and Erases Through a Resumable Saga

Status: superseded by ADR 0051 on 2026-10-27.

Historical decision. The founder removed this commercial architecture in [ADR 0051](0051-free-open-source-byok-only.md). Do not implement or operate it from this record.

## Context

An Eido Account spans Eido's entitlement and credit authority, one managed
OpenRouter credential, Clerk identity and Google connection, and Stripe money
and retention obligations. No provider owns a safe cross-system delete. A
simple Clerk cascade could leave a funded key or charge running; deleting the
Stripe Customer first can make refunds and disputes impossible; waiting months
for a payment case before deleting identity would retain an active account with
no product need. Local Boards and BYOK are outside every one of those cloud
authorities.

## Decision

Account deletion is an idempotent Eido-owned fork/join saga with one durable
case and monotonic steps. After strong hosted-account reverification, one
database transaction marks the account deletion-pending and atomically denies
Hosted AI, free turns, reservations, purchases, Checkout/Portal creation,
Auto-Recharge, and entitlement mutation. That access freeze precedes every
destructive provider effect and never touches the local Profile, Boards,
Portable Exports, or BYOK.

The saga then starts two joined branches:

1. Disable and delete the per-account OpenRouter credential, then erase Eido's
   encrypted recoverable copy.
2. Snapshot the minimum restricted Stripe case, immediately cancel the
   subscription, initiate any approved refund/dispute/credit disposition, and
   later delete or redact the Stripe Customer only when money is terminal.

As soon as required provider identifiers are snapshotted and user-authorized
money operations have started, the identity branch disconnects Google,
explicitly revokes Clerk sessions, deletes the Clerk User, and erases active
Eido cloud data. It does not keep identity alive for a months-long Stripe case.
Purpose-bound finance, dispute, incident, or legal records use a separate
restricted case identifier and can never authorize or reconstruct an account.

Eido-managed backup restoration cannot serve traffic until it reapplies every
erasure marker newer than the restored snapshot. Provider webhooks reconcile
operations but never coordinate the deletion transaction.

## Considered Options

- Chosen: freeze first, then resumable provider branches with restricted
  financial retention separated from active identity.
- Not chosen: Clerk user deletion as a cascade trigger, because authentication
  teardown does not prove Eido, Stripe, or OpenRouter cleanup.
- Not chosen: delete Stripe first, because it can cancel or strand operations
  and make refunds or disputes impossible to complete.
- Not chosen: retain the whole account until all provider backups and payment
  cases age out, because necessary restricted records do not justify active
  product identity or access.

## Consequences

- Ordinary period-end subscription cancellation and immediate cloud-account
  deletion are separate, plainly described customer actions.
- Every provider step needs a durable idempotency/reconciliation contract;
  already-absent resources count as success only after ownership is verified.
- Public copy distinguishes active-data erasure, provider backup/log aging, and
  purpose-bound retained records rather than promising instant global erasure.
- Refund, AI Credit expiry, financial-retention, cross-border disclosure, and
  provider deletion promises remain launch-gated on qualified Australian
  advice and the written provider confirmations listed in the research report.
