# ADR 0006: AI Agents As First-Class Contract Consumers

Status: accepted

## Context

Eido is expected to be built and operated with many AI coding agents. Those agents need stable, machine-readable ways to inspect, modify, validate, and diagnose the system.

## Decision

Eido will treat AI agents as first-class consumers of engineering contracts. Commands, diagnostics, import/export flows, storage checks, and performance gates should prefer structured JSON outputs and stable error codes over human-only terminal text.

## Considered Options

- Chosen: create agent-friendly contracts alongside human workflows.
- Not chosen: rely on ad hoc logs, screenshots, or manual inspection as the main integration surface.
- Later: publish a clearer command registry and compatibility policy for agent-facing tools.

## Consequences

- Product: many agents can work in parallel with less coordination friction.
- Engineering: tools need explicit schemas, predictable failures, and tests for command contracts.
- Trade-off: feature work includes contract design, not only UI or state changes.
