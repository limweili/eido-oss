# Eido Research 2 - n8n Source Study

Repo inspected: `research/repos/n8n`  
Commit: `f412820f522ab8cc3aa42097b618b046cb000288`  
Primary docs used:

- [n8n Connections](https://docs.n8n.io/flow-logic/connections/)
- [n8n Data](https://docs.n8n.io/data/)
- [n8n Item Linking](https://docs.n8n.io/data/data-mapping/data-item-linking/)
- [n8n Expressions](https://docs.n8n.io/code/expressions/)

## Bottom Line

n8n is not the right product surface for Eido, but it is a very useful execution reference. It shows how to turn a graph of nodes and connections into run data, partial execution, waiting state, errors, item lineage, expressions, and replayable outputs.

Eido should study n8n's runtime ideas without copying its workflow-builder UI or source code. n8n's license is restrictive enough that it should be treated primarily as an architectural reference.

## Wireframe Fit

| Wireframe object | n8n fit | Notes |
| --- | --- | --- |
| `IDEA` | Workflow/project container analogy | n8n workflows are execution-first; Eido ideas are thought-first. |
| `THOUGHT` | Subgraph/run scope | A thought can become the selected execution or context subgraph. |
| `NOTE` | Not a native fit | n8n nodes are operational units, not editable notes. |
| Strong/weak edges | Partial fit | n8n connections are operational, not semantic/weighted by default. |
| Intermediate component | Strong execution analogy | A node can transform upstream inputs into downstream outputs. |
| Output stack `v3` | Run output/version artifact | Eido outputs should store provenance like n8n run data. |
| `MOD` bubble | Node, expression, or sub-workflow analogy | A MOD can be passive context or executable transformation. |

## Source Spine

The useful areas are:

- `packages/workflow/src/interfaces.ts` - workflow, node, connection, task, execution, and run-data types.
- `packages/workflow/src/workflow.ts` - in-memory workflow model, source/destination connection maps, expression helpers.
- `packages/core/src/execution-engine/workflow-execute.ts` - main execution loop, run state, node stack, waiting data, partial runs.
- `packages/core/src/execution-engine/partial-execution-utils/recreate-node-execution-stack.ts` - recreating execution stack from graph/run state.
- `packages/core/src/execution-engine/partial-execution-utils/directed-graph.ts` - directed graph abstraction over workflow connections.
- `packages/frontend/editor-ui/src/features/workflows/canvas` - workflow canvas and node-view references.
- `packages/frontend/editor-ui/src/views/NodeView.vue` - editor integration, canvas operations, connection creation, run data.

## What n8n Proves

n8n separates the authored workflow from execution state. A workflow has nodes and connections. A run has execution data, node execution stack, waiting data, source data, run data, errors, and status. That split is exactly what Eido needs if it supports "playback" over a thought graph.

The official docs describe a connection as a link from one node output to another node input. Eido's edges are broader than that, but execution edges can be projected from the same underlying graph.

n8n's data docs emphasize inspecting data at each stage and referencing previous data. That maps to Eido's output stack: each generated output version should know what context, modifiers, and inputs produced it.

Item linking is particularly relevant. n8n tracks metadata that connects output items back to input items. Eido should do the same for generated sentences, paragraphs, or artifacts: an output version should be traceable back to the note blocks and edges that influenced it.

Expressions are another important analogy. n8n uses expressions to reference prior nodes, workflow metadata, and environment data. Eido's `MOD` objects may need a safer, more humane version of this: reusable prompt fragments, constraints, rubrics, or lenses that can reference graph context.

## Eido Translation

Eido should probably have three different concepts that n8n tends to unify:

| Eido concept | Meaning | n8n analogy |
| --- | --- | --- |
| Semantic edge | "This thought influences that thought." | Not native; closest to node connection metadata. |
| Execution edge | "Run this after that." | Workflow connection. |
| Context edge | "Include this when generating from that." | Data dependency/reference. |

These should be views over one property graph, not necessarily three separate graph stores.

A possible Eido execution record:

```ts
type EidoRun = {
  id: string
  graphSnapshotId: string
  focusNodeId: string
  outputTargetId?: string
  status: 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed'
  steps: EidoRunStep[]
  compiledContextTrace: ContextTrace
}

type EidoRunStep = {
  id: string
  nodeId: string
  inputNodeIds: string[]
  modIds: string[]
  startedAt?: string
  completedAt?: string
  resultNodeIds: string[]
  error?: string
}
```

The key is that a run should operate on a graph snapshot. The live canvas can keep changing while an output version remains explainable.

## Partial Execution

n8n's partial execution utilities are one of the most useful areas for Eido. They reconstruct an execution stack from a directed graph, start nodes, run data, and pinned data.

For Eido, partial execution could mean:

- Generate only from the selected `THOUGHT`.
- Re-run an output stack from version `v2` to produce `v3`.
- Re-run only the downstream consequences of one changed note block.
- Preserve accepted outputs while regenerating uncertain branches.
- Simulate a MOD on one subgraph without rewriting the whole idea.

## What To Borrow

- The authored-graph vs run-state distinction.
- Run records with source/provenance metadata.
- Partial execution from a selected subgraph.
- Waiting state for incomplete inputs or human review.
- Error/retry concepts, but hidden behind a calmer product surface.
- Item lineage from inputs to outputs.
- Expression/reference concepts for MODs, redesigned for nontechnical users.

## What To Avoid

- Workflow-builder visual density in the default note-taking mode.
- Exposing "ports" and operational machinery too early.
- Treating every note as an executable node.
- Copying source code because the license is not permissive for Eido's likely commercial path.
- Letting execution semantics dominate the product before note-taking feels excellent.

## Open Questions

- Is a `MOD` passive context, an executable node, or both depending on mode?
- Does Eido need branching and merging in v1, or just context compilation plus generation?
- Should the user ever see an execution stack, or only output history and provenance?
- What counts as an error in an ideation app: failed API call, bad context, contradiction, missing source, or low confidence?
- When an output is accepted, does it become a note, an output version, or both?

