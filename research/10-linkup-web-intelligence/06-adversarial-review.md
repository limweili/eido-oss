# 06: Adversarial Review of the Linkup Epic

Status: complete. Reviewed 2026-08-18 at head `21179ca0` on
`claude/eido-web-search-688819`, independently and against primary sources:
the shipped code and tests, the research track (10 and 11), ADRs 0028 and
0032 through 0036, epic #956 and issues #957 through #965 with comments, and
Linkup's live documentation (four pages fetched fresh: search best practices,
search for-agents, fetch best practices, research best practices).

Two lanes are in flight and not on the branch: dynamic tool declarations
(#962) and the Off / Web / Research control (#963). Findings against those
lanes are findings against the specification in
`research/11-linkup-skills/00-two-modes-and-dynamic-tools.md` and the amended
ADRs, which is what those lanes will build from.

What is marked **verified** below was read directly in source or observed by
running something. What is marked **inferred** is a conclusion drawn from
verified pieces.

---

## Finding 1: The research warning guards the wrong moment, and follow-ups walk around it entirely

**Severity: highest in this review. This is the one place the new design
quietly reverses a finding the epic itself already fixed once.**

The pre-code adversarial review recorded in #956 found: "Follow-ups inherited
Study with none of its design, so a chat reply could submit a five minute
job. Now clamped to the shallow tools." That clamp was a recorded fix.

The two-mode pivot silently removes it. Verified:

- ADR 0037: "Run records get no mode at all ... a follow-up reads the Card's
  current mode instead."
- `src/brain/followUpRunner.ts` lines 174 to 181: a follow-up builds its tool
  set from the run's `agentic` flag plus the Card's **current** depth (soon:
  mode). The machinery to hand follow-ups the full toolset already exists and
  is wired.
- The spec (`00-two-modes-and-dynamic-tools.md`) never mentions follow-ups.

Consequence (inferred, directly from the above): once #963 lands as
specified, a Card armed into Research mode gives **every follow-up in its
thread** the research tool. A one-line conversational reply ("expand the
second point") can submit a job that runs 10 to 20 minutes, costs up to
$2.50, and cannot be stopped once submitted. The user was warned once, at
arming time, possibly days earlier.

The same decoupling bites a second way. The spec says the warning "fires when
the Card is armed into Research mode, which is the last user action before
Run." That premise fails as soon as the mode persists, and the spec itself
makes it persist: `card.meta.reachMode` survives saves, restarts, and reopened
Boards. A Board opened next week with a research-armed Card runs research on
every Run press with no warning at all. "Armed" and "about to spend minutes"
are only the same moment in the demo flow.

Cost is not the constraint here, by founder direction, and this review does
not relitigate that. But the founder's instruction was "warn before
submitting", and the shipped reading of it warns before *arming*. The gap
between those is exactly where follow-ups, chain runs, and reopened Boards
live.

**Recommendation.** Pick one deliberately and record it:

1. Follow-ups clamp to the Web tools (restores the fix the epic already made
   once), or
2. the warning fires on the first research-mode Run press per session per
   Card rather than at arming, or
3. the current design is accepted with the consequence written down in ADR
   0036, so the next reviewer finds a decision instead of a hole.

Option 1 plus a per-session warning is the smallest change that honours both
the founder's sentence and the earlier fix.

---

## Finding 2: A paid research job does not survive the app closing, and the design throws away the handle that would save it

**Severity: high. Money and a result are both lost in an ordinary event.**

Verified from #963's redefinition: "Nothing is persisted to the Run record:
its key set is closed and the job identifier lives in memory for the life of
the run. An interrupted research run is lost cleanly."

"Cleanly" understates what is lost. A research job commits its charge at
submission and completes on Linkup's servers regardless of whether Eido is
listening. The report remains retrievable by `GET /v1/research/{id}` after
completion. If the app quits, crashes, or the laptop sleeps hard during a 10
to 20 minute poll, the user has paid up to $2.50 and waited the minutes, the
finished report exists on Linkup's side, and Eido has discarded the only key
that could fetch it. The user cannot recover it themselves either; the id was
never shown.

The stated reason is that `RunRecord` has a closed key set. True, and
verified in `profileLogicalProjection.ts`. But the epic already built the
escape hatch for exactly this class of value: `card.meta` is validated as an
open record, and `reachMode` and `webReachDepth` already ride it. A
`{researchJobId, submittedAt}` pair in `card.meta`, written at submission and
cleared on completion, costs no validator change, survives an older build
harmlessly, and turns "lost cleanly" into "resumed on next open, or at least
offered."

**Recommendation.** Stash the job id in `card.meta` for the life of the job.
On reopen with a live id, resume polling or offer to. If the loss is instead
accepted as a product decision, write that disposition into #963 so it is a
decision and not an accident. Given a 20 minute XL job is the exact case the
mode exists for, acceptance seems hard to defend.

---

## Finding 3: The tool-name matching convention will misroute `research` calls to the search executor

**Severity: high for the in-flight #962/#963 lanes; zero for shipped code.**

Verified in code: Eido-executed tools resolve by first substring match.

- `src/brain/webTools.ts:115`: the search tool's matcher is
  `(name) => name.includes('search')`.
- `src/brain/openRouter.ts:528`: the loop picks the executor with
  `eidoTools.tools.find((candidate) => candidate.matches(call.name))`.
- `'research'.includes('search')` is `true` (verified by running it).

The spec names the three tools `search_web`, `fetch_page`, and `research`.
If the new lane carries the existing matcher convention forward, a model call
to `research` resolves to whichever matching tool the `find` reaches first.
With the search tool listed first, the call executes a **web search** using
`args.query`: wrong tool, wrong price class, wrong trail line, and no error
anywhere, because the arguments happen to be compatible. This is a silent
misroute of the single most consequential call in the product.

The "generous matching" rationale in `agenticRun.ts` was written for
provider-executed server tools, where OpenRouter may qualify or prefix the
reported name. For Eido-executed function tools, Eido chose the names and the
model echoes them; generosity buys nothing and just created this collision.

**Recommendation.** Exact-name equality for Eido-executed tool matching, and
one regression test that declares all three tools and asserts a call named
literally `research` reaches the research executor. Cheap now, expensive to
diagnose later.

---

## Finding 4: The termination guard that replaces the call budget is not specified well enough to build

**Severity: medium-high. The guard is the only thing standing between a
broken tool and an infinite paid loop, and two of its load-bearing details
are unwritten.**

Verified: the spec and amended ADR 0036 both say "consecutive failed calls
with no successful call between them end the loop", and both stop there.

Two gaps:

1. **No threshold.** "Consecutive failed calls" without a number is not
   implementable as written. Two? Five? The lane will pick one; the spec
   should own it.
2. **No definition of "failed call".** In the shipped loop, three classes of
   answered-but-useless call exist: an unknown tool name, arguments that do
   not parse, and an executor failure. Today all three spend the call budget
   (`openRouter.ts:527`, spending happens before the name is even resolved),
   which is what makes a model hallucinating tool names terminate. Delete the
   budget and count only executor failures as "failed", and a model spinning
   on a misspelled tool name loops forever: each turn gets a polite "there is
   no tool named X" reply, no failure is counted, backoff never fires, and
   every iteration re-bills the entire conversation to the provider key.

**Recommendation.** The spec states the threshold (three is defensible) and
defines a failed call as any answered call that did not execute successfully,
explicitly including unknown-name and unparseable-argument replies. One test
per class.

---

## Finding 5: The Settings cost sentence becomes false under the new design, and no ticket owns fixing it

**Severity: medium. It is the product's single point of cost disclosure, and
after the pivot it will understate the worst case by ten times.**

Verified: `src/shared/words.ts:498` ships "A quick look costs about half a
cent, a deeper one about five cents, and a study twenty-five cents, billed to
this key."

Under the two-mode design: quick/deeper/study no longer exist, the model may
choose deep search ($0.055) inside ordinary Web mode, and Research reaches
`XL` at **$2.50**, which #963's redefinition makes explicitly available. The
sentence's vocabulary dies and its largest number is off by 10x.

ADR 0037 reaffirms "Settings says what a Linkup key costs", and the old #962
carried an acceptance criterion that the worst case per depth "is a number
someone can state, and the Settings copy from #958 states it beside the
price". That criterion was deleted in the redefinition and nothing replaced
it. #965's generic sweep may catch it; a named criterion would guarantee it.

**Recommendation.** Add to #963's acceptance: the Settings copy states the
Web-mode range in cents and the Research range as $0.25 to $2.50, and the
words suite passes. This is one sentence of copy and it is the sentence the
whole "cost is disclosed once" rule stands on.

---

## Finding 6: Making `depth` optional-with-default contradicts the vendor's own tool schema and the spec's own reasoning

**Severity: medium. A quiet quality failure, not a crash.**

Verified against the live docs: Linkup's for-agents page publishes a tool
definition in which `query`, `depth`, and `outputType` are all **required**.
The model always chooses depth per call; nothing defaults it.

Verified in the spec: `search_web` makes `depth` optional, defaulting to
`fast`. Yet three paragraphs later the same spec makes the research tool's
`mode` and `reasoningDepth` required "because Linkup's guidance is explicit
that leaving them unset makes latency, cost, and output shape unpredictable."
That argument applies with equal force to search depth, and the failure mode
is sharper: a JSON-schema `default` is advisory, so a model that simply omits
`depth` silently gets `fast`, and `fast` is keyword-only, bypasses the LLM,
and treats an instruction-shaped query as keywords. That is the vendor's
first-named anti-pattern, and it fails quietly with a thin answer rather
than loudly. The founder's "default to fast" is preserved by prompt guidance
either way; a schema default is the wrong place to encode it.

**Recommendation.** Make `depth` required in the declaration, exactly as
Linkup's own published tool definition does. Keep "default to fast, move up
for a reason" in the description and the brief, where the model can obey it
consciously.

---

## Finding 7: The travelling brief has a scope bug and a missing rule

**Severity: medium.**

(a) **Scope.** The spec sends the brief "whenever reach is on". Verified: on
the keyless fallback path, reach on means OpenRouter server tools, and the
brief's first sentence ("Web lookups here run through Linkup") plus its
entire depth model would be false for the tools actually declared. The brief
must be conditioned on the Linkup toolset being declared, not on the reach
toggle.

(b) **The one cross-tool rule that matters is absent.** The brief's stated
purpose is to carry "what spans the tools". In Research mode the model holds
three tools, and the most consequential decision it makes is research versus
deep search: seconds and cents against minutes and dollars, on an
uncancellable submission. The brief says nothing about it. The vendor's own
rule exists and is one line: reach for research "only when a single `deep`
search can't cover the job" (verified in the vendored
`linkup-research__SKILL.md` and the live research best-practices page).

**Recommendation.** Condition the brief on the Linkup toolset; add one
research-selection line, included only when the research tool is declared.

(Also verified sound, for balance: the brief's depth chain, the
`standard`-cannot-chain rule, the keyword-shaped-`fast` warning, and the
date-filter and named-facet advice all match the live vendor docs. The
compression is faithful.)

---

## Finding 8: Two lanes are building on a loop whose central provider assumption is still unverified

**Severity: medium, about sequencing rather than correctness.**

Verified: `05-loop-capture.md` records honestly that the reasoning-echo
question (whether `reasoning_details` must be echoed back with tool results,
and whether Eido's merged reconstruction is accepted, signatures included) has
never been observed on the wire. The capture script exists and is runnable.
The epic's own history, quoted in the same file, is that the previous epic
lost a rewrite to exactly this class of unverified provider assumption.

The risk is not that the gap is hidden; it is admirably documented. The risk
is order: #962 and #963 both build on `streamCompletion`'s loop. If the
capture later shows a provider rejecting the merged shape (Anthropic's signed
reasoning blocks are the named sharp case), the transport changes underneath
two landed lanes plus their tests.

**Recommendation.** The founder holds an OpenRouter key. Run
`capture-loop.mjs` before #962 lands, not at epic close. It costs under a
cent and minutes, and it either retires the epic's single largest open
technical risk or reshapes the loop while one lane depends on it instead of
three.

---

## Finding 9: Smaller, concrete items

Each verified unless marked otherwise.

1. **The prompt reserve loses its formula.** `promptReserveTokens` is
   computed from `callBudget` (`webTools.ts:190`). #962 deletes the budget
   and the spec keeps the reserve without saying what now sizes it. State a
   constant (the existing 48,000-token ceiling is the obvious candidate).
2. **`capForPrompt` over the joined source list** (`webTools.ts:129`) can cut
   the middle sources out of a search result, so the model may see a title
   whose URL was removed and cite a source it cannot name. Cap per source, or
   trim the source count, rather than slicing the concatenation.
3. **Empty-answer edge in the loop.** If `tool_choice: 'none'` is not
   honoured and the final turn contains only tool calls, `streamCompletion`
   returns `turn.text` which may be empty, and the run finishes with a blank
   answer (`openRouter.ts:494-498`). Worth one guard or one test when the
   loop is reworked for #962.
4. **No request timeout in `linkup.ts`.** A hung connection holds the run
   until the user cancels. Low priority; cancel works and is tested.
5. **`05-loop-capture.md` still carries the heading "# 04:"** after the
   renumber.

---

## Record drift that must not survive epic close

All expected for a mid-flight branch with two lanes out; listed so #965's
sweep has a checklist rather than a search. The ADRs were amended ahead of
the code, so until #962/#963 land, the accepted ADRs describe behaviour that
does not exist and the shipped code enforces behaviour the ADRs disown.

- `src/brain/linkup.ts` header: "The caller fixes `depth` and `outputType`,
  always. Both are cost levers, the model does not pay." Contradicts amended
  ADR 0036.
- `src/brain/webTools.ts`: the entire depth-plan and call-budget block, its
  comments, and its tests describe the retired design.
- `CONTEXT.md` glossary: "Eido never runs the tool loop itself" (Agentic Run)
  and "Eido holds no search credential of its own (ADR 0034)" (Web Reach).
  Both now false; #965's acceptance explicitly requires this fix.
- `research/11-linkup-skills/README.md` calls `eido-tool-brief.md` "what Eido
  actually ships"; nothing in `src/` carries the brief yet (verified by
  grep).
- `research/10-linkup-web-intelligence/README.md` still lists "not settled"
  questions (Research in wave one, cost disclosure) that founder direction
  has since settled.
- `webReachDepth.ts`, the `webDepth*` words, and the depth `Picker` in
  `AskAiCard.tsx` become dead code after the pivot and should be deleted, not
  stranded.

---

## What was checked and found sound

Said plainly, because a review that only lists faults misstates the state of
this epic. The following were examined with intent to break them and held.

- **The Linkup error boundary** (`linkup.ts`). Body-code-first
  classification is correct and necessary; the live captures proving the 402
  X402 trap, the 401 wrong-key case, and the overloaded 429 are verbatim in
  `03-live-capture.md`, and the trap tests in `linkup.test.ts` would fail any
  regression to status-keyed reading. Substring matching on vendor codes is a
  sensible softness against rewording. The empty-key guard keeps a missing
  key off the wire entirely.
- **ADR 0035's open vocabulary paid off exactly as claimed.** The `trouble`
  kind cost one registry entry and words; `RunToolStep`, the validator
  (shape-only, verified at `profileLogicalProjection.ts:1453`), the trail,
  and the Result Card are untouched. The forward-compatibility reasoning is
  real: an unknown kind draws a truthful unlinked line.
- **`card.meta` as the persistence escape hatch** for depth and mode is the
  right move, verified against the validator's closed Card key set. The #960
  post-mortem (a control gated on a flag nothing set, caught because tests
  set the flag by hand) is recorded honestly and the fix, deriving the flag
  at all three write paths, is in the store.
- **The loop's mechanics.** Per-request reader state (indices restart per
  response), the delta-versus-whole argument accumulation, reasoning-detail
  merging, the answer-restart contract, abortable rate-limit waits, and
  cancel reaching the model fetch, the tool call, and the wait are all
  implemented as ADR 0036 describes and pinned by tests.
