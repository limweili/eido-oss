# 05 — The AI Context Engine (Eido's Core)

> This is the document the original research prompt was missing. The prompt was 90% about rendering and collaboration — but by your own idea doc, *"the product is a mindmap that powers AI context."* The canvas is the interface; **this** is the product. Almost all of Eido's defensibility lives here.

Everything below is the part you **cannot buy off the shelf**. tldraw/React Flow/Yjs are commodities. The "graph → context → generation" engine is the IP.

---

## The central problem, stated precisely

Given a user's graph of notes (nodes) and connections (typed, weighted, possibly negative edges), and a *focus* (a node, a selection, or a "play this path" instruction), **deterministically compile the right slice of the graph into an LLM context window** — honoring the user's subjective connection weights — so the model "reads their mind" and *accelerates* rather than *replaces* their thinking.

This is a **context-compilation** problem, not a "call the API" problem. Three sub-systems:

1. **Graph model** — what a node/edge *is* and what metadata they carry.
2. **Context compiler** — graph subgraph → ordered, budgeted text payload.
3. **Execution model** — turning paths/automations ("playback") into agent runs.

---

## 1. The graph model

Your idea doc already specifies the hard requirements. Naming them as a data model:

- **Node** = a note / fragment / "thought component." Carries: text content (rich), embedding vector, tags, created/modified timestamps (for the evolution timeline), and a "crystallized" flag (your *modular thought components — think once, use everywhere*).
- **Edge** = a connection with:
  - **weight** (continuous, subjective, user-set via slider — "vibes-based"),
  - **sign** (positive / **negative** — negative connections as *constraints*, a genuinely novel primitive — most graph-RAG systems have no concept of this),
  - **type** ("hard" vs "soft" connection; supports/contradicts/derives-from/varies),
  - optional **direction** (influence flows one way, or mutual).
- Must scale to **hundreds of connections per idea**.
- **2.5D depth = variants.** Model depth as a `variant` axis on a node-cluster: the top layer is the selected option; lower layers are alternatives. This is just another edge type (`variant-of`) plus a z-ordering — you don't need true 3D rendering.

> **Key insight:** edges in Eido carry *more* semantic load than nodes. The whole value prop is that the **user's weighting of connections** is information the AI can't infer. Treat edge metadata as first-class, versioned, and central to the context compiler.

---

## 2. The context compiler (the crown jewels)

This is where to spend your hardest engineering. The research on weighted knowledge graphs gives you proven mechanisms; you assemble them into something explainable.

**Core algorithm sketch (deterministic, explainable — the recommended starting posture):**

```
compileContext(focusNode, tokenBudget):
  frontier = graph traversal outward from focusNode
  for each reachable node n:
      relevance(n) = f( edgeWeights along path,
                        edgeSign (negative edges subtract / become constraints),
                        distanceDecay,         # exponential decay by hops
                        recency,               # idea-evolution timeline
                        node.crystallized? )   # boost reusable components
  select nodes greedily by relevance until tokenBudget is hit
  partition into:  CONTEXT  (positive, supporting)
                   CONSTRAINTS (negative edges → "avoid / must not")
  serialize to a structured prompt (sections, not a blob)
```

