# ADR 0040: Content Fails Closed, Settings Fail Soft

Status: accepted

Extends: [ADR 0007](0007-hand-written-validators-before-formal-schemas.md)

## Context

Eido keeps a Board's content and a Card's presentation state in the same record,
behind the same validator. `validateCard`
(`src/persistence/profileLogicalProjection.ts`) opens with a `hasOnlyKeys`
allowlist and then checks every listed key against an exact expected value
shape. One unrecognised key, or one value outside its declared union or range,
throws `ProfileLogicalProjectionError`. `hydrateRevisionDocument`
(`electron/sqliteProfileRevisionStore.ts`) catches that and re-throws it as
`ProfileRevisionCorruptionError` for the whole Profile revision. The blast
radius of an unfamiliar font size is every Board the founder owns.

Issue #1305 records the near miss that forced the question. A branch added a new
Card key, `linkPreviewDismissedUrl`, to that allowlist (commit `419cd75e`), and
widened `Card.fontSize` from the union `'small' | 'medium' | 'large'` to a
numeric step (commits `cc1402b2` and `5d6392de`).
Both are ordinary presentation data, written to the Profile the first time
someone uses the feature. A founder who used either feature and then reinstalled
the immediately previous build would meet a validator that does not recognise
the new key or the new value shape, and that older build would refuse to open
any Board in the Profile, not only the one Card that carried the setting. The
only recovery is an older backup.

The founder's ruling is the constraint this ADR encodes. It is a standing law
for every setting Eido will ever persist, not a repair for one Card field. In
the founder's words: Eido will keep gaining tools, utilities, settings, and
preferences. They are saved with the Board, and they are not content. A new
setting must save to a separate, additive place, so the format stays backward
compatible forever. A build that meets a setting it does not understand falls
back to the previous behaviour, or to that feature's default value. It must
never fail the load. Never break an Eido Profile that holds content.

Three facts read out of the code decide how far that law reaches today.

**The physical database already tolerates additions. The logical document does
not.** Nothing on the open path lists the tables or columns on disk and compares
them with the ones this build creates. `preflightExistingProfileVersionAxes`
(`electron/sqliteProfileRevisionStore.ts`) asks only whether named tables
and named columns are present, then reads the seven version axes out of
`profile_meta` by name. `CREATE_SCHEMA_SQL` in the same file is entirely
`CREATE TABLE IF NOT EXISTS`. There is no `PRAGMA user_version` gate and no
schema comparison on open. An older build therefore ignores an extra table and
an extra column it has never heard of. Inside the logical document the opposite
holds: one record the build cannot account for fails the whole projection, at
`fail('Profile logical document contains an unconsumed record')`
(`src/persistence/profileLogicalProjection.ts`). "Store it where older
builds ignore it" is therefore a real option for device-scoped state, and no
option at all for anything written as a logical record.

**A device-scoped preference store already exists, and it already fails soft.**
The `eido-v3-settings` key in `localStorage` (`SETTINGS_KEY` in
`src/graph/store.ts`) holds this machine's preferences. A corrupt read clears
that one key and rebuilds the defaults instead of refusing anything.
`normalizeThemePreference` (`src/ui/theme.ts`) normalizes an
unrecognized theme preference to a default. Electron main keeps the same shape
for its own device state in `electron/productAnalyticsSettingsStore.ts` and
`electron/updateConsentStore.ts`. None of it enters the Profile, so none of it
can break a Profile.

**The mistake had already shipped twice, unnoticed.** When this ADR was
written, `validateBoardSettings`
(`src/persistence/profileLogicalProjection.ts`) held a pure bag of preferences
to a closed key allowlist plus closed value sets for `provider`,
`reasoningEffort`, and `compactionMode`. Commit `8352bb65` added `provider` and
`providerModels` to it. Commit `190d3753` restructured the provider set. Each
was, technically, a downgrade break, and nobody noticed because nobody
downgraded. The same closed-set trap sat on `Card.headerFill` and
`Card.conversationStyle` in `validateCard`, on `Block.kind` in `validateBlock`
(where it is correct, because a Block kind is content), and on the Profile
setting record, which `decodePortableProfileSetting`
(`src/persistence/profileGuiProjection.ts`) pinned to one exact record id and
one canonical locale. This is a recurring defect class, not a single incident.
The Decision below removes the trap from `aiSettings` and from the Profile
setting record. `Block.kind` stays closed because a Block kind is content.
`Card.headerFill` and `Card.conversationStyle` stay closed for now, on the terms
in the Consequences: nothing new joins them, and the next change that has to
touch one moves it into the envelope.

