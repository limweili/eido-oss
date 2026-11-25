# Persisting a new setting or preference

This is the standing procedure for any change that persists a new setting,
preference, or tool configuration. It is not a one-time repair. Eido will keep
gaining tools and preferences forever, and every one of them has to reach disk
in a way that keeps the format backward compatible.

One principle governs it: **content fails closed, settings fail soft**
([ADR 0040](../adr/0040-content-fails-closed-settings-fail-soft.md)). A person
who downgrades to the build they ran last week must still be able to open every
Board they own. A build that meets a setting it does not understand falls back
to the previous behavior, or to that feature's default. It never fails the load.
The worst a stranger setting may cost anyone is one feature returning to its
default.

Follow this SOP before you write the field, not after. The mistake it prevents
is cheap to make and expensive to ship: a new key in a strict allowlist, one
more key in a bag held to a closed allowlist, or one more member in a strict
value union reaches disk on first use and makes an older build refuse the whole
Profile. That mistake has already shipped three times, twice without anyone
noticing.

## Authority and boundaries

- [ADR 0040](../adr/0040-content-fails-closed-settings-fail-soft.md) owns the
  decision. This SOP owns the procedure. Where they disagree, the ADR wins.
- [`persistence-layer.md`](../foundations/persistence-layer.md) invariant 15
  states the invariant. Invariant 4 stays scoped to the version axes and to
  content shape, and does not reach per-key values inside an envelope.
- [`settingsEnvelope.ts`](../../src/persistence/settingsEnvelope.ts) is the only
  implementation of the tolerant rules. Do not write a second reader for one
  feature.
- `validateCard`, `validateBoard`, and `validateIdea` in
  [`profileLogicalProjection.ts`](../../src/persistence/profileLogicalProjection.ts)
  are the strict content validators (ADR 0007). Their key lists and closed value
  sets are declared once as `STRICT_CONTENT_SURFACE` in that file and pinned by
  [`strictContentSurface.test.ts`](../../src/persistence/strictContentSurface.test.ts),
  which is the check behind hard stops 1 and 3. Their content checks are
  correct, they stay strict, and a setting never joins them. What each one also
  carries is its record's envelope key, checked for container shape only by
  `isSettingsEnvelope`: `meta` on the Card, `settings` on the Board and the
  Idea, and `aiSettings` on the Board through `validateBoardSettings`.
- [`boardAiSettings.ts`](../../src/graph/boardAiSettings.ts) declares every key
  inside `SavedBoard.aiSettings` once, with its accepted shape and its
  documented default. `validateBoardSettings` is no longer a strict bag; it is a
  single container check.
- Device settings stay outside the Profile entirely. The renderer store is the
  `eido-v3-settings` key in [`store.ts`](../../src/graph/store.ts); the theme
  preference is in [`theme.ts`](../../src/ui/theme.ts); Electron main keeps its
  own in [`updateConsentStore.ts`](../../electron/updateConsentStore.ts). See the
  `State And Persistence` table in
  [`CONVENTIONS.md`](../codebase/CONVENTIONS.md).

## SOP 1: Classify the field before you persist it

This is the first step and the most important one. Everything after it follows
from the answer. Ask two questions, in order.

**Question 1. Does the canvas, semantic context, or execution projection
([ADR 0011](../adr/0011-one-graph-three-views.md)) read this value to decide what
a Card, Board, or Connection means or does?**

If yes, it is **content**. Use the strict path: add the field to the correct
validator in `profileLogicalProjection.ts`, with exact key and exact value
checks, and accept that a build which does not know the field refuses the
record. Content must fail closed. Stop here.

If no, it is a setting. Go to question 2.

**Question 2. Does the setting have to travel with the Profile to another
machine?**

If no, it is a **device setting**. It goes in the device preference store and
never enters the Profile document at all. Use SOP 2A.

If yes, because it belongs to a specific Card, Board, or Idea, it is a
**portable setting**. It goes in that record's tolerant settings envelope with a
documented default. Use SOP 2B.

**Prefer the device setting.** It is the safest of the three, because state that
is not in the Profile cannot corrupt the Profile. Choose the envelope only when
the value genuinely belongs to one person's content and would be wrong to lose
on a second machine.

**Unsure between content and a setting still means setting.** The two errors are
not symmetrical. Content misfiled as a setting costs one feature its stored
state. A setting misfiled as content costs a founder every Board in the Profile.

