# Eido Agent CLI runbook

Status: source-aligned runbook for epic
[#711](https://github.com/limweili/eido/issues/711). The command contract below
is implemented; packaged evidence remains platform- and build-specific, so
live `eido describe` stays authoritative.

The post-epic chicken-research and CLI workflow extension is tracked in
[#1191](https://github.com/limweili/eido/issues/1191). Its disposable-board
evidence, research artifacts, and completion review remain follow-up work until
the branch is rebased onto current `main`, revalidated, and merged.

The `eido` command is the local, bounded interface to the installed Eido
Profile. It is for coding agents and humans who need to inspect or change the
founder's thought graph. It never accepts a Profile path, database handle,
storage credential, provider key, SQL, or generic patch.

## Free local access

The CLI and MCP are free and require no Eido account, entitlement, subscription,
or network check. Local ownership, bounded command validation, revision pinning,
and disposable proof-root rules still apply. Delegated AI execution uses the
user's configured provider access and retains its ordinary live-app restrictions.
See [ADR 0051](../adr/0051-free-open-source-byok-only.md).

## Install and verify

The Friends Alpha packaged product supports Apple Silicon macOS 13.5 or newer
and Windows 11 x64.

- macOS: in packaged Eido, choose **Eido → Install “eido” Command…** to place
  an executable launcher at `/usr/local/bin/eido`. Running the command again
  from the menu upgrades an older Eido symlink that points to this app. If an
  unrelated file occupies that path, the install stops with an error.
- Windows: the installer adds its package-owned CLI directory to the current
  user's `PATH`. Open a new terminal if an existing shell has not observed the
  environment update.

Verify from a directory outside the Eido repository:

```bash
command -v eido
eido
```

In PowerShell, use `Get-Command eido` for the first check.

The packaged command discovers the fixed installed Profile. `EIDO_DATA_FILE`
is only for browser development and does not select packaged Profile data.

## Start from discovery

A caller with no Eido context should begin here:

```bash
eido
eido describe --pretty
eido status --pretty
eido capabilities --pretty
```

Bare `eido` and `eido --help` print a short index: one line per command group
plus a pointer to `eido <group> --help`. Every subcommand answers `--help` at
any position (`help` and `-h` are synonyms), and leaf help prints the synopsis,
the options, and copy-pasteable examples. `eido --version` prints the build
version.

`eido describe` projects the Agent-facing Gateway registry without opening
Profile authority. Bare `eido describe` prints one summary line per operation;
`eido describe <operation>` prints that operation's full input schema, bounds,
mutating flag, and failures; `eido describe --full` restores the whole-registry
dump.

Canonical spellings are singular: `card arrange`, `card layer`, `changes list`,
and `agent capabilities`. The older `cards arrange`, `cards layer`, bare
`changes`, and bare `capabilities` remain accepted aliases.

A usage failure writes a machine-readable envelope to stdout
(`{"version":1,"requestId":null,"ok":false,"error":{"code":"cli.usage",...}}`)
and a human line to stderr that names the offending flag or value and prints a
correct example. stdout carries the outcome, so stderr is safe for a machine
caller to ignore. Discovery describes normalized Gateway fields; bare help documents
the ergonomic CLI flags that translate into those fields:

```bash
eido describe graph.query --pretty
eido describe command.batch --pretty
eido describe changes.list --pretty
```

Treat live discovery as canonical when this runbook and an installed build
differ. Do not infer an operation from a similarly named GUI action.

## Output contract

Ordinary reads and mutations write one normalized Gateway response to stdout:

```json
{"version":1,"requestId":"...","ok":true,"result":{},"cli":{"version":1,"servedBy":"live","live":{"state":"served"}}}
```

Failures keep the same envelope and use `ok: false` with a structured `error`.
Short diagnostics go to stderr; scripts must use stdout plus the process exit
code. Ergonomic request envelopes add only the versioned `cli` routing record
described below. `--pretty` changes indentation only and grants no authority.
`describe` emits the selected static registry object rather than a
request/response envelope.

`eido batch` is the compatibility path for one complete Gateway request on
stdin. It adds no `cli` metadata and does not accept `--pretty`. When endpoint
absence selects headless execution, the SEA forwards the original stdin bytes
and preserves the packaged single-shot Gateway envelope, diagnostic, and
process exit. Historical raw Mod envelopes remain replayable through this
compatibility path (and the unchanged exact-seven MCP adapter); current v5 Mod
work should use the ergonomic verbs below. On Windows the SEA absorbs
Electron's native leading stdout CRLF:

```bash
printf '%s' '{"version":1,"requestId":"inspect-1","operation":"profile.status","params":{}}' \
  | eido batch
```

Use ergonomic verbs for normal work. Use `batch` only when a multi-command
atomic request or exact envelope replay is genuinely required.

## Bounded reads

| Intent | Command |
| --- | --- |
| Profile readiness and revision | `eido status` |
| Agent-filtered capabilities and bounds | `eido agent capabilities` |
| List Ideas | `eido idea list [--limit N] [--byte-limit N] [--cursor C] [--projection FIELD]` |
| Query logical records | `eido graph query <one-or-more filters>` |
| Read one record | `eido record get RECORD_OR_CARD_LINK [--byte-limit N] [--projection FIELD]` |
| Read a Result closure and its Output/Version ids | `eido result inspect RESULT_OR_LINK [--idea IDEA] [paging options]` |
| Read one Mod as an ergonomic spec | `eido mod inspect MOD_CARD_OR_LINK [--idea IDEA]` |
| List Mod templates | `eido mod template list [list options]` |
| Read Agent-attributed changes | `eido changes list [--since REVISION] [--limit N] [--byte-limit N] [--cursor C]` |

`graph query` requires at least one filter. Repeat filters to form bounded sets:

```bash
eido graph query --kind card --creator agent --limit 20 \
  --projection id --projection kind --projection position \
  --projection createdBy --projection lastModifiedBy --pretty
```

Available graph filters are:

- `--creator agent|user`
- `--kind KIND`
- `--record ID` or `--card ID_OR_LINK`
- `--owner OWNER_ID`: match the exact logical-record `ownerId`
- `--idea ID_OR_LINK`: resolve the Idea, or the Idea portion of a Card Deep
  Link, to `board:<idea-id>` and match records owned by that canonical Board
- `--parent ID_OR_LINK`
- `--limit`, `--byte-limit`, `--cursor`, and repeatable `--projection`

`--idea` is not an alias for `--owner`. It scopes Board-owned records such as
Cards, Blocks, and Connections; it does not select the Idea record or Board
envelope. Use `idea list` or `--record IDEA_ID` for the Idea, and
`--record board:IDEA_ID` for its Board envelope. Raw `batch` and Gateway
`ownerIds` remain exact and perform no Idea-to-Board expansion.

Every page is pinned to one Profile revision and query shape. When a response
has `truncated: true`, pass its `nextCursor` with the same filters, projection,
and creator selection. `limit` and `byte-limit` may remain conservatively
unchanged. If the Profile changed, the cursor returns `conflict`; restart the
bounded read rather than mixing revisions.

## Card Deep Links are the handoff idiom

Quote deep links in a shell because they contain `&`:

```bash
eido record get 'eido://app/?idea=idea-main&card=card-anchor&x=800&y=300&zoom=1.2' \
  --projection payload --pretty
```

The `idea` and `card` identities are authoritative. `x`, `y`, and `zoom` are
stale-able viewport hints and are ignored by CLI identity resolution. A Card
Deep Link works anywhere a Card or Idea address is expected. When a raw Card
ID is used for a mutation, provide `--idea`; a deep link supplies both. An
explicit Idea that disagrees with the link is invalid.

A Connection ID is not a Card address and therefore cannot be replaced with a
Card Deep Link.

## Safe single-command mutations

The ergonomic mutation surface is:

```text
eido idea create NAME
eido idea activate IDEA_OR_LINK
eido card create --idea IDEA --kind note|askAi|title|group|conversation PLACEMENT [kind fields]
eido card update CARD_OR_LINK [--idea IDEA] UPDATE_FIELDS
eido card delete CARD_OR_LINK [--idea IDEA]
eido ask model CARD_OR_LINK --model MODEL [--idea IDEA]
eido card identity CARD_OR_LINK (--identity PRESET --fill soft|body|pattern | --clear) [--idea IDEA]
eido card arrange --idea IDEA --frames JSON
eido card layer front|back CARD_OR_LINK... [--idea IDEA]
eido group add GROUP_OR_LINK MEMBER_OR_LINK... [--idea IDEA]
eido group remove MEMBER_OR_LINK... [--idea IDEA]
eido result choose|accept|unaccept OUTPUT --version VERSION --idea IDEA
eido connection create FROM_CARD TO_CARD [--idea IDEA] [meaning options]
eido connection update-meaning CONNECTION --idea IDEA [meaning options]
eido connection delete CONNECTION --idea IDEA
eido mod create|inspect|configure|delete|connect|stamp ...
eido mod template list|inspect|create|configure|delete ...
```

`idea create` trims one bounded display name and atomically creates an inactive
Idea plus its canonical empty Board. Duplicate display names are allowed; use
the returned stable Idea/Board identities as authority. Creation deliberately
does not replace the user's active canvas, and a later pinned command batch
authors Cards inside the new Idea.

`PLACEMENT` is exactly one of `--x N --y N` or one or more repeatable
`--near CARD_OR_LINK` anchors. Kind-owned fields are:

| Kind | Create or update fields |
| --- | --- |
| Note, Ask AI, Title | `--body TEXT` (`--text` remains a deprecated alias where unambiguous, and prints a deprecation notice on stderr without changing stdout or the exit code) |
| Group | `--group-title TEXT`, `--compression-prompt TEXT` |
| Conversation | `--topic TEXT`, `--conversation-style debate|critique|interview|collaborate`, `--conversation-turns N` |

An update supplies exactly one field family. The historical
`--block BLOCK --text TEXT` update spelling remains replayable. Generated Result
content, Conversation transcripts, and follow-up answers remain Run/system
authored. Agents may choose an Output version, set or clear its accepted latch,
and delete a stale Result with its recorded cascade. Title Cards are spatial
labels and cannot be Connection endpoints. Connecting an unrun Ask AI Card to another
Ask AI Card follows the canvas rule: Eido creates an empty Result shell and
stores Ask → Result → Ask. The shell is reversible graph structure and contains
no Output version, Run, or generated content.

Organization commands compile to v5 domain mutations rather than generic
patches. `card arrange --frames` accepts exact JSON entries shaped as
`{"card":"ID_OR_LINK","x":N,"y":N,"width"?:N,"height"?:N}`. Layering accepts
`front` or `back`. `group add` moves each member into the named Group;
`group remove` clears explicit membership. Both accept a member set atomically.
Because adding an earlier member reframes the Group and may geometrically absorb
a later requested member, that reached intermediate membership is treated as a
successful no-op inside the same batch; a truly unchanged standalone mutation
still fails as invalid. Use `result inspect` to obtain the
stable Output and Version ids required by `result choose`, `accept`, and
`unaccept`.

Title Cards are spatial labels and do not accept `card identity`; coordinate
their neighboring Cards and Groups instead. `card identity` also accepts a Mod
Card. Selecting a preset updates both its
Card fill and its Mod accent to that preset's solid colour, matching the Mod
colour-well UI. `--clear` removes only the Card fill and keeps the existing Mod
accent. Preset assignment updates the Card and its one native Mod-instance
record atomically; clear leaves that instance record untouched. Neither form
changes direct or stamped provenance.

Mod creation and configuration accept an exact ergonomic v1 `--spec` with
`{version,kind,title,identity,treatment,state}`. The eleven kinds are `mixer`,
`filter`, `slider`, `dial`, `count`, `switch`, `pad`, `select`, `order`, `radar`,
and `matrix`; identity is one of the twelve names printed by bare help. `mod
inspect` returns a round-trippable `spec` plus derived prompt context. Keep
opaque nested ids from inspection for existing parts; omitting ids on growable
kinds allocates fresh parts. `mod create` always creates a direct Card and
instance. Template creation is deliberately separate as `mod template create`.
`mod create` and `mod stamp` may atomically add a `--connect-to` edge to an Ask
or Conversation. Standalone `mod connect` has the same Mod → Ask/Conversation,
`helps` rule with optional `strong|weak` strength. Mod data is inert; executable
content remains forbidden.

Meaning options are `--strength strong|weak`,
`--polarity helps|pushesAgainst`, `--reason TEXT`, and
`--group-mode full|compress`. `connection update-meaning` alone also accepts
`--clear-reason`.

## Large values from stdin or a file

Long JSON and multi-line text do not have to survive shell quoting or an argv
length limit. `--spec`, `--frames`, `--body`, `--text`, `--group-title`,
`--compression-prompt`, `--topic`, and `--reason` accept two value sources:

- `-` reads that flag's value from stdin;
- `@PATH` reads it from that file.

One trailing newline is removed from what is read. A doubled marker keeps a
literal expressible: `--` is the literal `-`, and `@@text` is the literal
`@text`. At most one flag per command may read stdin; a second `-` is a usage
error that names both flags. A missing, unreadable, or oversize file is a usage
error that names the path, the flag, and the actual size against that flag's
byte bound.

```bash
eido card update '<CARD_LINK>' --body @./draft.md \
  --expected-revision 12 --dry-run --pretty

jq -c . mod-spec.json | eido mod configure '<MOD_LINK>' --spec - \
  --expected-revision 12 --apply --pretty
```

Help never resolves these sources, and `eido batch` is unchanged: it keeps
consuming raw stdin as one whole envelope.

Every mutation must include both mandatory safety choices:

- `--expected-revision N` pins the intent to the Profile head you inspected.
- exactly one of `--dry-run` or `--apply` selects preview or commit;

With `--idempotency-key` omitted, the CLI derives the key from the fully
resolved command: the positional words in order plus every remaining option,
with the flags in a stable order. Envelope and formatting flags
(`--request-id`, `--command-id`, `--idempotency-key`, `--pretty`, help) are not
part of the intent and never feed the hash. Rerunning the exact same command is
therefore a safe replay that returns the original receipt instead of making a
second change; changing any value makes it a new operation with a new key.
Moving from dry-run to apply changes a value, so it is already a new operation.

An explicit `--idempotency-key KEY` still wins, and remains useful when a script
wants to name its own retry identity. Reuse such a key only for the
byte-for-byte same intent.

If a mutation times out and you do not know what landed, either rerun the exact
same command, or read `eido changes --since REVISION` with the revision
`eido status` reported before the mutation. The Gateway has no read that looks
up an idempotency key.

`--request-id` and `--command-id` are optional exact-envelope replay controls.
The trusted Profile owner mints client-transaction identity after transport
admission; neither ergonomic flags nor raw request JSON can forge it.

Example, assuming `eido status` reported revision `7`:

```bash
eido card create --idea idea-main --kind note --x 420 --y 180 \
  --body 'Agent draft' --expected-revision 7 --dry-run \
  --idempotency-key example-agent-draft-preview --pretty

eido card create --idea idea-main --kind note --x 420 --y 180 \
  --body 'Agent draft' --expected-revision 7 --apply \
  --idempotency-key example-agent-draft-apply --pretty
```

The dry-run reports the proposed effects without advancing the revision. The
apply commits only if revision `7` is still current. Repeating that exact apply
with `example-agent-draft-apply` returns the original receipt as an idempotent
replay. Never reuse a key for a different payload or mode.

After a `conflict`, read the current state, decide whether the intent still
applies, and dry-run a newly pinned request. The CLI deliberately has no hidden
retry loop.

> **One-way compatibility edge:** the first successfully applied surface-v5
> Agent mutation atomically widens the Agent ledger and writes a v5 history
> row. Merely opening, reading, previewing, conflicting, or exactly replaying a
> v4 Profile does not cross that edge. Eido builds whose SQLite Agent ledger
> admits only surfaces `{1,2,3,4}` cannot open the Profile after the first v5
> commit. Current Eido preserves exact historical v1–v4 replay; it does not
> translate old receipts into v5.

## Attribution, adoption, and change history

Agent commits are stamped at the trusted commit seam with actor kind, client
label, and session ID. Cards retain `createdBy` and `lastModifiedBy`. Records
without those fields predate this feature and behave as user-created work.

The default client label is `eido-cli`. Each `eido` process generates a fresh
session ID unless the host supplies `--agent-session ID` or
`EIDO_AGENT_SESSION_ID`; `--agent-client LABEL` and `EIDO_AGENT_CLIENT` control
the client label. Flags override environment defaults. A host that wants one
per-session budget across multiple commands must reuse a stable session ID.
Rotating it does not bypass the independent app-lifetime cap.

An Agent-created Card stays visibly accented while it has not been reshaped by
the user. The user's first ordinary edit adopts it visually by changing
`lastModifiedBy` to user; durable `createdBy` remains Agent so creator search
and history still find it. Agent commits never enter the user's GUI undo stack.
Reverse unwanted work with ordinary edits or deletion, informed by attribution;
there is no batch-revert command.

Use both current-state and history views:

```bash
eido graph query --creator agent --kind card --limit 50 --pretty
eido changes --since 7 --limit 50 --pretty
```

`changes` is newest first and includes revision, timestamp, actor, command,
Idea, record kind, change kind, position when applicable, and a Card Deep Link
for Card rows. Defaults are 50 items and 64 KiB; maxima are 200 items and
256 KiB. A cursor is bound to the Profile, head revision, and `since` value.

## Required live transport and fallback behavior

ADR 0031 fixes one command surface over two transports:

- while packaged Eido is running, the shim uses its owner-only local socket
  (macOS) or named pipe (Windows), and committed mutations appear on the open
  canvas;
- while Eido is closed, non-Run operations fall back to the existing exclusive
  headless lease;
- callers do not select a transport, and request JSON cannot claim one;
- raw `eido batch` adds no routing fields; its headless fallback forwards stdin
  bytes verbatim and preserves the Gateway envelope, diagnostic, and exit while
  normalizing Electron's Windows-only leading stdout CRLF;

Ergonomic Gateway responses add:

```json
{
  "cli": {
    "version": 1,
    "servedBy": "live",
    "live": { "state": "served" }
  }
}
```

When Eido is closed, a non-Run operation is `servedBy: "headless"` and `live`
is an exact pre-admission absence record: `state: "absent"`, reason
`locator-not-found` or `endpoint-not-found`, `admission: "none"`, and
`fallback: "headless"`. Run submit/status/read remain `servedBy: "live"` with
`fallback: "forbidden"` and return `live-app-required`; they never launch a
headless AI engine. Other live failures also never fall back: they return an
`internal` Gateway envelope with `servedBy: "live"`, `state: "unavailable"`,
`fallback: "forbidden"`, an admission of `none`, `admitted`, or `unknown`, and
one bounded reason (`locator-rejected`, `peer-rejected`, `token-rejected`,
`protocol-failure`, `transport-failure`, `disconnected`, or `client-error`). Treat
`admission: "unknown"` as mutation uncertainty. A headless spawn/response
failure after proven absence still emits correlated `internal` JSON with
`servedBy: "headless"` and the original absence evidence.

The client handshake and helper-exit bounds are five seconds; a served request
has a 30-second response bound. The native server independently evicts a
stalled or partial same-user peer after five seconds per frame header/payload,
so it cannot hold the single live route indefinitely. After a hard app crash,
the first client safely re-resolves once before any valid `ready` frame and may
fall back only after the endpoint is then absent. After `ready`, retry and
headless fallback are forbidden.

Live endpoint files and tokens are implementation details. Do not locate,
open, copy, or pass them to an agent. The transport restricts access to the
same OS user, checks peer identity, and performs a per-launch token handshake.
It is local IPC, not TCP, HTTP, LAN, or remote access.

## Spatial placement and reads

The shared graph layer computes `--near` placement inside the pinned commit, so
dry-run and apply choose the same deterministic position. An intervening move
makes the expected revision stale instead of silently changing placement.
Explicit `--x/--y` remains available when a caller already knows the position.

Read a bounded neighborhood or exact Card-set bounds with:

```bash
eido graph neighbors '<ANCHOR_LINK>' --limit 20 --byte-limit 65536 --pretty
eido graph bounds '<ANCHOR_LINK>' '<SECOND_LINK>' --pretty
```

`graph bounds` returns each requested Card's kind, position, and resolved size
alongside the aggregate rectangle. Default footprints are resolved once at the
authoritative spatial seam, so holistic layout review does not require one
headless CLI process per Card.

Create one connected thought atomically by combining `--near` with
`--connect-from`. The existing Card feeds the new Card:

```bash
eido card create --idea '<ANCHOR_LINK>' --kind note \
  --near '<ANCHOR_LINK>' --body 'A connected Agent thought' \
  --connect-from '<ANCHOR_LINK>' --strength strong --polarity helps \
  --expected-revision 7 --dry-run \
  --idempotency-key connected-thought-1 --pretty
```

Repeat the same intent with `--apply` and a new apply idempotency key. Both Card
and Connection commit in one batch or neither does. Repeat `--near` for multiple
anchors; discovery publishes the current anchor, neighbor, byte, and
bounding-set limits.

## Delegated runs and budgets

Delegated runs are live-only: packaged Eido executes with its ordinary engine,
active Board, model settings, and credentials. The CLI never receives or
forwards provider keys. The target must be an Ask AI or Conversation Card on
the active Idea. A plain submit makes one run. `--variations N` requests 1–8
independent outputs; model, prompt, style, Conversation turns, provider, and
output placement remain app-owned. Delegation currently admits only
OpenRouter-backed Conversations and non-Agentic Ask chains. Local harness
commands are device-local rather than bound into the Board admission snapshot,
and Agentic tool loops intentionally have no call ceiling, so neither can fit
the pre-admission model-call ledger. Ask variations heal the stale upstream
prefix once and then execute exactly the requested target count. Within each
scheduled step, stale compressed Groups refresh serially before the Ask; a
Group made stale again by an earlier target variation may therefore refresh
again for the later target. Admission reserves that serial worst case plus
every context summary that is uncached or could become necessary after an
earlier provider-produced Result or refreshed digest grows. Conversation runs
use the Card's participant order and turn setting with deterministic
existing-title/`Speaker N` labels. Immediately before every provider call,
Eido rechecks the live Idea, Result selections, and the exact admitted
provider-facing inputs. The accepted Run records structured Agent attribution
and exposes only the exact bounded Run/output-version references returned by
the engine, including preserved partial artifacts on cancellation or failure.

`eido describe run.submit` publishes the exact accepted union: either only
`ideaId` and `targetCardId`, or those two fields plus both
`mode: "variations"` and `variationCount`. Mode and count are never independently
optional.

```bash
eido --agent-client my-agent --agent-session work-42 run '<ASK_LINK>' --pretty
eido run '<CONVERSATION_LINK>' --variations 3 --pretty
eido run status RUN_ID --pretty
eido run read RUN_ID --limit 50 --byte-limit 65536 --pretty
eido record get RETURNED_RECORD_ID --pretty
```

Submission returns a queued Run identity. Poll `status` from the same or a
later CLI process while the same app lifetime remains open. Once terminal,
`run read` returns references only; use `record get` for the authoritative
records. There is no hidden wait loop and no model output in the bridge or
submission response. Closing Eido makes submit, status, and read return
`live-app-required`; they never launch headless AI.

Eido owns graceful Run shutdown. Quit first stops new Run admission and the
live route, best-effort cancels the active Ask/Chain/Conversation, drains every already-accepted
job and its persistence flush, and only then captures the renderer's final
Profile checkpoint and joins native shutdown. A CLI connection closing does not
cancel an accepted app-scoped Run.

Current implementation defaults are:

| Scope | Limit |
| --- | ---: |
| One Agent session | 100 submitted jobs |
| One Agent session | 500 planned model calls |
| One app lifetime | 1,000 submitted jobs |
| One app lifetime | 5,000 planned model calls |
| Retained sessions per app lifetime | 256 |
| Retained jobs for cross-process polling | 500 |
| Artifact page default / maximum | 50 / 200 items |
| Artifact page default / maximum bytes | 64 KiB / 256 KiB |

The active owner-default grant policy runs without a prompt. A first-run
approval policy exists as a dormant seam; it is discoverable but not active.
Budget admission is fail-closed: an accepted job consumes one Run plus its
worst-case admitted model calls, one for each admitted Ask and each distinct compressed
Group it could refresh. Rotating session IDs cannot bypass the app-lifetime
ceiling.

Core failure meanings include `live-app-required`, `invalid`, `not-found`,
`run-not-finished`, `budget-exhausted`, `grant-required`, `grant-denied`, and
`internal`. A terminal Run with no usable provider credential says so without
exposing credential material and directs the caller to configure Eido before a
new submission. App-closed execution says: “Open Eido to run AI. Headless agent
runs are not available.” Budget exhaustion says: “Agent run budget is exhausted.
Raise the cap or run from the app.” The dormant approval seam maps
`grant-required` to `busy` and `grant-denied` to `capability-denied`.

If submission returns `error.code: "internal"`, reason
`submit-outcome-unknown`, and `retryable: false`, **do not repeat the
submission**. The live app may already have admitted it. Inspect the app and
Agent change trail, then reconcile manually; a new `run.submit` is not an
idempotent status check.

## Gateway failure and process exit taxonomy

This table is the stable raw and ergonomic Gateway mapping:

| Exit | Error codes | Caller action |
| ---: | --- | --- |
| 0 | success | Consume the result. |
| 1 | `internal` or output/transport failure | Inspect status/head first. For `submit-outcome-unknown`, do not retry the submission. |
| 2 | `invalid`, `idea-remap-too-large`, or invalid CLI syntax | Fix the request; run `eido --help` or `eido describe <operation>`. |
| 3 | `capability-denied` | Stop. Inspect `reason`: the operation may be prohibited, the Run budget exhausted, or the active grant denied. |
| 4 | `busy`, `conflict` | Re-read/re-pin on conflict; open Eido for `live-app-required`; poll for `run-not-finished`; otherwise wait for owner/grant readiness. |
| 5 | `unsupported-future-version` | Upgrade Eido; do not write with the older build. |
| 6 | `not-found` | Recheck stable identity and the current Idea/Profile. |
| 7 | `corrupt-or-recovery-required` | Stop automation and use Eido's verified recovery flow. |

The `retryable` property in the discovered failure registry is canonical. An
`internal` result is uncertainty, not permission to blindly repeat a mutation
with a new idempotency key.

## Synthetic proof and private-data safety

Packaged Eido fixes its Profile beneath the OS app-data `Eido` root. Do not run
manual CLI proof from the founder's ordinary OS account: that would select the
real installed Profile. Use one of these authorities instead:

- `npm run desktop:smoke` for the automated unpacked, disposable-root package
  proof; or
- a declared disposable OS user whose fixed `Eido` root is absent, for the
  interactive founder walkthrough.

For local visual review during development, the unpackaged Electron entry also
accepts one deliberately narrow scratch launch:

```bash
EIDO_REVIEW_ROOT=$(mktemp -d "${TMPDIR%/}/eido-profile-proof-X")
npm run build
npm run build:electron
./node_modules/.bin/electron . \
  --eido-profile-proof-root="$EIDO_REVIEW_ROOT" \
  --eido-profile-review
```

The short direct-child name keeps the macOS Unix-socket path within its native
bound. `--eido-profile-review` is rejected by packaged Eido, requires an
explicit disposable proof root, and never redirects the installed Profile.
The Profile, blobs, and Electron `userData` all remain under that scratch root.
For this review launch only, Electron main internally derives the ordinary
`appData/Eido` device-credential root and exposes its credential through a
get-only facade; no argument, environment variable, CLI request, or renderer
payload can choose that path. Set, clear, and legacy migration fail closed, and
the credential is not copied into the scratch root or logical Profile.

Review execution is fixed to `openai/gpt-5.6-luna`. The policy is applied
before context budgeting and Run provenance for Ask, compressed Group,
Conversation, follow-up, speaker-name, and compaction calls, then asserted
again immediately before OpenRouter egress. Credential and model controls are
disabled for the review; ordinary launches and packaged disposable proof keep
their existing credential roots and model behavior.
Point the worktree proof CLI at the same root with its internal
`--eido-profile-proof-root=...` argument; live responses must report
`servedBy: "live"`. This is a development review surface, not an installation,
Portable Export, production recovery route, or permission to copy private data.
Stop the owning development app before removing its scratch root.

Do not copy a real Profile, WAL/SHM file, blob, Portable Export, owner sidecar,
Card content, provider key, or physical Profile path into tests or transcripts.
Do not set `EIDO_DATA_FILE` and mistake browser JSON for packaged authority.
The companion [founder walkthrough](eido-cli-founder-walkthrough.md) uses only
synthetic cards and a disposable identity.

This repository does not claim a completed real-provider walkthrough for this
epic: no disposable provider credential was available during source close-out.
The packaged harness proves discovery, transport, bounded reads, spatial
projection, mutation, and run refusal without executing a paid model. Fresh
paired macOS arm64/Windows x64 certification is still required whenever the
fingerprinted runtime changes; a local macOS run cannot substitute for Windows
named-pipe/compiler proof or hosted validation of the current Alpha signing
posture. Friends Alpha uses ad-hoc signing for the app and its nested
executables and ships an unsigned DMG; it makes no Developer ID, notarization,
or Gatekeeper-acceptance claim.

## Sources of truth

- Product intent: epic [#711](https://github.com/limweili/eido/issues/711)
  and close-out ticket [#722](https://github.com/limweili/eido/issues/722).
- Transport: [ADR 0031](../adr/0031-live-agent-routing-over-local-socket.md).
- Gateway and discovery: `src/persistence/profileAgentGateway.ts`.
- CLI planning and help: `electron/eidoCli.ts`.
- Command specs, help layers, and examples: `electron/eidoCliCommands.ts`.
- Value sources for `-` and `@PATH`: `electron/eidoCliValueSources.ts`.
- Derived idempotency key: `electron/eidoCliMutationKey.ts`.
- Standalone routing: `electron/eidoCliStandalone.ts`.
- Raw exit mapping: `electron/profileJsonCli.ts`.
- Attribution trail: `src/persistence/profileAgentChangeTrail.ts`.
- Delegated-run contract, admission, and caps: `src/brain/agentRunContract.ts`
  and `src/brain/agentRunSession.ts`; execution ownership:
  `src/brain/agentRunExecutor.ts`.
- Private-data boundary: [release profile](release-profile.md).
