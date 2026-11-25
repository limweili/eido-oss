# ADR 0037: A Second Key Buys A Better Reach

Status: accepted

Amends: [ADR 0034](0034-one-provider-key-is-the-product-default.md)

## Context

ADR 0034 removed a second credential and said one provider key is the only key.
Two of its three load-bearing clauses are now amended and the third is
reaffirmed, so this ADR is precise about which is which.

The second-key clause was decided against a specific fact: the Tavily key had no
execution path left. ADR 0033 deleted the pre-flight mechanism that called it,
and forbade the client-side loop that could have replaced it, so the field would
have advertised a capability the product could not perform. ADR 0034's own words
were that it is "a redundant obstacle" whose "default path never calls" it. That
was true, and it is the part that changed: [ADR 0036](0036-eido-runs-the-tool-loop.md)
restores the loop, and a key that the primary path calls on every run is the
opposite of a redundant obstacle.

The card-control clause rejected a search-depth control on the Card face, on the
general rule that a control a user cannot answer well should not be shown to
them. The founder put one control on the face on 2026-08-18 and, later the same
day, took the depth question off it again. The rule survived both moves without
a scratch, and this ADR is mostly the story of it being applied correctly the
second time.

The cost clause said cost is disclosed once in Settings and never per run. The
founder reaffirmed it on the same day. It is unchanged.

## Decision

**Eido holds two keys, and the second one is optional.** The OpenRouter key is
still the only required credential and still the thing without which nothing
runs. The Linkup key sits beside it in Settings, marked optional, and buys a
better reach: Eido executes the tools itself, so the trail is provenance rather
than a provider's summary. Without it, runs take the OpenRouter server-tool path
that shipped in epic #931 and behave exactly as they do today.

This is not a general licence for credentials. The test a second key had to pass,
and which Tavily's failed, is that the default path calls it on an ordinary run.
A key the product only uses in a corner is an obstacle wearing a feature's
clothes, and ADR 0034's rejection of that stands.

**One control lives on the Ask AI Card face, and it cycles Off, Web, Research.**
It sits in the Card foot beside Run, on the founder's direction: whether a run
reaches the web changes what pressing Run does, so it belongs with Run rather
than up in the model row.

A first version of this control asked for a search depth, offering Quick,
Deeper, and Study named for time rather than mechanism. The reasoning was that
ADR 0034's rule is about whether a user can answer the question, and that "how
long should this take" is a question about the user's own patience, which is the
one thing they are the world authority on.

That reasoning was right about the rule and wrong about the question. The user
was being asked to pick a search tier with a friendly label on it, once per
Card, in advance, for a run whose shape nobody knows yet. The model reads the
actual question, holds Linkup's own selection rules, and decides per call. So
the tier was mechanism wearing a costume, and ADR 0034's rule disqualifies it
exactly as it disqualifies an engine picker. The founder reached this conclusion
first and stated it as a product direction; it is recorded here as the rule
working, not as the rule being overridden.

**What is left on the face is the one question the user genuinely owns:** how
much of the web this run may touch. Off is none. Web is search and page reading,
in seconds, the ordinary case. Research is an investigation that runs for
minutes and, once submitted, cannot be stopped or refunded. That last state is a
different kind of press, not a bigger one, which is why it is a mode rather than
a notch on a dial.

**Research is warned about before it is armed, and only research.** Linkup
publishes submit and poll for the research endpoint and nothing else: the charge
and the job commit the instant it is submitted, and it runs on their servers
whether Eido is listening or not. Cancel therefore stops the run and the polling
and does not stop the job. The epic's promise that stopping means stopping is
not true here, so the Card says so in words rather than letting the stop button
imply otherwise. Web mode is never warned about, because there is nothing there
a user needs protecting from.

**The mode is written to `card.meta`, never to a new Card field.** The persistence
validator holds Cards to a closed key set and fails the whole projection on an
unrecognised key, so a new top-level field would make a Board saved by this
build refuse to open in an earlier one. That is not a lost setting, it is a lost
board. `meta` is the one part of a Card validated as an open record: a newer
build writes into it and an older build carries it without reading. Run records
get no mode at all, because the run validator has no equivalent escape hatch; a
follow-up reads the Card's current mode instead. `card.agentic` stays a boolean
meaning reach is on, unchanged, so a Board saved here still opens in a build
that predates all of this with its reach intact.

**Cost stays in Settings, said once, and never per run.** Reaffirmed on the
founder's explicit direction. Settings says what a Linkup key costs and what the
free credit is. The Card prices nothing, because a per-run price tag makes
people avoid a feature rather than understand it, and because the decision has
already been made by the time the Card is running.

