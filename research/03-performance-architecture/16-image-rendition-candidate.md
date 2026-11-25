# Visibility-aware image rendition candidate (#413)

Status: **prototype evidence only. Production default remains unchanged. No production migration is selected.**

## Reproduce

Capture: `VITE_EIDO_IMAGE_RENDITION_CANDIDATE=1 EIDO_IMAGE_RENDITION_MODE=capture npx playwright test --config playwright.performance.config.ts src/performance/imageRenditionCandidate.perf.ts`. Regenerate this report from the retained raw artifact with the dedicated Vitest report test.

Provider: github-actions; Chromium: Chromium 149.0.7827.55; commit: `f38a2907f362ff6ed042ba90513b48ed8cb8d17e`; source: https://github.com/limweili/eido/actions/runs/29364921426.

## Fixed contract and fixture

The candidate keeps one authoritative Card data URL and derives purpose/size keyed object URLs only in memory. Candidate-only PNG/JPEG references; legacy canonical SVG remains an authoritative fallback/readability case; canonical #402 evidence is unchanged. The deterministic `rich-card-board-v1` fixture covers 9 images with varied count, source dimensions, alpha, Card/display size, cold/warm cache, and settled/ordinary/fast camera movement. Production Reading/Overview/Map appearance, thresholds, occupancy, deadband, settle, and crossfades are untouched.

## Persistence and paste ingestion

- Canonical #402 stored compressed bytes: 2375; MIME mix: image/png=1, image/svg+xml=8.
- Candidate substituted stored compressed bytes: 143195; MIME mix: image/jpeg=4, image/png=5.
- Within-candidate cache integrity: stored compressed bytes 143195 before / 143195 after; Board JSON 548431 bytes before / 548431 after; authoritative references remained equal.
- Image persistence/storage impact is **unmeasured and confounded** because the candidate deliberately substitutes PNG/JPEG bytes for canonical SVG/PNG bytes. This evidence claims neither a persistence win nor a persistence loss.
- `snapshot.storedReferenceBytes` and `referenceSizes` are request-seen resolver bookkeeping, not authoritative Board storage; they may omit never-requested images, are unbounded, may undercount, and are not used for storage conclusions or treated as independently bounded.
- Board serialization: 2.30 ms; paste-batch serialization: 0.20 ms / 79776 bytes.

| paste sample | source | alpha | paste decode ms | encode ms | total ms | stored data-URL bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| alpha-1600x1200 | 1600×1200 | true | 51.4 | 42.0 | 93.5 | 41374 |
| opaque-2048x2048 | 2048×2048 | false | 19.7 | 15.6 | 35.3 | 28379 |
| alpha-640x360 | 640×360 | true | 1.9 | 14.7 | 16.6 | 9998 |

## Runtime decode, paint, readiness, and repeated traversal

The canonical baseline estimated 48.66 MiB decoded pixels from 2375 stored bytes. Candidate peak decoded residency was 7.34 MiB against a 8.00 MiB budget; peak derived rendition residency was 0.01 MiB against 2.00 MiB. Reference-aware LRU produced 52 evictions/revocations while repeated traversal remained bounded.

| repetition | camera choreography | cache | ready ms | paint/composite ms | decoded residency | rendition residency | cache growth | evictions | motion deferred | offscreen deferred |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | settled | cold | 297.0 | 19.1 | 7.18 MiB | 0.01 MiB | 5.70 MiB | 5 | 0 | 0 |
| 2 | ordinary-pan | warm | 1469.1 | 59.2 | 7.18 MiB | 0.01 MiB | 0.00 MiB | 15 | 0 | 0 |
| 3 | fast-pan | warm | 437.2 | 21.7 | 7.18 MiB | 0.01 MiB | 0.00 MiB | 24 | 0 | 0 |
| 4 | settled | warm | 274.9 | 20.1 | 7.18 MiB | 0.01 MiB | 0.00 MiB | 33 | 0 | 0 |
| 5 | ordinary-pan | warm | 1369.2 | 44.8 | 7.18 MiB | 0.01 MiB | 0.00 MiB | 43 | 0 | 0 |
| 6 | fast-pan | warm | 431.7 | 21.5 | 7.18 MiB | 0.01 MiB | 0.00 MiB | 52 | 0 | 0 |

The settled, ordinary-pan, and fast-pan labels demonstrate traversal choreography and timing comparisons only. They do not demonstrate execution of the resolver’s motion- or offscreen-deferral policy branches.

| Evidence | Raw source | Result | Claim boundary |
| --- | --- | --- | --- |
| Camera-regime traversal | traversal.cameraSpeed | 2 settled / 2 ordinary / 2 fast | Traversal/timing evidence only |
| Motion deferral | max(snapshot.motionDeferred) | 0 | No runtime policy-branch evidence on this fixture |
| Offscreen deferral | max(snapshot.offscreenDeferred) | 0 | No runtime policy-branch evidence on this fixture |

Both deferral counters remained zero in every retained snapshot. Current UI routing skips resolver requests for out-of-range `RenditionImage` instances and filters offscreen preload demands, so the offscreen zero is expected and is not branch-success evidence.

Cold median readiness was 297.0 ms; warm median readiness was 437.2 ms. Blank replacements were zero during the measured traversals. `offscreenSharperRenders` was also zero, but because `offscreenDeferred` remained 0, that observation is not evidence that the offscreen policy branch executed. Decode/resize work is request-driven and asynchronous; no encode/decode loop runs on requestAnimationFrame.

## Search, copy, and accessibility limitations

| Observation | Observed result | Measured scope | Unmeasured boundaries |
| --- | --- | --- | --- |
| Search | found `synthetic-alpha-square.png` | window.find over mounted visible synthetic asset-name text. | Image pixels and OCR.<br>Application semantic search.<br>Unmounted or offscreen asset indexing. |
| Copy | copied `synthetic-alpha-square.png` | Exact visible gallery caption DOM selection copied through a real browser keyboard copy gesture and read back from the granted synthetic-test clipboard. | Bitmap, data-URL, and image metadata copy.<br>Operating-system and cross-application interoperability. |
| Accessibility | 1 matching `image` node(s) named `synthetic-alpha-square.png` | Chromium Accessibility.getFullAXTree role/name match for a mounted synthetic image. | Real assistive-technology behavior.<br>Reading order, announcements, contrast, and zoom.<br>Complete keyboard and focus navigation. |

These synthetic observations pre-authorize no correctness or accessibility sacrifice. Unmeasured behavior is neither waived nor claimed compatible.

## Gallery and authoritative consumers

Gallery activation reached a derived `gallery` rendition in 1631.3 ms without changing the Card's 380×450 bounds. Hover/focus prepares the active path. Save/export and AI compatibility guards continue to assert the original Card `dataUrl`; no `blob:` or thumbnail reference entered Board JSON.

## Interpretation

On this fixture, **image rendering materially contributes at runtime**: decoded-pixel residency, derived rendition residency, paint/composite time, and cache growth are measured separately. Image persistence/storage impact remains **unmeasured and confounded** by the canonical-versus-candidate MIME and byte divergence. This is candidate evidence, not authorization to change the production renderer or default behavior; no production migration is selected.
