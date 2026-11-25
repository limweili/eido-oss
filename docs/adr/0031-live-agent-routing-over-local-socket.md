# ADR 0031: Live Agent Routing Over a Local Socket, Behind a Two-Transport Shim

Status: accepted

## Context

ADR 0026 admits external agents through one Agent Gateway and anticipates that
a gateway "either routes a request to the active owner or acquires … exclusive
Profile ownership," but the installed implementation only ever built the
second route: with the GUI open, agent mutations fail `busy`. Founder
direction (2026-07-22, agent CLI epic) requires the opposite out-of-box
experience — an agent working while Eido is open, changes appearing live on
the canvas. Separately, every CLI call today launches the full Electron
binary, which is too slow for interactive agent loops.

ADR 0026 rejected a listening TCP/HTTP port for the first release because of
bearer-token lifecycle, origin policy, open-port, and orphan-server risk.
That rationale is about network reachability, not about local inter-process
transport as such.

## Decision

The running Eido app owns one local IPC endpoint — a Unix domain socket on
macOS, a named pipe on Windows — created inside the installed profile root
with owner-only filesystem permissions plus a per-launch token handshake and
peer-credential checks. The endpoint carries versioned Gateway envelopes
only; the app stamps trusted actor/transport/client-transaction identity at
the commit seam exactly as the headless lease does. Request JSON can never
select transport or supply attribution.

The packaged `eido` command is a standalone Node SEA with two
transports behind one command surface. A colocated minimal native helper owns
the platform socket/pipe and peer-credential checks. The SEA uses that live
route when the app is running and falls back to the existing headless
exclusive lease through the packaged Electron binary only after endpoint
absence is proven before admission. The caller never chooses a transport.
Ergonomic responses report the selected route in versioned `cli` metadata.
Raw `eido batch` forwards headless input bytes verbatim and retains the
single-shot Gateway envelope, diagnostic, and exit contract without metadata;
the shim absorbs Electron's Windows-only leading CRLF before stdout.

Delegated AI execution is deliberately live-only. The CLI may submit an
OpenRouter-backed Conversation or non-Agentic Ask chain on the active Idea
either once or as 1–8 variations, then poll and read bounded artifact
references. Device-local harness commands cannot be bound into the Board
admission snapshot, and Agentic tool loops intentionally have no finite call
ceiling, so both fail closed until they can satisfy the same exact pre-admission
ledger. The request cannot supply a provider, credential, model, prompt,
Conversation style/turns, or output placement; those remain Board/app state.
Admission fingerprints that provider-facing state and reserves the
graph-derived worst case, including stale Group refreshes, Conversation turns,
and uncached context compactions. The same app-scoped queue serializes accepted
work. A brain-owned executor applies
the explicit admitted schedule through the ordinary runners, revalidates its
provider-facing inputs before every model egress, and returns exact owned
Run/output-version artifacts rather than asking the desktop adapter to infer
them from actor-wide graph changes. Active Conversation transcript/progress may
stream while its artifact identity and selected Result remain guarded. Graceful
shutdown drains execution and persistence before the final renderer checkpoint.
Proven endpoint absence never permits a headless Run.

Friends Alpha requires Apple Silicon macOS 13.5 or newer. The production app
declares and enforces that one product floor in its bundle metadata. Its
packaged `eido` SEA uses the Node executable that built it. Certification
checks the CLI and every nested Mach-O deployment target against the macOS
13.5 product floor.

Live mutation admission is a renderer/native authority barrier, not a refresh
notification. The renderer synchronously holds new GUI schedules and drains
pre-hold work before main enters the authority FIFO. Main then flushes its
scheduler, requires the renderer checkpoint to match, and admits at most one
globally serialized Agent mutation. After a durable commit the renderer
hydrates and applies that exact revision, acknowledges it, rebases the held
record-level GUI delta over the Agent snapshot, and only then releases and
drains the hold. Dry-run, replay without a new revision, and definite
pre-admission failure cancel the hold without hydration. Once utility mutation
dispatch begins, an ambiguous failure never cancels onto the old base.
Renderer progress that is intentionally non-durable mid-interaction—delegated
stream chunks and drag/resize frames—refreshes the held projection while the
barrier can still replace renderer state. Progress arriving after authority is
applied builds on the new base; capture does not turn a transient frame into an
independent durable commit.

