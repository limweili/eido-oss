# Function-change proposals · ALL APPROVED

**Status: P1–P7 approved by weili on 2026-07-17** ("I accept all the items
you have proposed"), alongside the directed changes D1–D16 below. Nothing
here awaits sign-off anymore; this file is now the approved scope sheet
for the UI overhaul spec. Each entry keeps its original template: what
changes, why design demands it, and blast radius. “Baseline before slice
05” records the pre-migration state; it is not a claim about current code.

---

## P1 · Replace native browser dialogs at six call sites

**Today:** Card/group/tag deletion confirms via `window.confirm`
(`BottomDock`, `GroupCard`, Idea manager, tag manager).

**Change:** one in-system confirm/prompt service using the modal grammar:
same copy/default value and explicit confirmation, styled. Call sites
capture the target before awaiting and gate every mutation on the result.
The stack serializes simultaneous requests.

**Why:** they are the only two surfaces the system cannot reach, they
freeze the whole canvas in a browser-chrome voice, and they can't carry
the copy rules (object + consequence).

**Blast radius:** medium. The six current call sites are Board group-selection
deletion, dock card deletion, Group-card deletion, Highlights tag deletion,
Highlighter tray tag deletion, and Idea deletion. The shared
service depends on P2's stack-aware focus contract; explicit confirmation,
keyboard trapping, and captured targets preserve destructive guarantees.

---

## P2 · One escape-and-focus contract for every overlay

**Baseline before P2:** only the now-retired expanded Mod editor trapped focus
and closed on Escape; connection popover and dock menus handled Escape; Settings, Context peek,
Chain preview, Version context, Idea manager, and the gallery close only
by clicking away.

**Change:** every modal/panel consumes one stack-aware contract: Escape
closes only the topmost overlay, focus enters on open and returns on close,
and Tab stays inside while modal. Nested surfaces remain mounted; independent
window-level Escape listeners are not the implementation.

**Why:** "learn it once, know it everywhere": today the same gesture
(Escape) works on some surfaces and silently fails on others.

**Blast radius:** medium-small. A shared `useOverlayContract` hook applied
to ~7 surfaces; behavior-visible (Escape now closes things it didn't).
The keyboard suppression rules for editable fields stay untouched.

---

## P3 · Theme the React Flow zoom controls

**Baseline before slice 05:** the bottom-left zoom in/out/fit cluster is unthemed React Flow
default chrome: cool grays, foreign radii, its own shadows.

**Change:** restyle via React Flow's documented CSS hooks to the dock-key
recipe (panel surface, ink glyphs, hairline). Same buttons, same behavior,
same placement.

**Why:** it is the only piece of chrome that will still speak the old
language after migration.

**Blast radius:** CSS-only in practice, but it touches Board-adjacent
styling that is perf-gated, hence flagged rather than assumed.

---

## P4 · Extend reduced-motion coverage app-wide

**Baseline before slice 05:** only the connection beats respect `prefers-reduced-motion`.

**Change:** the token-level policy in SYSTEM.md §5: transform motion
becomes instant, opacity fades cap at 80ms, camera flights become jumps,
the streaming dot holds still.

**Why:** the accessibility contract (§11) is dishonest if 90% of motion
ignores the setting.

**Blast radius:** small code change, behavior-visible only to users with
the OS setting. The camera-jump piece touches every `Board.tsx` flight call
and App playback's `fitBounds` path; semantic playback progression does not
change.

---

## P5 · Assign on-color per identity instead of runtime luma

**Today:** card-header text color is chosen by a luma>145 threshold at
render time. Coral (`#f1666d`, luma 144) lands on the wrong side and gets
2.8:1 paper text.

**Change:** the 12 palette identities carry an explicit on-color in the
token sheet (see SYSTEM.md §1.5). Previously saved custom colors are accepted
as opaque six-digit hex and begin from the approved warm ink/paper roles. A
mid-gap color tightens the nearer warm role toward its black/white endpoint
only until AA is reached. The exact 50% body tint independently derives
theme-aware primary, soft, and functional readable foreground roles from
the semantic token authority. Faint remains the decoration-only theme role
and is never promoted into readable text.

**Why:** contrast becomes a design-time guarantee instead of a runtime
accident; headers, body text, and functional words all clear AA without
turning user identity colors into semantic colors.

**Founder decision, 2026-07-17:** forward-only. New/default palette choices
produce opaque six-digit hex input. The custom picker was subsequently retired;
previously saved custom values remain readable. Unsupported legacy shapes and
invalid values render the safe default without mutating or writing back to the
save. The live CardShell and playback renderer share that
resolver. Historical color migration or preservation is not a requirement;
no backup lane, storage-version change, or #464 dependency belongs to P5.

**Blast radius:** small, render-only code plus characterization tests for
accepted input, safe fallback, header/body contrast, and live/playback parity.
Save mutation, store normalization, and migration files are out of scope.

---

## P6 · Replace native `<select>` with the designed picker

**Requested by weili in review (2026-07-16):** "design something nicer
than the default OS picker."

**Current approved inventory:** after the single-class Mod cutover removes the
generic Mod choice and target fields, the designed Picker serves exactly four
consumers: Ask model, Conversation style, Group model, and playback speed
(2× / 5× / 10×). Settings model choices stay radio option cards; they are not
a fifth Picker use.

**Change:** every consumer uses the Picker in SYSTEM.md §6.2b
(field-styled trigger, floating option menu, check at the row's right
edge). Semantics stay the same and every use keeps the full keyboard
contract: open on Enter/Space, arrow roving, type-ahead, Escape closes,
`role=listbox/option` with managed focus.

**Blast radius:** medium: one shared component at four surfaces. Shared
primitive evidence plus representative production journeys is the
acceptance gate; repeating the full contract at every call site is not.

---

## P7 · Ship dark mode as a setting

**Requested by weili in review (2026-07-16):** "design everything from
ground up for dark mode."

**Baseline before slice 05:** the app is light-only.

**Change:** the night token set in SYSTEM.md §1.7: graphite anchored at
`#282828` (founder-revised 2026-08-11), designed and contrast-verified;
toggles live in the living reference nav, ships behind a setting: Light /
Dark / Match system (`prefers-color-scheme`), stored per device.

**Why:** a thinking tool gets used at night; inverted-by-filter dark
modes break the paper metaphor, so this one is designed: ink becomes
paper, solids brighten one step, light replaces shadow.

**Blast radius:** medium. Token flip is one `data-theme` attribute once
slice 02 lands; the real work is the painted canvas (Overview/Map
palettes must read from the token module: parity test extends to both
modes) and a settings row. Highlight washes carry their own night set
(§1.6: deep washes under paper ink). User card colors are data and
don't change.

The Light / Dark / Match system preference is device-local UI state. It may be
stored by the device settings adapter, but it is excluded from `SavedBoard`,
Board export/import, Board schema migrations, and future sync entities. Match
system resolves the operating-system preference on that device; it does not
rewrite card data or create a cross-device ordering concern.

---

## Directed in review · pre-approved, no approval needed

These crossed into function during weili's review rounds (2026-07-16/17)
and direct quality-of-life briefs (2026-07-28/29)
as direct instructions, so they skip the approval queue. Listed here so
the implementation plan carries them; specs live in SYSTEM.md.

- **D1 · Dock reorder + contextual tray** (§8.9): SELECT first, tools,
  creators, UNDO/REDO last; contextual actions leave the bar for a tray
  that slides out from behind its top edge on selection. The bar's
  geometry never changes.
- **D2 · The whole wire is the control** (§8.7): preserve the existing
  28px DOM interaction stroke and bring the painted bands to the same
  shared hit geometry: hover grows the pill, click opens the editor.
  Pill tooltip removed; global tooltip intent 600ms.
- **D3 · Playback transport slimmed** (§8.10): play = go icon key, no
  EXIT key (the panel's close is the exit), count as bare `5/14` value,
  speed = compact picker (call site under P6), and playback positions events
  equally from first to last instead of preserving recorded timestamp gaps.
  The uniform scrub is unmarked, and the centered strip is at most 90vw.
- **D4 · Save state beside the Idea pill** (§8.8), not at the bar's far
  right.
- **D5 · Copy tightened by rule**: chips one word (`SAVED`, `LATEST`,
  attention `!` + tooltip, §6.5); callouts never repeat a state word
  (§6.10b); context/chain panels lose their prose: rows carry the
  facts, incl. the `REUSED` row (§8.10).
- **D6 · Empty board = the ghost graph** (§8.10): two dashed cards
  joined by a dotted go wire, not a single ghost card.
- **D7 · One colour-choice module** (§6.2c): every colour picker imports
  the shared ColourPicker. Domain palettes keep their own values and names;
  the module standardizes the two-row circular well, radio keyboard contract,
  18px controls, 1.5px ink selection ring offset 2px, and tooltip policy.
  Cards may prepend the shared optional 2×2 fill-style block.
- **D8 · Single-class Mod face exceptions** (§8.6): Mod titles and option
  labels use the founder-approved inline `e-edit` treatment; Mod identity uses
  the shared 12-identity ColourPicker with no custom-hex entry; removal circles
  and connector dots use the shared recipes. The whole face is the editor, so
  the expanded workbench and its generic Picker consumers retire.
- **D9 · Select at every canvas LOD** (§8.12): Select keeps marquee and
  modifier-click selection in Reading, Overview, and Map, including edge
  auto-pan while a marquee remains held. Group regions paint behind ordinary
  Cards so a coloured Group cannot cover their connector nodes.
- **D10 · Result thread quality-of-life** (§8.4): Result follow-up uses a
  standard prose multiline composer that remains editable while a reply
  streams (only Send disables); settled AI replies offer Copy beside Turn into
  a note and copy confirmation appears immediately;
  empty reply/version content cannot create an empty Note; copy actions use the
  shared clipboard contract; new Results claim the preferred right-hand slot
  with three times the ordinary flow-space separation.
- **D11 · One rendered Markdown projection in Context** (§8.10): task, Card,
  and Mod projections use the shared Markdown renderer; only Show text exposes
  the exact raw prompt. Reorder feedback includes a lifted row that tracks the
  held drag inside the modal-owned floating layer.
- **D12 · Editable Markdown links** (§2.4): safe Markdown links render and
  activate in passive Card prose with exact passive/editor geometry. Pasting a
  direct link over selected editor prose wraps the selection. Selecting an
  editor link opens the compact floating preview/edit/copy/remove surface.
- **D13 · Pasted website previews** (§8.2): pasting one whole HTTP(S) URL on
  the Board creates an atomic Note whose ordinary editable text remains above
  one inset website-preview element. Rich
  metadata uses the title/description/site/media ladder; unavailable or
  metadata-empty pages keep the source URL in a website-shaped fallback with
  an explicit retry. Every preview can refresh or be removed without deleting
  the Card or changing its Note text, and status changes are announced.
  Remote pages never execute in renderer DOM, and preview media stays bounded
  and transient rather than entering logical Profile records. This is the
  founder's direct link-preview brief (2026-08-14).
- **D14 · Local HTML static previews** (§8.2): in the installed app, pasting
  one whole absolute Finder/File Explorer HTML path creates the same atomic
  Note composition with a short running state, an inset 16:9 static page
  image, filename/title, and the shared Open, Refresh, and Remove actions.
  The page renderer is short-lived and never becomes Card chrome; missing
  source authority keeps the saved image visible. This is the founder's
  local-first performance extension to D13 (2026-08-14).
- **D15 retired on 2026-10-27**: Account, Hosted routes, locked upgrade
  controls, and billing presentation were removed under ADR 0051. AI Models
  now offers only the person's own provider keys and installed AI tools.

- **D16 · Fixed CLI mode indicator** (§6.5, §8.3): when an Ask AI Card uses
  Claude Code, OpenAI Codex, or Google Antigravity, the reach globe becomes a
  compact square status indicator with the Lucide terminal glyph, selected go
  treatment, and `CLI MODE` as its accessible name and tooltip. It is not a
  switch because the chosen provider owns its tools and establishes the mode.
  This is the founder's direct local-harness brief (2026-08-22).

## Explicitly NOT proposed (considered and rejected)

- **Moving/regrouping any button, menu, or flow beyond the directed
  changes above**: the interaction model stays; the redesign re-clothes
  it in place, and only weili's direct instructions relocate chrome.
- **Changing the connection editor's model** (polarity/strength/reason)
  or the drawn-stroke strength vocabulary: it is already the best-designed
  surface in the app; the system adopts its grammar rather than replacing it.
- **The prototype's 72px dealer pitch app-wide**: the product canvas keeps
  free placement; only the kind faces and their interaction grammar transfer.
