# ADR 0030: Single-Class Mods Replace The Control Workbench

Status: accepted

Decided by the founder for issue #750 (2026-07-23). Supersedes ADR 0022's
control-primitive workbench, prompt-bucket, and built-in Intent-template decisions
while preserving its connection-scoped application and frozen-stamp ownership.

Amended 2026-08-05 after a shipped axis-1 Profile stranded user Boards: installed
recovery may copy-first retain adjacent Board data while dropping the retired Mod
records. This does not translate a v1 Mod or create a dual live reader.

## Context

ADR 0022 correctly established that Mods are declarative data, apply through a
`modifies` connection, and stamp as self-contained Board copies. Its concrete UI and
prompt model made a Mod a bag of ten generic controls: a separate expanded editor
built the bag, each control selected one of four prompt buckets, and one built-in
template attempted to re-home the retired Intent signal.

The approved v37 prototype proved a simpler product model. Each Mod kind is already a
complete thinking instrument: the picture of its state is the control, its treatment
explains how to read that state, and its sentences say the selected values. Retaining
the old workbench beside this model would leave two authoring systems and two prompt
languages for one concept. Eido has no shipped legacy Mod data that justifies that
cost.

## Decision

- A Mod is one of eleven kinds: slider, dial, count, switch, pad, select, order,
  filter, mixer, radar, or matrix. Its document contains `kind`, `title`, `accent`,
  kind-specific `state`, and an optional treatment override. Stable nested IDs belong
  to every editable member; the containing Card or Profile record supplies root
  identity.
- The whole card face is the Mod's control, editor, and visualizer. Settings and exact
  prompt context live in small popovers. The old expanded editor, generic control
  renderers, per-control prompt tooltip, and use/build mode split are removed.
- `readModContext` is the one Mod-to-prompt seam. Every connected Mod contributes its
  treatment followed immediately by its value sentences. The compiler preserves
  connection order and emits exactly one `MODS` block. Repeated kinds each speak;
  treatments are not deduplicated. The four prompt buckets and five retired compiler
  sections do not survive.
- A Mod still applies only through a `modifies` connection, never enters ordinary
  context, and is never compacted. Run provenance freezes the exact contributed lines.
- Mod templates are Profile-owned records. Stamping creates a self-contained Board
  instance with fresh stable nested IDs and immutable source provenance; later
  template edits cannot alter an existing stamp.
- Agent surface v5 exposes the same eleven-kind document through an exact ergonomic
  spec for inspection, direct-instance creation, template creation, configuration,
  stamping, and deletion. It is an adapter over the ordinary Mod model, not a second
  authoring format. A Mod created or stamped with a Connection may target only an
  Ask or Conversation and contributes through the ordinary Mod prompt seam.
- Configuration never rewrites a stamped instance's `idMap`: that map is immutable
  stamp-time provenance. Existing members retain same-role nested IDs, newly added
  members receive globally fresh IDs, and foreign, colliding, or recycled IDs fail
  closed. Direct instances have no template provenance to fabricate.
- This is a clean break for Mod meaning. Browser-era `Card.mod` payloads are dropped
  at the Board-load seam while adjacent Board data is retained. Ordinary installed
  reads and Portable archives require record axis 2. The recovery owner may rebuild
  an integrity-valid shipped axis-1 Profile as axis 2 only after preserving its raw
  SQLite family; it retains adjacent Board records and drops v1 Mod records. There is
  no Mod conversion, dual live reader, compatibility ledger, or command translation.
- Inline `e-edit` title and option editing is the approved Mod-specific exception to
  ordinary Card-title editing. Mod identity uses the shared 12-identity colour well;
  the Mod UI provides no custom-hex entry.
- The retired Intent signal is not re-homed. Its old fields, events, compiler sections,
  and former built-in Mod identifier are deleted without an absence sentinel.

## Considered Options

- Not chosen: keep ADR 0022's workbench as a legacy or advanced mode. It would preserve
  two interfaces, two prompt contracts, and permanent compatibility code without user
  value.
- Not chosen: convert old controls or persisted record-axis-1 Mods. The mapping is
  lossy. The 2026-08-05 amendment adds only copy-first adjacent-Board salvage because
  shipped axis-1 data did warrant recovery; it does not reinterpret retired controls.
- Not chosen: deduplicate treatments by kind. Two Mods of the same kind may carry
  different titles, overrides, and values; each connected Mod is intentional context.

## Consequences

- Mod authoring becomes direct manipulation on the card rather than construction of a
  generic control panel.
- Prompt output has one inspectable shape shared by Ask, Conversation, group digest,
  preview, and provenance consumers.
- The old workbench, control emitters/renderers, prompt buckets, compiler sections,
  tests, styles, fixtures, and built-in Intent template are deleted rather than
  adapted.
- A legacy browser Board may load without its old Mod payload. Its other Cards,
  Connections, outputs, and settings remain intact.
- CLI inspection is round-trippable: the returned ergonomic spec can be edited and
  submitted without exposing template storage, raw logical records, or executable
  prompt content.
