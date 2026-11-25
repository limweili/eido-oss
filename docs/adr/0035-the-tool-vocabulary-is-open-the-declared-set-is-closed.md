# ADR 0035: The Tool Vocabulary Is Open, The Declared Set Is Closed

Status: accepted

Amends: [ADR 0033](0033-agentic-runs-delegate-tool-use-to-the-provider.md)

## Context

ADR 0033 fixed an Agentic Run at exactly two tools and said so in the code: the
step type was a two-member union, and the trail, the icons, the link rule, and
the persistence validator each hard-coded that pair. The clause read "this is
deliberately two tools wide. It is not a general tool registry and must not
become one without a further ADR." This is that ADR.

Two forces pushed on it at once.

The first is ordinary product direction. Search and fetch are the first two
agentic abilities, not the last. Adding a third would today mean editing four
places that each independently know what a step can be, which is the shape a
codebase takes just before someone adds the fifth place.

The second is sharper, and is about data rather than design. Eido's persistence
validators reject a Run whose shape is not on the current allowlist, and the
rejection is not partial: an unrecognised step kind fails the whole Run. A user
running a newer Eido on one machine and an older one on another, or rolling back
after an update, would open a Profile that a strictly-newer build had written and
lose the Run. A closed vocabulary in the validator is therefore not caution. It
is a forward-compatibility hazard that grows with every tool added.

The two forces pull in opposite directions only if "what Eido declares" and
"what Eido records" are treated as one vocabulary. They are not.

## Decision

**What Eido declares stays closed.** The request sent to OpenRouter names a
fixed, small set of server tools, listed in one place with the rule for turning
each one's reported calls into a step. Eido asks only for tools it can stand
behind: their cost, their failure modes, and what they do to a user's Card are
understood before they are named. A tool call reported under a name Eido did not
declare is ignored rather than guessed at. Adding a declared tool is a product
decision with a diff of one entry.

**What Eido records is open.** A step's `kind` is a string, not a union. The
persistence validator checks the shape of a step (a closed key set, a non-empty
kind, a string detail) and never its membership in a list. A Profile written by
a later build opens here, and the Run it carries survives intact.

**One registry owns how a kind is presented.** Icon, label, and whether the
detail is a destination the reader can open live in a single vocabulary module.
Nothing that renders a step reads `step.kind` directly. A kind this build does
not recognise still draws a truthful line, with no link: what an unrecognised
tool's detail means is exactly what this build does not know.

**The trail's settled default is bounded, and says so; the reader's reach is
not, and a live run is not bounded at all.** There is still no ceiling on how
many tools a run may use, which ADR 0033 settled and this does not revisit.
While a run works, its trail is open and complete: a lookup is the answer
beginning to exist, and it streams like the answer does. Once the answer lands
the trail folds, and reopening it draws the first few steps and states the
remainder in the user's words, as a control: one press draws the rest, and the
count above it was always the true total. Nothing is dropped, and nothing is
dropped silently.

An earlier draft made that first number a hard drawing cap, on the reasoning
that a Card is passively captured by serializing its DOM and that capture is
rejected past a node budget. The premise was wrong: the cached passive renderer
was a rejected candidate and its source lineage has been removed. Production
bounds canvas residency by mounted Card count and text weight, which a trail's
rows do not enter. What actually needed bounding was the state a trail is almost
always in, and the fix for that is not a cap but building no rows at all until
the reader reaches for them. Past that point the rows exist only for a Card the
reader has both opened and expanded, which is one Card, transiently.

## Consequences

Adding a third agentic tool is now two edits with clear owners: one entry in the
declared set, if Eido is the one asking for it, and one entry in the presentation
vocabulary with its words. No component, no type, and no validator changes.

An older build shows a newer build's steps as generic tool lines rather than
hiding them, which is the honest failure: the Card says the answer used a tool
it cannot name, instead of implying the answer used none.

The cost is that a corrupt or hostile `kind` string now reaches the presentation
layer rather than being rejected at load. It is bounded there by the same rules
every other Card string obeys: it is rendered as text, never as markup, and it is
never a destination.
