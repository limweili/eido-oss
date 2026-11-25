# Eido Research 2 - Founder/CTO Summary

## The Big Picture

The strongest architecture for Eido is not "a canvas app with notes on it." It is a graph-native note-taking app where the canvas is one way to see and shape the graph.

Your wireframe is important because it shows the core idea clearly:

- Notes are not isolated cards.
- Individual lines inside notes can matter.
- Connections have strength and direction.
- Outputs are versioned.
- MODs are reusable thinking operators.
- A Thought is a bounded working context, not just a folder.

That points toward one underlying property graph with three views:

| View | User meaning | Technical meaning |
| --- | --- | --- |
| Canvas graph | "What I see and arrange" | Notes, frames, arrows, layout, selection, zoom. |
| Semantic graph | "What matters for this idea" | Weighted context, constraints, influence, contradiction, relevance. |
| Execution graph | "What gets run or regenerated" | Runs, output versions, MODs, dependencies, provenance. |

## Project Findings

### tldraw

tldraw is the best candidate for the visible infinite canvas. It already has custom shapes, custom bindings, a reactive store, schema migrations, rich text, frames, culling, persistence, and collaboration-oriented architecture.

The big question is licensing and fit. tldraw is source-available and commercially licensed for production. Technically it is strong, but Eido must decide whether that dependency is acceptable.

The hardest product fit is line-level anchors inside note cards. Eido needs arrows to attach to bullets or paragraphs, not only to the outside of a card.

### Excalidraw

Excalidraw is a great reference for lightweight rendering and simple canvas UX. It is MIT licensed and technically elegant.

But it is drawing-first. Its arrows and bindings are visual objects. Eido needs relationships to be semantic objects. Excalidraw is valuable to study, but less likely to be the core Eido engine.

### n8n

n8n is not the UI model for Eido, but it is extremely useful for execution. It shows how a graph becomes a run, how partial execution works, how outputs track inputs, and how previous data can be referenced.

Eido should borrow the architectural idea of separating the authored graph from run state. It should not inherit n8n's visual density or workflow-builder feel.

### Neo4j

Neo4j is the best mental model for Eido's data. Nodes and relationships both have properties. Relationships have type, direction, and metadata. That is exactly what Eido's strong/weak arrows want to be.

But Eido probably should not ship Neo4j directly. It is too heavy for the early product and carries license/operational complexity. The right move is to use property-graph ideas in Eido's own local data model.

## The Core Technical Bet

Eido's core IP is probably the context compiler.

That means: given a selected note, thought, output, or MOD, Eido can decide what context matters, what should be ignored, what constraints apply, and why.

A simple version could:

1. Start from the selected object.
2. Follow strong and weak edges outward.
3. Include hard constraints.
4. Treat negative/contradictory links separately.
5. Rank context by edge strength, distance, recency, and user intent.
6. Generate an output version with a trace of what influenced it.

This is the difference between Eido and a canvas with AI buttons.

## Biggest Design Risks

| Risk | Why it matters |
| --- | --- |
| Treating arrows as decoration | Then Eido loses the semantic graph. |
| Making every note an automation node | Then Eido becomes too technical and loses note-taking ease. |
| Ignoring line-level anchors | Then the wireframe's strongest idea becomes impossible. |
| Letting AI output float outside the graph | Then versioning and provenance collapse. |
| Choosing a canvas engine before graph vocabulary | Then Eido may inherit the wrong primitives. |

## Best Current Hypothesis

The strongest path to explore next is:

- Use a property-graph model as the conceptual core.
- Treat notes, note blocks, thoughts, MODs, outputs, and output versions as graph nodes.
- Treat strong/weak/negative/context/execution links as first-class relationships.
- Use tldraw as the leading canvas candidate if the license works.
- Use Excalidraw as the reference for simplicity and rendering performance.
- Use n8n as the reference for runs, partial execution, and output provenance.
- Use Neo4j as the reference for graph modeling and algorithms, not as a shipped database.

## Questions For Your Review

- Are line-level anchors essential for the first real version, or can v1 start with card-level edges and graduate to line-level edges?
- What does a MOD mean to you first: persona, prompt, constraint, rubric, automation, or something else?
- Should output versions be mostly AI generations, human-edited artifacts, or both?
- Does a `Thought` feel more like a frame on the canvas, a saved context query, or a project section?
- Are you open to a commercial tldraw license if it becomes the fastest path to a great editor?

