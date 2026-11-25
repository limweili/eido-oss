# Mod Workbench V2 — goal and research protocol

Status: complete
PR: #442
Primary prototype: docs/design/prototypes/mod-workbench-v2.html

## Goal

Take the Mod Workbench V2 from a promising prototype to a polished,
internally consistent, user-centred Mod authoring workbench while preserving
its instrument-flat creative direction.

The work is complete only after five evidence-backed iterations cover:

1. end-to-end user jobs and information architecture;
2. every control, setting, dial, process primitive, step, and Mod package;
3. all 15 visualizers, patching semantics, and truthful process/run-plan
   behaviour;
4. visual-system consistency, interaction states, accessibility,
   keyboard/touch, and responsive layout;
5. an adversarial hands-on browser walkthrough and regression verification.

Independent specialist findings must be integrated and reverified. The final
handoff must distinguish implemented behaviour, research-backed decisions,
prototype-only simulation, and unresolved product decisions.

## Mandatory research gate

Before committing to a material product or interaction change:

1. State the user problem and the claim being relied on.
2. Check the repo's governing design/foundation/ADR documents.
3. Validate the claim against high-trust external primary sources when it
   concerns an established external practice, including synthesizer/modular
   patching, DAW/device authoring, accessibility, interaction standards, or
   process-plan representation.
4. Record the evidence and implication under this directory. Do not rely on
   conversation context as durable memory.
5. Implement the smallest coherent prototype change that satisfies the
   validated user job without changing the creative direction.
6. Recheck it in a real browser at representative desktop and narrow widths.
7. Record contradictions or rejected ideas as explicitly as accepted ones.

Use official manuals, specifications, standards, first-party documentation,
or source code. Secondary sources can help find primary evidence but cannot
be the sole support for a product claim.

## Compaction recovery

After a context compaction, resume in this order:

1. read this file;
2. read this directory's README.md and research reports;
3. inspect git diff and the active task plan;
4. rerun the latest browser checks before relying on prior claims;
5. continue from the first incomplete iteration.

Do not mark the goal complete from absence of obvious defects. Audit every
numbered requirement above against current source and runtime evidence.