`docs/foundations/persistence-layer.md` invariant 4 read, when this ADR was
written, as though it forbids exactly that fallback: every compatibility
dimension "refuse[s] unsupported future values instead of normalizing them
down". That is right for the version axes and for content shape. These incidents
show it must not reach per-setting values, so invariant 4 is now scoped to
exclude them and invariant 15 owns them instead.

## Decision

Every field that reaches persisted state is one of three things. Choosing which
is the first step and the one that matters most, because the other two decisions
follow from it.

**Content is what the three projections read** (ADR 0011): Ideas, Boards, a
Card's blocks, Connections, Outputs, Runs, and Intent history. Content is what
tells canvas, semantic context, and execution what a thing *is* or *does*.
Content keeps today's strict, hand-written, exact-key and exact-value validators
(ADR 0007) and keeps failing closed on anything unrecognised. Invariant 4
applies here unchanged.

**A portable setting changes only how something looks or behaves, and it has to
travel with the Profile** because it belongs to a Card, a Board, or an Idea:
Note font size, link-preview dismissal, header color and fill, per-Card tool
configuration, and every preference not yet imagined that a person would expect
to find again on another machine. No context or execution projection reads it.
It goes in the owning record's additive envelope, read tolerantly, with a
documented default.

**A device setting changes only how this machine behaves and does not need to
travel**: theme, panel widths, debug toggles, analytics consent, update consent.
It goes in the existing device preference store and never enters the Profile
document at all. This is the safest of the three, because state that is not in
the Profile cannot corrupt the Profile, and it is what every setting should be
unless it genuinely needs to follow the person's content. Prefer it.

The tiebreak is unchanged and asymmetric: if the choice between content and a
setting is not obvious, it is a setting. Content misfiled as a setting costs one
feature its stored state. A setting misfiled as content costs a founder every
Board in the Profile.

**A closed value set and a preference bag are the same mistake as a strict
key.** Growing a strict value union, or adding one more key to a bag held to a
closed allowlist, breaks an older build exactly the way a new top-level key
does: it meets a value or a key it was not compiled to accept, and refuses the
record. `provider`, `reasoningEffort`, and `compactionMode` inside `aiSettings`
were the live examples, and the evidence in the Context shows this has already
happened twice without anyone noticing. Every rule in this ADR covers all three
shapes, so the procedure is the same whether the change adds a key, adds a key
to a bag, or adds a member to a value set. `SavedBoard.aiSettings` was that bag.
This decision converts it into an envelope rather than leaving it as a permanent
exception.

### Where each record keeps its envelope

**The Card envelope is `meta`, the field that already exists.** `Card.meta`
(`src/graph/types.ts`) is validated as a plain record and nothing more, by
`isSettingsEnvelope` inside `validateCard`. Choosing it is not a naming
convenience. Because `validateCard` gates the record with `hasOnlyKeys`, every
build already installed on a founder's machine rejects any top-level Card key it
was not compiled to know. Introducing a new top-level `settings` key on the Card
would therefore reproduce the very downgrade failure this ADR exists to prevent,
and the protection would begin working only one release after the release that
needed it. `meta` is the only place where builds already in the wild tolerate
keys they have never heard of. Using it is what makes Card downgrade safety real
today rather than aspirational from the next version onward.

**The Board keeps two envelopes, and the Idea keeps one.** `SavedBoard.settings`
carries Board-level preferences that are not AI settings.
`SavedBoard.aiSettings` stays where it is, under its own name, and stops being a
strict bag: `validateBoardSettings` is now a single `isSettingsEnvelope`
container check, and every key inside it is declared once in
`src/graph/boardAiSettings.ts` with its own accepted shape and documented
default. `IdeaSummary.settings` carries Idea-level preferences on the same
terms. `validateIdea` moved from `hasExactKeys` to `hasOnlyKeys` to admit it,
which is not a loosening: every content field it lists is still required by its
own value check.

**A Profile-level setting is a `profile-setting` record, read for its container
only.** `decodePortableProfileSetting`
(`src/persistence/profileGuiProjection.ts`) still fails closed on a row that is
not a well-formed setting record. A record id this build does not recognise is
now inert: it is carried through verbatim and never inspected, instead of
failing the Profile.

The tolerant-read rules inside every envelope:

- **An unrecognised key is preserved exactly as written**, through read and
  re-write, by a build that cannot interpret it as much as by one that can. An
  older build resaving a newer build's Profile never destroys the newer build's
  settings.
