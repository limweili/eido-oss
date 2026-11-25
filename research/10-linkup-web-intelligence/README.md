# 10: Linkup Web Intelligence

Status: active. Opened 2026-08-18.

## The question

Eido's Agentic Runs reach the web through OpenRouter's server-side tools
(ADR 0033). That arrangement was measured after it shipped and found to hide
most of what it does: a page the model fetches never reaches the caller, so the
Card cannot say what it read. This track asks whether Linkup, a direct search,
fetch, and research API, should become Eido's primary web reach, with the
OpenRouter server tools kept as the fallback.

The short answer is yes, and the reason is structural rather than a matter of
taste: Eido makes the Linkup call itself, so Eido sees the query, the sources,
and the markdown. Nothing has to be inferred from a completion it cannot see
into.

## Documents

| Document | Holds |
| --- | --- |
| [01-api-surface.md](01-api-surface.md) | What Linkup is, endpoint by endpoint: parameters, response shapes, depths, prices, errors, rate limits, SDK, MCP server, security posture. Facts only. |
| [02-what-this-changes-for-eido.md](02-what-this-changes-for-eido.md) | What it means here: the evidence that forces the change, who runs the tool loop, the seams that move, what ADR 0035 already pays for, the fallback order, the cost problem, the spikes, and the open founder decisions. |
| [03-live-capture.md](03-live-capture.md) | The live capture behind `src/brain/linkup.ts` (#959): verbatim unauthenticated probes, where the wire contradicts the docs, and the keyed captures still outstanding, taken by [capture-keyed.sh](capture-keyed.sh) once a key exists. The abort-billing question lives there. |
| [04-evidence-baseline.md](04-evidence-baseline.md) | The three checks that fail at the base commit before this epic touched anything, pinned so no lane re-derives debt it did not create, plus the bundle budgets in force. |
| [05-loop-capture.md](05-loop-capture.md) | The tool loop's own capture (#961), outstanding until an OpenRouter key exists: whether reasoning must be echoed back with tool results and whether Eido's merged `reasoning_details` shape is accepted, answered by [capture-loop.mjs](capture-loop.mjs). |
| [06-adversarial-review.md](06-adversarial-review.md) | Independent review of the whole epic at `21179ca0`, against the code, the ADRs, the tickets, and four live vendor pages. Nine findings, what was checked and held, and a record-drift checklist for the close-out sweep. |

## What this track already settled

- Linkup's value is that the caller runs the call. Full trail, full markdown,
  multi-hop handled on their infrastructure.
- Taking it means Eido runs a client-side tool loop, which reverses ADR 0033.
  The reversal is earned by measurement, not preference, and needs its own ADR.
- It also means a second credential, which reverses ADR 0034. The keychain was
  built for this and needs one new slot.
- The tool trail shipped in epic #931 needs no structural change. ADR 0035's
  open step vocabulary absorbed the new kinds (`research`, `trouble`, and the
  thinking rows of #966) for the price of registry entries and words; the
  component itself gained only interaction polish (whole-row press, the address
  inside an opened read row).
- `api.linkup.so` accepts browser-origin requests with `authorization` and
  `content-type`, probed 2026-08-18, so Eido calls it from the renderer and
  needs no main-process bridge.
- The packaged app's CSP allows `https://openrouter.ai` and nothing else, and
  that string is pinned by a proof gate. Linkup needs a deliberate widening of
  it. The same probe surfaced a live bug: the Jina Reader host behind Web Notes
  is not allowed either, so pasted URLs should fail in the packaged build.

## How the open questions closed (epic close, 2026-08-18)

The three questions this track left open were all settled by founder direction
during the epic, together with two reversals of the epic's own early design.
The full record is ADR 0036 and ADR 0037; the dispositions in brief:

- **Research shipped in the first wave**, as the globe's third state rather
  than a depth notch. Only Research is warned about before submission, because
  a submitted job cannot be stopped or refunded, not because it is expensive.
- **Cost is not a constraint on this product** (founder, 2026-08-18). Cost is
  said once, in Settings, and never per run; the depth menu and the per-mode
  call budgets were removed with that reasoning, and all four research
  reasoning depths (S through XL) are exposed to the model, which chooses per
  call. The plan's "Study pinned to depth S" did not survive contact with the
  decision that motivated it.
- **Jina Reader stays** as the keyless reader behind pasted URLs. Two readers
  for two jobs: it works on a fresh install, Linkup fetch serves runs where a
  key already exists.

What the epic deferred, with its disposition:

- **Resuming a Study across an app restart**: not built. What is built is the
  prerequisite: the job id is written into `card.meta` at acknowledgement
  (`src/brain/researchJobMeta.ts`), so the handle to paid work survives a quit.
  Building resume is a future ticket for whoever first needs it; the id is
  waiting.
- **Persisting a run's depth as provenance**: retired along with the depth
  control. There is no per-Card depth to persist; the model's per-call choices
  are visible in the trail and, when enabled, in the Board Info wire record
  (#968). A follow-up reads the Card's current reach mode (ADR 0037).
- **Linkup's MCP server in the local harnesses**: documented, not automated.
  Those harnesses own their tools (ADR 0033); a user may add the server to
  their own CLI themselves.
- **The keyed live captures** in [03-live-capture.md](03-live-capture.md) and
  the loop echo capture in [05-loop-capture.md](05-loop-capture.md) remain
  outstanding: no key was ever placed in an agent's reach. The scripts are
  ready; the founder can run them in a minute when it matters.

## Provenance

Captured from `https://docs.linkup.so` on 2026-08-18 via the documentation
index at `https://docs.linkup.so/llms.txt`. The OpenRouter evidence quoted in
document 02 comes from a live 290-line SSE capture taken the same day against
the founder's own key, during epic #931.
