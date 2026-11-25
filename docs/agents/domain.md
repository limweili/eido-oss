# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before Exploring, Read These

- `CONTEXT.md` at the repo root.
- `docs/adr/` for ADRs that touch the area being changed, if that directory exists.
- `docs/foundations/` when the change touches how thoughts connect (context layer), how AI runs (execution layer), or canvas rendering — the matching layer doc lists the seams, invariants, and prepared-for future work.

If any of these files do not exist, proceed silently. Do not flag their absence; do not suggest creating them upfront. The producer skill creates them lazily when terms or decisions actually get resolved.

## File Structure

This is a single-context repo:

```text
/
├── CONTEXT.md
├── docs/adr/
├── docs/foundations/
└── src/
```

## Use The Glossary's Vocabulary

When output names a domain concept in an issue title, refactor proposal, hypothesis, or test name, use the term as defined in `CONTEXT.md`. Avoid drifting to synonyms.

If the needed concept is not in the glossary yet, either reconsider the wording or note the gap for a future domain-modeling pass.

## Flag ADR Conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding the decision.
