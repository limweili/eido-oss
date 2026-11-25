# Chicken evolution: development Eido board delivery

**Status:** completed through the worktree CLI on 5 August 2026

**Review target:** `Chicken Research_2`

## Outcome

The research was re-derived from scratch from primary sources and authored into a live,
disposable development Eido Profile using only the worktree's v4 CLI. The
installed Eido 0.1.3 Profile was not read, copied, migrated, or changed.

Two Ideas were deliberately retained:

| Idea | Role | Runtime inventory | Decision |
| --- | --- | ---: | --- |
| `Chicken Research_1` | First full CLI publish and measurable layout trial | 114 Cards, 104 Connections | Superseded: no Card overlaps, but 27 straight-line connector crossings and four overlong cross-band handoffs failed the cohesion bar. |
| `Chicken Research_2` | Corrected content and final review layout | 114 Cards, 108 Connections | Accepted: exact runtime-to-manifest match, zero Card overlaps, zero proper connector crossings, zero connectors through unrelated Cards, and no overlong edge. |

The final Idea identity is
`agent-idea-dccd958c53a2e97a24240847ccda88387d901653`. Its orientation Card can
be addressed with this spatial context:

`eido://app/?idea=agent-idea-dccd958c53a2e97a24240847ccda88387d901653&card=agent-card-5049ee1a36dc95041490c7ccbe45977d29888a7c`

In the delivery session, the development Eido window was left running. Because
Agent-created Ideas are deliberately inactive, use Eido's Ideas manager to
select `Chicken Research_2` for review.

## Use, review, build, test, repeat

The work followed the requested closed loop with independently measurable
outcomes:

1. **Use the CLI:** publish `Chicken Research_1` from the new source dossier,
   then read its complete inventory and all resolved Card bounds back through
   bounded CLI queries.
2. **Review independently:** a fresh-context reviewer assessed the Profile-free
   manifest and first layout as a research board. It found three disconnected
   content components, imprecise language around grey-junglefowl gene-flow
   direction and clock dates, a misleading *Conflicto* attachment, 27 modeled
   connector crossings, and four dominant cross-band edges.
3. **Build what was needed:** extract and test the auxiliary-launch resolver,
   add a development-only disposable Profile review mode, document the
   same-root worktree-CLI workflow, correct the reviewed claims and edge
   semantics, and replace the first layout with a locally connected overlay.
4. **Test the system:** run focused launch-boundary tests, repository-wide
   tests, type checking, application and Electron builds, a real development
   launch, CLI dry-run/apply/readback, and whole-board graph/geometry audits.
5. **Use the CLI again:** publish `Chicken Research_2` into a new Idea and
   repeat the bounded runtime audit at revision 50.

A second fresh-context reviewer then independently inspected the live final
Idea using the CLI only. The reviewer found no blocking factual, completeness,
authorship, thought-structure, spatial, or Ask-AI-boundary issue and returned
`PASS — suitable for human Eido research review`. The final review confirmed
114 Cards, 114 Blocks, 108 Connections, zero manifest/runtime mismatches, one
107-Card substantive component, zero modeled overlaps or connector crossings,
and zero AI execution records. It made no mutation; the live Profile remained
clean and unchanged at revision 50.

## What the final board contains

- A nested cellular-life-to-domestic-chicken scaffold, with fossil examples on
  side branches rather than asserted as direct ancestors.
- The five-family living Galliformes backbone and two complete, unresolved
  *Gallus* root hypotheses.
- A separate reticulate domestication layer: principal sampled
  *spadiceus*-related ancestry, regional red-junglefowl inputs, non-red
  candidate tracts, validated `BCO2`, and domestic-to-wild backcrossing.
- Evidence-typed human chronology: phase-associated context, direct AMS,
  ZooMS, proteomics, isotopes, and negative reassessments are not collapsed
  into a single kind of date.
- Explicitly quarantined claims for northern China, Caiyuanzi, *Vegavis*,
  *Baminornis*, and El Arenal 1.
- Eight linked evidence lenses and six deliberately unrun Ask AI Cards stating
  discriminating future research questions.

The final factual corrections include the 2026 *Vegavis* qualification, the
disputed *Baminornis* pygostyle, *Zhengheornis* tail shortening before fusion,
*Conflicto* as the safest current crown-Galloanserae minimum, Ban Non Wat as a
phase-associated assemblage with inferential domestic status, and El Arenal 1
as an unsubstantiated chicken claim after tinamou reassessment.

## CLI evidence

All mutations used `command.batch` through the public Agent Gateway. Each
chunk was previewed with `dryRun: true`, re-pinned to the subsequently inspected
live revision, and then applied with a fresh idempotency key. Card and
Connection batches stayed below the advertised 64-command bound.

The final runtime audit at Profile revision 50 returned:

- 114 Cards: 7 Title, 101 Note, and 6 Ask AI;
- 114 Blocks and 108 Connections;
- no Run, Output, or Output-version records;
- `truncated: false` for every inventory query;
- all 114 resolved boxes from two bounded `graph.bounds` reads;
- an exact body, kind, position, creator-attribution, and Connection-meaning
  match to the source manifest and layout overlay;
- aggregate bounds `11,060 × 4,180` at `(0, -620)`;
- minimum modeled clearance of 100 px horizontally and 80 px vertically;
- one connected component containing all 107 substantive Cards, with the seven
  non-connectable Title Cards as the only isolates;
- zero modeled rectangle overlaps, proper centre-line crossings, unrelated-Card
  intersections, or edges beyond `|Δx| = 1,080` / `|Δy| = 780`;
- 90.7% of Connections within `|Δx| ≤ 720` and `|Δy| ≤ 520`.

This geometry audit is a conservative CLI proxy over Eido's resolved Card
boxes and Connection endpoints. It is authoritative for graph placement and
intersection rejection, but it is not a claim of pixel-level renderer review.

## AI and privacy boundary

No Eido AI run was submitted. The disposable development Profile did not
inherit or copy the installed Profile's OpenRouter credential. The six Ask AI
Cards remain visibly marked `UNRUN`; if the founder later chooses to execute
them, the board says to configure exactly `openai/gpt-5.6-luna` through
OpenRouter first.

No Profile database, WAL/SHM file, blob, owner endpoint, credential, or physical
Profile path is stored in this repository. The review Profile is disposable and
exists only as runtime state owned by the development Eido process.

## Reproducible research artifacts

- [`03-installed-rerun-primary-source-audit.md`](./03-installed-rerun-primary-source-audit.md)
  is the standalone, from-scratch primary-source dossier.
- [`04-eido-board-manifest.json`](./04-eido-board-manifest.json) is the
  Profile-free Card content and base logical graph.
- [`05-eido-board-layout-v2.json`](./05-eido-board-layout-v2.json) records the
  second-pass positions and topology substitutions that closed the first
  board's measurable layout gaps.

The development launch boundary and same-root proof-CLI workflow are documented
in [`docs/agents/eido-cli.md`](../../docs/agents/eido-cli.md).