Grounding in the literature (so you're not inventing from zero):

- **Distance/decay + radius:** relevance as a *weighted sum of edge weights with exponential decay by graph distance*, using a "radius" sphere around the focus node — this is a documented technique ([USPTO 11948099 / 11126919 on KG weighting in sessions](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11948099)).
- **Edge-weighted PageRank / centrality** to rank which connected thoughts matter most globally ([TransRW](https://gengchenmai.github.io/papers/2018-EKAW18_TransRW.pdf)).
- **Semantic Top-K on edges** — select most relevant connections by embedding similarity when the graph is dense ([SIGIR WeightE](https://dl.acm.org/doi/10.1145/3539618.3591784)).

**The deterministic-vs-semantic fork (a real product decision, flagged in [README](README.md)):**
- *Deterministic/explainable* — relevance is a transparent function of the user's own weights + distance. Pros: predictable, debuggable, the user feels *in control* (matches "accelerate not replace"). Cons: more manual.
- *Semantic/automatic* — embeddings + similarity auto-surface relevant nodes the user didn't connect. Pros: magic "reads my mind" moments; auto-suggested connections. Cons: can feel like it's "doing it for you" / introducing slop — the exact failure mode you named.
- **Recommendation:** start deterministic and *explainable* (honor the user's weights literally; show them what was included and why), and layer semantic suggestion as an *opt-in assist* ("connect this with the thought from yesterday" = embedding search), never as silent context injection. This directly serves your "effortless = precise, never replaces intent" principle.

### Do you need full GraphRAG? Probably not at first.

GraphRAG (entities→nodes, relations→edges, community summaries) is designed to extract a graph *from documents you don't control*. **Eido's user is hand-authoring the graph** — you already have clean nodes and meaningful edges. That's a massive head start; most of GraphRAG's machinery is about *building* the graph you already have.

What to borrow from that world:
- **GraphRAG** (Microsoft) — community detection / hierarchical summaries: useful later for "zoom out and summarize this whole region of my canvas."
- **LightRAG** (Oct 2024) — dual-level retrieval at **~10x token reduction** vs GraphRAG ([awesome-graphrag](https://github.com/DEEP-PolyU/Awesome-GraphRAG)). The efficiency mindset to copy.
- **Hybrid retrieval** is the 2025–26 production consensus: vector + graph traversal + structured lookup, routed by query type ([medium/branzan](https://medium.com/@claudiubranzan/from-llms-to-knowledge-graphs-building-production-ready-graph-systems-in-2025-2b4aff1ec99a)). Eido's compiler is essentially a *user-weighted* version of graph traversal.

**Tech for the semantic layer:** a vector store for node embeddings — start with an in-process/local option (e.g. `sqlite-vec`, LanceDB, or even in-memory + cosine for small graphs); a graph store is optional early (an adjacency structure in your CRDT is enough; reach for a real graph DB only at large scale).

---

## 3. The execution model — "playback" & automations

Your most original idea: **the runtime of an agent is dictated by the playback of a thought-path through the canvas.** Your examples — series validators (novel→feasible→impactful), parallel personas (Marketing Mark / Legal Larry), the auto-debate bounce loop — are all *graph execution topologies*.

The closest existing mental model is **node-based LLM orchestration**, and the key realization is: **Eido's canvas graph and its automation graph can be the same graph.**

| Tool | License | Relevance to Eido's "playback" |
|------|---------|-------------------------------|
| **LangGraph** | MIT (OSS) | Graph as a **state machine**: nodes = steps, edges = transitions, supports loops/branches/parallelism. The right *semantic model* for playback (series, parallel, the debate-loop). Code-first; steal the execution semantics, not the UI. |
| **Flowise / Langflow** | OSS | Visual node-based agent builders (built on React-Flow-like canvases). Proof that "canvas + node = agent pipeline" is a usable UX. Flowise's "Agentflow" = multi-agent orchestration. |
| **Rivet** | OSS | Local, visual, debugger-style node graph for LLM chains — good UX reference for *watching* a thought play back. |
| **ComfyUI** | OSS | Image-gen, but the **gold standard** for "a node graph people actually enjoy operating," with reusable subgraphs (≈ your crystallized thought components). |

### Your open question: how is this different from agent harnesses / subagents / prompt-chaining?

The honest answer from the research: **the execution mechanics are NOT differentiated** — LangGraph/subagents/tool-chaining can produce the same outputs. So Eido must win on the dimensions you already identified:

1. **Speed of imparting taste.** The graph IS accumulated, reusable context. You don't re-prompt; you connect. Each crystallized component is taste, captured once, reused forever. A subagent harness starts cold every session — your doc nails this.
2. **Adherence to intent.** Weighted + negative connections are a *continuous, spatial* control surface over the model's behavior that a text prompt can't express as fluidly. The slider is the differentiator, not the LLM call.
3. **Feedback loop latency.** Real-time spatial manipulation ("I've shaped my thought 100 times before a response generates") vs request/response. The canvas is the interaction model; the agent run is incidental.
4. **It's a thinking tool, not an automation tool.** Automations are a *mode*, not the point. (Your own answer — correct.) The output is text, but the *durable artifact is the evolving graph itself.*

> Practical implication: don't try to out-LangGraph LangGraph. Build the **thinnest possible execution layer** on top of your graph (series/parallel/loop over nodes, each node = a prompt-with-compiled-context), and pour your effort into the **context compiler** and the **real-time manipulation feel.** That's where you win.

---

## Recommendation

1. **The graph model and context compiler are your core IP — build them, don't buy.**
2. **Edges are first-class:** weight + sign + type, versioned. Negative edges → constraints is a differentiator; design it in from the start.
3. **Start deterministic & explainable**; add embedding-based *suggestion* as opt-in assist, never silent injection.
4. **Don't adopt heavyweight GraphRAG** — the user authors the graph, so you skip extraction. Borrow LightRAG's token-efficiency mindset and hybrid-retrieval routing.
5. **Playback = a thin graph-execution layer** modeled on LangGraph semantics, sharing the canvas's node/edge primitive. Compete on taste-capture, weighting, and feedback-loop speed — not on orchestration plumbing.
6. **Models:** target the latest frontier models for the generation step; the compiler is model-agnostic. Keep the LLM call swappable behind your own context payload.
