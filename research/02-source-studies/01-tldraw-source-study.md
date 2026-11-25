# Eido Research 2 - tldraw Source Study

Repo inspected: `research/repos/tldraw`  
Commit: `846e39a811fbaa43199d1e7e9a424413225a9f80`  
Primary docs used:

- [tldraw Store](https://tldraw.dev/sdk-features/store)
- [tldraw Bindings](https://tldraw.dev/sdk-features/bindings)
- [tldraw Culling](https://tldraw.dev/sdk-features/culling)
- [tldraw Rich Text](https://tldraw.dev/sdk-features/rich-text)
- [tldraw Frame Shape](https://tldraw.dev/sdk-features/frame-shape)

## Bottom Line

tldraw is the strongest candidate for Eido's canvas and document-store layer if the source-available/commercial license is acceptable. It already thinks in the right primitives: shapes, bindings, pages, records, schema migrations, reactive state, viewport culling, undo/redo, persistence, sync, and custom extensions.

The main unresolved fit question is not "can tldraw draw notes and arrows?" It can. The question is whether Eido can make line-level thought anchors feel native inside a note card while still keeping relationships as first-class graph objects.

## Wireframe Fit

| Wireframe object | tldraw fit | Notes |
| --- | --- | --- |
| `IDEA` | Page/document/root record | tldraw has pages and custom records. Eido may need an `Idea` record above pages or as page metadata. |
| `THOUGHT` | Frame-like custom shape | tldraw frames already model bounded canvas regions with contained children. |
| `NOTE` | Custom shape using rich text | Existing note shape is a useful reference, but Eido probably needs its own note block model. |
| Line/bullet ports | Partial fit | tldraw bindings attach shape-to-shape by default. Eido needs stable anchors inside note text. |
| Strong/weak arrows | Strong fit | Custom bindings can carry weight, type, polarity, and rendering metadata. |
| Output stack `v3` | Custom shape + custom records | The visible stack can be a shape; versions should be document records. |
| `MOD` bubble | Custom shape + semantic record | A modifier can be represented visually while carrying prompt/execution semantics. |
| View/action icons | App shell concern | tldraw can be embedded under custom UI. |

## Source Spine

The useful areas are:

- `packages/editor/src/lib/editor/shapes/ShapeUtil.ts` - base class for custom shape behavior.
- `packages/editor/src/lib/editor/bindings/BindingUtil.ts` - base class for relationship lifecycle behavior.
- `packages/tlschema/src/bindings/TLBaseBinding.ts` - binding records with `fromId`, `toId`, `props`, and `meta`.
- `packages/tlschema/src/shapes/TLBaseShape.ts` - base shape record with layout, parent, props, and metadata.
- `packages/tlschema/src/createTLSchema.ts` - custom records, validation, and schema migration hooks.
- `packages/store/src/lib/Store.ts` - reactive document store and history entries.
- `packages/tldraw/src/lib/shapes/frame/FrameShapeUtil.tsx` - frame behavior.
- `packages/editor/src/lib/editor/shapes/BaseFrameLikeShapeUtil.tsx` - frame-like containment behavior.
- `packages/tldraw/src/lib/shapes/note/NoteShapeUtil.tsx` - existing sticky-note implementation.
- `packages/tldraw/src/lib/bindings/arrow/ArrowBindingUtil.ts` - binding lifecycle for arrows.
- `packages/tldraw/src/lib/shapes/arrow/ArrowShapeUtil.tsx` - arrow rendering and binding behavior.

## What tldraw Proves

tldraw's store is not just a React state holder. The official docs describe it as a reactive database containing shapes, pages, bindings, assets, and custom records. It provides validation, migrations, persistence, undo/redo, sync, and indexed queries. That is highly relevant because Eido's graph needs long-lived records, not temporary canvas decorations.

Bindings are especially important. tldraw describes bindings as persistent relationships between shapes, stored as records with source, target, properties, metadata, lifecycle hooks, and efficient lookup. That maps closely to Eido's strong/weak arrows.

Frames are also close to the `THOUGHT` boundary in the sketch. A frame is a labeled container whose children can travel together, export together, and be clipped inside its boundary. Eido likely needs a more semantic version of that: a visible boundary that is also a saved context scope.

Rich text is based on TipTap/ProseMirror JSON. That matters because a note is not only a string. It can have a structured tree, which gives Eido a place to attach stable paragraph or bullet anchors.

tldraw also has viewport culling designed for large canvases. The docs state that culled shapes remain mounted but are hidden with `display: none`, while expensive geometry work is avoided through incremental derivations. This is the kind of practical canvas engineering Eido should not reinvent casually.

## Eido Translation

The most natural tldraw-shaped Eido model would look like this:

```ts
type ThoughtShape = {
  id: TLShapeId
  type: 'eido-thought'
  props: {
    title: string
    focusRules?: FocusRule[]
  }
}

type NoteShape = {
  id: TLShapeId
  type: 'eido-note'
  props: {
    richText: ProseMirrorJson
    blockAnchors: BlockAnchor[]
  }
}

type EidoEdgeBinding = {
  id: TLBindingId
  typeName: 'binding'
  type: 'eido-edge'
  fromId: TLShapeId
  toId: TLShapeId
  props: {
    fromBlockId?: string
    toBlockId?: string
    edgeType: 'supports' | 'contradicts' | 'constrains' | 'modulates' | 'feeds'
    weight: number
    polarity: 'positive' | 'negative' | 'neutral'
    hardness: 'soft' | 'hard'
    visibleLabel?: string
    executionMode?: 'none' | 'input' | 'dependency' | 'sequence'
  }
}
```

This keeps tldraw in charge of canvas interaction while making Eido relationships semantic enough for context compilation.

## The Line-Level Anchor Problem

The wireframe shows arrows attaching to specific lines or bullets inside a note. This is the most important technical design pressure.

There are two plausible models:

| Model | Description | Strength | Risk |
| --- | --- | --- | --- |
| Internal block anchors | A note is one shape. Its rich-text blocks have stable IDs. Edges store `fromBlockId` and `toBlockId`. | Keeps notes clean and editing natural. | Edge geometry must track text layout as blocks move, split, or merge. |
| Block-as-child records/shapes | Each paragraph or bullet is its own hidden or visible graph object. Edges attach to block records directly. | Makes graph semantics clean and durable. | Can make editing and selection much more complex. May leak implementation into UX. |

My research hypothesis: Eido should start with internal block anchors, but those anchors should be real document records rather than throwaway line numbers. A line number is too fragile; a block ID can survive editing.

## What To Borrow

- Shape utilities for `Thought`, `Note`, `OutputStack`, `MOD`, and possibly `BlockAnchor` affordances.
- Binding utilities for `EidoEdge`.
- Store schema and custom records for non-visual graph records.
- Migrations from day one. Thought graphs will live for years.
- Frame-like containment for `THOUGHT`.
- Rich text JSON as the note substrate.
- Culling and incremental derivation patterns.
- Collaboration/sync model if Eido becomes local-first and collaborative.

## What To Avoid

- Treating tldraw's default arrow as the semantic graph. It is visually close but too shape-bound for Eido's deeper model.
- Making every paragraph a fully selectable visible shape too early.
- Inheriting drawing-app complexity that does not serve note-taking.
- Depending on tldraw commercially before understanding license cost and product constraints.

## Licensing Risk

The local `LICENSE.md` is source-available, not plain MIT. It allows development use but requires a commercial license for production use. This is a business decision, not just an engineering decision.

Technical implication: tldraw can still be a major architectural reference even if Eido eventually builds its own canvas. But if the commercial license is acceptable, it may save a large amount of foundational work.

## Open Questions

- Is Eido willing to pay for and depend on tldraw commercially if it becomes the fastest path?
- Should `Thought` be one tldraw frame, a graph node, a saved query, or all three?
- Should a note's internal blocks be ProseMirror nodes with stable IDs, Eido custom records, or hidden child shapes?
- Should `MOD` be visually draggable like a card, or mostly referenced through an edge/control?
- Does execution need to be visible in the same canvas layer, or a separate mode over the same graph?