| Content: strict, in the record | Portable setting: the record's envelope | Device setting: outside the Profile |
| --- | --- | --- |
| Card `blocks`, `kind`, `position`, `size`, `groupId` | Note font size, header collapse state, per-Card header fill | Theme, panel and dock widths, zoom defaults |
| Connections, Outputs, Run records, Intent history | Link-preview dismissal, web reach mode, research depth | Debug and diagnostic toggles, developer flags |
| Mod stamps and template records | Per-Card tool configuration and feature toggles; the Board's AI model, provider, reasoning effort, and compaction mode | Update consent and local harness paths |
| Anything a prompt, a Run, or the painter needs to build the right thing | Anything whose absence only returns a default look, and that the person would expect to find again on another machine | Anything whose absence only returns a default look, and that nobody would miss on another machine |

Write the classification and its reason in the PR or issue description. A
reviewer must be able to check the judgment without re-deriving it.

### What is actually protected today

Every record now has an envelope. The tolerance those envelopes give is not
uniform. Do not assume it is.

"Safe against builds already shipped" means: a Profile this build writes still
opens in a build installed before ADR 0040 landed.

| Where the setting lands | Safe against builds already shipped? | Why |
| --- | --- | --- |
| Device preference store | Yes, completely | It never enters the Profile, so no validator sees it. |
| `Card.meta` envelope | Yes, against every build ever shipped | `meta` was always on the Card allowlist and always an open plain record. |
| `Board.settings` or `Idea.settings` envelope | No, from the moment something first writes one | This build tolerates the key. Builds already installed carry their own `hasOnlyKeys` and `hasExactKeys` copies without it, so the first Profile that actually carries the field is the one they refuse. |
| `Board.aiSettings` envelope | Only for values a shipped build already accepted | The bag is open here and closed in every shipped build. A new key in it, or a value outside its old closed sets, is the same one-time break. |
| Profile setting record | Yes for a recognised id, no for a new one | An unknown id is inert here, and shipped builds admit only `profile-setting-locale`. |
| A new strict key or a widened strict value union | No, ever | This is the defect the SOP exists to stop. |

A Card-level setting through the envelope is therefore safe now. A Board-level
setting, an Idea-level setting, a new `aiSettings` key, and a new Profile
setting id each cost one deliberate downgrade break, paid by the release that
first writes it. See SOP 2B.

## SOP 2A: A device setting goes in the device preference store

Nothing about it reaches the Profile, so nothing about it can break a Profile.

1. Renderer preferences join the `eido-v3-settings` object in
   [`store.ts`](../../src/graph/store.ts). Electron main preferences follow the
   shape of [`updateConsentStore.ts`](../../electron/updateConsentStore.ts).
2. Normalize on read. An absent key, an unreadable value, and a value from a
   newer build all resolve to the documented default.
   [`normalizeThemePreference`](../../src/ui/theme.ts) is the pattern.
3. A corrupt read never throws. The renderer store clears that one key and
   rebuilds the defaults. Keep that behavior.
4. Do not add the value to `SavedBoard`, to any logical record, or to Portable
   Export. A device setting stays on the device by definition.

Then skip to SOP 3. A device setting needs a default, and it does not need the
downgrade proof in SOP 4, because no older build ever reads it.

## SOP 2B: A portable setting goes in the owning record's envelope

Find your record in this table first. It names the envelope you write to and
the helper shape that reaches it, which are the only two decisions this step
has.

| Record | Its envelope | Read and write it with | Validated by |
| --- | --- | --- | --- |
| Card | `meta` | `readSetting`, `hasSetting`, `writeSetting`, `clearSetting`. They take the Card and look inside `meta` for you | `isSettingsEnvelope` inside `validateCard` |
| Board, preferences that are not AI settings | `settings` | `readEnvelopeSetting`, `envelopeHasSetting`, `resolveEnvelope`, plus `foreignEnvelopeKeys` and `mergeForeignEnvelopeKeys` on the way to disk. They take the envelope itself | `isSettingsEnvelope` inside `validateBoard` |
| Board, AI settings | `aiSettings` | The same envelope helpers, through the wrappers in `boardAiSettings.ts` | `validateBoardSettings`, a container check only |
| Idea | `settings` | The same envelope helpers | `isSettingsEnvelope` inside `validateIdea` |
| Profile | a `profile-setting` record | `decodePortableProfileSetting` | `decodePortableProfileSetting` |

