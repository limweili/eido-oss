import { defineConfig } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const rawPort = Number(process.env.EIDO_PERF_PORT ?? 5177)
const port = Number.isFinite(rawPort) ? rawPort : 5177
const baseURL = `http://127.0.0.1:${port}`
const currentBoardSource = process.env.EIDO_CURRENT_BOARD_DATA_FILE
const dataFile = process.env.EIDO_PERF_DATA_FILE
  ? path.resolve(process.env.EIDO_PERF_DATA_FILE)
  : currentBoardSource
    ? path.join(os.tmpdir(), `eido-browser-perf-current-${process.pid}.json`)
    : path.join(os.tmpdir(), `eido-browser-perf-${port}.json`)
const cleanupDataFile = Boolean(currentBoardSource && !process.env.EIDO_PERF_DATA_FILE)

preparePerfDataFile(dataFile)
if (cleanupDataFile) registerPerfDataFileCleanup(dataFile)

export default defineConfig({
  testDir: './src/performance',
  testMatch: '**/*.perf.ts',
  timeout: 120_000,
  reporter: [['list']],
  workers: 1,
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    env: {
      ...process.env,
      EIDO_DATA_FILE: dataFile,
    },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})

function preparePerfDataFile(targetFile: string) {
  mkdirSync(path.dirname(targetFile), { recursive: true })

  if (!currentBoardSource) {
    rmSync(targetFile, { force: true })
    return
  }

  const sourceFile = path.resolve(currentBoardSource)
  if (!existsSync(sourceFile)) {
    throw new Error(`EIDO_CURRENT_BOARD_DATA_FILE does not exist: ${sourceFile}`)
  }

  copyFileSync(sourceFile, targetFile)
}

function registerPerfDataFileCleanup(targetFile: string) {
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    rmSync(targetFile, { force: true })
  }
  process.once('exit', cleanup)
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      cleanup()
      process.kill(process.pid, signal)
    })
  }
}
