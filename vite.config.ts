import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
// vitest/config, not vite: only its defineConfig types the `test` block below.
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { designTokensVitePlugin } from './scripts/vite/designTokensPlugin'
import { eidoStoragePlugin } from './scripts/vite/storagePlugin'
import { eidoLinkPreviewPlugin } from './scripts/vite/linkPreviewPlugin'

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Presence is the evidence-build signal: B-control explicitly sets `off`
  // and still needs the full owner diagnostics alongside C-candidate's `1`.
  const cachedPassiveBuildRequested = env.VITE_EIDO_CACHED_PASSIVE_CANDIDATE !== undefined
  const browserProductionBuild = command === 'build' && mode === 'production'
  return {
    // Vitest's own default is 5s, and nothing here used to say otherwise, so
    // every test in the repo inherited it silently. Tests that do real work
    // (SQLite stores, ZIP streaming, codesign on a packaged tree, the macOS
    // swap script waiting on a real process) legitimately run 2-7s, which left
    // them passing alone and failing in a full parallel run. The failure then
    // read as a signing or storage fault rather than a busy machine, which is
    // the worst kind of red: it accuses the code that is fine. State the bound
    // once, generously. A genuine hang still fails, and the CI job timeout is
    // the real backstop for anything that never returns.
    test: {
      exclude: [...configDefaults.exclude, '**/.claude/**', '**/.lanes/**', '**/.worktrees/**'],
      // jsdom provides its own storage. Node's global can shadow it in test workers.
      execArgv: ['--no-experimental-webstorage'],
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
    plugins: [designTokensVitePlugin(), react(), eidoLinkPreviewPlugin(), eidoStoragePlugin()],
    resolve: {
      alias: [
        ...(command === 'build' && !cachedPassiveBuildRequested
          ? [{
            find: './cachedPassiveCardAdapter',
            replacement: fileURLToPath(new URL('./src/canvas/cachedPassiveCardAdapter.production.tsx', import.meta.url)),
          }]
          : []),
        ...(browserProductionBuild
          ? [{
            find: './desktop/installedProfileRendererRuntime',
            replacement: fileURLToPath(new URL('./src/desktop/installedProfileRendererRuntime.browser.ts', import.meta.url)),
          }]
          : []),
      ],
    },
    build: {
      rolldownOptions: {
        output: {
          // Static ESM seam: the overview painter is required at startup (no
          // lazy visual gap), but keeping its dense canvas implementation out
          // of the application entry preserves the audited single-chunk cap.
          manualChunks(id) {
            return id.endsWith('/src/canvas/BoardOverviewLayer.tsx')
              ? 'board-overview'
              : undefined
          },
        },
      },
    },
  }
})
