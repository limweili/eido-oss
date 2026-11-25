# ADR 0044: The AI Control Plane Runs on a Sydney Google Cloud Stack

Status: superseded by ADR 0051 on 2026-10-27.

Historical decision. The founder removed this commercial architecture in [ADR 0051](0051-free-open-source-byok-only.md). Do not implement or operate it from this record.

## Context

Hosted AI adds Eido's first production service authority. It must transact
account mappings, entitlements, free-turn reservations, payment-backed credit,
provider operations, and webhook inboxes without becoming an AI content data
plane. The repository has no existing backend, database, queue, deployment, or
secret-management platform to extend. A fragmented low-cost stack reduces its
initial bill but expands recovery, security, and operational ownership at the
most financially sensitive boundary in the product.

## Decision

The target public-launch stack is one Node 24/TypeScript AI Control Plane
container on Google Cloud Run in Sydney (`australia-southeast1`), backed by a
high-availability Cloud SQL PostgreSQL authority in the same region. Cloud
Tasks owns durable provider work, Cloud Scheduler triggers idempotent scans,
Secret Manager stores provider and database secrets, Cloud KMS owns credential
envelope encryption, and Cloud Logging/Monitoring use a content-blind schema.

The service and a separately invoked migration job share one immutable image.
PostgreSQL transactions own reservations and ledger invariants; a transactional
outbox bridges state changes to at-least-once tasks. Migrations expand before
code rollout and contract only in a later release. Cloud Run revision rollback
does not imply database rollback.

Sandbox and production use separate Google Cloud projects, databases, service
identities, KMS keys, secrets, provider environments, logs, and budgets. Local
development and ordinary automated tests use synthetic data and in-memory or
containerized external adapters; production data is never cloned into sandbox.

## Considered Options

- Chosen: Cloud Run, Cloud SQL PostgreSQL, Tasks/Scheduler, Secret Manager/KMS,
  and managed observability in one Sydney administrative boundary.
- Deferred pilot posture: a zonal Cloud SQL instance can temporarily reduce
  cost only as an explicit availability trade-off before public paid launch.
- Not chosen as default: Vercel Pro plus Neon, because split operations,
  no-retry/duplicate Cron behavior, short standard telemetry and PITR windows,
  and weaker customer-selected KMS posture make Eido own more correctness and
  recovery machinery.
- Not chosen: an AWS serverless graph, because its wider service, IAM,
  networking, and database-access surface has no current product benefit.

## Consequences

- Public paid launch requires a sandbox end-to-end proof, concurrent-ledger
  proof, content-redaction proof, expand/deploy/rollback rehearsal, isolated
  backup restore, database failover exercise, and bounded abuse/load test.
- Production starts with seven days of point-in-time recovery, 14 daily
  backups, deletion protection, a retained final backup, and quarterly isolated
  restore rehearsal; actual RPO/RTO is recorded rather than assumed.
- Cloud Run maximum instances and concurrency are set from the database pool
  and an approved cost envelope. Provider queues have separate rate and
  concurrency limits. Billing budgets alert but are not treated as spend caps.
- Hosted AI may be temporarily unavailable during a control-plane incident;
  local Boards and basic BYOK remain available, so an initial cross-region hot
  database is not justified.