The two helper shapes are one API, not two. The carrier forms (`readSetting`
and friends) are sugar for the one envelope nothing reads directly, `Card.meta`.
Every other envelope IS the runtime object callers already hold, so its helpers
take the envelope. The header of
[`settingsEnvelope.ts`](../../src/persistence/settingsEnvelope.ts) states why
the carrier forms take no field selector, and what retires them when a
Board-level setting finally lands.

**Use the envelope the record already has. Never add a new top-level field to
carry a setting.**

**A Card's settings envelope IS the existing `Card.meta` field.** Not a new
top-level `settings` key on the Card. This is not a naming preference and it is
not open for improvement later:

- `validateCard`
  ([`profileLogicalProjection.ts`](../../src/persistence/profileLogicalProjection.ts))
  gates a Card with `hasOnlyKeys`. Every build already installed carries its own
  copy of that allowlist and refuses any top-level key it was not compiled to
  know.
- A refused Card fails the projection, and the SQLite revision store re-reports
  that as a corrupt Profile revision for everything the person owns.
- `meta` is the one container those shipped builds already tolerate. It is on
  the allowlist and is validated as an open plain record with no key checks.
  Using it is what makes Card downgrade safety real today instead of one release
  from now.

Adding a second, top-level `settings` key to the Card would reproduce the exact
failure this procedure exists to prevent, and buy nothing that `meta` does not
already give. If a future change proposes it, the answer is no, and the
counter-proof already runs in
[`settingsEnvelope.test.ts`](../../src/persistence/settingsEnvelope.test.ts)
(`rejects the same settings as a top-level Card field, which is why the envelope
is meta`).

Then, for any of the envelopes above:

1. Declare the setting once, in the feature's own module, with `defineSetting`
   or `defineChoiceSetting`. Read and write it only through the helpers the
   table above gives your record. Never index `card.meta`, `board.settings`,
   `board.aiSettings`, or `idea.settings` by hand.

   Never hand a `resolveEnvelope` result to a save path: that is a read result,
   and persisting it would push this build's defaults over a newer build's
   stored values.
2. Copy the shape of [`reachMode.ts`](../../src/brain/reachMode.ts) for a
   Card setting. Also see
   [`researchDepth.ts`](../../src/brain/researchDepth.ts) and
   [`researchJobMeta.ts`](../../src/brain/researchJobMeta.ts). For a Board AI
   setting, copy [`boardAiSettings.ts`](../../src/graph/boardAiSettings.ts).
3. Do not add the key to any strict allowlist. Do not widen or narrow any strict
   value union to carry it. Do not add a new top-level field for it.
   [`strictContentSurface.test.ts`](../../src/persistence/strictContentSurface.test.ts)
   fails on the first two, and its message repeats this choice back to you.

**A Board-level setting, an Idea-level setting, and a new `aiSettings` key each
cost one downgrade break.** The fields themselves already exist:
`SavedBoard.settings` and `IdeaSummary.settings` are tolerated by this build's
validators, and `aiSettings` is an open envelope here. Builds already installed
have none of that. The break is therefore not paid by the release that added the
field, but by the release that first WRITES one. Nothing writes
`Board.settings` or `Idea.settings` today, so that price is still unpaid.

ADR 0040 accepts the price in advance, once. It does not authorize you to pay it
quietly. Before you spend it, try the two cheaper answers:

1. Can it be a device setting? Most Board-wide preferences are really machine
   preferences. Take SOP 2A instead.
2. Can it hang off the Card it actually affects? A per-Card key in `meta` is
   safe today and needs no break at all.

Only when neither is honest, write to the Board or the Idea envelope, and say so
in the PR. The release that carries the first such write names the break in its
release notes. `settingsEnvelope.ts` is already record-agnostic and needs no
redesign to serve a new carrier.

## SOP 3: Ship a documented default with every setting key

No setting merges without a default, on any of the three paths. The default is
what a build that cannot interpret the stored value falls back to, so a setting
without one has no defined behavior on the day it matters.

For a device setting, the default is whatever the normalizer returns for an
unrecognized value. State it, and state the accepted values, in the PR or issue
description. For a portable setting in the envelope:

1. The `fallback` in the setting contract is the default, declared exactly once.
   The runtime uses it whenever the key is absent, or holds a value this build
   cannot act on.
2. `accepts` must reject every shape this build cannot act on, and not only the
   wrong type. Out-of-range numbers, retired union members, `null`, and future
   variants all read as the default. The default is substituted for the READ
   only. The stored value stays on disk exactly as written until this build
   writes an answer of its own, so a downgrade that saves once does not delete a
   preference the person set on a newer build.
