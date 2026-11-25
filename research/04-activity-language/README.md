# Activity Language and Board Portraits

Status: exploratory research.

This track studies how Eido can turn the lived activity of a board into a visual artifact that feels recognizable, proud, and personal. The direction is not "another activity tracker." It is a compressed portrait of the board's own geography: the places a user worked, the colors they attached to regions, the connections they made, and the shape of thought that existed at one point in time.

## Core Question

How can Eido render thinking activity as a beautiful, durable visual language without flattening it into generic productivity metrics?

The working answer:

- The board graph and intent log are the source of truth.
- The activity artifact should preserve board geography, not replace it with a calendar metaphor.
- Procedural variation is useful only when it is seeded, replayable, and locked.
- The result should behave like a journal or print, not a scorecard.
- Recognizability matters more than uniformity.

## Contents

| File | Purpose |
| --- | --- |
| [01-rich-intent-capture.md](01-rich-intent-capture.md) | Captures the user's product thesis, emotional target, and non-negotiables. |
| [02-source-synthesis.md](02-source-synthesis.md) | Synthesizes the current Rhythm proposal, critique, and visual references. |
| [03-activity-portrait-design-system.md](03-activity-portrait-design-system.md) | Proposes the first design-system vocabulary for board portraits. |
| [04-generative-board-portrait-model.md](04-generative-board-portrait-model.md) | Describes how deterministic procedural rendering could work from Eido data. |
| [05-open-questions-and-experiments.md](05-open-questions-and-experiments.md) | Lists future experiments, tests, and unresolved product questions. |
| [index.html](index.html) | A standalone research exhibit for reviewing and discussing the direction. |
| [sources/current-rhythm-proposal-extract.md](sources/current-rhythm-proposal-extract.md) | Human-readable extract of the attached Rhythm MHTML proposal. |

## Source Material

| Path | Notes |
| --- | --- |
| [sources/initial-brief-and-throwaway-pattern.txt](sources/initial-brief-and-throwaway-pattern.txt) | Initial brief and "Synaptic Flow Grid" throwaway direction. |
| [sources/user-feedback-and-generator-notes.txt](sources/user-feedback-and-generator-notes.txt) | Feedback on the Rhythm proposal plus design-language and generator notes. |
| [assets/shape-studies-poster.png](assets/shape-studies-poster.png) | Bold modular poster reference with overprint, grain, and annotation marks. |
| [assets/activity-cell-field.png](assets/activity-cell-field.png) | Dense field of varied activity cells, useful for glyph variability. |
| [assets/modular-color-studies.png](assets/modular-color-studies.png) | Larger modular compositions and palette studies. |
| [assets/modular-thumbnail-field.png](assets/modular-thumbnail-field.png) | Study-sheet scale and controlled chaos reference. |

The original Claude/HTML artifact was treated as source input only. Its code was not reused in this track.

## Working Terms

- **Activity language**: The visual grammar that translates board events into readable marks.
- **Board portrait**: A compressed visual artifact generated from a real board's spatial, semantic, and temporal history.
- **Activity glyph**: A small mark for a day, session, cluster, or thought event.
- **Locked randomness**: Seeded procedural variation that is fixed after a mark is formed.
- **Recognition pass**: A product/design test where the user can identify board regions from the activity artifact before reading labels.

These are research terms, not settled glossary terms. Move them into `CONTEXT.md` only if they become durable product language.
