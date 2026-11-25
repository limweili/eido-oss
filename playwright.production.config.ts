import { defineConfig } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const port = Number(process.env.EIDO_PRODUCTION_TEST_PORT ?? 5175)
const dataFile = process.env.EIDO_PRODUCTION_TEST_DATA_FILE
  ?? path.join(os.tmpdir(), `eido-production-interaction-${port}.json`)

prepareProductionDataFile(dataFile)
registerProductionDataFileCleanup(dataFile)

export default defineConfig({
  globalTeardown: './playwright.production.teardown.ts',
  testDir: './src/canvas',
  testMatch: '**/*.production.browser.test.ts',
  timeout: 60_000,
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port}`,
    env: {
      ...process.env,
      EIDO_DATA_FILE: dataFile,
    },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})

function prepareProductionDataFile(targetFile: string) {
  const timestamp = '2026-07-15T00:00:00.000Z'
  const ideaId = 'production-test-idea'
  mkdirSync(path.dirname(targetFile), { recursive: true })
  rmSync(targetFile, { force: true })
  rmSync(`${targetFile}.boards`, { force: true, recursive: true })
  writeFileSync(
    targetFile,
    JSON.stringify({
      version: 1,
      ideas: [
        {
          id: ideaId,
          name: 'Production interaction fixture',
          createdAt: timestamp,
          updatedAt: timestamp,
          lastOpenedAt: timestamp,
        },
      ],
      boards: {
        [ideaId]: {
          version: 1,
          cards: [
            {
              id: 'production-ask',
              kind: 'askAi',
              title: 'Synthetic Ask',
              blocks: [{ id: 'production-ask-block', text: 'Click to edit' }],
              position: { x: 120, y: 120 },
            },
          ],
          connections: [],
          outputs: [],
          runs: [],
          highlights: [],
          highlightTags: [],
          intentLog: [],
          compactionSummaries: [],
          updatedAt: timestamp,
        },
      },
      activeIdeaId: ideaId,
    }),
  )
}

function registerProductionDataFileCleanup(targetFile: string) {
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    rmSync(targetFile, { force: true })
    rmSync(`${targetFile}.boards`, { force: true, recursive: true })
  }
  process.once('exit', cleanup)
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      cleanup()
      process.kill(process.pid, signal)
    })
  }
}
