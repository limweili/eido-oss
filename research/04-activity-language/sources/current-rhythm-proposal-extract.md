# Current Rhythm Proposal Extract

Source: attached MHTML artifact titled `Rhythm - Eido's activity language`, saved July 7, 2026.

The original HTML/code was not copied into this research track. This extract preserves the proposal's ideas for comparison and future synthesis.

## Main Proposal

The artifact proposed **Rhythm** as an activity language for Eido. Its core contrast was:

- GitHub grids count labor.
- Health rings close effort.
- Rhythm draws form.

It framed each day as a small ink drawing generated from board activity. The visual grammar used three verbs:

- **Capture:** new thoughts.
- **Connect:** ties made between thoughts.
- **Return:** older ideas reworked.

The proposal emphasized that quiet days should not shame the user, and that the artifact should make users proud of what happened rather than guilty about what did not.

## Product Structure

The proposal included four zoom altitudes:

- year shelf,
- month page,
- week strip,
- day story.

It also proposed:

- hoverable day marks,
- ribbons for persistent lines of thinking,
- a "show these on the board" action,
- a full-day ring for days with all three verbs,
- a month seal,
- a replay handoff to Timeline Playback.

## Strongest Ideas To Preserve

- Zoom is disclosure.
- Anti-guilt language is a product principle.
- Activity should come from Eido's existing event history.
- Board geography should seed the marks.
- Once drawn, a mark should stay stable.
- A still portrait and playback can be paired ceremonies.

## Weakest Ideas To Rework

- Calendar structure was too visually dominant.
- Three-ring completion felt too close to Apple Health.
- The three-verb system was useful but underdeveloped.
- Color as verb alone ignored the user's board colors.
- The proposal did not preserve enough literal board location.
- It needed a bolder graphic language.

## Data Notes From The Proposal

The proposal suggested using Eido's intent log as source data:

| Proposed verb | Source events |
| --- | --- |
| Capture | `card.created`, `group.created` |
| Connect | `connection.created` |
| Return | `card.content.edited`, `intent.changed`, `followup.message.added` |
| Ignored | `card.moved`, `card.resized`, `run.*` |

This mapping should be revisited. The user's feedback suggests that movement, grouping, location, region color, and spatial shaping may matter more than the proposal allowed.
