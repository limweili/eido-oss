# Open Questions and Experiments

## Product Questions

1. What is the smallest set of verbs that feels true to Eido?
2. Should "Return" become "Revisit," "Shape," or something else?
3. Should card movement count as meaningful activity or only as spatial housekeeping?
4. How should AI-generated outputs appear when they matter to the user's thinking?
5. Is the primary artifact a day, a session, a week, a month, or a named project window?
6. Should the product ever show a calendar, or should time appear as a sheet of board portraits?
7. How much of the current board color system should flow into the portrait?
8. What privacy controls are needed before any shareable artifact exists?
9. Should finalized portraits be persisted as recipes, images, or both?
10. How should old boards be handled if the needed intent events are incomplete?

## Design Experiments

### 1. Compressed Board Postcard

Make one large portrait of the current board reference. Ignore calendar structure. Preserve regions, colors, long-distance connections, and density. Test whether the user recognizes it.

### 2. Day Glyph Taxonomy

Generate 50 small day/session glyphs from the same visual primitives. Vary density, active region, connection count, and return/revisit marks. Judge whether the family feels coherent without becoming repetitive.

### 3. Region Color Extraction

Try three palette policies:

- direct user board colors,
- board colors plus system action accents,
- normalized palette derived from board colors.

Check which preserves recognizability and still looks intentional.

### 4. Locked Randomness Demo

Build a small generator where changing the seed changes texture and jitter, but not the board's recognizable structure. Then freeze a seed and test hover, resize, and zoom without rerolling.

### 5. Zoom Disclosure Prototype

Prototype four altitudes:

- tiny glyph,
- period portrait,
- region focus,
- actual board highlight.

The test is whether meaning is folded and unfolded, not replaced.

### 6. Recognition Pass

Hide labels. Ask:

- Which area is pricing?
- Which area is the long vertical work lane?
- Which marks are isolated?
- Which regions became connected?

This is more important than whether the artifact looks like a conventional analytics chart.

## Technical Experiments

1. Generate a portrait from a board snapshot fixture.
2. Generate a portrait from intent log replay for a time window.
3. Compare current-position vs event-time-position rendering.
4. Export recipe metadata as JSON alongside PNG/SVG output.
5. Add generator versioning and confirm old recipes remain stable.
6. Measure generation cost on large synthetic boards.
7. Explore canvas-first rendering for speed and SVG export for editability.

## Near-Term Prototype Brief

The next useful prototype should be a standalone research page, not production UI.

Inputs:

- one board snapshot or synthetic board shaped like the current reference,
- a small event list,
- a fixed generator seed,
- a few palette options.

Outputs:

- one large period portrait,
- a grid of smaller glyph variants,
- recipe metadata,
- side-by-side source board and portrait,
- toggle for labels on/off,
- button or link concept for "show on board."

Acceptance criteria:

- It feels bolder than the Rhythm proposal.
- It does not look like Apple Health or GitHub.
- It visibly preserves board location, color, and connection patterns.
- It supports procedural variation without losing recognition.
- It feels like a journal artifact, not a productivity demand.
