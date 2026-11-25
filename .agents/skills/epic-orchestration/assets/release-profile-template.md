# Release profile — <repository>

This file adapts durable orchestration and landing principles to the current
repository. Keep volatile run state elsewhere.

## Repository and delivery

- Canonical repository and shared branch: <value>
- Review and integration conventions: <value>
- What “landed” and “in production” mean here: <observable states>

## Required evidence

- Canonical required proof: <current source of truth>
- Additional evidence by risk: <behavior or surface → proof>
- Optional/canary evidence and triage expectation: <value>
- Conditions that make local or hosted evidence non-authoritative: <value>

Do not duplicate the implementation of the canonical gate. Point to its one
executable owner.

## Shared and high-risk surfaces

- <surface → coordination or review implication>

## Toolchain and environment

- Required versions or compatibility boundaries: <value>
- Stable capability constraints that affect authoritative evidence: <value>
- Resource limits that require serialization: <value>

## Data and safety

- Sensitive data boundary: <value>
- Procedure that governs risky access or migration: <pointer>
- Irreversible or security-sensitive escalation boundary: <value>

## Integration and deployment

- Required shared-branch proof: <value>
- Deployment/promotion/rollback expectations: <value>
- Cleanup ownership rules: <value>

Add only stable repository policy. Current branches, progress, transient host
load, and one-off incidents belong in live state or retrospectives.