3. `writeSetting` deletes the key when the value equals the fallback, and
   `clearSetting` collapses an emptied envelope to `undefined`. Absent and
   default are therefore one state. Keep it that way: do not persist a default.
4. Mark a contract `required` only when its ABSENCE would leave a hole in a type
   callers already dereference. `required` is the one case where resolving a bag
   is not byte-identical to the bag that came in, so it costs the "absent equals
   default" property for that key. Inside `aiSettings` only `model`, `models`,
   and `reasoningEffort` earn it.
5. State the key, its accepted values, and its default in the PR or issue
   description.

## SOP 4: Prove downgrade safety before merge

Evidence is proportional to risk (ADR 0028). The envelope's three rules are
already proven once at the seam that owns them, so a setting that uses the
envelope reuses that proof instead of repeating it.

**A device setting needs no downgrade proof.** No older build ever reads it, and
nothing it does can reach a Profile. Test the normalizer's default like any other
unit, and stop.

**A setting that goes through the envelope helpers into `Card.meta`,
`Board.settings`, `Board.aiSettings`, or `Idea.settings`:**

1. Add a corpus vector only if the setting introduces a value shape the corpus
   does not already carry. `SYNTHETIC_UNKNOWN_SETTINGS_CARD` (unknown key),
   `SYNTHETIC_FOREIGN_SETTINGS_CARD` (foreign value under a known key),
   `SYNTHETIC_MALFORMED_SETTINGS_CARD` (corrupt container),
   `SYNTHETIC_FOREIGN_BOARD_AI_SETTINGS`, and `SYNTHETIC_UNKNOWN_BOARD_SETTINGS`
   already stand for the common cases in
   [`profileFixtureCorpus.ts`](../../src/persistence/fixtures/profileFixtureCorpus.ts).
2. If you change the corpus, update `PROFILE_FIXTURE_CORPUS_SHA256` in the same
   file. `profileFixtureCorpus.test.ts` pins the canonical digest and reports the
   value it computed.
3. Run the three suites that own this boundary:

   ```sh
   npx vitest run \
     src/persistence/settingsEnvelope.test.ts \
     src/graph/saveLoadCompat.test.ts \
     src/persistence/fixtures/profileFixtureCorpus.test.ts
   ```

**Anything else needs its own downgrade test before merge.** That means a new
strict field, a changed value shape on an existing strict field, a new envelope
owner, or any write that reaches disk outside the envelopes above. Write a Board
with the current build, then load it through the frozen validators and assert
the outcome you claim:

- [`preEnvelopeCardValidator.ts`](../../src/persistence/fixtures/preEnvelopeCardValidator.ts),
  through `validatePreEnvelopeBoardCards`, is the shipped strict Card validator.
  A Card setting must still load. Assert success.
- [`preEnvelopeBoardValidator.ts`](../../src/persistence/fixtures/preEnvelopeBoardValidator.ts),
  through `validatePreEnvelopeBoard`, `validatePreEnvelopeIdea`, and
  `validatePreEnvelopeBoardSettings`, is the shipped strict Board, Idea, and
  `aiSettings` validator. A Board-level setting, an Idea-level setting, or a new
  `aiSettings` key does NOT load there. Assert the refusal, so the one-time
  price stays visible instead of hypothetical.

Both files are frozen copies of the strict validators as they shipped. They
stand in for the build already installed on a founder's machine.

**Never edit either frozen validator to make a test pass.** A change that makes
`preEnvelopeCardValidator.ts` reject a Board the current build writes is the
exact defect the proof exists to catch. The only legitimate reason to touch
either file is to freeze a newer floor after every build carrying the old floor
is provably gone.

The mirror direction, meaning data an older build wrote opening in this one, is
proven in [`saveLoadCompat.test.ts`](../../src/graph/saveLoadCompat.test.ts).
That suite also proves rule 1 at the runtime seam: a Board carrying settings
from a newer build survives load, a settings write, save, and reload with every
foreign key intact. Follow that pattern when a setting needs a runtime proof of
its own.

## SOP 5: Hard stops

Each of these is a downgrade break. None of them merges. Rules 1, 2, and 3 are
one mistake wearing three costumes: an older build meets something it was not
compiled to accept, and refuses the whole record.