- **A recognised key whose value does not match this build's expected shape** (a
  retired union member, an out-of-range number, a future variant) is preserved
  on disk exactly as written, and the runtime reads that setting's documented
  default in its place. The substitution is a read, never a rewrite: physically
  dropping the value is how an older build would destroy a newer build's
  preference, which is rule 1 again. It never fails the Card, the Board, the
  Idea, or the Profile.
- **Only a structurally broken envelope is corruption**, meaning an envelope
  that is not a plain object. Envelope structure stays fail-closed.

Stated plainly, because this is the line the rest of the decision serves: **an
unrecognised setting key or an unrecognised setting value must never fail a
Profile, Idea, Board, or Card load.** Only content shape and envelope structure
remain fail-closed. Adding or changing a setting never bumps a Profile, schema,
or record version axis.

### What this protects, and what it does not

Every record now has an envelope, but the protection those envelopes give is not
uniform, and this ADR must not be read as though it were. "Safe against builds
already shipped" means: a Profile written by this build still opens in a build
that was installed before this ADR landed.

| Where a setting lives | Safe against builds already shipped? | Why |
| --- | --- | --- |
| Device preference store | Yes, completely | It never enters the Profile, so no validator ever sees it. |
| `Card.meta` envelope | Yes, against every build ever shipped | `meta` was always on the Card allowlist and always an open plain record. |
| `Board.settings` envelope | No, until something first writes it | `validateBoard` now tolerates the key, but every build already installed carries its own `hasOnlyKeys` copy without it. |
| `Idea.settings` envelope | No, until something first writes it | `validateIdea` now tolerates the key, but every build already installed used the stricter `hasExactKeys`. |
| `Board.aiSettings` envelope | Only for values the previous build already accepted | The bag is open here, and closed in every build already installed. A new key or a new value in it is the same one-time break. |
| Profile setting record | Yes, for the recognised ids; no for a new id | `decodePortableProfileSetting` now carries an unrecognised id through untouched, but shipped builds admit only `profile-setting-locale`. |
| Any remaining strict top-level field or value union | No, ever | This is the defect the ADR exists to remove. |

**Board-level and Idea-level envelopes are taken, not deferred. The cost is
accepted, and it is not paid until something first writes one.** Adding a
tolerated field protects nothing already shipped. It is the first release that
actually WRITES a Board-level or Idea-level setting that older builds start
refusing, and only builds from this release onward carry the tolerance. Sowing
the field now and writing nothing into it is deliberate: it moves the tolerance
into the wild ahead of the first setting that needs it, so the break lands later
and smaller. `SavedBoard.settings` and `IdeaSummary.settings` exist, are
validated as open plain records, and are copied through the load path verbatim.
Nothing writes either one yet.

The same holds for `aiSettings`. It is an envelope in this build, and a closed
bag in every build already installed, so the break there also arrives with the
first key or value a shipped build cannot accept, not with this release.

The break is paid once, knowingly, and recorded in the release notes of the
release that first writes one of those fields. After it, the law holds at every
level, forever. Before it, a setting that seems to belong to a Board or an Idea
still has two cheaper answers to try first: make it a device setting, or hang it
off the Card it actually affects. Take the one-time break only when neither is
honest.

## Considered Options

- Chosen: split every persisted field three ways, keep the device preference
  store as the preferred home for anything that need not travel, and read the
  portable settings envelope tolerantly. The Card uses the `meta` field that
  shipped builds already tolerate. The Board, the Idea, and `aiSettings` get the
  same envelope on the one-time terms in the Decision.
- Not chosen: two categories only, content and setting, with everything that is
  not content written into the Profile. It puts state into the one place an
  older build can refuse, for settings that had no reason to be there.
- Not chosen: a new logical record kind per setting. An unaccounted record fails
  the whole projection, so this is the most dangerous option available, not the
  cleanest.
- Not chosen: a new physical table or column per setting, which older builds
  would genuinely ignore. It moves preference state below the logical contract
  that invariant 1 exists to hold, and it excludes the setting from Portable
  Export. The device preference store already gives the same tolerance without
  breaking the layering.
- Not chosen: a new top-level `settings` key on the Card. `meta` is already
  there and already tolerated, so a second Card container would buy nothing and
  cost a downgrade break on exactly the builds this decision is meant to
  protect. The Board and the Idea had no such field, which is why they take the
  break instead of avoiding it.