Barrier phases use a per-cycle token and exact replay. Completion retries are
idempotent across hydrate, apply, acknowledgement, held-delta drain, and a lost
final ACK. Exhaustion withdraws all live admission and terminates the packaged
app rather than rewriting a durable Agent receipt or allowing held GUI work to
continue against uncertain authority. Shutdown first drains accepted complete
barrier cycles.

This amends ADR 0026's transport stance as follows: "no listening port"
remains binding for network transports (TCP/HTTP/LAN); a filesystem-
permissioned local socket is different in kind — no network reachability, OS-
enforced same-user identity, no origin or bearer-token lifecycle — and is
admitted for live routing only. Everything else in ADR 0026 (allowlisted
operations, validated batches, revision checks, one-writer authority) applies
unchanged over the socket.

## Considered Options

- Chosen: app-owned local domain socket / named pipe plus a two-transport
  shim, because it gives request/response and run-status polling naturally,
  makes live CLI calls milliseconds-fast (no Electron boot when the app is
  up), and keeps trusted attribution at the existing commit seam.
- Not chosen: Electron single-instance argv forwarding, because the channel
  is one-way (a response path must be invented), every call still pays full
  Electron startup, and streaming/polling shapes do not fit.
- Not chosen: file-based request/response, rejected with evidence in #598
  (stale projection, contention, attribution failures).
- Not chosen: localhost TCP/HTTP, for the unchanged ADR 0026 reasons.

## Consequences

- The residual threat is other same-user local processes; mitigations are
  owner-only permissions, the per-launch token, and peer-credential checks.
  Native reads of each client frame header and payload also have a fixed
  five-second monotonic deadline, so a same-user stalled or partial peer is
  disconnected without wedging later clients. These checks are certification
  scope for the epic, not optional hardening.
- The GUI must apply agent commits to the live renderer store (ADR 0016
  state-first semantics); live-apply becomes part of this epic's spine.
- The socket lifecycle follows app lifecycle. Graceful stop withdraws the
  locator before drain. After a hard parent crash, the native server withdraws
  its endpoint before the first pre-admission client observes disconnect; that
  client re-resolves exactly once and may fall back only after endpoint absence
  is then proven. A valid ready frame ends all retry/fallback permission. Two
  concurrent mutable authorities remain prohibited.
- A fixed macOS Profile path too long for `sockaddr_un` is structurally proven
  endpoint absence before admission. The shim may therefore try the headless
  lease; that lease still refuses `busy` if the GUI owns the Profile.
- Headless-only environments (app closed, CI) retain the existing certified
  single-shot path unchanged; the raw `--eido-profile-json` wire contract is
  untouched.
- The production-shaped macOS status route measured a 30.433 ms median and
  33.468 ms p95 across 200 sequential packaged CLI calls; the lower native
  transport seam measured a 6.342 ms median. The disposable method and limits
  are recorded in
  [`research/07-agent-cli/06-live-socket-latency-evidence.md`](../../research/07-agent-cli/06-live-socket-latency-evidence.md).
- Native exit 21 and an explicit token-denial frame are pre-admission
  rejections. Native exit 22 remains admission-unknown and forbids fallback;
  EOF alone is never evidence that a request was admitted.
- The macOS 13.5 floor is a package-level compatibility promise, not a request
  to rebuild upstream Electron or the local IPC helper with artificially higher
  deployment targets. Production packaging, public download copy, and hosted
  certification must nevertheless report that same floor.
