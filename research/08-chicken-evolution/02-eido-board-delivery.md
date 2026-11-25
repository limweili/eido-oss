# Chicken Research Eido board: delivery and review record

**Status:** final reviewed CLI proof, 2 August 2026

This record preserves what was built and independently checked without
committing private Profile storage or a Portable Export. The scientific source
of truth remains [`01-primary-source-dossier.md`](./01-primary-source-dossier.md).

## Iteration outcome

Two new Ideas were created in a disposable synthetic Profile, using only the
packaged `eido` CLI during research authoring:

1. `Chicken Research_1` — a 50-Card/34-Connection tracer board. Independent
   review found disconnected claims, incomplete dispersal and source coverage,
   and inspection gaps in the CLI. It was retained as iteration evidence.
2. `Chicken Research_2` — the final evidence board. Review findings were fixed
   in place because a third rebuild would not improve the research outcome.

No Eido AI Run was submitted. Consequently no provider credential was read and
the conditional `openai/gpt-5.6-luna` restriction was never invoked. Six Ask AI
Cards preserve the evidence-linked questions for a future deliberate run.

## Final board inventory

`Chicken Research_2` finished at disposable Profile revision 10 with:

- 100 Cards and 100 Blocks: 7 Titles, 87 Notes, and 6 Ask AI Cards;
- 101 reasoned Connections: 61 strong/helping, 39 weak/helping, and one
  strong/pushes-against authentication edge;
- all 93 content Cards in one connected component; only the seven deliberately
  non-connectable Titles are isolates;
- a continuous directed route from cellular organisms through theropod and
  avialan evolution, crown birds, Galliformes, *Gallus*, the principal
  *G. g. spadiceus*-related source, and domestic chicken;
- the supported nested Galliform family tree and both unresolved red-first and
  green-first *Gallus* topologies without a false consensus;
- the principal source plus regional red, grey, Sri Lanka, rare green-candidate,
  and domestic-to-modern-wild gene-flow routes;
- all 11 dossier dispersal rows and all six evidence-linked open questions;
- 29 unique DOI publications — 28 primary studies plus the Wang correction —
  with NCBI Taxonomy and AviList used only as nomenclatural scaffolds.

The final review patch made the rare green-junglefowl candidate tract
traversable as:

```text
G. varius
→ Green-junglefowl signal
→ Candidate tract · not an ancestry percentage
→ Source lineage ≠ origin event
→ Domestic chicken
```

This deliberately uses two qualification Cards so the route does not cross or
pass through the dense red-junglefowl population row.

## Spatial and audit evidence

The authoritative `graph.bounds` result contains all 100 resolved Card boxes
and the aggregate rectangle `x=0, y=0, width=5330, height=8882`.
The deterministic straight-centreline audit reports:

- minimum Card gap: 118 canvas units;
- maximum Connection length: 1,170 canvas units;
- zero Card overlaps;
- zero non-endpoint Connection/Card intersections;
- zero proper non-shared-endpoint Connection crossings.

The former bottom heading `6 · OPEN QUESTIONS` was independently judged to
misstate scan order because Ask Cards are embedded beside evidence higher on
the board. It now reads `OPEN QUESTIONS · EMBEDDED BESIDE THEIR EVIDENCE ABOVE`
and serves as an accurate footer/legend.

Every applied batch was revision-pinned, dry-run first, committed with a fresh
idempotency key, and then exactly replayed with the apply key. Revisions 5–10
contain 304 attributable record changes: the Idea/Board pair, 100 Card/Block
pairs, 101 Connections, and the final Title Block update. Post-commit reads
confirmed a clean head, complete pagination, the intended neighborhood route,
and zero Run or Output records.

Two independent fresh-context reviews converged on **PASS** after revision 10:
one against the primary-source dossier and one against Eido research-board
usability, topology, spacing, traceability, and audit history.

## CLI capabilities delivered

The research loop exposed and closed three blocking CLI gaps:

- surface v4 now creates one named inactive Idea and canonical empty Board with
  audited dry-run/apply/replay semantics;
- Idea-scoped graph queries now resolve the canonical Board owner correctly;
- `graph.bounds` now returns each resolved Card's kind, position, size, and Deep
  Link in addition to aggregate bounds.

The repository commits for this work are:

- `7e16849` — primary-source chicken evolution dossier;
- `a08e12b` — audited CLI Idea creation;
- `3094b10` — Agent surface v4 documentation;
- `e20db4a` — Idea-scoped CLI graph-query fix;
- `14f7ec0` — resolved Card boxes in `graph.bounds`.

Verification after the code changes included a serialized full suite (2,715
passing, 4 skipped across 294 files), TypeScript checking, six focused boundary
files (59 passing), and the packaged desktop smoke. The CI-tools suite passed
327 of 328 checks; its sole failure was the intentionally unrebaselined native
certification fingerprint, which requires paired macOS and Windows evidence.

## Installed-Profile boundary

The founder's running installed Eido advertised Agent command surface v3. It
does not contain `idea.create`, while the new surface-v4 feature is present in
this branch and the packaged proof. Applying a surface-v4 write directly to
that Profile would create a one-way compatibility edge that the older installed
app could not reopen.

The installed Profile was therefore inspected only at the bounded status and
matching-Idea-list level and was not mutated. The reviewed board remains a
disposable proof artifact rather than a hidden raw SQLite handoff. After Eido is
updated to a build containing these commits, the same CLI-authored board can be
created in the installed Profile without unsafe storage access or GUI
automation.