- Not chosen: one strict schema for everything, with engineering discipline
  deciding which future fields are safe to fail on. That was the policy this ADR
  replaces. It had already failed three times, twice without anyone noticing,
  and it degrades further as feature velocity rises.
- Not chosen: refuse to open a Profile whose stated version is newer than the
  running build. The founder needs downgrade safety, and refusing a whole
  Profile is a worse outcome than one feature quietly reverting to its default.
- Not chosen: defer the Board-level and Idea-level envelopes until a real
  setting needs one. Deferring does not avoid the break, it only moves it later
  and makes it bigger, because the release that pays it would then also be the
  release that ships the setting. Sowing the tolerant field now and writing
  nothing into it separates the two.
- Deferred: formal JSON-schema tooling for the envelope. ADR 0007's
  hand-written validators are enough at this size.

## Consequences

- A setting or a preference can never again take down a Board or a Profile in
  this build or any build after it. The worst downgrade outcome is one feature
  returning to its default. For Card settings that holds against every build
  ever shipped; for Board, Idea, and `aiSettings` settings it holds from this
  release onward, which is what the one-time break buys.
- Two validation policies now coexist, strict for content and tolerant for
  settings, and every future feature has to place its field on one of three
  sides of that line. A companion SOP (#1306) gives that placement one
  procedure, so the judgment is not re-derived per feature.
- The default answer for a new setting moves outward, to the device store.
  Fewer new fields reach the Profile at all, which is the cheapest form of
  compatibility there is. The cost is that a preference kept on the device does
  not follow the person to a second machine, which is the right trade for a
  panel width and the wrong one for a Card's appearance.
- One deliberate downgrade break is accepted in advance, once. This release
  creates `Board.settings`, `Idea.settings`, and the tolerant `aiSettings`
  envelope, but does not pay for them: nothing writes the two new fields, and
  the break arrives with the first Profile that actually carries a Board-level
  setting, an Idea-level setting, or an `aiSettings` value a shipped build
  cannot accept. That release names the break in its release notes. It is a
  known, one-off price for permanent tolerance at every level, not an open
  licence. Nothing else in this ADR permits a compatibility break.
- `SavedBoard.aiSettings` is no longer a strict bag. `validateBoardSettings` is
  a container check and nothing more, and each key inside it is declared once in
  `src/graph/boardAiSettings.ts` with its accepted shape and its default.
  `model`, `models`, and `reasoningEffort` are marked required, because callers
  dereference them without asking and an absent one would leave a hole. Every
  other key stays absent when it is absent, so a Board written before a setting
  existed stays byte-identical to one that never left the default.
- The closed value sets still on the strict path are on the wrong side of this
  line: `Card.headerFill`, `Card.conversationStyle`, and the legacy
  `Card.fontSize` union. They are not rewritten now, because doing so costs the
  same one-time break for no present benefit, but no new key or union member
  joins them. The next change that needs to touch one migrates it instead. The
  `provider` union on a Run record is different: a Run recording which provider
  answered is content, so it stays strict on purpose.
- `meta` stops being a spare-room field and becomes a contract: presentation and
  preference state only. Anything a projection reads is content, and belongs in
  a validated top-level field.
- Both fields that motivated this decision are migrated. The Note text scale
  (#1308) reads from `meta.noteFontSize` through the single reader
  `src/graph/noteFontSize.ts`, holds a step on the Note text ladder that
  `src/ui/tokens.ts` owns, defaults to step 2 (what the retired `'medium'`
  rendered), and leaves the top-level `fontSize` on the strict allowlist as a
  read-only legacy key so every Profile already saved still opens. The Note
  link-preview state (#1307) reads from `meta.linkPreviewExtras`,
  `meta.linkPreviewDismissedUrls`, and `meta.linkPreviewAttemptedUrls` through
  `src/shared/linkPreview.ts`, and no part of it is a top-level Card key.
- A `profile-setting` record whose id this build does not recognise is now
  inert. `decodePortableProfileSetting` still fails closed on a malformed
  container, and carries an unknown id through verbatim without inspecting it.
- `docs/foundations/persistence-layer.md` invariant 4 is scoped to the version
  axes and to content shape, and explicitly excludes per-key values inside the
  settings envelope. Invariant 15 states this decision in that document.
- Relates to ADR 0007 (this adds a second, tolerant validation mode beside its
  strict one, without weakening it), ADR 0011 (defines content as what the three
  projections read), and ADR 0025 with ADR 0029 (physical and process authority
  are untouched: this is a logical-record decision).