Rules 1 and 3 are the two that have actually shipped, so they are no longer left
to a reader's discipline.
[`strictContentSurface.test.ts`](../../src/persistence/strictContentSurface.test.ts)
holds the live strict key lists and the live closed value sets, key by key and
member by member, against a hand-written table. Add either one and that suite
goes red before review does, and the failure asks the only question that
matters: is this content, or is it a setting? The lists it holds are named once
as `STRICT_CONTENT_SURFACE` in
[`profileLogicalProjection.ts`](../../src/persistence/profileLogicalProjection.ts),
and the validators gate with them, so an inline key list beside one is itself a
failure.

1. Adding a key to a strict `hasOnlyKeys` or `hasExactKeys` allowlist for
   anything that is presentation or preference rather than content.
   `strictContentSurface.test.ts` catches this for the Board, Idea, Card, Block,
   Connection, Output, Version, and message validators. Updating that pin to
   make the suite green is correct only when the answer to its question is
   content. It is never the fix for a setting.
2. Adding a new top-level field to a record to carry a setting. Use the envelope
   the record already has: `Card.meta`, `Board.settings`, `Board.aiSettings`, or
   `Idea.settings`. Which envelope a record uses is already fixed, and a second
   container next to it is a downgrade break that buys nothing.
3. Widening or narrowing a strict value union or a numeric range, on the strict
   path, to carry a preference. `Card.headerFill`, `Card.conversationStyle`, and
   the legacy `Card.fontSize` union are still closed sets. A new member in any
   of them is the same failure as a new key, and
   `strictContentSurface.test.ts` catches it the same way. Inside an envelope
   the opposite holds: widen the `choices` or the `accepts` of the setting
   contract, because that is where a value this build cannot read already
   resolves to a default.
4. Adding a new logical record kind for a setting. An unaccounted record fails
   the whole projection with `Profile logical document contains an unconsumed
   record`, which is the worst available outcome, not the cleanest. A
   Profile-level setting is a `profile-setting` record, not a new kind.
5. Bumping a Profile, schema, record, or export version axis because a setting
   was added or changed. Settings never touch a version axis.
6. Indexing `card.meta`, `board.settings`, `board.aiSettings`, or
   `idea.settings` directly, or writing a per-feature tolerant reader beside the
   envelope.
7. Editing a frozen pre-envelope validator so a proof turns green.
8. Writing a Board-level setting, an Idea-level setting, or a new `aiSettings`
   key without saying so in the PR. The field exists, but the first write pays a
   one-time downgrade break for everyone. Take the two cheaper answers in SOP 2B
   first, and name the break where a reviewer can see it.

The closed sets still on the strict path stay as they are. Rewriting them now
costs the same one-time break for no present benefit. The rule is
forward-looking: nothing new joins them, and the next change that has to touch
one migrates it to the right path instead of extending it. The `provider` union
on a Run record is the exception that is not a defect: a Run recording which
provider answered is content, and content fails closed on purpose.

## The two fields that motivated this, as they landed

The Note text scale is migrated (#1308). It reads from the envelope key
`meta.noteFontSize` through the single reader
[`noteFontSize.ts`](../../src/graph/noteFontSize.ts). The stored value is a step
on the numbered Note text ladder that [`tokens.ts`](../../src/ui/tokens.ts)
owns, defaulting to step 2, which is exactly what the retired `'medium'`
rendered. The contract's `accepts` also admits the three retired names, so a
Board written while the envelope key still held a name keeps the scale the
person picked. The retired top-level `card.fontSize` stays on the strict Card
allowlist as a read-only legacy key, because every Profile already saved carries
it and a build that stopped recognizing the key would fail those Cards.

The Note link-preview state is migrated too (#1307). All of it is presentation
state and all of it lives in the same Card envelope, read and written only
through the envelope helpers in
[`linkPreview.ts`](../../src/shared/linkPreview.ts):

| Envelope key | What it holds | Default |
| --- | --- | --- |
| `linkPreviewExtras` | Previews two and up, for a Note whose body carries several links. The first preview stays in the strict top-level `linkPreview` field every shipped build already validates | no extras |
| `linkPreviewDismissedUrls` | The addresses the founder closed with the X, newest last, bounded to 8, so a closed tile never regrows | nothing dismissed |
| `linkPreviewAttemptedUrls` | The addresses this Note has already spent a fetch on, bounded to 8, so a failed or finished attempt is never repeated on reopen | nothing attempted |

None of the three is ever a top-level Card key. A `linkPreviewExtras` list this
build cannot read is carried through untouched and the Note shows the one
preview it can, which is rule 2 rather than a refused Board.
