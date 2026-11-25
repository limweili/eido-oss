# ADR 0013: Execution Plans As Data

Status: accepted

## Context

Running AI over the graph is currently one shape: compile a card's connected thought, stream one completion, record provenance (`brain/runEngine.ts`). The product direction is bigger: multi-hop runs, chains of reasoning that follow the graph, and eventually the app doing agentic heavy lifting for the user. n8n is a reference point for how workflow systems stay extensible: what a step is and what it needs is described as versioned data that tools can read without executing code.

## Decision

Execution is described by a plan: a small, versioned, serializable piece of data that says which steps run, over which cards, in what dependency order — derived from the graph, before anything runs. Executing is applying a plan: each step reads its inputs through the context layer (ADR 0012), produces outputs/versions with full provenance (ADR 0008), and its results re-enter the graph, where they become context for later steps. Today's runs (ask, conversation, group compression, follow-up) are single-step plans; multi-hop and chained execution are longer plans of the same shape, not a new system. Step kinds form a small closed registry that grows deliberately.

## Considered Options

- Chosen: plans as versioned data over the existing run engine; single-step today, multi-step later.
- Not chosen: hardcoding each new execution shape as another bespoke runner function.
- Not chosen: adopting an external workflow engine.
- Later: multi-step plans with dependencies, plan preview UI ("what will run"), pausing/resuming, persisting plans on runs once multi-step exists.

## Consequences

- Product: users will be able to see and trust what is about to run, and chains of reasoning stay explainable step by step.
- Engineering: the run engine gains a plan/execute split; new execution features add steps or plan builders, not new engines; plans stay lean (IDs, not copied content) so history and saves do not bloat.
- Trade-off: a layer of indirection for today's simple runs, accepted to avoid rewriting execution when chains arrive.
