# Failure taxonomy — classify before reacting

| Class | Signal | Response |
| --- | --- | --- |
| **Product failure** | Direct behavior or invariant is wrong under a trustworthy repro | Keep it blocking; diagnose and repair the product path. |
| **Evidence failure** | The test or instrumentation observes a proxy, cannot fail on the bug, or contradicts its own claim | Repair or discard the evidence before changing product code. |
| **Capability failure** | The environment cannot run the required class of work | Record the capability once and choose another authoritative method; do not retry unchanged conditions. |
| **Capacity failure** | Unrelated tests rotate, time out, or fail only under contention | Serialize or reduce concurrency, run a narrow discriminator, and avoid treating local timing as product evidence. |
| **Coordination failure** | Ownership is silent, duplicated, stale, or lost across handoff | Freeze shared mutation, re-derive live state, name one current owner, and resume from preserved work. |
| **State-drift failure** | Tracker, plan, branch, or ledger disagrees with its live source | Treat cached state as stale and update only after re-deriving the authoritative fact. |
| **Decision-value failure** | More proof is being built after the question is resolved, or evidence cost rivals the change | Stop, preserve the minimum reproducible conclusion, and reslice toward the goal. |
| **Repeated-boundary failure** | Successive attempts add machinery but no new information | Change strategy or remove the unnecessary gate; do not build another layer by default. |

Human status questions are audit triggers: inspect every in-flight ownership
and claimed completion before repeating cached progress.

Apply a new lesson to the rest of the run immediately, but promote it into
durable guidance only after the placement and pruning test in `SKILL.md`.
