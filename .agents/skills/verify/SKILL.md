---
name: verify
description: Runtime-verify Eido canvas changes by driving the real app in a browser. Use when confirming a change works in the running app (not just tests).
---

# Verify Eido in the running app

## Launch (safe save handling)

Never run dev against the real save (`~/.eido/eido-v3-ideas.json`). Use a
disposable data file in gitignored `tmp/`:

```bash
mkdir -p tmp
EIDO_DATA_FILE='tmp/eido-dev-scratch-save.json' npm run dev -- --port 5273 &
curl -s http://localhost:5273/api/eido/status   # confirm dataFile is the scratch path, ideaCount 0
```

## Drive (Playwright, headless)

`@playwright/test` is a devDependency; write a plain `.mjs` script in `tmp/`
(so bare imports resolve against repo `node_modules`) using
`import { chromium } from '@playwright/test'`.

Dev-only hooks on `window` (available after load):

- `window.__eido.getState()` / `.setState({...})` — the zustand graph store.
  Seed cards/connections directly; read back `cards`, `connections`,
  `outputs`, `undoStack` to assert graph shape.
- `window.__EIDO_SET_VIEWPORT__({ x, y, zoom })` — position the canvas for
  screenshots.
- Wait for `window.__eido?.getState().hydrated` before interacting.

UI geography:

- Cards are React Flow nodes: `.react-flow__node[data-id="<cardId>"]`, kind
  classes like `.react-flow__node-askAi`.
- Connection handles: `type="target"` on the card's left,
  `type="source"` on the right (`.react-flow__handle.source` / `.target`).
  To draw a connection, mouse-drag handle-center to handle-center.
  **Gotcha:** the first drag after `setState` often no-ops while React Flow
  re-measures — wait ~800ms after seeding, hover the handle first, and retry
  a failed drag (check `connections.length` grew).
- Bottom dock buttons add cards: `.bottom-dock` + role button "Ask AI",
  "Add note", etc.
- "What will run" chain preview modal root: `.chain-preview`.
- Undo: `Meta+z` (press Escape first if a modal is open).

## Clean up

Kill the vite process and delete the scratch save + scripts from `tmp/`.