An earlier draft added that depth is the cost control the user actually holds,
expressed in time. That sentence is gone with the depth control, and nothing
replaces it: the founder removed cost as a constraint on this product the same
day, so there is no cost control on the face because there is no cost lever
worth giving the user. The one thing the Card still says about spending is said
about Research, and it is said because that spend is irreversible rather than
because it is large.

## Consequences

Onboarding is one key plus one optional key. The optional one has to earn its
sentence in Settings, which is why the copy says what it buys before it says
what it costs.

A user with no Linkup key cycles Off and Web only, because Research has nothing
to run. The Card does not show a control that would do nothing, and it does
not advertise the key by dangling a disabled one.

An older Eido opening a Board saved here shows the Card with its reach on and
no mode, and runs in Web. That is the forward-compatibility property `meta` was
chosen for, and it is worth more than the tidiness of a real field.

The rule ADR 0034 stated is now on record as having survived the reversal of its
own conclusion, which is the useful outcome: the next control proposed for a
Card face is tested by whether a user can answer it, and a control that failed
that test was removed from the face within a day of reaching it.

## Amendment, 2026-08-18: research depth belongs to the person paying (#971)

Research is the one reach that spends dollars per press, between $0.25 and
$2.50, uncancellable once submitted. The founder ruled the same day that when
a press spends money in dollars rather than fractions of a cent, the choice of
`reasoningDepth` belongs to the person paying, not the model. The research
callout now carries four depth keys, S to XL. Pressing one only sets the dial;
the consent is a second press of Run, which the callout names, so choosing and
spending stay two acts with a moment in between (founder revision, same day:
a key that both chose and spent gave nobody a chance to change their mind).
The choice persists per Card in `card.meta`
(`researchDepth`, absent means S, the cheapest), and the parameter is gone
from the research tool's schema so the model cannot supply it at all. `mode`
stays the model's, because shape is machinery and spend is not.

This is a scoped exception, not a reversal. The search-depth rejection above
stands untouched: Web mode still lets the model choose per call, because
there the question is mechanism and the cost is fractions of a cent. The
"never per run" cost rule bends exactly this far: the two numbers a depth
choice turns on, minutes and dollars, stand beside the depth control, where
the finger is deciding, and nowhere else on the face.

A third revision the same day, from testing on a coloured Card: a small fast
model handed the research tool answered from memory in sixteen seconds with an
empty trail. Research mode is not a hint, so the tool set now names a call the
model must make on its first turn, and only the first. The transport forces it
through `tool_choice` and never learns whose tool it is. Web mode stays a free
choice, because there nothing was promised and nothing costs dollars.

The same testing showed the Card sitting blank for minutes afterwards, because
a trail row was only written when a tool returned and this one takes minutes.
An executor can now announce a step the moment it knows what it is doing, and
research announces when the vendor takes the job. A tool that announces does
not also return the same step, or one lookup would be counted twice.

The same decision spent the job-id stash #963 wrote: a research-armed Card
with a job id standing offers Resume, which re-attaches by polling the
standing job and never submits, so a cancel, a crash, or a quit no longer
strands a paid report.

## Amendment, 2026-08-19: a locked reach control routes to upgrade (#987, #989)

The subscription epic (#987) puts web mode and research mode behind the US$15
subscription, and the founder was explicit about how that boundary must feel:
gated features are greyed out, never hidden, and a greyed control is never
inert. That deliberately reverses one sentence of this record's Consequences,
which said the Card "does not advertise the key by dangling a disabled one".
The reversal is recorded here so the next reader sees a decision rather than
drift.

The rule that changes is scoped to entitlement. When a person's account is not
entitled to reach, the globe wears the design system's new **locked** state
(SYSTEM.md §7): it holds at Off, keeps the pointer cursor, hover, focus, and a
real click, and every press opens the upgrade screen instead of cycling. It
never carries `aria-disabled`, and its accessible name and tooltip say what
unlocks it. Cycling into a mode the person is not entitled to would arm a run
that cannot happen, so the hold-at-Off is the honest shape of the gate.

The rule that stands is capability. With a subscription but no Linkup key, the
cycle still skips Research rather than offering a state that cannot run,
exactly as this record decided: that absence is a missing credential, not a
missing entitlement, and a disabled Research state would still be a control
that does nothing. The two absences answer to different rules because they say
different things: "you have not bought this" is a doorway, "this has nothing
to run" is silence.

Nothing else here moves. The one-control cycle, the mode's home in
`card.meta`, the research warning, the depth choice, and the cost-in-Settings
rule are all unchanged.