- **The keyless fallback is genuinely the shipped path**, byte-identical
  when no Eido toolset arrives, which is what makes it trustworthy.
- **The vendored upstream guidance matches the live vendor docs.** Four
  pages fetched fresh this review: depth semantics, fast's limitations, the
  standard-cannot-chain rule, renderJs advice, research modes, polling
  backoff, and failed-jobs-not-charged all agree with what the repo recorded.
  One divergence found, and it is Eido's choice not an error of record:
  Finding 6.
- **The evidence baseline discipline** (`04-evidence-baseline.md`) is
  unusually good: canonical scope named, the two wrong-scope traps that
  actually happened documented, host-load failures discriminated at the base
  commit per ADR 0028.
## Evidence run for this review

- `npx tsc --noEmit` at `21179ca0`: **clean, exit 0.**
- `npm test` (canonical scope) at `21179ca0`, run twice, both under a host
  saturated by other active lanes (another worktree's `tsc -b` at 65% CPU,
  load average around 30, exactly the condition
  `04-evidence-baseline.md` warns about):
  - First attempt: 42 failures across 26 files, with a
    `[vitest-pool-runner]: Timeout waiting for worker to respond` error.
    Read as host saturation, not code.
  - Second attempt: **3 failed of 3026 tests**, all in Electron suites this
    epic never touched: `electron/profilePortableZip.test.ts` (payload
    streaming), `electron/sqliteProfileRevisionStore.test.ts` (a 46-second
    test), `scripts/electron/profile-mcp-sea-after-pack.test.mjs` (macOS
    signing). None is in the epic's diff surface (`src/brain`, `src/canvas`,
    keychain contract, protocol policy).
  - The baseline's own rule is that discrimination needs a quiet host or a
    second checkout, and this session had neither. The honest statement is:
    nothing in the epic's own surface failed; the three residual failures are
    consistent with host load and outside the diff; and the baseline claim
    "`npm test` is green at the base commit" should be re-confirmed on a
    quiet host at epic close rather than taken from this run in either
    direction.
- Live vendor documentation fetched 2026-08-18: search best practices, search
  for-agents, fetch best practices, research best practices. Findings 6 and 7
  rest on it.
- No API key was requested, read, or used. No real Profile data was touched.
  Nothing was edited outside this report file.
