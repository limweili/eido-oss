# ADR 0007: Hand-Written Validators Before Formal Schemas

Status: accepted

## Context

The data model is still evolving quickly. Eido needs safety now without freezing every structure too early.

## Decision

Eido will use focused hand-written validators for current storage, import, export, command, and integrity boundaries. Formal schema generation or a shared schema system can come later once the contracts stabilize.

## Considered Options

- Chosen: hand-written validators for important boundaries now.
- Not chosen: no validation, because silent corruption would compound as history and agents scale.
- Deferred: formal schema tooling, because premature schema centralization can slow design while the product language is still changing.

## Consequences

- Product: users get safer imports, exports, and recovery sooner.
- Engineering: validation stays close to the code it protects while the model changes.
- Trade-off: validators may need consolidation later to avoid duplicated contract logic.
