# 02 — Languages, Runtimes & Application Shells

Your language/runtime choice flows from one upstream decision: **web-first or native-first?** Everything else follows.

## TypeScript / JavaScript — the default, and probably right for Eido

- The entire infinite-canvas ecosystem is TS: **tldraw, Excalidraw, React Flow, PixiJS, Konva, Fabric, Yjs, Automerge, TipTap.** Choosing anything else means leaving this ecosystem on the table.
- Browser is the universal runtime; ships everywhere instantly; easiest collaboration (WebSocket/WebRTC) and AI-API integration story.
- React specifically is the lingua franca here (tldraw and React Flow are React-first). Svelte/Vue are viable (Svelte Flow exists) but with smaller canvas ecosystems.
- **Verdict for Eido:** TypeScript is the spine regardless of shell. The question is only what you wrap it in.

## Rust (+ WebAssembly) — a performance scalpel, not a foundation

- Compile Rust → Wasm to run hot paths (spatial math, geometry, force-directed layout, large-graph traversal, CRDT cores) at near-native speed in the browser.
- **You already consume Rust-via-Wasm whether you know it or not:** the fastest CRDT, **Loro**, is Rust/Wasm; Automerge's core is Rust; Yjs has Rust ports.
- **Don't write your app in Rust.** Write it in TS and *drop to Rust/Wasm only for a measured bottleneck.* Premature Wasm is a velocity killer for an idea-stage product. Note Wasm's main cost is initial load/instantiation time (the one category Loro loses on — [pkgpulse CRDT 2026](https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026)).
- Realistic Eido use: graph layout engine and context-subgraph extraction *if* graphs get huge. Months away.

## C++ / Swift / Kotlin — only if you abandon the browser

- Native canvas (Metal/Skia on Apple, Direct2D/Skia on Windows) gives the absolute best rendering and pen/ink latency — relevant if handwriting input ever became core (you scoped it *out*).
- Cost: you abandon the entire web canvas ecosystem and build everything (rendering, hit-testing, text, layout) from scratch, per-platform. Enormous.
- **Verdict:** out of scope unless Eido becomes an ink-first native app. The "2.5D / depth = variants" idea does *not* require native — it's achievable with CSS transforms/WebGL layering.

## Application shells (how a web app becomes a "real" app)

| Shell | What it is | Footprint | Notes for Eido |
|-------|-----------|-----------|----------------|
| **Browser (PWA)** | Just the web app, installable | none | Fastest to ship; offline via service worker + IndexedDB. Start here. |
| **Tauri 2** | Rust core + OS-native WebView | ~8–10MB, ~30–40MB RAM | Tauri 2 (late-2024) added **iOS + Android** — one codebase, desktop *and* mobile. Hoppscotch cut 165MB→8MB moving off Electron ([peerlist](https://peerlist.io/jagss/articles/tauri-vs-electron-a-deep-technical-comparison)). Best native option. |
| **Electron** | Bundled Chromium + Node | 80–150MB, 150–300MB RAM | Heavier, but maximum consistency and the most mature ecosystem. Figma's desktop app is Electron wrapping a WebGL tool — proves it handles graphics-heavy loads. |

**Tauri caveat:** because it uses the OS WebView (WebKit on macOS/iOS, WebView2 on Windows, WebKitGTK on Linux), you inherit per-platform rendering quirks — test WebGL/WebGPU behavior on each. Electron gives you one Chromium everywhere at the cost of size.

## Recommendation

- **Build the app in TypeScript/React, web-first, as a PWA.** This maximizes ecosystem leverage and lets you validate the *idea* fastest.
- **Plan to wrap in Tauri 2** once you want native desktop/mobile distribution, deeper OS integration (global capture hotkey, file system, menu bar quick-capture), or app-store presence.
- **Reserve Rust/Wasm** for a *proven* hot path (graph layout / context extraction at scale), never as the starting foundation.
- **Skip C++/Swift/Kotlin** unless handwriting/ink becomes a core, day-one feature — which your own doc scopes out.

See [07](07-architecture-decisions.md) for how this ties into the local-first storage story.
