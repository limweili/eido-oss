# Slicing — create paths to convergence

Slice for coherent value and clean integration, not to maximize task count.

## Find the serial spine

Identify decisions and shared seams that constrain most downstream work. Land
the smallest foundation that makes later lanes independent. A foundation may
be a decision, interface, characterization of existing behavior, or narrow
structural change; it is not automatically a large preliminary project.

## Form coherent lanes

A good lane has:

- one clear reason it exists;
- an observable outcome or decision;
- bounded ownership and affected surfaces;
- explicit dependencies and integration expectations;
- a validation plan proportional to its risk;
- a stopping point that does not require solving adjacent problems.

Use one issue or review unit per lane when that improves ownership and
traceability. Combine tightly coupled work when splitting would create more
coordination than independence. Separate work when shared context would hide
risk or concurrent changes would collide.

## Choose parallelism from reality

Work is parallel-safe when its decisions, state, and integration surfaces can
advance independently—not merely when filenames differ. Shared files may be
safe under a single ownership contract; apparently disjoint files may still
depend on the same unresolved behavior.

Prefer parallel work on the current dependency frontier. Recompute the
frontier after every integrated result because a landing may unblock work,
invalidate assumptions, or reveal a simpler route.

Size the frontier to execution slots, cumulative thread quota, and shared
compute as well as dependency shape. Reserve capacity for review, integration,
diagnosis, and recovery; a wide fan-out that starves those functions reduces
throughput. Give each shared branch, file, stateful environment, or mutable
artifact one active writer until an explicit handoff transfers ownership.

## Keep evidence attached to decisions

Create characterization or benchmark work only when it protects a meaningful
claim. Reuse shared fixtures and primitive-level evidence across consumers.
Once a candidate or approach is decisively eligible or ineligible, capture the
minimum reproducible reason and move the epic forward.

## Resist procedural slicing

Do not create lanes solely because a workflow has stages, a template has
fields, or a tool offers more concurrency. Every lane should shorten the path
to the goal, reduce a material risk, or resolve a decision.
