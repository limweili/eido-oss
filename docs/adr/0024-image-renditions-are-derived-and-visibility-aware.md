# ADR 0024: Image Renditions Are Derived And Visibility-Aware

Status: accepted; production display resolver implemented 2026-07-19

Reconciliation note (2026-07-18): the [Reading-band architecture selection](../../research/03-performance-architecture/19-reading-band-architecture-selection.md) selects [#413's visibility-aware rendition policy](../../research/03-performance-architecture/16-image-rendition-candidate.md) as the companion to buffered rich-DOM residency. This resolves the runtime image direction without requiring an asset-to-blob or save-format migration. The measured budgets are provisional evidence thresholds, not universal device guarantees.

## Context

Eido's paste pipeline compresses images to a stored data-URL budget and a maximum edge length, which protects save size and upload/context payloads. It does not bound runtime image cost: compressed bytes can decode into a much larger pixel surface. Before #555, Card thumbnails and the full gallery both consumed that stored reference directly, so a Board with many images could retain large base64 strings, decode more pixels than were visible, and ask the browser to scale full reference images into small Card previews.

Excalidraw remains responsive with many images by separating scene records from cached decoded image state, culling offscreen paint, reusing settled raster work during motion, and invalidating image work only when needed. Eido should adopt those lifecycle principles without copying Excalidraw's scene model or making cached pixels a second source of truth.

## Decision

The saved Card asset/reference and its content remain authoritative, while every display-sized image is a derived **Image Rendition** managed behind one visibility-aware resolver:

1. Paste compression remains an ingestion and persistence safeguard; it is not treated as a rendering optimization.
2. Card thumbnails, passive Card renders, active Card views, and galleries request an appropriate display rendition for their purpose. Export and AI execution deliberately bypass disposable display renditions and continue to consume the authoritative saved reference directly.
3. The resolver chooses work from actual screen-space demand and settled zoom. During pan/zoom it keeps the last valid image visible, defers sharper upgrades until settle, deduplicates decode/resize work by asset identity and rendition key, and never performs encode/decode loops on an animation-frame path.
4. Offscreen and passive images do not eagerly resolve sharper variants. The preload-resident window may warm its bounded display rendition; a first-seen far-jump image may show its existing preview or placeholder while loading.
5. Decoded surfaces and derived renditions have explicit pixel/byte budgets, reference-aware eviction, and repeated-traversal tests. Active galleries and explicitly playing media may temporarily pin their display rendition. Export and AI execution consume the authoritative saved reference outside this evictable display cache.
6. Derived renditions are rebuildable caches, never graph truth. They must not multiply base64 copies inside the Board JSON. ADR 0004's records-and-blobs path remains the long-term storage seam for reference assets and optional persisted rendition blobs.
7. Existing saves remain readable. Moving current data URLs out of Card records is a separate, compatibility-gated storage migration; this decision allows the runtime resolver to improve before that migration.

### Production implementation

#555 made the existing purpose- and display-size-aware resolver the default CardAssets and ImageGallery display path. There is no production flag, staged enable, or alternate source of truth. A request initially renders the authoritative `CardAsset.dataUrl`, keeps the last valid visual during deferred or failed sharper work, and may replace it only with a rebuildable derived object URL keyed by authoritative reference identity, purpose, and size. Reference bytes, purpose, and size therefore invalidate display reuse without changing or serializing Card data.

The retained #413 diagnostic surface is observability only and does not control production behavior. #560/S7 completes the production lifecycle without adding a second cache: mounted `P ∪ O ∪ L` image consumers and the gallery hold resolver leases, bounded preloads warm then release them, and a `G` proxy alone never renders or pins an image. Gallery opening still uses #556's native pointer/focus activation and continuing first intent; the image layer adds no parallel interaction owner. Asset-to-blob migration #461 and saved-Board format changes remain external.

#754/F4 connects direction-aware passive residency to that same resolver without adding a second viewport query or cache. While the Board moves, the scene exposes the exact candidates from its existing direction-shifted spatial query; after Board and rendition motion settle, one browser-idle, single-flight batch warms the exact `passive-card` or compact `card-thumbnail` key that `CardAssets` will request. The idle callback rechecks motion before dispatch. The resolver still owns the eight-entry preload cap, 8 MiB decoded and 2 MiB derived budgets, reference-aware eviction, and release; no image-bearing Card scan or reference hash enters the navigation frame.

Shared rendition work records every live visual claim before decode/resize settles. An abandoned waiter therefore cannot make LRU trim revoke the object URL before another waiter adopts it. Reference invalidation marks the current generation stale, keeps it alive only for existing claims, serves new or late adopters from the authoritative saved reference, and revokes exactly once after the final claim releases. `reset()` follows the same last-reference rule; only resolver disposal force-revokes as explicit teardown. Production snapshots expose active and pending pins, pinned and invalidated entries, budget-blocked trims, and invalidation deferrals alongside the existing decoded bytes, derived bytes, request, reuse, eviction, revocation, and timing counters.

### Selected evidence, authority, and release

#413 measured 7.34 MiB peak decoded residency, about 0.01 MiB peak derived-rendition residency, and 52 reference-aware eviction/revocation events in its synthetic traversal. Retain its 8 MiB decoded and 2 MiB derived-rendition gates as provisional evidence thresholds for production sequencing. They are not universal budgets: the prototype did not exercise its motion or offscreen-deferral branches, did not observe native decoder/compositor/GPU residency, and its persistence result was confounded by substituted fixture MIME/bytes.

#560 reuses that retained plateau and the unchanged production budgets rather than repeating loaded-host timing. The direct resolver seam now exercises offscreen and motion deferral, bounded repeated traversal, shared pending/adopted claims, invalidation fallback, and last-reference revocation. Paint/composite and native decoder, compositor, GPU, and upload residency remain externally measured or `not-measured`; resolver byte and timing counters do not impersonate those signals.

Rendition demand is keyed by the authoritative saved asset/reference, purpose, and display size. A viewport-visible, preload-resident, or Live visual consumer may pin the needed rendition; an active editor is already a Live owner. A gesture proxy alone never pins image residency unless the same Card also has a visible, preload, or Live visual consumer. Object URLs are revoked only after the last visual reference and every owner pin clear, then decoded and derived budgets use reference-aware LRU. The saved asset/reference itself is never evicted by this runtime policy.

Compressed storage bytes are persistence accounting, not asset identity, runtime ownership, or proof of decoded cost. Production evidence must separately report compressed storage bytes, source decoded-pixel residency, decoded derived-rendition residency, paint/upload cost for the representation actually drawn, and cache growth, reuse, eviction, and revocation across repeated navigation. Derived keys, object URLs, decoded surfaces, and eviction metadata are disposable projection state.

## Considered Options

- Chosen: one authoritative reference plus purpose-sized, visibility-aware derived renditions with bounded decode residency.
- Not chosen: relying on compressed file size alone; a small JPEG can still decode into millions of pixels.
- Not chosen: using the full stored reference for every thumbnail and passive Card because the browser can scale it; that spends decode and texture memory independently of visible size.
- Not chosen: persisting several base64 renditions inside each Card record; it reduces some decode work by worsening Board payload, invalidation, and save cost.
- Deferred: the exact codec, worker/off-main-thread boundary, blob store, browser image primitives, and whether selected renditions merit persisted sidecars. Production slices may choose them only from direct paste latency, decode, camera-motion, settled-sharpness, memory, and save-cost evidence.

## Consequences

- The rich-card performance upgrade includes image-heavy fixtures and a dedicated image ingestion/render/residency lane; images are no longer deferred automatically behind text rendering.
- Performance reports distinguish compressed storage bytes, source pixel dimensions, source decoded-pixel residency, derived-rendition residency, visible image count, paint/upload cost, cache growth/eviction/revocation, and first/settled readiness.
- Gallery and active-Card images remain crisp after settle. During fast navigation an existing lower-resolution rendition may be briefly softer, but it remains present.
- AI execution and export continue to receive the authoritative saved reference, never an accidental thumbnail, object URL, or evictable cache entry.
- ADR 0004 remains accepted and supplies the future blob boundary; ADR 0010's massive-Board gates now include image count and decoded-pixel pressure.
- Motion/offscreen deferral, far-jump readiness, gallery focus, link/keyboard behavior, and accessibility completeness remain production gates where applicable. Unmeasured branches are not encoded as zero loss.
