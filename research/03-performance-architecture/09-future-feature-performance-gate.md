# Future Feature Performance Gate

> Date: 2026-06-22
> Related issue: [#96](https://github.com/limweili/eido/issues/96)
> Status: active gate for future Eido feature work

## Purpose

Every future feature should reuse the shared performance foundation instead of inventing local history, lookup, rendering, or persistence paths. This gate is intentionally lightweight: it should make feature builders faster by pointing them at the right shared modules and checks.

## Required Questions

Before implementing a feature, answer:

1. Which Board records does it read?
2. Which Board records does it write?
3. Is the change Undoable?
4. Is the change part of Playback?
5. Is it persisted, ephemeral, or session-only?
6. Does it need Graph Index lookup behavior?
7. Does it create or consume Intent Log Events?
8. Does it touch high-frequency paths such as typing, dragging, streaming, pan/zoom, or animation frames?
9. What happens at the large Performance Fixture target: 5,000 Cards, 10,000 Connections, 1,000 Output Versions, and 50,000 Intent Log Events?
10. Which command or browser harness proves it did not degrade the Board?

## Shared Modules And Commands

Use the glossary terms from `CONTEXT.md`:

- **Board** is the saved workspace.
- **Card** and **Connection** are the visual graph records.
- **Output**, **Output Version**, and **Run** capture AI work and provenance.
- **Intent Log Event** powers Playback and history explanation.
- **Undo** is bounded and fast.
- **Playback** is durable, semantic, and checkpointed.
- **Timeline Projector** projects Board state at a time.
- **Graph Index** is the shared lookup seam for future lookup-heavy work.
- **Performance Fixture** is the deterministic scale test input.

Run the relevant checks:

| Feature Type | Required Check |
| --- | --- |
| Timeline or Playback behavior | `npm run perf:timeline` and `npm run perf:report` |
| Store mutation behavior | `npm run perf:store` and `npm run perf:report` |
| Browser interaction behavior | `npm run perf:browser` |
| Ordinary code changes | `npm test` and `npm run build` |
| Performance-sensitive changes | `npm run typecheck`, `npm test`, `npm run perf:report`, `npm run perf:browser`, and `npm run build` |

## Rules

- Do not put full-board work on typing, dragging, streaming, pan/zoom, or animation-frame Playback.
- Do not create a new local lookup system when Graph Index should own the lookup.
- Do not record every keystroke in Playback. Use coarse semantic Intent Log Events.
- Do not make Undo unbounded.
- Do not embed large blob payloads deeper into hot Card paths.
- Do not make feature-specific persistence rules that bypass the shared Board persistence strategy.
- At low zoom, simplify visuals before rendering thousands of expensive elements.
- Keep full import/export behavior intact even if internal persistence becomes more normalized later.

## tldraw Scope Note

tldraw remains a reference project only. Eido is not adopting the tldraw SDK or migrating to tldraw technology.
