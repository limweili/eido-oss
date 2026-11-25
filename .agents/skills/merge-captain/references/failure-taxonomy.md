# Landing failure taxonomy

| Observation | Meaning | Response |
| --- | --- | --- |
| Required check is missing or cancelled | Proof is absent, not green | Restore current proof or use a policy-authorized equivalent; never infer success. |
| Required check is genuinely red | The current change is unproven | Diagnose and repair; compensation cannot override a real red. |
| Optional or experimental signal is red | Its claim failed, but it may not gate landing | Investigate, report, and follow current repository policy without silently changing classification. |
| Readiness is unknown or computing | The state is not actionable yet | Wait and refresh; do not replace unknown with a guess. |
| Shared base moved or conflicts appeared | Earlier freshness claims expired | Refresh in isolation; mechanical resolution gets proportional reproof, semantic conflict escalates. |
| A dependent closes or breaks after base cleanup | A protected dependency was destroyed too early | Freeze, preserve remaining resources, and choose deliberate recovery before further cleanup. |
| Mutation command reports failure but live state shows success | The command and provider outcome diverged | Trust verified live state, then repair local cleanup separately. |
| User-owned workspace is dirty | Work exists outside this landing effort's ownership | Leave it untouched and report the preservation boundary. |
| Unrelated tests rotate under load | Likely capacity contention, not stable product failure | Run the narrowest discriminator, reduce concurrency, and avoid repeated full-suite retries. |
| Handoff and live state disagree | The handoff is stale | Re-derive, update the current plan, and continue from live truth. |
| Recovery adds more risk than the incident | The owner boundary has been reached | Stop with bounded facts, options, and a recommendation. |
| A layer's approval disappears after a lower layer merged | The cascading rebase tripped a review-dismissal setting | Re-request review on the affected layers, and fix the repository setting instead of re-approving every train. |
| A middle layer is ready but a layer below it is red | The merge set is unready, not the named change | Land up to the last ready layer, or repair below it; never retarget a layer to skip a dependency. |
| `gh stack sync` exits 0 reporting `Sync aborted` | Local and remote stack composition diverged and nothing moved | Reconcile the divergence before treating any branch in that stack as current. |
